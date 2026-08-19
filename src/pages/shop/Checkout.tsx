import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { callFunction } from '../../lib/supabase'
import type { Product } from '../../lib/types'
import { formatCharged, formatPrice } from '../../lib/format'
import { track, trackPurchaseOnce } from '../../lib/pixel'
import { Alert, Eyebrow, Field, Spinner, inputClass } from '../../components/ui'
import { useShop } from './ShopLayout'

/**
 * Page de paiement. Tout s'y passe : l'acheteur choisit son pays et son
 * opérateur, saisit son numéro, et la demande de paiement part sur son
 * téléphone. Il ne quitte jamais la boutique — il compose son code PIN, et la
 * page bascule d'elle-même sur le lien de téléchargement.
 */

type ProviderOption = {
  provider: string
  name: string
  logo: string | null
  amount: string
  auth_type: 'PROVIDER_AUTH' | 'PREAUTH' | 'REDIRECT_AUTH'
  pin_prompt: 'AUTOMATIC' | 'MANUAL' | null
  pin_prompt_revivable: boolean
  instructions: InstructionSet | null
  merchant_name: string | null
}

type CountryOption = {
  country: string
  name: string
  prefix: string
  flag: string | null
  currency: string
  /** Le prix seul, sans les frais de paiement. */
  base_amount: string
  /** Les frais de paiement, dans la devise du pays. */
  fee_amount: string
  /** Prix barré, converti dans la devise du pays. */
  compare_amount: string | null
  providers: ProviderOption[]
}

type InstructionSet = {
  channels: {
    type: string
    displayName?: { fr?: string; en?: string }
    quickLink?: string
    instructions?: { fr?: { text: string }[]; en?: { text: string }[] }
  }[]
}

type Stage = 'form' | 'waiting' | 'paid' | 'failed'

type StatusReply = {
  status: 'pending' | 'paid' | 'failed' | 'cancelled'
  download_url: string | null
  authorization_url: string | null
  message: string | null
}

const POLL_MS = 3000
/** Au-delà, l'invite de code PIN a expiré chez tous les opérateurs. */
const POLL_DEADLINE_MS = 5 * 60 * 1000

/**
 * Envoie l'acheteur sur l'écran d'autorisation de l'opérateur (Wave), une seule
 * fois par commande. Le lien reste attaché à la commande tant qu'elle est en
 * attente : sans cette mémoire, l'acheteur qui en revient serait aussitôt
 * renvoyé là-bas, en boucle.
 *
 * Renvoie vrai quand la redirection est lancée.
 */
function goToAuth(orderId: string, url: string): boolean {
  const cle = `foxpay:auth:${orderId}`
  if (sessionStorage.getItem(cle)) return false

  sessionStorage.setItem(cle, '1')
  window.location.href = url
  return true
}

