-- ============================================================
-- Vendre au Nigéria et au Ghana
-- ============================================================
-- Deux pays de plus hors zone franc CFA, donc deux devises de plus à convertir :
-- le naira (NGN) et le cedi (GHS). Le mécanisme est celui déjà en place pour la
-- RDC — un taux enregistré par le vendeur, jamais appelé à chaud — mais la
-- contrainte ne connaissait que les devises de la RDC.
--
-- Une ligne par devise et non plus une seule par boutique : le Nigéria, le Ghana
-- et la RDC se vendent en même temps. La règle qui reste vraie est « une seule
-- devise par pays » — c'est elle qui empêcherait pawaPay d'avoir à arbitrer
-- entre deux montants pour un même acheteur — et la clé primaire
-- (shop_id, currency) suffit à la tenir tant qu'aucune devise n'est partagée par
-- deux pays vendables.

alter table public.shop_currencies
  drop constraint shop_currencies_currency_check;

alter table public.shop_currencies
  add constraint shop_currencies_currency_check
  check (currency in ('CDF', 'USD', 'NGN', 'GHS'));

comment on column public.shop_currencies.currency is
  'Devise d''un pays hors zone franc CFA : CDF/USD (RDC), NGN (Nigéria), GHS (Ghana).';

comment on column public.shop_currencies.rate is
  'Combien d''unités de `currency` pour 1 FCFA. Saisi par le vendeur, à tenir à jour.';
