# Foxpay — boutique digitale

Boutique standalone pour vendre **un** produit digital : page publique, paiement
mobile money, livraison automatique par lien de téléchargement à durée limitée.

Stack : React + TypeScript + Tailwind, Supabase (auth / Postgres / Storage / Edge
Functions), paiement **pawaPay**, email de livraison **Resend**.

## État

- [x] Étape 1 — Schéma de base de données (`supabase/migrations/0001_init.sql`)
- [x] Étape 2 — App React : auth, admin boutique + produit
- [x] Étape 3 — Page publique `/boutique/:slug`
- [x] Étape 4 — Paiement : `create-payment` + `pawapay-callback`
- [x] Étape 5 — Livraison : `download` (URL signée) + email Resend
- [x] Étape 6 — Suivi des ventes (admin)
- [x] Étape 7 — Projet Supabase créé, migrations appliquées, fonctions déployées
- [ ] **Renseigner les secrets des Edge Functions** — sans eux, rien ne tourne
- [x] Étape 7 — Paiement sur la page de checkout (API `deposits`, sans redirection)

## Projet Supabase

| | |
|---|---|
| Référence | `vodgtcipxqkebronwbmu` |
| Région | eu-west-3 (Paris) |
| URL API | `https://vodgtcipxqkebronwbmu.supabase.co` |

Déjà en place : les 3 tables avec RLS, les 2 buckets Storage, `consume_download()`,
et les 4 Edge Functions en `verify_jwt = false`. Le linter de sécurité Supabase
ne remonte aucun avertissement.

## Modèle de données

Trois tables, une seule boutique par compte, un seul produit par boutique.

```
auth.users ──1:1──> shops ──1:1──> products
                      │              │
                      └──────1:N────>┴─ orders
```

| Table | Rôle | Contrainte v1 |
|---|---|---|
| `shops` | identité de la boutique (nom, description, logo, couleur, slug, pays) | `owner_id` unique → 1 boutique / compte |
| `products` | le produit vendu + fichier livrable | `shop_id` unique → 1 produit / boutique |
| `orders` | une tentative d'achat + son état de paiement + son droit de téléchargement | — |

Les deux contraintes d'unicité sont volontaires et se retirent en une ligne le
jour où on veut du multi-produit.

### Décisions à retenir

**Prix en entier.** Le XOF n'a pas de décimales : `price` et `amount` sont des
`integer`. Le montant est recopié dans `orders.amount` à la création de la
commande — si le prix change ensuite, les ventes passées gardent le bon montant.

**Le fichier n'est jamais servi directement.** Il vit dans le bucket privé
`product-files`, sur lequel aucun rôle client n'a de policy. `products.file_path`
est lisible publiquement mais ne sert à rien : seule une URL signée (60 s)
générée par l'Edge Function `download` en `service_role`, après paiement
confirmé, ouvre le fichier. La sécurité tient à la couche Storage, pas au secret
du chemin.

**Les commandes ne sont jamais écrites par le navigateur.** `orders` n'a qu'une
policy de lecture (le vendeur voit ses ventes). La création et la mise à jour
passent par les Edge Functions en `service_role`, qui contournent RLS. Un
acheteur ne peut donc pas se déclarer payé.

**Le statut du paiement n'est jamais lu dans le callback.** `pawapay-callback` ne
retient que le `depositId` du corps reçu, puis redemande le statut réel à
l'API pawaPay. Conséquence : un faux callback ne peut pas déclencher une
livraison, et vérifier la signature du callback devient facultatif.

**`deposit_id` est généré par nous.** pawaPay attend un UUIDv4 fourni par le
marchand, ce qui donne une clé de réconciliation qui existe même si la réponse
HTTP se perd en route. Index unique dessus → si pawaPay rejoue son callback (il
le fait), la commande n'est pas dupliquée.

**L'email est piloté par `delivered_at`, pas par le passage à `paid`.** Si
l'envoi échoue, la fonction répond 500 et le rejeu suivant renverra l'email sans
rouvrir la fenêtre de téléchargement.

