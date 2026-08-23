-- Trancher les commandes que plus personne ne regarde.
--
-- Une commande n'est tranchée que tant que l'acheteur a sa page ouverte :
-- c'est elle qui interroge le processeur toutes les quelques secondes. S'il
-- ferme l'onglet — et c'est ce que fait quelqu'un dont le paiement n'aboutit
-- pas — la commande reste « en attente » pour toujours. Elle pollue les
-- chiffres, et surtout le bouton de relance la refuse : le vendeur ne peut
-- même pas récupérer le panier abandonné.
--
-- Deux étages, dans cet ordre, parce qu'ils n'ont pas la même autorité :
--
--   1. **Demander.** On rejoue `order-status` sur les commandes en attente,
--      qui va chercher le vrai statut chez pawaPay ou SebPay. C'est la seule
--      source de vérité : elle sait dire « payé » aussi bien que « échoué ».
--   2. **Conclure.** SebPay laisse une collecte abandonnée « pending »
--      indéfiniment — il ne dira jamais non. Passé une heure sans réponse,
--      alors qu'on l'a bien interrogé, l'invite de code PIN a expiré depuis
--      longtemps : la commande est déclarée échouée.
--
-- L'ordre compte. Conclure sans avoir demandé, ce serait risquer de marquer
-- « échoué » quelqu'un qui a réellement payé et dont le callback s'est perdu.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.balayer_commandes_en_attente()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  commande record;
begin
  -- Étage 1 — les deux processeurs ne coûtent pas la même chose à interroger,
  -- donc on ne les interroge pas au même rythme :
  --
  --   - pawaPay se demande en direct, gratuitement, et finit toujours par
  --     donner un verdict : on redemande tant que la commande est en attente ;
  --   - SebPay sort par le relais à IP fixe, facturé à la requête : fenêtre
  --     étroite, une seule passe. Douze minutes laissent à l'acheteur le temps
  --     de finir seul, et au-delà de vingt-sept redemander n'apprend plus rien
  --     — c'est l'étage 2 qui tranchera.
  for commande in
    select id
    from public.orders
    where status = 'pending'
      and created_at < now() - interval '12 minutes'
      and created_at > now() - interval '7 days'
      and (
        provider = 'pawapay'
        or created_at > now() - interval '27 minutes'
      )
    order by created_at
    limit 50
  loop
    perform net.http_post(
      url := 'https://vodgtcipxqkebronwbmu.supabase.co/functions/v1/order-status',
      body := jsonb_build_object('order_id', commande.id),
      timeout_milliseconds := 20000
    );
  end loop;

  -- Étage 2 — pour SebPay seulement, parce que lui seul laisse une collecte
  -- abandonnée « pending » sans jamais dire non. `provider_checked_at` est la
  -- preuve qu'on l'a bien interrogé au moins une fois : sans elle on ne
  -- conclut pas, une commande jamais vérifiée pouvant cacher un paiement
  -- réussi. pawaPay n'a pas besoin de cet étage — il tranche de lui-même, et
  -- l'étage 1 le lui redemande jusqu'à ce qu'il le fasse.
  update public.orders
  set status = 'failed',
      failure_code = 'PAYMENT_NOT_APPROVED',
      failure_reason = 'Sans réponse une heure après : invite de code PIN expirée.'
  where status = 'pending'
    and provider = 'sebpay'
    and created_at < now() - interval '60 minutes'
    and provider_checked_at is not null;
end;
$$;

-- Un quart d'heure : assez fréquent pour que la fenêtre de l'étage 1 ne laisse
-- passer aucune commande, assez espacé pour ne pas repasser deux fois sur la
-- même — donc pour ne pas payer deux fois la requête chez le relais.
select cron.schedule(
  'balayage-commandes',
  '*/15 * * * *',
  $$select public.balayer_commandes_en_attente()$$
);
