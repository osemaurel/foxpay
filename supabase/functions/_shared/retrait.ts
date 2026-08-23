import { admin } from './admin.ts'
import { getPayout } from './pawapay.ts'

/**
 * Règle un retrait à partir de son état réel chez pawaPay.
 *
 * Deux appelants : le callback, et le bouton de rafraîchissement de la page
 * des retraits. Le callback pawaPay n'est pas signé, donc son corps ne fait
 * jamais foi — comme pour les encaissements, on redemande. Les deux chemins
 * passent ici pour que le verdict soit le même quel qu'il soit.
 *
 * Idempotent : la mise à jour est filtrée sur status='pending'.
 */
export type EtatRetrait = 'pending' | 'completed' | 'failed' | 'unknown'

/**
 * Délai avant de conclure qu'une demande n'est jamais partie. Juste après
 * l'insertion, la ligne peut légitimement exister avant que pawaPay ne la
 * connaisse : conclure tout de suite ferait échouer un virement en cours.
 */
const GRACE_MS = 60_000

export async function reglerRetrait(payoutId: string): Promise<EtatRetrait> {
  const { data } = await admin
    .from('payouts')
    .select('id, status, created_at')
    .eq('id', payoutId)
    .maybeSingle()

  if (!data) return 'unknown'
  if (data.status !== 'pending') return data.status as EtatRetrait

  const etat = await getPayout(payoutId)

  // pawaPay ne connaît pas ce retrait : la demande n'a jamais abouti. L'argent
  // n'a donc pas bougé — il est resté sur le portefeuille.
  if (!etat) {
    if (Date.now() - new Date(data.created_at).getTime() < GRACE_MS) return 'pending'

    await echouer(payoutId, 'NOT_FOUND', "La demande n'a jamais abouti chez pawaPay.")
    return 'failed'
  }

  // ACCEPTED, ENQUEUED, PROCESSING et IN_RECONCILIATION ne sont pas des fins de
  // course : trancher ici ferait passer pour perdu un virement en cours.
  if (etat.status !== 'COMPLETED' && etat.status !== 'FAILED') return 'pending'

  if (etat.status === 'FAILED') {
    await echouer(payoutId, etat.failureCode ?? 'UNSPECIFIED_FAILURE', etat.failureReason)
    return 'failed'
  }

  await admin
    .from('payouts')
    .update({ status: 'completed', provider_transaction_id: etat.providerTransactionId })
    .eq('id', payoutId)
    .eq('status', 'pending')

  return 'completed'
}

function echouer(payoutId: string, code: string, raison: string | null) {
  return admin
    .from('payouts')
    .update({ status: 'failed', failure_code: code, failure_reason: raison })
    .eq('id', payoutId)
    .eq('status', 'pending')
}
