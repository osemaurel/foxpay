-- ============================================================
-- Pixel Facebook
-- ============================================================
-- Identifiant du pixel Meta de la boutique, pour mesurer les publicités :
-- vues de produit, mises en paiement, achats.
--
-- La contrainte n'est pas cosmétique. Cet identifiant est injecté dans un
-- script sur une page publique, et n'importe qui peut créer une boutique :
-- sans elle, un vendeur pourrait y glisser du code et l'exécuter chez ses
-- visiteurs. Un pixel Meta n'est qu'une suite de chiffres, on n'accepte que ça.

alter table public.shops add column facebook_pixel_id text
  check (facebook_pixel_id is null or facebook_pixel_id ~ '^[0-9]{8,20}$');

comment on column public.shops.facebook_pixel_id is
  'Identifiant du pixel Meta, chiffres uniquement. Vide = aucun suivi publicitaire.';
