import { admin } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { createPayout, getBalances, predictProvider } from '../_shared/pawapay.ts'
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

  let body: { action?: string; phone?: string; amount?: number; payout_id?: string }
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
      case 'soldes':
        return json({ soldes: await getBalances() })

      case 'creer':
        return await creer(shop.id, auth.user.id, body.phone ?? '', Number(body.amount))

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
  phone: string,
  montant: number,
): Promise<Response> {
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

  // pawaPay reconnaît le numéro, le normalise et dit à quel opérateur il est
  // rattaché : c'est plus sûr que de le demander au vendeur, et ça donne le
  // pays, donc le portefeuille à débiter.
  const numero = await predictProvider(phone.replace(/\D/g, ''))
  if (!numero) {
    return fail("Ce numéro n'est rattaché à aucun opérateur mobile money connu.")
  }

  // Le portefeuille du pays de ce numéro. Quand un pays en a plusieurs (la RDC
  // a un compte en francs congolais et un en dollars), on prend le mieux garni.
  const soldes = await getBalances()
  const portefeuille = soldes
    .filter((s) => s.country === numero.country)
    .sort((a, b) => b.balance - a.balance)[0]

  if (!portefeuille) {
    return fail(`Aucun portefeuille pawaPay pour ${numero.country}.`, 409)
  }

  if (montant > portefeuille.balance) {
    return fail(
      `Solde insuffisant : ${portefeuille.balance} ${portefeuille.currency} disponible sur le portefeuille ${numero.country}.`,
      409,
    )
  }

  const { data: retrait, error } = await admin
    .from('payouts')
    .insert({
      shop_id: shopId,
      provider: 'pawapay',
      country: numero.country,
      currency: portefeuille.currency,
      amount: montant,
      phone: numero.phoneNumber,
      mmo_provider: numero.provider,
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
      provider: numero.provider,
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
