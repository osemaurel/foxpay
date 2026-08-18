-- ============================================================
-- Routage des méthodes de paiement entre processeurs
-- ============================================================
-- La boutique n'encaisse plus par un seul prestataire. pawaPay et SebPay
-- couvrent des pays et des opérateurs qui se chevauchent en partie : le
-- vendeur choisit, pour chaque méthode, lequel des deux la traite.
--
-- Une méthode absente de cette table suit la règle par défaut : le seul
-- processeur qui la propose, et pawaPay quand les deux la proposent — c'est
-- lui qui encaisse aujourd'hui, une intégration ne doit pas changer de main
-- toute seule.

create table public.payment_routes (
  shop_id   uuid not null references public.shops (id) on delete cascade,

  -- ISO 3166-1 alpha-3, comme partout ailleurs dans cette base. SebPay parle
  -- en alpha-2 ; la conversion se fait dans son module, pas ici.
  country   char(3) not null,

  -- Slug canonique de l'opérateur, commun aux deux processeurs : « mtn »,
  -- « orange », « moov », « wave »… Chaque module fait la correspondance avec
  -- son propre codage (MTN_MOMO_CIV chez pawaPay, mtn chez SebPay).
  method    text not null check (method ~ '^[a-z0-9_]{2,32}$'),

  processor text not null check (processor in ('pawapay', 'sebpay')),

  updated_at timestamptz not null default now(),

  primary key (shop_id, country, method)
);

create trigger payment_routes_set_updated_at
  before update on public.payment_routes
  for each row execute function public.set_updated_at();

alter table public.payment_routes enable row level security;

-- Aucun accès public : le routage est une décision de gestion. La page de
-- paiement ne voit que le résultat, calculé côté serveur.
create policy "payment_routes: le propriétaire gère les siennes"
  on public.payment_routes for all
  to authenticated
  using (
    exists (
      select 1 from public.shops s
      where s.id = payment_routes.shop_id and s.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.shops s
      where s.id = payment_routes.shop_id and s.owner_id = (select auth.uid())
    )
  );

comment on table public.payment_routes is
  'Quel processeur traite quelle méthode de paiement, par boutique.';
