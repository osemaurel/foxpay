-- Le balayage couvre aussi les retraits.
--
-- La page des retraits redemande le statut tant qu'elle est ouverte, mais le
-- vendeur lance un virement et ferme son onglet — c'est même le comportement
-- normal quand on attend de l'argent sur son téléphone. Sans ce passage, le
-- retrait resterait affiché « en cours » jusqu'à sa prochaine visite.
--
-- On passe par le callback public : il ne croit rien de ce qu'on lui envoie,
-- il redemande le statut à pawaPay. Lui écrire ne coûte donc rien de plus
-- qu'une vérification qui aurait eu lieu de toute façon — et pawaPay, contrairement
-- à SebPay, s'interroge sans passer par le relais facturé.
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

  -- Deux minutes : un virement mobile money aboutit en quelques secondes, et
  -- le délai de grâce de la fonction protège déjà les demandes toutes fraîches.
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
