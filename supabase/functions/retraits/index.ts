import { admin } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import {
  createPayout,
  getBalances,
  getPayoutMethods,
  predictProvider,
} from '../_shared/pawapay.ts'
import { reglerRetrait } from '../_shared/retrait.ts'

/**
 * Le guichet des retraits, réservé au vendeur.
 *
 * Trois gestes de la même page — voir les soldes, lancer un retrait, en
 * rafraîchir le statut — dans une seule fonction. Les séparer en trois
 * endpoints reviendrait à recopier trois fois le même contrôle d'identité,
 * pour trois appels que personne n'utilise l'un sans l'autre.
 *
 * C'est le seul endroit de l'application qui fait **sortir** de l'argent. Tout
 * y est donc revérifié côté serveur : l'identité du demandeur, le fait que la
 * boutique lui appartienne, l'opérateur derrière le numéro, et surtout le
 * montant contre le solde réel — jamais contre ce que le navigateur affirme.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  const jeton = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jeton) return fail('Authentification requise', 401)

  const { data: auth } = await admin.auth.getUser(jeton)
  if (!auth?.user) return fail('Session expirée', 401)

  let body: {
    action?: string
    phone?: string
    amount?: number
    methode?: string
    payout_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

  // La boutique de la personne connectée : c'est elle qui porte les retraits.
  const { data: shop } = await admin
    .from('shops')
    .select('id')
    .eq('owner_id', auth.user.id)
    .maybeSingle()

  if (!shop) return fail('Aucune boutique', 404)

  try {
    switch (body.action) {
      case 'soldes': {
        // Les deux ensemble : une méthode sans son solde ne se choisit pas, et
        // les demander séparément laisserait la page afficher un instant une
        // liste qui ne correspond plus aux portefeuilles.
        const [soldes, methodes] = await Promise.all([getBalances(), getPayoutMethods()])
        return json({ soldes, methodes })
      }

      case 'creer':
        return await creer(
          shop.id,
          auth.user.id,
          body.methode ?? '',
          body.phone ?? '',
          Number(body.amount),
        )

      case 'statut': {
        const id = body.payout_id?.trim()
        if (!id) return fail('Retrait manquant')

        // Le retrait doit appartenir à cette boutique avant qu'on aille en
        // demander quoi que ce soit à pawaPay.
        const { data: retrait } = await admin
          .from('payouts')
          .select('id')
          .eq('id', id)
          .eq('shop_id', shop.id)
          .maybeSingle()

        if (!retrait) return fail('Retrait introuvable', 404)

        return json({ statut: await reglerRetrait(id) })
      }

      default:
        return fail('Action inconnue')
    }
  } catch (e) {
    console.error('retraits', e)
    return fail(`pawaPay est injoignable : ${(e as Error).message}`, 502)
  }
})

/**
 * Lance un retrait.
 *
 * L'ordre des étapes n'est pas négociable : la ligne est écrite **avant**
 * l'appel à pawaPay. Son `id` est le `payoutId` envoyé, donc même si la
 * réponse se perd, le virement reste retrouvable et reprenable — c'est
 * exactement ce que pawaPay demande.
 */
