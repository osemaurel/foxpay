-- Fige le search_path des deux fonctions helper.
--
-- Sans ça, leur search_path suit celui de l'appelant : un rôle qui contrôle son
-- search_path peut faire pointer un nom non qualifié vers ses propres objets.
-- owns_shop_folder décide de l'accès aux buckets, elle ne doit pas en dépendre.
-- Tous les noms qu'elles utilisent sont déjà qualifiés, search_path = '' passe.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.owns_shop_folder(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.shops s
    where s.owner_id = (select auth.uid())
      and s.id::text = (storage.foldername(object_name))[1]
  );
$$;
