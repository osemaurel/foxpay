-- ============================================================
-- Passage de la « payment page » aux « checkouts » pawaPay
-- ============================================================
-- Un checkout est la référence unique de tout le paiement : si l'acheteur
-- rate son code PIN et réessaie, c'est la même référence. L'ancienne approche
-- créait une commande par tentative.

alter table public.orders rename column deposit_id to checkout_id;
alter index orders_deposit_id_key rename to orders_checkout_id_key;

-- Code court renvoyé par pawaPay. Il forme le chemin de l'URL de paiement et
-- revient en paramètre sur notre page de retour : c'est par lui qu'on retrouve
-- la commande, y compris si l'acheteur revient depuis un autre appareil.
alter table public.orders add column checkout_code text;
create unique index orders_checkout_code_key
  on public.orders (checkout_code)
  where checkout_code is not null;

-- Le pays n'est plus choisi par le vendeur : l'acheteur le choisit sur la page
-- de paiement. On ne le connaît donc qu'après coup, d'où le passage en nullable.
alter table public.orders alter column country drop not null;

comment on column public.orders.country is
  'Pays depuis lequel le paiement a été effectué, renseigné à la confirmation.';

-- La boutique n'a plus de pays : elle vend dans toute la zone CFA. XOF et XAF
-- étant arrimés à l'euro au même taux, un seul prix couvre les sept pays.
alter table public.shops drop column country;
