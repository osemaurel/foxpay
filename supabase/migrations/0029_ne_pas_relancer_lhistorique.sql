-- Ne pas écrire à tous les acheteurs passés.
--
-- La demande d'avis part un jour après la livraison. Au moment où la
-- fonctionnalité est mise en service, 269 commandes remplissent déjà cette
-- condition depuis des semaines : sans cette ligne, le premier balayage
-- commencerait à leur écrire, vingt-cinq par quart d'heure, à des gens qui ont
-- acheté il y a un mois et n'attendent plus rien.
--
-- On les marque donc comme déjà sollicitées. Ce n'est pas un mensonge de plus
-- qu'un compteur remis à zéro : le champ dit « ne rien envoyer pour celle-ci »,
-- et c'est exactement ce qu'on veut. La demande ne partira que pour les ventes
-- à venir.
update public.orders
set review_requested_at = now()
where status = 'paid'
  and review_requested_at is null
  and delivered_at is not null;
