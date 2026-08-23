-- La fenêtre de téléchargement s'ouvre quand l'email part, pas quand le
-- paiement est confirmé.
--
-- Les deux dates étaient confondues parce qu'elles tombent à la même seconde
-- sur une vente normale. Elles se séparent au moment qui compte : quand le
-- vendeur clique « renvoyer l'email » pour dépanner un acheteur. Jusqu'ici ce
-- renvoi expédiait le lien d'origine, avec son échéance d'origine — donc un
-- lien déjà mort dès que la vente datait de plus de sept jours, très
-- exactement le cas où un acheteur écrit pour réclamer son fichier.
--
-- La règle vit ici plutôt que dans la fonction de renvoi parce que c'est déjà
-- ici que vit toute la politique de téléchargement — consume_download(), le
-- quota, l'échéance. Tout chemin qui livre, aujourd'hui ou demain, ouvre un
-- lien utilisable, sans avoir à y penser.
create or replace function public.rouvrir_lien_a_la_livraison()
returns trigger
language plpgsql
as $$
begin
  -- Uniquement le passage « pas encore livré » → « livré » d'une commande
  -- payée. Le renvoi manuel remet delivered_at à null avant de réexpédier :
  -- c'est ce retour à null qui fait de l'envoi suivant une nouvelle livraison.
  if new.status = 'paid' and new.delivered_at is not null and old.delivered_at is null then
    new.download_expires_at := now() + interval '7 days';
    new.download_count := 0;
  end if;

  return new;
end;
$$;

create trigger orders_rouvrir_lien
  before update of delivered_at on public.orders
  for each row execute function public.rouvrir_lien_a_la_livraison();
