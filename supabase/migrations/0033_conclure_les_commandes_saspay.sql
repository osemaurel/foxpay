-- Les commandes SasPay ne restaient jamais conclues.
--
-- Le balayage ne réinterrogeait SasPay qu'entre la douzième et la vingt-
-- septième minute. Passé ce délai, plus rien : ni conclusion, ni échec, ni
-- courrier. Quatre-vingt-deux commandes burkinabè sont restées « en attente »
-- pendant des semaines — l'acheteur sans réponse, le vendeur avec des ventes
-- fantômes dans ses statistiques.
--
-- Deux corrections.
--
-- D'abord, SasPay est réinterrogé aussi longtemps que pawaPay : c'est lui qui
-- redemande au gateway à chaque appel, donc chaque passage a une chance de
-- trancher. SebPay garde sa fenêtre courte — ses collectes abandonnées ne
-- bougent plus jamais, et c'est la règle des soixante minutes qui les ferme.
--
-- Ensuite, ce que SasPay laisse en attente trois heures durant est déclaré
-- échoué. Une invite de code PIN vit quelques minutes ; à trois heures, il n'y
-- a plus rien à attendre. Si SasPay confirmait malgré tout un paiement plus
-- tard, son webhook rouvre la commande — voir settleSaspayWebhook.
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
      and created_at < now() - interval '12 minutes'
      and created_at > now() - interval '7 days'
      and (
        provider in ('pawapay', 'saspay')
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

  -- Les acheteurs qui n'ont pas ouvert leur lien.
  perform net.http_post(
    url := 'https://vodgtcipxqkebronwbmu.supabase.co/functions/v1/rappels',
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );

  -- Ceux qui l'ont ouvert, la veille : on leur demande ce qu'ils en ont pensé.
  perform net.http_post(
    url := 'https://vodgtcipxqkebronwbmu.supabase.co/functions/v1/demande-avis',
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );

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
