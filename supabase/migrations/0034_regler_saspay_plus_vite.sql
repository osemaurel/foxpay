-- Régler les ventes SasPay plus vite quand l'acheteur a quitté la page.
--
-- Le webhook de SasPay n'arrive jamais : preuve faite, chaque vente SasPay
-- différée se conclut pile sur un tic du balayage (:00, :15, :30, :45), jamais
-- à une minute quelconque. Tant que l'acheteur reste sur la page, le suivi la
-- règle en quelques secondes ; dès qu'il part (Wave), il faut attendre le
-- balayage — jusqu'à 27 minutes, 22 en moyenne. C'est le « ça reste en
-- attente » que voit le vendeur.
--
-- Deux leviers, sans toucher à pawaPay ni SebPay qui, eux, ont un webhook qui
-- marche :
--   - SasPay est réinterrogé dès 2 minutes au lieu de 12 ;
--   - le balayage passe toutes les 5 minutes au lieu de 15 (voir cron plus bas).
-- Ensemble, l'attente maximale tombe de ~27 à ~7 minutes. Réinterroger plus tôt
-- ne risque rien : on ne fait que redemander le statut, jamais pousser un
-- second paiement.
--
-- Les rappels et les demandes d'avis, eux, n'ont aucune raison de tourner cinq
-- fois plus souvent : ils restent à leur cadence de quinze minutes, déclenchés
-- seulement au début de chaque quart d'heure.
create or replace function public.balayer_commandes_en_attente()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  commande record;
  retrait record;
begin
  for commande in
    select id
    from public.orders
    where status = 'pending'
      and created_at > now() - interval '7 days'
      and (
        (provider = 'saspay' and created_at < now() - interval '2 minutes')
        or (provider = 'pawapay' and created_at < now() - interval '12 minutes')
        or (provider = 'sebpay'
            and created_at < now() - interval '12 minutes'
            and created_at > now() - interval '27 minutes')
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

  for retrait in
    select id
    from public.payouts
    where status = 'pending'
      and provider = 'pawapay'
      and created_at < now() - interval '2 minutes'
      and created_at > now() - interval '7 days'
    order by created_at
    limit 50
  loop
    perform net.http_post(
      url := 'https://vodgtcipxqkebronwbmu.supabase.co/functions/v1/pawapay-payout-callback',
      body := jsonb_build_object('payoutId', retrait.id),
      timeout_milliseconds := 20000
    );
  end loop;

  -- Rappels et demandes d'avis : une fois par quart d'heure, pas à chaque
  -- passage de cinq minutes.
  if (extract(minute from now())::int % 15) < 5 then
    perform net.http_post(
      url := 'https://vodgtcipxqkebronwbmu.supabase.co/functions/v1/rappels',
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );

    perform net.http_post(
      url := 'https://vodgtcipxqkebronwbmu.supabase.co/functions/v1/demande-avis',
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  end if;

  update public.orders
  set status = 'failed',
      failure_code = 'PAYMENT_NOT_APPROVED',
      failure_reason = 'Sans réponse une heure après : invite de code PIN expirée.'
  where status = 'pending'
    and provider = 'sebpay'
    and created_at < now() - interval '60 minutes'
    and provider_checked_at is not null;

  update public.orders
  set status = 'failed',
      failure_code = 'PAYMENT_NOT_APPROVED',
      failure_reason = 'Sans réponse trois heures après : demande de paiement jamais confirmée.'
  where status = 'pending'
    and provider = 'saspay'
    and created_at < now() - interval '3 hours';
end;
$$;

-- Toutes les cinq minutes.
select cron.alter_job(1, schedule => '*/5 * * * *');
