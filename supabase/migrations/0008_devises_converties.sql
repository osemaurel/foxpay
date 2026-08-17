-- ============================================================
-- Devises hors zone CFA (RDC)
-- ============================================================
-- XOF et XAF partagent la même valeur, donc un seul prix couvre sept pays.
-- La RDC sort de cette parité : il faut convertir.
--
-- Le taux est stocké, pas appelé à chaud. Un appel à une API de change au
-- moment du paiement serait un point de panne unique : si elle est lente ou
-- indisponible, l'acheteur ne peut plus payer. Un taux enregistré fonctionne
-- toujours, et le vendeur voit exactement le montant que verra son client.
-- La contrepartie est qu'il faut le tenir à jour — d'où updated_at, que
-- l'administration utilise pour signaler un taux qui date.

create table public.shop_currencies (
  shop_id    uuid not null references public.shops (id) on delete cascade,

  -- Devises supplémentaires proposées par pawaPay hors zone CFA.
  -- La RDC est le seul pays qui accepte l'USD, sur ses trois opérateurs.
  currency   text not null check (currency in ('CDF', 'USD')),

  -- Combien d'unités de `currency` pour 1 unité du prix (exprimé en XOF).
  rate       numeric(20, 8) not null check (rate > 0),

  -- Le CDF ne gère pas les décimales chez Vodacom ; l'USD en accepte deux.
  decimals   smallint not null default 0 check (decimals between 0 and 2),

  -- Arrondi commercial, en unités entières : 66 123 CDF devient 66 100.
  -- Ignoré dès que decimals > 0.
  round_to   integer not null default 1 check (round_to > 0),

  is_active  boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (shop_id, currency)
);

create trigger shop_currencies_set_updated_at
  before update on public.shop_currencies
  for each row execute function public.set_updated_at();

alter table public.shop_currencies enable row level security;

-- Aucun accès public : la conversion est faite côté serveur au moment de créer
-- le paiement, la boutique n'affiche que le prix de référence.
create policy "shop_currencies: le propriétaire gère les siennes"
  on public.shop_currencies for all
  to authenticated
  using (
    exists (
      select 1 from public.shops s
      where s.id = shop_currencies.shop_id and s.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.shops s
      where s.id = shop_currencies.shop_id and s.owner_id = (select auth.uid())
    )
  );
