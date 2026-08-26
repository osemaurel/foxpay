-- Quand est parti le dernier rappel de téléchargement.
--
-- Le compteur seul ne suffisait pas. Le second rappel était espacé depuis
-- `paid_at`, ce qui marche pour une vente qu'on suit en direct mais s'effondre
-- dès qu'une commande est prise en charge en retard : un achat de six heures
-- remplissait les deux conditions au même instant, et l'acheteur recevait les
-- deux courriers coup sur coup. C'est arrivé à trois personnes.
--
-- Le délai se compte donc maintenant depuis le rappel précédent. Le premier
-- reste ancré à l'achat — il n'a pas de prédécesseur.
alter table public.orders
  add column last_reminder_at timestamptz;

-- Les rappels déjà partis sont datés de maintenant : sans ça, les commandes
-- déjà relancées une fois repartiraient aussitôt pour la seconde.
update public.orders
set last_reminder_at = now()
where download_reminders > 0;
