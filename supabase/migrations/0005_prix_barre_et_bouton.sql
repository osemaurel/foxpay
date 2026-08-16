-- ============================================================
-- Prix barré et bouton d'achat personnalisable
-- ============================================================

alter table public.products
  -- Prix de référence affiché barré à côté du prix réel. Nul = pas de promo.
  add column compare_at_price integer,
  -- Texte du bouton d'achat. Nul = on retombe sur « Acheter » côté app, ce qui
  -- évite d'avoir à remplir la colonne pour tous les produits existants.
  add column cta_label text,
  -- Couleur du bouton propre au produit. Nul = couleur d'accent de la boutique.
  add column cta_color text;

alter table public.products
  add constraint products_compare_at_price_check
  check (compare_at_price is null or compare_at_price > 0),

  -- Un prix barré inférieur au prix réel afficherait une remise négative :
  -- c'est une erreur de saisie, pas une offre.
  add constraint products_compare_at_price_above
  check (compare_at_price is null or compare_at_price > price),

  add constraint products_cta_label_length
  check (cta_label is null or char_length(btrim(cta_label)) between 1 and 40),

  add constraint products_cta_color_format
  check (cta_color is null or cta_color ~* '^#[0-9a-f]{6}$');