**Le quota de téléchargement est consommé sous verrou.** `consume_download()`
vérifie payé / non expiré / quota et incrémente le compteur dans la même
transaction avec `for update` : deux clics simultanés sur le lien ne peuvent pas
passer tous les deux.

**`country` en ISO 3166-1 alpha-3.** C'est l'acheteur qui le choisit sur la page
de paiement, et il détermine la devise : le prix de la boutique s'applique tel
quel dans les sept pays de la zone franc CFA (XOF et XAF sont arrimés à l'euro
au même taux), et passe par un taux enregistré dans `shop_currencies` pour la
RDC. `charged_amount` / `charged_currency` gardent ce que l'acheteur a
réellement payé, `amount` restant le prix de référence.

**La liste des pays et des opérateurs n'est écrite nulle part.** Elle vient de
`GET /v2/active-conf` : le compte pawaPay est la source de vérité, donc activer
un opérateur chez eux le fait apparaître sur la boutique sans toucher au code,
et une coupure (`status: CLOSED`) le retire de la liste.

## Parcours d'achat

Tout se passe sur `/boutique/:slug/checkout/:produit`. L'acheteur ne quitte pas
la boutique : la demande de paiement part sur son téléphone, il compose son code
PIN, et la page bascule d'elle-même sur le lien de téléchargement.

```
Page de paiement
    │
    ├─> payment-options ──> GET /v2/active-conf  (pays, opérateurs, montants)
    ├─> predict-phone   ──> POST /v2/predict-provider  (numéro + opérateur deviné)
    │
    ▼  nom, email, pays, numéro, opérateur
create-payment
    │  revalide pays / opérateur / montant contre active-conf
    │  crée l'order (pending) AVANT l'appel
    └─> POST /v2/deposits ──> invite de code PIN sur le téléphone
    │
    ├─> order-status (polling, 3 s) ──────────┐
    │                                          ├─> settleOrder()
    └─> callback serveur : pawapay-callback ──┘        │
                                                       ▼
                                    GET /v2/deposits/{id} = vérité
                                                       │
                                    order → paid, email Resend envoyé
                                                       │
                            lien /functions/v1/download?token=…
                                                       │
                          consume_download() → URL signée 60 s
```

À l'ouverture, `payment-options` devine aussi le pays de l'acheteur d'après son
IP (`ipwho.is`, avec `api.country.is` en secours) et le présélectionne : son
indicatif et ses opérateurs sont affichés d'entrée, sans un clic. C'est une
avance, jamais une décision — le champ reste modifiable, un acheteur détecté
hors des pays vendables n'est simplement pas présélectionné, et une panne des
deux services laisse la page se comporter comme avant. La détection tourne en
parallèle du reste (≈30 ms) et l'IP n'est stockée nulle part.

Les deux chemins de confirmation (polling de la page et callback serveur)
passent par la même fonction `settleOrder()`. Le polling n'est pas un luxe : un
callback peut être retardé, mal configuré ou perdu, et l'acheteur attend son
fichier.

### Les trois façons d'autoriser un paiement

`active-conf` donne l'`authType` de chaque opérateur, et l'interface s'y adapte :

| `authType` | Ce que voit l'acheteur |
|---|---|
| `PROVIDER_AUTH` | Une invite de code PIN sur son téléphone. Si `pinPrompt` vaut `MANUAL` ou si l'invite est relançable, les instructions de pawaPay (composer `*840#`…) sont affichées pendant l'attente. |
| `PREAUTH` | Un champ pour le code à usage unique, précédé des instructions pour le générer. Envoyé comme `preAuthorisationCode`. |
| `REDIRECT_AUTH` | Le seul cas où l'acheteur quitte la page : Wave impose son propre écran. `order-status` renvoie l'`authorizationUrl` dès que pawaPay la publie, et `successfulUrl` / `failedUrl` le ramènent sur sa page de paiement. |

### Les frais de paiement

pawaPay prélève une commission sur chaque encaissement. `PAYMENT_FEE_RATE`
(3 %, dans `_shared/pawapay.ts`) la reporte sur l'acheteur, pour que le vendeur
touche le prix qu'il a affiché. Le taux s'applique au prix de référence **avant**
conversion, arrondi au supérieur : pas de décimales, et le montant congolais
garde ses arrondis à la centaine au lieu de tomber sur un chiffre bancal.

