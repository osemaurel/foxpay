-- La Guinée, et son franc.
--
-- Le pays était déjà routé (GIN/mtn vers SasPay) mais n'apparaissait pas sur la
-- page de paiement : on ne propose que les pays dont on sait fixer le prix, et
-- le franc guinéen n'était nulle part. À ne pas confondre avec la
-- Guinée-Bissau, qui est en zone CFA et fonctionnait déjà.
--
-- Comme pour le naira et le cedi, le taux reste à la main du vendeur : sans
-- taux enregistré, le pays reste invisible. Mieux vaut ne pas proposer un pays
-- que d'y afficher un prix faux.
alter table public.shop_currencies
  drop constraint shop_currencies_currency_check;

alter table public.shop_currencies
  add constraint shop_currencies_currency_check
  check (currency in ('CDF', 'USD', 'NGN', 'GHS', 'GNF'));
