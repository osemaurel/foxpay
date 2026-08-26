-- Le balayage déclenche aussi les rappels de téléchargement.
--
-- Un quart d'heure entre deux passages, c'est exactement la cadence que
-- demandent les rappels : le premier part au bout de quinze minutes, le second
-- six heures après lui. Pas besoin d'une seconde tâche planifiée.
--
-- La fonction `rappels` ne prend aucun paramètre et relit l'état de la base à
-- chaque appel : l'appeler plus souvent n'enverrait pas un courrier de plus.
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