export default function Checkout() {
  const { productSlug } = useParams<{ productSlug: string }>()
  const [params, setParams] = useSearchParams()
  const { shop, products } = useShop()
  const product = products.find((p) => p.slug === productSlug)

  const [countries, setCountries] = useState<CountryOption[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [autoDetected, setAutoDetected] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [localNumber, setLocalNumber] = useState('')
  const [providerCode, setProviderCode] = useState('')
  const [otp, setOtp] = useState('')

  const [phoneState, setPhoneState] = useState<'idle' | 'checking' | 'ok' | 'bad'>('idle')
  const [touchedProvider, setTouchedProvider] = useState(false)

  // Une commande reprise depuis l'URL : l'acheteur revient d'un opérateur à
  // redirection, ou il a simplement rechargé la page pendant l'attente.
  const resumed = params.get('order')
  const [stage, setStage] = useState<Stage>(resumed ? 'waiting' : 'form')
  const [orderId, setOrderId] = useState<string | null>(resumed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  const country = countries?.find((c) => c.country === countryCode) ?? null
  const provider = country?.providers.find((p) => p.provider === providerCode) ?? null

  // Le montant suit le pays dès qu'il est choisi, sans attendre l'opérateur :
  // un acheteur congolais doit voir son prix en francs congolais tout de suite.
  // Les opérateurs d'un même pays demandent le même montant, à l'arrondi près.
  const payable = provider?.amount ?? country?.providers[0]?.amount ?? null

  // Gardé dans une référence pour le suivi publicitaire : le montant change
  // quand l'acheteur choisit son pays, mais le suivi du paiement ne doit pas
  // se relancer pour autant.
  const payableRef = useRef<{ amount: string; currency: string } | null>(null)
  useEffect(() => {
    if (payable && country) payableRef.current = { amount: payable, currency: country.currency }
  }, [payable, country])

  useEffect(() => {
    let cancelled = false
    callFunction<{ countries: CountryOption[]; detected: string | null }>('payment-options', {
      slug: shop.slug,
      product_slug: productSlug,
    })
      .then((data) => {
        if (cancelled) return
        setCountries(data.countries)

        // Le pays deviné d'après l'IP ouvre la page déjà remplie : l'indicatif
        // et les opérateurs sont là sans un clic. C'est une avance, pas une
        // décision — le champ reste modifiable, et un acheteur en voyage ou
        // derrière un VPN n'a qu'à choisir le sien.
        if (data.detected && data.countries.some((c) => c.country === data.detected)) {
          setCountryCode(data.detected)
          setAutoDetected(true)
        }
      })
      .catch((e) => !cancelled && setLoadError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [shop.slug, productSlug])

  // Vérification du numéro pendant la frappe : l'acheteur découvre sa faute de
  // frappe tout de suite, et l'opérateur deviné lui évite un choix de plus.
  useEffect(() => {
    if (!country || localNumber.length < 6) {
      setPhoneState('idle')
      return
    }

    setPhoneState('checking')
    const handle = setTimeout(async () => {
      try {
        const reply = await callFunction<{
          valid: boolean | null
          country?: string
          provider?: string
        }>('predict-phone', { phone: country.prefix + localNumber })

        if (reply.valid === false) {
          setPhoneState('bad')
          return
        }
        setPhoneState('ok')

        // La prédiction se trompe parfois (6 % au Bénin) : elle présélectionne,
        // elle ne décide pas. Dès que l'acheteur a choisi, on ne touche plus.
        const guessed = country.providers.find((p) => p.provider === reply.provider)
        if (guessed && !touchedProvider) setProviderCode(guessed.provider)
      } catch {
        setPhoneState('idle')
      }
    }, 600)

    return () => clearTimeout(handle)
  }, [country, localNumber, touchedProvider])

  // Paiement commencé. L'événement part à l'ouverture de la page, pas au clic :
  // c'est ici que se joue l'abandon, et Meta a besoin de connaître les deux
  // bouts pour mesurer ce que la publicité rapporte vraiment.
  useEffect(() => {
    if (!product || resumed) return
    track('InitiateCheckout', {
      content_ids: [product.slug],
      content_name: product.title,
      content_type: 'product',
      value: product.price,
      currency: product.currency,
    })
  }, [product?.id, resumed])

  const poll = useCallback(async (id: string): Promise<StatusReply | null> => {
    try {
      return await callFunction<StatusReply>('order-status', { order_id: id })
    } catch {
      return null
    }
  }, [])

  // Suivi du paiement. Le callback pawaPay arrive côté serveur, mais il peut
  // être en retard : on redemande l'état jusqu'à ce qu'il soit tranché.
  const startedAt = useRef(0)
  useEffect(() => {
    if (stage !== 'waiting' || !orderId || timedOut) return

    let cancelled = false
    if (!startedAt.current) startedAt.current = Date.now()

    async function tick() {
      const reply = await poll(orderId!)
      if (cancelled || !reply) return schedule()

      if (reply.authorization_url && goToAuth(orderId!, reply.authorization_url)) return

      if (reply.status === 'paid') {
        setDownloadUrl(reply.download_url)
        setStage('paid')
        // Le montant compté est celui réellement débité, dans la devise de
        // l'acheteur. Après un rechargement de page le pays n'est plus
        // sélectionné : on retombe alors sur le prix du produit.
        trackPurchaseOnce(orderId!, {
          content_ids: product ? [product.slug] : [],
          content_type: 'product',
          value: Number(payableRef.current?.amount ?? product?.price ?? 0),
          currency: payableRef.current?.currency ?? product?.currency ?? 'XOF',
        })
        return
      }
      if (reply.status === 'failed' || reply.status === 'cancelled') {
        setError(reply.message ?? "Le paiement n'a pas abouti.")
        setStage('failed')
        return
      }
      schedule()
    }

    function schedule() {
      if (cancelled) return
      if (Date.now() - startedAt.current > POLL_DEADLINE_MS) {
        setTimedOut(true)
        return
      }
      timer = setTimeout(tick, POLL_MS)
    }

    let timer = setTimeout(tick, POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [stage, orderId, poll, timedOut])

  if (!product) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-24 text-center">
        <p className="text-ink-muted">Ce produit n'est plus disponible.</p>
        <Link
          to={`/boutique/${shop.slug}`}
          className="mt-4 inline-block text-sm text-ink-faint underline underline-offset-4 hover:text-ink"
        >
          Voir le catalogue
        </Link>
      </main>
    )
  }

  const accent = product.cta_color ?? 'var(--accent)'

  async function pay(e: React.FormEvent) {
    e.preventDefault()
    if (!country || !provider) return

    setBusy(true)
    setError(null)
    try {
      const { order_id, authorization_url } = await callFunction<{
        order_id: string
        authorization_url?: string | null
      }>('create-payment', {
        slug: shop.slug,
        product_slug: product!.slug,
        buyer_name: name,
        buyer_email: email,
        country: country.country,
        provider: provider.provider,
        phone: country.prefix + localNumber,
        otp: otp || null,
      })

      // L'identifiant part dans l'URL : recharger la page ou revenir d'un
      // opérateur à redirection ne perd pas la commande en cours.
      setParams({ order: order_id }, { replace: true })
      setOrderId(order_id)
      startedAt.current = 0
      setTimedOut(false)
      setStage('waiting')

      if (authorization_url) goToAuth(order_id, authorization_url)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  function retry() {
    setStage('form')
    setError(null)
    setOrderId(null)
    setTimedOut(false)
    startedAt.current = 0
    setParams({}, { replace: true })
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
      <Link
        to={`/boutique/${shop.slug}/p/${product.slug}`}
        className="text-sm text-ink-faint transition hover:text-ink"
      >
        ← Retour au produit
      </Link>

      <h1 className="mt-5 text-2xl font-medium text-ink sm:text-3xl">
        {stage === 'paid' ? 'Paiement confirmé' : 'Finaliser la commande'}
      </h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-start">
        <div className="order-2 lg:order-1">
          {stage === 'paid' && <Paid product={product} downloadUrl={downloadUrl} email={email} />}

          {stage === 'waiting' && (
            <Waiting provider={provider} timedOut={timedOut} onRetry={retry} />
          )}

          {stage === 'failed' && (
            <section className="space-y-5 rounded-2xl border border-line bg-card p-6 sm:p-8">
              <Eyebrow>Paiement interrompu</Eyebrow>
              <Alert kind="error">{error ?? "Le paiement n'a pas abouti."}</Alert>
              <button
                type="button"
                onClick={retry}
                style={{ backgroundColor: accent }}
                className="inline-flex w-full items-center justify-center rounded-xl px-6 py-3.5 font-medium text-white transition hover:brightness-110"
              >
                Réessayer
              </button>
            </section>
          )}

          {stage === 'form' && (
            <form
              onSubmit={pay}
              className="space-y-5 rounded-2xl border border-line bg-card p-6 sm:p-8"
            >
              <Eyebrow>Tes coordonnées</Eyebrow>

              <Field label="Ton nom">
                <input
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field
                label="Ton email"
                hint="C'est là que le lien de téléchargement sera envoyé. Vérifie-le bien."
              >
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <div className="border-t border-line-soft pt-5">
                <Eyebrow>Ton paiement mobile money</Eyebrow>
              </div>

              {loadError && <Alert kind="error">{loadError}</Alert>}
              {!countries && !loadError && <Spinner label="Chargement des moyens de paiement…" />}

              {countries?.length === 0 && (
                <Alert kind="error">
                  Aucun moyen de paiement n'est disponible pour le moment.
                </Alert>
              )}

              {countries && countries.length > 0 && (
                <>
                  <Field
                    label="Ton pays"
                    hint={autoDetected ? 'Détecté automatiquement. Change-le si ce n’est pas le bon.' : undefined}
                  >
                    <select
                      required
                      value={countryCode}
                      onChange={(e) => {
                        setCountryCode(e.target.value)
                        setProviderCode('')
                        setTouchedProvider(false)
                        setAutoDetected(false)
                      }}
                      className={inputClass}
                    >
                      <option value="">Choisis ton pays</option>
                      {countries.map((c) => (
                        <option key={c.country} value={c.country}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {country && (
                    <Field
                      label="Ton numéro mobile money"
                      hint="Sans l'indicatif, il est déjà devant."
                    >
                      <div className="flex items-stretch gap-2">
                        <span className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-line bg-raise px-3 text-sm text-ink-muted">
                          {country.flag && (
                            <img src={country.flag} alt="" className="h-4 w-6 rounded-sm object-cover" />
                          )}
                          +{country.prefix}
                        </span>
                        <input
                          required
                          inputMode="numeric"
                          autoComplete="tel-national"
                          value={localNumber}
                          onChange={(e) => setLocalNumber(e.target.value.replace(/\D/g, ''))}
                          className={`${inputClass} flex-1`}
                        />
                      </div>
                      {phoneState === 'bad' && (
                        <p className="mt-2 text-xs text-stop">
                          Ce numéro ne semble pas valide pour {country.name}.
                        </p>
                      )}
                    </Field>
                  )}

                  {country && (
                    <Group label="Ton opérateur">
                      <div className="grid gap-2 sm:grid-cols-2">
                        {country.providers.map((p) => (
                          <label
                            key={p.provider}
                            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                              p.provider === providerCode
                                ? 'border-transparent ring-2'
                                : 'border-line hover:bg-raise'
                            }`}
                            style={
                              p.provider === providerCode
                                ? ({ '--tw-ring-color': accent } as React.CSSProperties)
                                : undefined
                            }
                          >
                            <input
                              type="radio"
                              name="provider"
                              required
                              className="sr-only"
                              checked={p.provider === providerCode}
                              onChange={() => {
                                setProviderCode(p.provider)
                                setTouchedProvider(true)
                              }}
                            />
                            {p.logo && (
                              <img src={p.logo} alt="" className="h-8 w-8 rounded object-contain" />
                            )}
                            <span className="text-sm font-medium text-ink">{p.name}</span>
                          </label>
                        ))}
                      </div>
                    </Group>
                  )}

                  {provider?.auth_type === 'PREAUTH' && (
                    <Group
                      label="Code d'autorisation"
                      hint={`${provider.name} demande un code à générer depuis ton téléphone avant de payer.`}
                    >
                      <Instructions set={provider.instructions} />
                      <input
                        required
                        inputMode="numeric"
                        aria-label="Code d'autorisation"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\s/g, ''))}
                        className={`${inputClass} mt-3`}
                      />
                    </Group>
                  )}
                </>
              )}

              {error && <Alert kind="error">{error}</Alert>}

              <button
                type="submit"
                disabled={busy || !provider}
                style={{ backgroundColor: accent }}
                className="inline-flex w-full items-center justify-center rounded-xl px-6 py-3.5 font-medium text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {busy
                  ? 'Envoi de la demande…'
                  : payable
                    ? `Payer ${formatCharged(payable, country!.currency)}`
                    : `Payer ${formatPrice(product.price, product.currency)}`}
              </button>

              <p className="text-center text-xs leading-relaxed text-ink-faint">
                Une demande de paiement arrivera sur ton téléphone. Rien n'est débité avant que
                tu ne composes ton code PIN.
              </p>
            </form>
          )}
        </div>

        <aside className="order-1 lg:order-2">
          <Summary
            product={product}
            accent={accent}
            charged={
              payable && country
                ? {
                    amount: payable,
                    base: country.base_amount,
                    fee: country.fee_amount,
                    compare: country.compare_amount,
                    currency: country.currency,
                  }
                : null
            }
          />
        </aside>
      </div>
    </main>
  )
}

/**
 * Un bloc étiqueté, pour les groupes qui contiennent déjà des `label` (les
 * opérateurs) ou un lien. `Field` enveloppe ses enfants dans un `label`, ce
 * qui les rendrait imbriqués — et donc inutilisables au clic.
 */
function Group({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-2 block text-xs leading-relaxed text-ink-faint">{hint}</span>}
    </div>
  )
}

/** Ce que l'acheteur doit faire pendant que la demande part sur son téléphone. */
function Waiting({
  provider,
  timedOut,
  onRetry,
}: {
  provider: ProviderOption | null
  timedOut: boolean
  onRetry: () => void
}) {
  const manual = provider?.pin_prompt === 'MANUAL'

  return (
    <section className="space-y-5 rounded-2xl border border-line bg-card p-6 sm:p-8">
      <Eyebrow>En attente de ta confirmation</Eyebrow>

      {!timedOut && (
        <>
          <div className="flex items-start gap-4">
            <span
              aria-hidden
              className="mt-1 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-line border-t-ink"
            />
            <div className="space-y-2">
              <p className="font-medium text-ink">
                {manual
                  ? 'Suis les étapes ci-dessous sur ton téléphone.'
                  : 'Une demande de code PIN arrive sur ton téléphone.'}
              </p>
              <p className="text-sm leading-relaxed text-ink-muted">
                {provider?.merchant_name
                  ? `Elle s'affiche au nom de « ${provider.merchant_name} ». Compose ton code PIN pour valider.`
                  : 'Compose ton code PIN pour valider le paiement.'}{' '}
                Cette page se met à jour toute seule, ne la ferme pas.
              </p>
            </div>
          </div>

          {(manual || provider?.pin_prompt_revivable) && (
            <div className="rounded-xl border border-line bg-raise p-4">
              <Instructions set={provider?.instructions ?? null} />
            </div>
          )}
        </>
      )}

      {timedOut && (
        <>
          <p className="text-sm leading-relaxed text-ink-muted">
            Toujours rien après cinq minutes. L'invite de code PIN a probablement expiré. Si tu
            as bien payé, l'email de téléchargement arrivera quand même — vérifie ta boîte de
            réception.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex w-full items-center justify-center rounded-xl border border-line px-6 py-3 font-medium text-ink transition hover:bg-raise"
          >
            Recommencer le paiement
          </button>
        </>
      )}
    </section>
  )
}

/**
 * pawaPay renvoie le raccourci sous forme de code USSD brut (« *840*8*2*1# »).
 * Pour qu'un lien le compose, il lui faut le schéma `tel:` et un dièse encodé —
 * sans quoi le navigateur le prend pour une ancre.
 */
function dialLink(quickLink: string): string {
  const code = quickLink.replace(/^tel:?/i, '')
  return `tel:${code.replace(/#/g, '%23')}`
}

/** Étapes fournies par pawaPay pour l'opérateur choisi (composer *144#, etc.). */
function Instructions({ set }: { set: InstructionSet | null }) {
  const channel = set?.channels?.[0]
  const steps = channel?.instructions?.fr ?? channel?.instructions?.en ?? []
  if (steps.length === 0) return null

  return (
    <div className="space-y-2">
      {channel?.displayName?.fr && (
        <p className="text-xs font-medium text-ink">{channel.displayName.fr}</p>
      )}
      <ol className="list-inside list-decimal space-y-1 text-sm text-ink-muted">
        {steps.map((step, i) => (
          <li key={i}>{step.text}</li>
        ))}
      </ol>
      {channel?.quickLink && (
        <a
          href={dialLink(channel.quickLink)}
          className="inline-block text-sm underline underline-offset-4 hover:text-ink"
        >
          Composer depuis ce téléphone
        </a>
      )}
    </div>
  )
}

function Paid({
  product,
  downloadUrl,
  email,
}: {
  product: Product
  downloadUrl: string | null
  email: string
}) {
  return (
    <section className="space-y-5 rounded-2xl border border-line bg-card p-6 sm:p-8">
      <Eyebrow>C'est réglé</Eyebrow>
      <p className="text-sm leading-relaxed text-ink-muted">
        Merci&nbsp;! Ton paiement est confirmé et « {product.title} » t'attend. Le lien a aussi
        été envoyé{email ? ` à ${email}` : ' par email'}, tu peux y revenir pendant 7&nbsp;jours.
      </p>
      {downloadUrl && (
        <a
          href={downloadUrl}
          className="inline-flex w-full items-center justify-center rounded-xl bg-ink px-6 py-3.5 font-medium text-canvas transition hover:opacity-90"
        >
          Télécharger maintenant
        </a>
      )}
    </section>
  )
}

function Summary({
  product,
  accent,
  charged,
}: {
  product: Product
  accent: string
  charged: {
    amount: string
    base: string
    fee: string
    compare: string | null
    currency: string
  } | null
}) {
  const discount =
    product.compare_at_price && product.compare_at_price > product.price
      ? Math.round((1 - product.price / product.compare_at_price) * 100)
      : null

  return (
    <section className="rounded-2xl border border-line bg-raise p-5">
      <Eyebrow>Ta commande</Eyebrow>

      <div className="mt-4 flex gap-4">
        {product.cover_url && (
          <img
            src={product.cover_url}
            alt=""
            className="aspect-square w-16 shrink-0 rounded-xl border border-line object-cover"
          />
        )}
        <p className="min-w-0 font-medium leading-snug text-ink">{product.title}</p>
      </div>

      <div className="mt-5 space-y-2 border-t border-line-soft pt-4 text-sm">
        {charged && (
          <div className="flex items-center justify-between text-ink-muted">
            <span>Le produit</span>
            <span className="tabular-nums">
              {formatCharged(charged.base, charged.currency)}
            </span>
          </div>
        )}
        {product.compare_at_price && (
          <div className="flex items-center justify-between text-ink-faint">
            <span>Prix habituel</span>
            <span className="tabular-nums line-through">
              {charged?.compare
                ? formatCharged(charged.compare, charged.currency)
                : formatPrice(product.compare_at_price, product.currency)}
            </span>
          </div>
        )}
        {discount !== null && (
          <div className="flex items-center justify-between text-go">
            <span>Remise</span>
            <span className="tabular-nums">−{discount} %</span>
          </div>
        )}
        {charged && (
          <div className="flex items-center justify-between text-ink-muted">
            <span>Frais de paiement</span>
            <span className="tabular-nums">
              + {formatCharged(charged.fee, charged.currency)}
            </span>
          </div>
        )}
        <div className="flex items-baseline justify-between pt-1">
          <span className="font-medium text-ink">Total</span>
          <span className="text-xl font-medium tabular-nums" style={{ color: accent }}>
            {charged
              ? formatCharged(charged.amount, charged.currency)
              : formatPrice(product.price, product.currency)}
          </span>
        </div>
      </div>
    </section>
  )
}
