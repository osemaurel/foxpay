-- ============================================================
-- Le paiement se fait sur la page de checkout
-- ============================================================
-- On abandonne la page hébergée par pawaPay (checkouts) pour l'API « deposits ».
-- L'acheteur choisit son pays et son opérateur chez nous, saisit son numéro, et
-- la demande de paiement part vers son téléphone sans quitter la boutique.
--
-- Conséquence sur le modèle : un dépôt porte un seul montant dans une seule
-- devise pour un seul opérateur. Ces trois informations n'étaient pas connues
-- avant, elles le sont maintenant dès l'initiation.

alter table public.orders rename column checkout_id to deposit_id;
alter index orders_checkout_id_key rename to orders_deposit_id_key;

comment on column public.orders.deposit_id is
  'UUIDv4 généré par nous et envoyé à pawaPay : clé de réconciliation qui existe même si la réponse HTTP se perd.';

-- La page hébergée n'existe plus : ni code de checkout, ni URL de redirection.
alter table public.orders drop column checkout_code;
alter table public.orders drop column checkout_url;

-- L'opérateur mobile money choisi par l'acheteur (ex. MTN_MOMO_CIV).
-- La colonne `provider` existante désigne le prestataire de paiement (pawapay),
-- pas l'opérateur : deux notions différentes, deux colonnes.
alter table public.orders add column mmo_provider text;

-- Code d'échec pawaPay (PAYMENT_NOT_APPROVED, INSUFFICIENT_BALANCE…).
-- `failure_reason` garde le message d'origine, écrit en anglais pour les
-- équipes techniques ; le code, lui, se traduit en une phrase utile à
-- l'acheteur sans avoir à analyser du texte libre.
alter table public.orders add column failure_code text;

-- Ce que l'acheteur paie réellement, qui n'est pas toujours le prix de
-- référence : en RDC le montant est converti, et l'USD a des décimales que
-- `amount` (integer, pensé pour le franc CFA) ne sait pas porter.
alter table public.orders add column charged_amount numeric(20, 4);
alter table public.orders add column charged_currency text;

comment on column public.orders.amount is
  'Prix de référence figé à la commande, en franc CFA.';
comment on column public.orders.charged_amount is
  'Montant réellement demandé à l''acheteur, dans la devise de son pays.';

-- Le pays est désormais connu dès l'initiation, plus seulement à la
-- confirmation : c'est l'acheteur qui l'a choisi.
comment on column public.orders.country is
  'Pays du portefeuille mobile money utilisé pour payer, choisi par l''acheteur.';
