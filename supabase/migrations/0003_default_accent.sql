-- Le thème de la boutique est sombre : le bleu par défaut était un reste de
-- l'ancien rendu clair et ressortait mal sur fond noir. Le bronze de la
-- direction artistique tient sur le noir sans vibrer.
--
-- Seule la valeur par défaut change : les boutiques existantes gardent la
-- couleur choisie par leur propriétaire.
alter table public.shops
  alter column accent_color set default '#bf854a';
