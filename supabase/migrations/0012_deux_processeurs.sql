-- ============================================================
-- Deux processeurs pour encaisser
-- ============================================================

-- `provider` désignait le prestataire de paiement, et n'en admettait qu'un.
alter table public.orders drop constraint orders_provider_check;
alter table public.orders add constraint orders_provider_check
  check (provider in ('pawapay', 'sebpay'));

comment on column public.orders.provider is
  'Le processeur qui a traité ce paiement : pawapay ou sebpay.';

-- SebPay renvoie tout de suite un lien d''autorisation pour les opérateurs qui
-- en demandent un (Wave). pawaPay le publie plus tard, on va le chercher à la
-- demande — d''où une colonne qui peut rester vide sans que ce soit anormal.
alter table public.orders add column authorization_url text;

comment on column public.orders.authorization_url is
  'Lien d''autorisation de l''opérateur, quand il en impose un (Wave).';

-- ============================================================
-- Cache du catalogue des processeurs
-- ============================================================
-- Les appels vers SebPay sortent par un relais à IP fixe, facturé à la
-- requête. Sans ce cache, chaque visiteur qui ouvre la page de paiement
-- consommerait deux appels — le quota mensuel partirait en quelques centaines
-- de visites, pour une liste qui bouge une fois par mois.
--
-- Aucune politique RLS : la table n'est lue et écrite que par les Edge
-- Functions en service_role. La boutique n'en voit que le résultat.

create table public.processor_catalogue (
  processor  text primary key check (processor in ('pawapay', 'sebpay')),
  payload    jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.processor_catalogue enable row level security;

comment on table public.processor_catalogue is
  'Dernier catalogue connu de chaque processeur : pays, opérateurs, contraintes.';