Le récapitulatif détaille toujours le total — le produit, puis les frais — et
les deux montants viennent du même calcul que celui envoyé à pawaPay, si bien
que l'addition affichée tombe juste même après arrondi. Le prix barré, lui,
reste le prix habituel du produit : les frais ont leur propre ligne et seraient
sinon comptés deux fois.

### Ce qui n'est jamais cru sur parole

Le navigateur envoie un pays, un opérateur et un numéro — pas un montant.
`create-payment` recalcule le prix, vérifie que l'opérateur existe et encaisse
dans la devise du pays, contrôle les limites de transaction de l'opérateur, et
renormalise le numéro via `predict-provider`. Une requête forgée ne peut donc
pas payer 1 XOF un produit à 19 000.

## Mise en route

### 1. Base de données — déjà fait

Les migrations ont été appliquées directement sur le projet. Pour repartir de
zéro ailleurs :

```bash
supabase link --project-ref <ref>
supabase db push
```

Crée le compte vendeur depuis la page `/login` (bouton « Créer un compte »), ou
depuis le dashboard Supabase. Le premier passage sur `/admin` propose de créer la
boutique.

### 2. Secrets des Edge Functions — à faire

```bash
supabase secrets set \
  PAWAPAY_BASE_URL=https://api.sandbox.pawapay.io \
  PAWAPAY_API_TOKEN=<jeton pawaPay> \
  SITE_URL=https://<domaine du front> \
  RESEND_API_KEY=<clé Resend> \
  RESEND_FROM="Boutique <no-reply@ton-domaine.com>"
```

`SITE_URL` sert à construire les URL de retour des opérateurs à redirection
(Wave) : elle doit être joignable depuis Internet. Pour tester en local, passe
par un tunnel (ngrok, cloudflared).

### 3. Fonctions — déjà déployées

Les quatre tournent déjà. Pour republier après modification :

```bash
supabase functions deploy create-payment pawapay-callback order-status download \
  payment-options predict-phone
```

Puis, dans le dashboard pawaPay, pointe l'URL de callback des dépôts sur
`https://vodgtcipxqkebronwbmu.supabase.co/functions/v1/pawapay-callback`.

Les six fonctions sont déclarées `verify_jwt = false` dans `config.toml` :
elles sont appelées par des visiteurs non authentifiés (acheteur, serveurs
pawaPay). Chacune fait ses propres vérifications.

### 4. Front

```bash
cp .env.example .env   # renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Déploiement : `npm run build` puis n'importe quel hébergeur statique. Le routage
est côté client, il faut donc rediriger toutes les routes vers `index.html` —
`vercel.json` le fait pour Vercel ; sur Netlify, un fichier `_redirects`
contenant `/*  /index.html  200`.

**Les deux variables `VITE_` doivent exister avant le build.** Vite les remplace
par leur valeur pendant la compilation : les ajouter à l'hébergeur sans relancer
un déploiement ne change rien. Si elles manquent, l'app affiche un écran
« Configuration incomplète » qui les nomme, plutôt qu'une page blanche.

Piège sur Vercel : l'intégration Supabase injecte des variables nommées
`SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_…`. Vite ne lit que les noms préfixés
`VITE_`, il faut donc ajouter les deux à la main même si des variables Supabase
apparaissent déjà dans le projet.

## Dupliquer la boutique

La v1 est pensée pour être redéployée plutôt que rendue multi-tenant : nouveau
projet Supabase, nouveau déploiement du front, nouvelles clés. Le code n'a pas
besoin d'être touché.

## Ce qui n'a pas été vérifié

- **Les Edge Functions n'ont jamais été exécutées.** Elles sont déployées et
  actives, mais l'environnement de développement n'avait ni Deno ni accès
  réseau à `*.supabase.co`, donc ni typecheck ni appel réel. Le premier
  `create-payment` sera le premier test.
- Aucun paiement, même en sandbox, n'a été passé de bout en bout.
- L'email Resend n'a jamais été envoyé.
- Le front, lui, compile et build (`npm run build`).
