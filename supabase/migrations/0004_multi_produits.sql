-- ============================================================
-- Passage au multi-produit
-- ============================================================
-- La v1 limitait volontairement à un produit par boutique, via une contrainte
-- d'unicité sur products.shop_id. On la lève, et on donne à chaque produit son
-- propre lien public.

alter table public.products
  drop constraint products_shop_id_key;

create index products_shop_id_idx on public.products (shop_id);

-- ------------------------------------------------------------
-- Lien public du produit : /boutique/<boutique>/p/<produit>
-- ------------------------------------------------------------
alter table public.products
  add column slug text,
  -- Ordre d'affichage sur la page boutique, réglable par le vendeur.
  add column position integer not null default 0;

-- Reprise des produits existants : on dérive le lien du titre. translate()
-- suffit pour le français et évite d'installer l'extension unaccent.
update public.products
set slug = nullif(
  trim(both '-' from regexp_replace(
    lower(translate(
      title,
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ',
      'aaaaaaceeeeiiiinooooouuuuyyoa'
    )),
    '[^a-z0-9]+', '-', 'g'
  )),
  ''
);

-- Titre sans aucun caractère exploitable, ou collision entre deux produits de
-- la même boutique : on retombe sur un suffixe tiré de l'identifiant.
update public.products p
set slug = coalesce(p.slug, 'produit') || '-' || left(p.id::text, 6)
where p.slug is null
   or exists (
     select 1 from public.products autre
     where autre.shop_id = p.shop_id
       and autre.slug = p.slug
       and autre.id <> p.id
   );

alter table public.products
  alter column slug set not null;

alter table public.products
  add constraint products_slug_format
  check (slug ~ '^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$' or slug ~ '^[a-z0-9]$');

-- Deux produits d'une même boutique ne peuvent pas partager un lien ; deux
-- boutiques différentes, si.
create unique index products_shop_slug_key on public.products (shop_id, slug);

create index products_shop_position_idx on public.products (shop_id, position, created_at);
