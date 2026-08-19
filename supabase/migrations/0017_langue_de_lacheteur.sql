-- ============================================================
-- La langue de l'acheteur, gardée sur la commande
-- ============================================================
-- Le tunnel d'achat s'affiche dans la langue de l'appareil, et un sélecteur en
-- pied de page permet d'en changer. Mais l'email de livraison, la relance et la
-- page de téléchargement arrivent plus tard : au moment de les écrire, plus
-- personne n'est devant l'écran pour dire quelle langue l'acheteur lit.
--
-- On la note donc à la création de la commande. C'est aussi la seule façon de
-- rester cohérent quand quelqu'un ouvre son email sur un autre appareil que
-- celui où il a payé.
--
-- Français par défaut : c'est la langue des commandes déjà passées, et celle de
-- la boutique tant que le vendeur n'écrit pas en anglais.

alter table public.orders
  add column locale text not null default 'fr'
  check (locale in ('fr', 'en'));

comment on column public.orders.locale is
  'Langue lue par l''acheteur au moment du paiement : emails et page de téléchargement s''y conforment.';
