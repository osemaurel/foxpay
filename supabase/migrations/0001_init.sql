-- ============================================================
-- Foxpay — boutique digitale (1 boutique, 1 produit)
-- Schéma initial : shops, products, orders + storage + RLS
-- ============================================================

-- ------------------------------------------------------------
-- Helper : mise à jour automatique de updated_at
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 1. shops
-- ------------------------------------------------------------
create table public.shops (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null unique references auth.users (id) on delete cascade,
  slug          text not null unique,
  name          text not null,
  description   text,                       -- markdown ou texte simple
  logo_url      text,                       -- URL publique (bucket shop-assets)
  banner_url    text,
  accent_color  text not null default '#2563eb',
  contact_email text,                       -- expéditeur / réponse acheteur
  -- Pays d'opération, ISO 3166-1 alpha-3. pawaPay l'exige pour router le
  -- paiement vers les bons opérateurs mobile money.
  country       text not null default 'CIV',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint shops_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  constraint shops_accent_color_format check (accent_color ~* '^#[0-9a-f]{6}$'),
  constraint shops_country_format check (country ~ '^[A-Z]{3}$')
);

create trigger shops_set_updated_at
  before update on public.shops
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. products  (un seul produit par boutique en v1)
-- ------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null unique references public.shops (id) on delete cascade,
  title       text not null,
  description text,
  price       integer not null check (price >= 0),   -- XOF : entier, pas de décimales
  currency    text not null default 'XOF',
  cover_url   text,                                   -- image de couverture (bucket public)
  file_path   text,                                   -- chemin dans le bucket privé product-files
  file_name   text,                                   -- nom affiché / nom du fichier téléchargé
  file_size   bigint,
  is_active   boolean not null default false,         -- false tant que le fichier n'est pas uploadé
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. orders
-- ------------------------------------------------------------
create table public.orders (
  id                      uuid primary key default gen_random_uuid(),
  shop_id                 uuid not null references public.shops (id) on delete cascade,
  product_id              uuid not null references public.products (id) on delete restrict,

  -- acheteur
  buyer_email             text not null,
  buyer_name              text,
  buyer_phone             text,                       -- souvent requis par le mobile money

  -- montant figé au moment de la commande (le prix du produit peut changer après)
  amount                  integer not null check (amount >= 0),
  currency                text not null default 'XOF',

  -- paiement (pawaPay)
  status                  text not null default 'pending'
                            check (status in ('pending', 'paid', 'failed', 'cancelled')),
  provider                text not null default 'pawapay'
                            check (provider in ('pawapay')),
  -- deposit_id est généré par NOUS (UUIDv4) et envoyé à pawaPay : c'est la clé
  -- de réconciliation, elle existe même si la réponse HTTP se perd.
  deposit_id              uuid not null default gen_random_uuid(),
  country                 text not null,              -- copié de shops.country
  provider_transaction_id text,                       -- id côté opérateur mobile money
  failure_reason          text,                       -- rempli si status = 'failed'
  checkout_url            text,                       -- redirectUrl de la Payment Page
  paid_at                 timestamptz,

  -- livraison
  download_token          uuid not null default gen_random_uuid(),
  download_expires_at     timestamptz,                -- posé à la confirmation (now() + 24h)
  download_count          integer not null default 0,
  max_downloads           integer not null default 3,
  delivered_at            timestamptz,                -- email de livraison envoyé

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- Idempotence du webhook : pawaPay rejoue ses callbacks, et deposit_id est
-- l'identifiant stable de la transaction. Une commande = un deposit_id.
create unique index orders_deposit_id_key on public.orders (deposit_id);

create unique index orders_download_token_key on public.orders (download_token);
create index orders_shop_created_idx on public.orders (shop_id, created_at desc);
create index orders_buyer_email_idx on public.orders (buyer_email);

-- ============================================================
-- RLS
-- ============================================================
alter table public.shops    enable row level security;
alter table public.products enable row level security;
alter table public.orders   enable row level security;

-- --- shops ---------------------------------------------------
-- La boutique est publique (page /boutique/:slug).
create policy "shops: lecture publique"
  on public.shops for select
  to anon, authenticated
  using (true);

create policy "shops: le propriétaire gère sa boutique"
  on public.shops for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- --- products ------------------------------------------------
-- Lecture publique : le produit est affiché sur la page boutique.
-- file_path est lisible mais sans valeur : le bucket product-files est privé,
-- aucun rôle client n'a de policy dessus. Seule une URL signée générée
-- côté serveur (service_role, après paiement) donne accès au fichier.
create policy "products: lecture publique"
  on public.products for select
  to anon, authenticated
  using (true);

create policy "products: le propriétaire gère son produit"
  on public.products for all
  to authenticated
  using (
    exists (
      select 1 from public.shops s
      where s.id = products.shop_id and s.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.shops s
      where s.id = products.shop_id and s.owner_id = (select auth.uid())
    )
  );

-- --- orders --------------------------------------------------
-- Aucun accès public. Les commandes sont créées et mises à jour
-- exclusivement par les Edge Functions (service_role, qui contourne RLS).
create policy "orders: le vendeur lit ses ventes"
  on public.orders for select
  to authenticated
  using (
    exists (
      select 1 from public.shops s
      where s.id = orders.shop_id and s.owner_id = (select auth.uid())
    )
  );

-- ============================================================
-- Storage
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('shop-assets',   'shop-assets',   true,  5 * 1024 * 1024,
     array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('product-files', 'product-files', false, 200 * 1024 * 1024, null)
on conflict (id) do nothing;

-- Convention de chemin pour les deux buckets : <shop_id>/<fichier>
create or replace function public.owns_shop_folder(object_name text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.shops s
    where s.owner_id = (select auth.uid())
      and s.id::text = (storage.foldername(object_name))[1]
  );
$$;

-- --- shop-assets : lecture publique, écriture par le propriétaire ---
create policy "shop-assets: lecture publique"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'shop-assets');

create policy "shop-assets: le propriétaire écrit dans son dossier"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'shop-assets' and public.owns_shop_folder(name))
  with check (bucket_id = 'shop-assets' and public.owns_shop_folder(name));

