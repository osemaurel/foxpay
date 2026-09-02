-- Le reliquat de l'historique : les commandes payées jamais livrées.
--
-- La neutralisation précédente (0029) ne visait que les commandes livrées.
-- Restaient dix-huit ventes des 17 et 18 août dont l'email de livraison n'est
-- jamais parti — la panne Resend. Leur `delivered_at` est nul, elles étaient
-- donc encore éligibles : le jour où l'une d'elles serait renvoyée, son
-- acheteur recevrait une demande d'avis pour un achat vieux de deux semaines.
--
-- On ferme. La demande d'avis ne concerne que les ventes à partir d'ici.
update public.orders
set review_requested_at = now()
where status = 'paid'
  and review_requested_at is null
  and created_at < timestamptz '2026-09-02 00:00:00+00';
