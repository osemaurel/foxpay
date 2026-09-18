-- ============================================================
-- L'inscription sur invitation
-- ============================================================
-- Jusqu'ici le formulaire de connexion laissait n'importe qui créer un compte :
-- l'inscription était ouverte sur internet. Tant que la plateforme n'avait
-- qu'un vendeur c'était sans conséquence visible — un compte sans boutique ne
-- fait rien. Maintenant qu'une boutique peut encaisser, l'entrée se ferme :
-- pour créer un compte, il faut une invitation remise par le propriétaire.
--
-- Le verrou n'est pas dans cette table. Il est chez Supabase Auth, dont
-- l'inscription publique est désactivée : le point d'entrée `signUp` refuse
-- tout le monde, sans exception. Les comptes sont créés par la fonction
-- `inscription`, côté serveur, qui exige d'abord une invitation valable. Un
-- contrôle fait seulement ici, ou seulement dans le navigateur, se contournerait
-- en appelant l'API d'authentification directement.

create table public.invitations (
  code uuid primary key default gen_random_uuid(),

  /** « pour Awa, Abidjan » : de quoi se souvenir à qui on l'a donnée. */
  note text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  /** Renseignés à l'usage. Une invitation ne sert qu'une fois. */
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null
);

-- RLS activé sans aucune politique, comme pour les identifiants : le code d'une
-- invitation est un mot de passe d'entrée, il ne traîne pas dans une table que
-- le navigateur peut lire. Tout passe par les fonctions ci-dessous.
alter table public.invitations enable row level security;

-- ------------------------------------------------------------
-- Qui a le droit d'inviter
-- ------------------------------------------------------------
-- Le propriétaire de la boutique d'origine, et lui seul. C'est déjà lui qui
-- porte `identifiants_plateforme` ; inutile d'inventer un second rôle
-- d'administrateur pour une plateforme qui n'en a qu'un.
create or replace function public.est_proprietaire_plateforme()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shops
    where owner_id = (select auth.uid()) and identifiants_plateforme
  );
$$;

-- ------------------------------------------------------------
-- Créer une invitation
-- ------------------------------------------------------------
create or replace function public.creer_invitation(p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nouveau uuid;
begin
  if not public.est_proprietaire_plateforme() then
    raise exception 'Non autorisé';
  end if;

  insert into public.invitations (note, created_by)
  values (nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()))
  returning code into nouveau;

  return nouveau;
end;
$$;

-- ------------------------------------------------------------
-- Les voir
-- ------------------------------------------------------------
-- Le code est renvoyé en entier : celui qui invite doit pouvoir recopier le
-- lien s'il l'a perdu. Il ne sort que pour lui, et jamais pour une invitation
-- déjà utilisée — à ce stade il ne sert plus à rien et n'a plus à circuler.
create or replace function public.lister_invitations()
returns table (
  code uuid,
  note text,
  created_at timestamptz,
  used_at timestamptz,
  utilisee_par text
)
language sql
security definer
set search_path = public
as $$
  select
    case when i.used_at is null then i.code end,
    i.note,
    i.created_at,
    i.used_at,
    (select u.email::text from auth.users u where u.id = i.used_by)
  from public.invitations i
  where public.est_proprietaire_plateforme()
  order by i.created_at desc;
$$;

-- ------------------------------------------------------------
-- En annuler une
-- ------------------------------------------------------------
-- Un code communiqué par erreur, ou à quelqu'un qui n'en veut plus. On ne
-- supprime que celles qui n'ont pas servi : effacer une invitation utilisée
-- ferait disparaître la trace de l'entrée d'un compte.
create or replace function public.revoquer_invitation(p_code uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.est_proprietaire_plateforme() then
    raise exception 'Non autorisé';
  end if;

  delete from public.invitations where code = p_code and used_at is null;
end;
$$;

-- ------------------------------------------------------------
-- La consommer, au moment de créer le compte
-- ------------------------------------------------------------
-- Réservée au service_role, donc à la fonction `inscription`.
--
-- La réservation et la vérification sont le même ordre SQL : le `where used_at
-- is null` porte sur la ligne verrouillée par l'update. Deux inscriptions
-- simultanées avec le même code ne peuvent donc pas passer toutes les deux —
-- la seconde ne trouve plus rien à mettre à jour et repart bredouille.
create or replace function public.reserver_invitation(p_code uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with pris as (
    update public.invitations
    set used_at = now()
    where code = p_code and used_at is null
    returning code
  )
  select exists (select 1 from pris);
$$;

-- La création du compte peut échouer après la réservation — email déjà pris,
-- mot de passe refusé. L'invitation doit alors redevenir utilisable, sinon une
-- faute de frappe la brûlerait définitivement.
create or replace function public.liberer_invitation(p_code uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.invitations
  set used_at = null
  where code = p_code and used_by is null;
$$;

-- Le compte est créé : on note qui c'est.
create or replace function public.attribuer_invitation(p_code uuid, p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.invitations set used_by = p_user where code = p_code;
$$;

-- ------------------------------------------------------------
-- Qui a le droit d'appeler quoi
-- ------------------------------------------------------------
revoke all on function public.est_proprietaire_plateforme() from public;
revoke all on function public.creer_invitation(text) from public;
revoke all on function public.lister_invitations() from public;
revoke all on function public.revoquer_invitation(uuid) from public;
revoke all on function public.reserver_invitation(uuid) from public;
revoke all on function public.liberer_invitation(uuid) from public;
revoke all on function public.attribuer_invitation(uuid, uuid) from public;

grant execute on function public.est_proprietaire_plateforme() to authenticated;
grant execute on function public.creer_invitation(text) to authenticated;
grant execute on function public.lister_invitations() to authenticated;
grant execute on function public.revoquer_invitation(uuid) to authenticated;

grant execute on function public.reserver_invitation(uuid) to service_role;
grant execute on function public.liberer_invitation(uuid) to service_role;
grant execute on function public.attribuer_invitation(uuid, uuid) to service_role;
