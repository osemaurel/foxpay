import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { callFunction } from '../../lib/supabase'
import type { Product } from '../../lib/types'
import { formatCharged, formatPrice } from '../../lib/format'
import { track, trackPurchaseOnce } from '../../lib/pixel'
import { useLangue, type Langue } from '../../lib/i18n'
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
  const { langue, t } = useLangue()
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
      // Les noms de pays reviennent traduits : la liste est rechargée si
      // l'acheteur change de langue en cours de route.
      locale: langue,
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
  }, [shop.slug, productSlug, langue])

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
        setError(reply.message ?? t('paiementEchoue'))
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
        <p className="text-ink-muted">{t('produitPlusDisponible')}</p>
        <Link
          to={`/boutique/${shop.slug}`}
          className="mt-4 inline-block text-sm text-ink-faint underline underline-offset-4 hover:text-ink"
        >
          {t('voirCatalogue')}
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
        // La langue voyage avec la commande : l'email de livraison et la page
        // de téléchargement arriveront plus tard, quand plus personne ne sera
        // devant cet écran pour dire dans quelle langue les écrire.
        locale: langue,
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
        {t('retourProduit')}
      </Link>

      <h1 className="mt-5 text-2xl font-medium text-ink sm:text-3xl">
        {stage === 'paid' ? t('paiementConfirme') : t('finaliser')}
      </h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-start">
        <div className="order-2 lg:order-1">
          {stage === 'paid' && <Paid product={product} downloadUrl={downloadUrl} email={email} />}

          {stage === 'waiting' && (
            <Waiting provider={provider} timedOut={timedOut} onRetry={retry} />
          )}

          {stage === 'failed' && (
            <section className="space-y-5 rounded-2xl border border-line bg-card p-6 sm:p-8">
              <Eyebrow>{t('paiementInterrompu')}</Eyebrow>
              <Alert kind="error">{error ?? t('paiementEchoue')}</Alert>
              <button
                type="button"
                onClick={retry}
                style={{ backgroundColor: accent }}
                className="inline-flex w-full items-center justify-center rounded-xl px-6 py-3.5 font-medium text-white transition hover:brightness-110"
              >
                {t('reessayer')}
              </button>
            </section>
          )}

          {stage === 'form' && (
            <form
              onSubmit={pay}
              className="space-y-5 rounded-2xl border border-line bg-card p-6 sm:p-8"
            >
              <Eyebrow>{t('tesCoordonnees')}</Eyebrow>

              <Field label={t('tonNom')}>
                <input
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label={t('tonEmail')} hint={t('emailAstuce')}>
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
                <Eyebrow>{t('tonPaiement')}</Eyebrow>
              </div>

              {loadError && <Alert kind="error">{loadError}</Alert>}
              {!countries && !loadError && <Spinner label={t('chargementMoyens')} />}

              {countries?.length === 0 && <Alert kind="error">{t('aucunMoyen')}</Alert>}

              {countries && countries.length > 0 && (
                <>
                  <Field
                    label={t('tonPays')}
                    hint={autoDetected ? t('paysDetecte') : undefined}
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
                      <option value="">{t('choisisPays')}</option>
                      {countries.map((c) => (
                        <option key={c.country} value={c.country}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {country && (
                    <Field label={t('tonNumero')} hint={t('numeroAstuce')}>
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
                          {t('numeroInvalide')(country.name)}
                        </p>
                      )}
                    </Field>
                  )}

                  {country && (
                    <Group label={t('tonOperateur')}>
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
                      label={t('codeAutorisation')}
                      hint={t('codeAutorisationAstuce')(provider.name)}
                    >
                      <Instructions set={provider.instructions} />
                      <input
                        required
                        inputMode="numeric"
                        aria-label={t('codeAutorisation')}
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
                  ? t('envoiDemande')
                  : t('payer')(
                      payable
                        ? formatCharged(payable, country!.currency, langue)
                        : formatPrice(product.price, product.currency, langue),
                    )}
              </button>

              <p className="text-center text-xs leading-relaxed text-ink-faint">
                {t('rassurance')}
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
  const { t } = useLangue()
  const manual = provider?.pin_prompt === 'MANUAL'

  return (
    <section className="space-y-5 rounded-2xl border border-line bg-card p-6 sm:p-8">
      <Eyebrow>{t('attenteTitre')}</Eyebrow>

      {!timedOut && (
        <>
          <div className="flex items-start gap-4">
            <span
              aria-hidden
              className="mt-1 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-line border-t-ink"
            />
            <div className="space-y-2">
              <p className="font-medium text-ink">
                {manual ? t('suisLesEtapes') : t('demandePin')}
              </p>
              <p className="text-sm leading-relaxed text-ink-muted">
                {provider?.merchant_name
                  ? t('auNomDe')(provider.merchant_name)
                  : t('composePin')}{' '}
                {t('neFermePas')}
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
          <p className="text-sm leading-relaxed text-ink-muted">{t('expire')}</p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex w-full items-center justify-center rounded-xl border border-line px-6 py-3 font-medium text-ink transition hover:bg-raise"
          >
            {t('recommencer')}
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

/**
 * Étapes fournies par pawaPay pour l'opérateur choisi (composer *144#, etc.).
 *
 * Le processeur les fournit déjà dans les deux langues : on prend celle de
 * l'acheteur, et l'autre en secours — mieux vaut des instructions dans la
 * mauvaise langue que pas d'instructions du tout.
 */
function Instructions({ set }: { set: InstructionSet | null }) {
  const { langue, t } = useLangue()
  const autre: Langue = langue === 'fr' ? 'en' : 'fr'

  const channel = set?.channels?.[0]
  const steps = channel?.instructions?.[langue] ?? channel?.instructions?.[autre] ?? []
  if (steps.length === 0) return null

  const titre = channel?.displayName?.[langue] ?? channel?.displayName?.[autre]

  return (
    <div className="space-y-2">
      {titre && <p className="text-xs font-medium text-ink">{titre}</p>}
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
          {t('composerIci')}
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
  const { t } = useLangue()

  return (
    <section className="space-y-5 rounded-2xl border border-line bg-card p-6 sm:p-8">
      <Eyebrow>{t('cestRegle')}</Eyebrow>
      <p className="text-sm leading-relaxed text-ink-muted">
        {t('merciAchat')(product.title, email)}
      </p>
      {downloadUrl && (
        <a
          href={downloadUrl}
          className="inline-flex w-full items-center justify-center rounded-xl bg-ink px-6 py-3.5 font-medium text-canvas transition hover:opacity-90"
        >
          {t('telechargerMaintenant')}
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
  const { langue, t } = useLangue()
  const discount =
    product.compare_at_price && product.compare_at_price > product.price
      ? Math.round((1 - product.price / product.compare_at_price) * 100)
      : null

  return (
    <section className="rounded-2xl border border-line bg-raise p-5">
      <Eyebrow>{t('taCommande')}</Eyebrow>

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
            <span>{t('leProduit')}</span>
            <span className="tabular-nums">
              {formatCharged(charged.base, charged.currency, langue)}
            </span>
          </div>
        )}
        {product.compare_at_price && (
          <div className="flex items-center justify-between text-ink-faint">
            <span>{t('prixHabituel')}</span>
            <span className="tabular-nums line-through">
              {charged?.compare
                ? formatCharged(charged.compare, charged.currency, langue)
                : formatPrice(product.compare_at_price, product.currency, langue)}
            </span>
          </div>
        )}
        {discount !== null && (
          <div className="flex items-center justify-between text-go">
            <span>{t('remise')}</span>
            <span className="tabular-nums">−{discount} %</span>
          </div>
        )}
        {charged && (
          <div className="flex items-center justify-between text-ink-muted">
            <span>{t('fraisPaiement')}</span>
            <span className="tabular-nums">
              + {formatCharged(charged.fee, charged.currency, langue)}
            </span>
          </div>
        )}
        <div className="flex items-baseline justify-between pt-1">
          <span className="font-medium text-ink">{t('total')}</span>
          <span className="text-xl font-medium tabular-nums" style={{ color: accent }}>
            {charged
              ? formatCharged(charged.amount, charged.currency, langue)
              : formatPrice(product.price, product.currency, langue)}
          </span>
        </div>
      </div>
    </section>
  )
}
