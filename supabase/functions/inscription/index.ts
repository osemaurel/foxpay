import { admin } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'

/**
 * Créer un compte vendeur, sur invitation.
 *
 * L'inscription publique de Supabase Auth est désactivée : `signUp` refuse
 * tout le monde depuis le navigateur. C'est le vrai verrou. Cette fonction est
 * la seule porte qui reste, et elle ne s'ouvre que sur un code d'invitation
 * remis par le propriétaire de la plateforme.
 *
 * L'ordre compte. Le code est **réservé avant** la création du compte, par un
 * seul ordre SQL qui vérifie et marque en même temps : deux personnes qui
 * s'inscriraient à la même seconde avec le même code ne peuvent pas passer
 * toutes les deux. Si la création échoue ensuite — email déjà pris, mot de
 * passe trop court — la réservation est relâchée, sinon une faute de frappe
 * brûlerait l'invitation pour de bon.
 *
 * Le compte est créé avec l'email déjà confirmé. Le tour de vérification par
 * email n'apprendrait rien de plus : l'invitation est elle-même la preuve que
 * cette personne était attendue, et un lien de confirmation perdu dans les
 * indésirables laisserait un vendeur invité à la porte.
 */

type Corps = {
  code?: string
  email?: string
  password?: string
}

/** Comme sur le formulaire, et comme l'exige Supabase Auth. */
const MIN_MOT_DE_PASSE = 8

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  let corps: Corps
  try {
    corps = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

  const code = corps.code?.trim().toLowerCase() ?? ''
  const email = corps.email?.trim().toLowerCase() ?? ''
  const password = corps.password ?? ''

  // Un code mal formé est refusé avant d'atteindre la base : inutile de lui
  // faire coûter une requête, et le message est le même que pour un code
  // inconnu — on ne dit pas à quelqu'un qui cherche au hasard s'il s'approche.
  if (!UUID.test(code)) return fail("Cette invitation n'est pas valable", 403)
  if (!email.includes('@')) return fail('Cet email est invalide')
  if (password.length < MIN_MOT_DE_PASSE) {
    return fail(`Le mot de passe doit faire au moins ${MIN_MOT_DE_PASSE} caractères`)
  }

  const { data: reserve, error: erreurReserve } = await admin.rpc('reserver_invitation', {
    p_code: code,
  })

  if (erreurReserve) {
    console.error('inscription: réservation', erreurReserve)
    return fail("La création du compte n'a pas abouti. Réessaie dans un instant.", 500)
  }

  if (!reserve) return fail("Cette invitation n'est pas valable, ou a déjà servi", 403)

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !data?.user) {
    await admin.rpc('liberer_invitation', { p_code: code })

    const message = (error?.message ?? '').toLowerCase()
    if (message.includes('already been registered') || message.includes('already registered')) {
      return fail('Un compte existe déjà avec cet email. Connecte-toi plutôt.', 409)
    }

    console.error('inscription: création', error)
    return fail("La création du compte n'a pas abouti", 400)
  }

  // Le compte existe : on note qui a utilisé l'invitation. Un échec ici ne
  // remet rien en cause — le compte est bon, il manquerait juste une ligne
  // dans la liste des invitations.
  const { error: erreurTrace } = await admin.rpc('attribuer_invitation', {
    p_code: code,
    p_user: data.user.id,
  })
  if (erreurTrace) console.error('inscription: traçabilité', erreurTrace)

  return json({ ok: true })
})