-- --- product-files : privé. Le propriétaire gère son dossier, ---
-- --- personne d'autre n'y accède sans URL signée.             ---
create policy "product-files: le propriétaire gère son dossier"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'product-files' and public.owns_shop_folder(name))
  with check (bucket_id = 'product-files' and public.owns_shop_folder(name));

-- ============================================================
-- Consommation d'un droit de téléchargement
-- ============================================================
-- Les trois vérifications (payé / non expiré / quota) et l'incrément du
-- compteur doivent être atomiques, sinon deux clics simultanés sur le lien
-- passent tous les deux le contrôle de quota. Le verrou de ligne s'en charge.
--
-- Appelée uniquement par l'Edge Function `download` en service_role.
create or replace function public.consume_download(p_token uuid)
returns table (file_path text, file_name text, refusal text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order
  from public.orders
  where download_token = p_token
  for update;

  if not found then
    return query select null::text, null::text, 'not_found'::text;
    return;
  end if;

  if v_order.status <> 'paid' then
    return query select null::text, null::text, 'not_paid'::text;
    return;
  end if;

  if v_order.download_expires_at is null or v_order.download_expires_at < now() then
    return query select null::text, null::text, 'expired'::text;
    return;
  end if;

  if v_order.download_count >= v_order.max_downloads then
    return query select null::text, null::text, 'exhausted'::text;
    return;
  end if;

  update public.orders
  set download_count = download_count + 1
  where id = v_order.id;

  return query
  select p.file_path, p.file_name, null::text
  from public.products p
  where p.id = v_order.product_id;
end;
$$;

revoke all on function public.consume_download(uuid) from public, anon, authenticated;
grant execute on function public.consume_download(uuid) to service_role;
