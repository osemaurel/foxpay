-- SasPay, troisième processeur.
--
-- Les trois colonnes qui nomment un processeur portaient une liste fermée à
-- deux valeurs. C'est volontaire — une faute de frappe dans un nom de
-- processeur doit être refusée par la base, pas router un paiement dans le
-- vide — mais il faut donc l'ouvrir explicitement à chaque nouvelle
-- intégration.
alter table public.orders
  drop constraint orders_provider_check,
  add constraint orders_provider_check
    check (provider in ('pawapay', 'sebpay', 'saspay'));

alter table public.payment_routes
  drop constraint payment_routes_processor_check,
  add constraint payment_routes_processor_check
    check (processor in ('pawapay', 'sebpay', 'saspay'));

alter table public.processor_catalogue
  drop constraint processor_catalogue_processor_check,
  add constraint processor_catalogue_processor_check
    check (processor in ('pawapay', 'sebpay', 'saspay'));

-- Les retraits SasPay existent aussi dans leur API, mais rien n'est branché
-- pour l'instant : la colonne est ouverte pour ne pas avoir à y revenir.
alter table public.payouts
  drop constraint payouts_provider_check,
  add constraint payouts_provider_check
    check (provider in ('pawapay', 'sebpay', 'saspay'));
