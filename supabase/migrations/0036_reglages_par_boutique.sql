-- ============================================================
-- Les deux réglages qui restaient codés en dur
-- ============================================================
-- Le numéro WhatsApp du service après-vente et l'adresse à qui SasPay envoie
-- ses reçus étaient écrits dans le code, donc les mêmes pour tout le monde.
-- Avec une deuxième boutique, l'acheteur d'un autre vendeur écrirait au
-- premier, et les reçus d'un autre vendeur tomberaient dans la boîte du
-- premier. Les deux descendent au niveau de la boutique.

-- ------------------------------------------------------------
-- Le numéro WhatsApp
-- ------------------------------------------------------------
-- Sur `shops`, qui est en lecture publique : ce numéro est fait pour être vu.
-- Il figure déjà en toutes lettres dans les emails et sur les pages de recours.
alter table public.shops
  add column whatsapp_support text;

-- La boutique d'origine garde le sien, à l'identique.
update public.shops
set whatsapp_support = '+1 (825) 897-7760'
where identifiants_plateforme;

-- ------------------------------------------------------------
-- L'adresse déclarée à SasPay
-- ------------------------------------------------------------
-- Celle-ci ne va pas sur `shops` : la table est lisible par n'importe quel
-- visiteur, et cette adresse est la boîte privée du vendeur, pas son adresse
-- de contact. Elle rejoint donc la table fermée des identifiants, où elle est
-- d'ailleurs à sa place : c'est un réglage SasPay, au même titre que la clé.
alter table public.shop_processor_credentials
  add column email_recus text;

-- La boutique d'origine n'a pas de ligne ici — elle encaisse avec les secrets
-- d'environnement. On lui en crée une pour ce seul réglage : `api_key_id` reste
-- nul, et `identifiants_plateforme` continue de décider quelles clés servent.
insert into public.shop_processor_credentials (shop_id, processor, email_recus)
select id, 'saspay', 'my2023projects@gmail.com'
from public.shops
where identifiants_plateforme
on conflict (shop_id, processor) do update
  set email_recus = excluded.email_recus;

-- ------------------------------------------------------------
-- Les trois fonctions, mises à jour
-- ------------------------------------------------------------
-- Leur signature change, donc il faut les supprimer avant de les recréer.
drop function if exists public.enregistrer_identifiants_processeur(uuid, text, text, text);
drop function if exists public.etat_identifiants_processeur(uuid);
drop function if exists public.lire_identifiants_processeur(uuid, text);

-- Écriture : le vendeur dépose ses clés et son adresse de reçus.
--
-- Une clé laissée vide ne remplace pas celle déjà en place. L'adresse, si :
-- c'est un texte que le vendeur relit à l'écran, et il doit pouvoir l'effacer
-- pour revenir au comportement normal de SasPay — les reçus à l'acheteur.
create or replace function public.enregistrer_identifiants_processeur(
  p_shop uuid,
  p_processor text,
  p_api_key text default null,
  p_webhook_secret text default null,
  p_email_recus text default null
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
    (shop_id, processor, api_key_id, webhook_secret_id, api_key_hint, email_recus)
  values (p_shop, p_processor, id_api, id_hook, indice, nullif(btrim(coalesce(p_email_recus, '')), ''))
  on conflict (shop_id, processor) do update
    set api_key_id        = excluded.api_key_id,
        webhook_secret_id = excluded.webhook_secret_id,
        api_key_hint      = excluded.api_key_hint,
        email_recus       = excluded.email_recus,
        updated_at        = now();
end;
$$;

-- Lecture par le vendeur : ce qui est configuré, jamais le secret.
create or replace function public.etat_identifiants_processeur(p_shop uuid)
returns table (
  processor text,
  api_key_hint text,
  webhook_configure boolean,
  email_recus text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select c.processor, c.api_key_hint, c.webhook_secret_id is not null, c.email_recus, c.updated_at
  from public.shop_processor_credentials c
  join public.shops s on s.id = c.shop_id
  where c.shop_id = p_shop and s.owner_id = (select auth.uid())
  order by c.processor;
$$;

-- Lecture par le serveur : les secrets en clair, et l'adresse des reçus.
create or replace function public.lire_identifiants_processeur(
  p_shop uuid,
  p_processor text
) returns table (api_key text, webhook_secret text, email_recus text)
language sql
security definer
set search_path = public
as $$
  select
    (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.api_key_id),
    (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.webhook_secret_id),
    c.email_recus
  from public.shop_processor_credentials c
  where c.shop_id = p_shop and c.processor = p_processor;
$$;

revoke all on function public.enregistrer_identifiants_processeur(uuid, text, text, text, text) from public;
revoke all on function public.etat_identifiants_processeur(uuid) from public;
revoke all on function public.lire_identifiants_processeur(uuid, text) from public;

grant execute on function public.enregistrer_identifiants_processeur(uuid, text, text, text, text) to authenticated;
grant execute on function public.etat_identifiants_processeur(uuid) to authenticated;
grant execute on function public.lire_identifiants_processeur(uuid, text) to service_role;
