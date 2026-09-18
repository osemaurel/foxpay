-- ============================================================
-- Les identifiants de paiement, boutique par boutique
-- ============================================================
-- Jusqu'ici les clés des processeurs étaient des secrets de plateforme : un
-- seul jeu pour tout le monde. Une deuxième boutique aurait donc encaissé sur
-- le compte SasPay de la première. Cette table fait descendre les clés au
-- niveau de la boutique.
--
-- Les clés ne sont pas stockées ici : seuls y figurent les identifiants des
-- secrets déposés dans le coffre (Vault), qui les chiffre. La table ne porte
-- en clair que les quatre derniers caractères, pour que le vendeur reconnaisse
-- la clé qu'il a collée sans jamais pouvoir la relire.

create table public.shop_processor_credentials (
  shop_id   uuid not null references public.shops (id) on delete cascade,
  processor text not null check (processor in ('pawapay', 'sebpay', 'saspay')),

  /** Identifiants des secrets dans le coffre, jamais les secrets eux-mêmes. */
  api_key_id        uuid,
  webhook_secret_id uuid,

  /** « …a4f2 » : de quoi reconnaître la clé, pas de quoi s'en servir. */
  api_key_hint text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (shop_id, processor)
);

-- RLS activé **sans aucune politique** : c'est volontaire. Personne, pas même
-- le propriétaire connecté, ne lit ni n'écrit cette table directement. Tout
-- passe par les trois fonctions ci-dessous, qui décident ce qui sort.
alter table public.shop_processor_credentials enable row level security;

-- ------------------------------------------------------------
-- La boutique de la plateforme
-- ------------------------------------------------------------
-- Les boutiques qui portent ce drapeau continuent d'utiliser les secrets
-- d'environnement historiques. Il vaut pour la boutique d'origine, et pour
-- elle seule : sans ce garde-fou, une boutique neuve sans clés retomberait sur
-- celles de la plateforme et encaisserait l'argent d'autrui.
alter table public.shops
  add column identifiants_plateforme boolean not null default false;

update public.shops set identifiants_plateforme = true;

-- ------------------------------------------------------------
-- Écriture : le vendeur dépose ses clés
-- ------------------------------------------------------------
-- SECURITY DEFINER parce que la table est fermée et que le coffre l'est aussi.
-- La première chose que fait la fonction est de vérifier que l'appelant est
-- bien le propriétaire de la boutique visée.
--
-- Une clé laissée vide ne remplace pas celle déjà en place : on ne veut pas
-- qu'un formulaire réenregistré sans toucher au champ efface une clé qui
-- fonctionne.
create or replace function public.enregistrer_identifiants_processeur(
  p_shop uuid,
  p_processor text,
  p_api_key text default null,
  p_webhook_secret text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ligne public.shop_processor_credentials;
  id_api  uuid;
  id_hook uuid;
  indice  text;
begin
  if not exists (
    select 1 from public.shops
    where id = p_shop and owner_id = (select auth.uid())
  ) then
    raise exception 'Boutique inconnue ou non autorisée';
  end if;

  if p_processor not in ('pawapay', 'sebpay', 'saspay') then
    raise exception 'Processeur inconnu : %', p_processor;
  end if;

  select * into ligne
  from public.shop_processor_credentials
  where shop_id = p_shop and processor = p_processor;

  id_api  := ligne.api_key_id;
  id_hook := ligne.webhook_secret_id;
  indice  := ligne.api_key_hint;

  if p_api_key is not null and btrim(p_api_key) <> '' then
    if id_api is null then
      id_api := vault.create_secret(
        btrim(p_api_key),
        format('%s:api:%s', p_processor, p_shop),
        'Clé API du marchand'
      );
    else
      perform vault.update_secret(id_api, btrim(p_api_key));
    end if;
    indice := right(btrim(p_api_key), 4);
  end if;

  if p_webhook_secret is not null and btrim(p_webhook_secret) <> '' then
    if id_hook is null then
      id_hook := vault.create_secret(
        btrim(p_webhook_secret),
        format('%s:webhook:%s', p_processor, p_shop),
        'Secret de signature des webhooks du marchand'
      );
    else
      perform vault.update_secret(id_hook, btrim(p_webhook_secret));
    end if;
  end if;

  insert into public.shop_processor_credentials
    (shop_id, processor, api_key_id, webhook_secret_id, api_key_hint)
  values (p_shop, p_processor, id_api, id_hook, indice)
  on conflict (shop_id, processor) do update
    set api_key_id        = excluded.api_key_id,
        webhook_secret_id = excluded.webhook_secret_id,
        api_key_hint      = excluded.api_key_hint,
        updated_at        = now();
end;
$$;

-- ------------------------------------------------------------
-- Lecture par le vendeur : ce qui est configuré, jamais le secret
-- ------------------------------------------------------------
create or replace function public.etat_identifiants_processeur(p_shop uuid)
returns table (
  processor text,
  api_key_hint text,
  webhook_configure boolean,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select c.processor, c.api_key_hint, c.webhook_secret_id is not null, c.updated_at
  from public.shop_processor_credentials c
  join public.shops s on s.id = c.shop_id
  where c.shop_id = p_shop and s.owner_id = (select auth.uid())
  order by c.processor;
$$;

-- ------------------------------------------------------------
-- Lecture par le serveur : les secrets en clair
-- ------------------------------------------------------------
-- Réservée au service_role, donc aux Edge Functions. Aucun compte connecté ne
-- peut l'appeler — c'est la seule porte vers le contenu du coffre.
create or replace function public.lire_identifiants_processeur(
  p_shop uuid,
  p_processor text
) returns table (api_key text, webhook_secret text)
language sql
security definer
set search_path = public
as $$
  select
    (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.api_key_id),
    (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.webhook_secret_id)
  from public.shop_processor_credentials c
  where c.shop_id = p_shop and c.processor = p_processor;
$$;

-- ------------------------------------------------------------
-- Qui a le droit d'appeler quoi
-- ------------------------------------------------------------
revoke all on function public.enregistrer_identifiants_processeur(uuid, text, text, text) from public;
revoke all on function public.etat_identifiants_processeur(uuid) from public;
revoke all on function public.lire_identifiants_processeur(uuid, text) from public;

grant execute on function public.enregistrer_identifiants_processeur(uuid, text, text, text) to authenticated;
grant execute on function public.etat_identifiants_processeur(uuid) to authenticated;
grant execute on function public.lire_identifiants_processeur(uuid, text) to service_role;
