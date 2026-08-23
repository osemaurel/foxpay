-- Les retraits : sortir vers un numéro mobile money l'argent encaissé.
--
-- Une ligne par demande, et son `id` est aussi le `payoutId` envoyé à pawaPay.
-- C'est volontaire : pawaPay demande un UUID pour identifier le paiement, et
-- exige qu'il soit **écrit chez nous avant l'appel**. Un seul identifiant des
-- deux côtés, c'est ce qui permet de retrouver un retrait même si la réponse
-- HTTP se perd en route — et l'idempotence du côté pawaPay va avec : renvoyer
-- le même payoutId ne crée pas un second virement.
--
-- Le vendeur lit ses retraits, il n'en écrit aucun : comme les commandes, ils
-- ne sont créés et mis à jour que par les Edge Functions. C'est le seul endroit
-- de l'application qui fait sortir de l'argent.
create table public.payouts (
  id                      uuid primary key default gen_random_uuid(),
  shop_id                 uuid not null references public.shops(id) on delete cascade,

  provider                text not null default 'pawapay' check (provider in ('pawapay', 'sebpay')),
  country                 text not null,              -- ISO alpha-3, celui du portefeuille débité
  currency                text not null,
  amount                  numeric(14, 2) not null check (amount > 0),

  phone                   text not null,              -- MSISDN normalisé, sans le « + »
  mmo_provider            text not null,              -- MTN_MOMO_BEN, MOOV_BEN…

  status                  text not null default 'pending'
                            check (status in ('pending', 'completed', 'failed')),
  failure_code            text,
  failure_reason          text,
  provider_transaction_id text,

  -- Qui a demandé : un compte peut avoir plusieurs personnes, et un mouvement
  -- d'argent doit toujours porter un nom.
  requested_by            uuid references auth.users(id),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index payouts_shop_idx on public.payouts (shop_id, created_at desc);

create trigger payouts_set_updated_at
  before update on public.payouts
  for each row execute function public.set_updated_at();

alter table public.payouts enable row level security;

create policy "payouts: le vendeur lit ses retraits"
  on public.payouts for select
  to authenticated
  using (
    exists (
      select 1 from public.shops s
      where s.id = payouts.shop_id and s.owner_id = (select auth.uid())
    )
  );
