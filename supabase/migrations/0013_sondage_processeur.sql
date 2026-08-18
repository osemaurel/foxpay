-- ============================================================
-- Trace du dernier sondage auprès du processeur
-- ============================================================
-- La page de paiement interroge le statut toutes les trois secondes pendant
-- cinq minutes. Chez pawaPay c'est sans conséquence : l'appel part en direct.
-- Chez SebPay il sort par un relais à IP fixe facturé à la requête, et cent
-- appels par vente videraient le quota.
--
-- Le webhook signé de SebPay reste le chemin normal. Cette colonne sert au
-- filet de sécurité : elle espace les sondages quand le webhook tarde.

alter table public.orders add column provider_checked_at timestamptz;

comment on column public.orders.provider_checked_at is
  'Dernière interrogation directe du processeur, pour espacer les sondages.';
