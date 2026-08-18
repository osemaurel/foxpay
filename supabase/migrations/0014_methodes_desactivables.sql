-- ============================================================
-- Retirer une méthode de paiement de la boutique
-- ============================================================
-- Un pays expose parfois six opérateurs quand deux suffisent. Les afficher
-- tous allonge la page de paiement et fait hésiter l'acheteur au pire moment.
-- Le vendeur peut désormais n'en proposer que ce qu'il veut.
--
-- La table ne porte plus seulement un routage : elle porte les réglages d'une
-- méthode pour une boutique. D'où deux changements.

alter table public.payment_routes add column enabled boolean not null default true;

comment on column public.payment_routes.enabled is
  'Faux quand le vendeur retire cette méthode de sa page de paiement.';

-- `processor` devient facultatif : une ligne peut n'exister que pour désactiver
-- une méthode qu'un seul processeur propose — il n'y a alors rien à router.
-- NULL signifie « pas de choix, applique le défaut ».
alter table public.payment_routes alter column processor drop not null;

comment on column public.payment_routes.processor is
  'Processeur imposé par le vendeur, ou NULL pour laisser le défaut décider.';

comment on table public.payment_routes is
  'Réglages par méthode de paiement et par boutique : proposée ou non, et par quel processeur.';
