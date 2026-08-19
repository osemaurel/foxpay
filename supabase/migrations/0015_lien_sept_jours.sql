-- ============================================================
-- Le lien de téléchargement vit une semaine, plus 24 heures
-- ============================================================
-- Vingt-quatre heures était une valeur prudente, choisie sans raison
-- commerciale : un acheteur qui ouvre ses mails le lendemain soir, ou qui
-- change de téléphone, se retrouvait devant un lien mort et devait écrire au
-- vendeur. C'est `max_downloads` qui protège du partage, pas la durée.
--
-- La fenêtre est posée à la confirmation du paiement par les Edge Functions.
-- Cette migration ne fait que remettre le commentaire d'accord avec le code ;
-- les commandes déjà payées gardent l'échéance qu'elles avaient.

comment on column public.orders.download_expires_at is
  'Fin de validité du lien, posée à la confirmation du paiement (now() + 7 jours).';