async function creer(
  shopId: string,
  userId: string,
  methodeChoisie: string,
  phone: string,
  montant: number,
): Promise<Response> {
  if (!methodeChoisie.trim()) return fail('Méthode de retrait manquante')
  if (!phone.trim()) return fail('Numéro manquant')
  if (!Number.isFinite(montant) || montant <= 0) return fail('Montant invalide')

  // Un retrait déjà en cours bloque les suivants : deux clics sur le bouton ne
  // doivent pas partir deux fois.
  const { data: enCours } = await admin
    .from('payouts')
    .select('id')
    .eq('shop_id', shopId)
    .eq('status', 'pending')
    .maybeSingle()

  if (enCours) {
    return fail('Un retrait est déjà en cours. Attends qu\'il soit tranché.', 409)
  }

  // La méthode est le choix du vendeur, et c'est elle qui commande : elle donne
  // l'opérateur destinataire, le pays, donc le portefeuille débité. On la
  // revérifie contre le catalogue de pawaPay — un identifiant fabriqué à la
  // main ne doit pas pouvoir désigner un portefeuille au hasard.
  const [soldes, methodes] = await Promise.all([getBalances(), getPayoutMethods()])

  const methode = methodes.find((m) => m.provider === methodeChoisie)
  if (!methode) return fail('Cette méthode de retrait n\'existe pas.', 409)

  if (methode.status === 'CLOSED') {
    return fail(`${methode.name} ne reçoit pas de virement en ce moment.`, 409)
  }

  const portefeuille = soldes.find(
    (s) => s.country === methode.country && s.currency === methode.currency,
  )

  if (!portefeuille) {
    return fail(`Aucun portefeuille pawaPay pour ${methode.country}.`, 409)
  }

  if (montant > portefeuille.balance) {
    return fail(
      `Solde insuffisant : ${portefeuille.balance} ${portefeuille.currency} disponible sur le portefeuille ${methode.country}.`,
      409,
    )
  }

  // Les bornes de l'opérateur, dites tout de suite plutôt que par un rejet
  // quelques secondes plus tard.
  if (methode.minAmount !== null && montant < methode.minAmount) {
    return fail(`${methode.name} n'accepte pas moins de ${methode.minAmount} ${methode.currency}.`)
  }
  if (methode.maxAmount !== null && montant > methode.maxAmount) {
    return fail(
      `${methode.name} n'accepte pas plus de ${methode.maxAmount} ${methode.currency} par virement.`,
    )
  }

  // pawaPay valide et normalise le numéro. On garde son verdict sur le **pays**
  // — envoyer un numéro ivoirien sur le portefeuille béninois n'a pas de sens —
  // mais pas sur l'opérateur : un numéro porté est deviné à côté, et c'est le
  // vendeur qui sait à quel portefeuille son numéro est rattaché.
  const numero = await predictProvider(phone.replace(/\D/g, ''))
  if (!numero) {
    return fail("Ce numéro n'est reconnu par aucun opérateur mobile money.")
  }

  if (numero.country !== methode.country) {
    return fail(
      `Ce numéro est enregistré en ${numero.country}, pas en ${methode.country}. Choisis la méthode correspondante.`,
    )
  }

  const { data: retrait, error } = await admin
    .from('payouts')
    .insert({
      shop_id: shopId,
      provider: 'pawapay',
      country: methode.country,
      currency: portefeuille.currency,
      amount: montant,
      phone: numero.phoneNumber,
      mmo_provider: methode.provider,
      requested_by: userId,
    })
    .select('id')
    .single()

  if (error || !retrait) return fail("Le retrait n'a pas pu être enregistré", 500)

  let reponse
  try {
    reponse = await createPayout({
      // L'identifiant de la ligne sert de payoutId : un seul des deux côtés.
      payoutId: retrait.id,
      // Les devises servies ici n'ont pas de centimes.
      amount: String(Math.round(montant)),
      currency: portefeuille.currency,
      phoneNumber: numero.phoneNumber,
      provider: methode.provider,
      customerMessage: 'Retrait foxpay',
    })
  } catch (e) {
    // Sans réponse claire, on ne conclut pas : le virement est peut-être parti.
    // Le retrait reste en attente, son statut sera redemandé.
    console.error('createPayout', e)
    return json({ payout_id: retrait.id, statut: 'pending' })
  }

  if (reponse.status === 'REJECTED') {
    await admin
      .from('payouts')
      .update({
        status: 'failed',
        failure_code: reponse.failureCode,
        failure_reason: reponse.failureReason,
      })
      .eq('id', retrait.id)

    return json(
      {
        payout_id: retrait.id,
        statut: 'failed',
        error: reponse.failureReason ?? 'pawaPay a refusé ce retrait.',
      },
      409,
    )
  }

  return json({ payout_id: retrait.id, statut: 'pending' })
}
