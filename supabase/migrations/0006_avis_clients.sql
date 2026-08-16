-- ============================================================
-- Avis clients
-- ============================================================
-- Les avis sont saisis par le vendeur depuis son administration : ce sont des
-- témoignages qu'il recueille lui-même (WhatsApp, email) et recopie ici. Ils ne
-- sont pas déposés par les acheteurs, et l'affichage ne prétend donc jamais
-- qu'ils sont vérifiés.

create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,

  author_name   text not null,
  -- Ville, métier, entreprise… ce qui rend le témoignage situable.
  author_detail text,
  rating        smallint check (rating is null or rating between 1 and 5),
  body          text not null,

  position      integer not null default 0,
  is_visible    boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint reviews_author_name_length check (char_length(btrim(author_name)) between 1 and 80),
  constraint reviews_body_length check (char_length(btrim(body)) between 1 and 1000)
);

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

create index reviews_product_position_idx on public.reviews (product_id, position, created_at);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.reviews enable row level security;

-- Le public ne voit que les avis affichés ; les brouillons restent au vendeur.
create policy "reviews: lecture publique des avis affichés"
  on public.reviews for select
  to anon, authenticated
  using (is_visible);

create policy "reviews: le propriétaire gère les siens"
  on public.reviews for all
  to authenticated
  using (
    exists (
      select 1
      from public.products p
      join public.shops s on s.id = p.shop_id
      where p.id = reviews.product_id and s.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.products p
      join public.shops s on s.id = p.shop_id
      where p.id = reviews.product_id and s.owner_id = (select auth.uid())
    )
  );
