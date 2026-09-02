-- ============================================================
-- Les avis déposés par les acheteurs
-- ============================================================
-- À ne pas confondre avec la table `reviews`, qui existe déjà : celle-là garde
-- les témoignages que le vendeur recopie lui-même sur ses fiches produit —
-- choisis, publics, faits pour vendre. Ceux-ci sont écrits par l'acheteur après
-- son achat, ne sont jamais affichés en boutique, et n'appartiennent qu'au
-- vendeur. Deux objets différents, deux tables : les mélanger aurait fini par
-- publier sur une fiche produit ce que quelqu'un croyait dire en privé.

create table public.order_feedback (
  id       uuid primary key default gen_random_uuid(),

  -- Une commande, un avis. Cette contrainte d'unicité est la seule chose qui
  -- empêche un lien d'email, rouvert dix fois, de déposer dix avis.
  order_id uuid not null unique references public.orders (id) on delete cascade,

  rating   smallint not null check (rating between 1 and 5),
  -- Le commentaire est facultatif : beaucoup de gens donnent une note et s'en
  -- vont, et leur note vaut mieux que rien.
  body     text,

  created_at timestamptz not null default now(),

  constraint order_feedback_body_length
    check (body is null or char_length(btrim(body)) <= 2000)
);

create index order_feedback_created_idx on public.order_feedback (created_at desc);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.order_feedback enable row level security;

-- Le vendeur, et personne d'autre. Ces avis contiennent ce qu'un acheteur a
-- écrit en croyant s'adresser à lui seul.
create policy "order_feedback: le propriétaire lit les siens"
  on public.order_feedback for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      join public.shops s on s.id = o.shop_id
      where o.id = order_feedback.order_id and s.owner_id = (select auth.uid())
    )
  );

-- Le vendeur peut effacer un avis de sa liste — il n'a en revanche aucun moyen
-- d'en modifier le texte : un avis retouché ne serait plus un avis.
create policy "order_feedback: le propriétaire efface les siens"
  on public.order_feedback for delete
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      join public.shops s on s.id = o.shop_id
      where o.id = order_feedback.order_id and s.owner_id = (select auth.uid())
    )
  );

-- Aucune politique d'insertion, volontairement : le dépôt passe par la fonction
-- `avis`, en service_role, qui est le seul endroit où l'on vérifie que la
-- commande est bien payée.

-- ------------------------------------------------------------
-- Le suivi de la demande
-- ------------------------------------------------------------
alter table public.orders add column review_requested_at timestamptz;

comment on column public.orders.review_requested_at is
  'Quand la demande d''avis est partie. Nul = pas encore demandée. Une seule par commande.';
