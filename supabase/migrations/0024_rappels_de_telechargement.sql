-- Combien de rappels de téléchargement ont déjà été envoyés pour cette vente.
--
-- Un simple compteur plutôt que deux dates : les rappels partent à des moments
-- fixes après le paiement, donc leur rang suffit à savoir lequel est dû —
-- 0 pour le rappel de quelques minutes, 1 pour celui de quelques heures. Deux
-- colonnes de dates n'apprendraient rien de plus que `paid_at` ne dit déjà.
--
-- Il est incrémenté **après** l'envoi : si Resend refuse, le rappel sera
-- retenté au passage suivant plutôt que perdu.
alter table public.orders
  add column download_reminders integer not null default 0;
