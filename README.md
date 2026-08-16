# Foxpay — boutique digitale

Boutique standalone pour vendre **un** produit digital : page publique, paiement
mobile money, livraison automatique par lien de téléchargement à durée limitée.

Stack : React + TypeScript + Tailwind, Supabase (auth / Postgres / Storage / Edge Functions),
paiement Moneroo (ou MoneyFusion).

## État

- [x] Étape 1 — Schéma de base de données (`supabase/migrations/0001_init.sql`)
- [ ] Étape 2 — App React (auth + admin boutique/produit)
- [ ] Étape 3 — Page publique `/boutique/:slug`
- [ ] Étape 4 — Paiement : Edge Functions `create-payment` + `payment-webhook`
- [ ] Étape 5 — Livraison : `download` (URL signée) + email
- [ ] Étape 6 — Suivi des ventes (admin)

## Modèle de données

Trois tables, une seule boutique par compte, un seul produit par boutique.

```
auth.users ──1:1──> shops ──1:1──> products
                      │              │
                      └──────1:N────>┴─ orders
```

| Table | Rôle | Contrainte v1 |
|---|---|---|
| `shops` | identité de la boutique (nom, description, logo, couleur, slug) | `owner_id` unique → 1 boutique / compte |
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
est lisible publiquement mais ne sert à rien : seule une URL signée générée par
une Edge Function en `service_role`, après paiement confirmé, ouvre le fichier.
La sécurité tient à la couche Storage, pas au secret du chemin.

**Les commandes ne sont jamais écrites par le navigateur.** `orders` n'a qu'une
policy de lecture (le vendeur voit ses ventes). La création et la mise à jour
passent par les Edge Functions en `service_role`, qui contournent RLS. Un
acheteur ne peut donc pas se déclarer payé.

**Webhook idempotent.** Index unique sur `(provider, provider_reference)` : si le
PSP rejoue la notification, la commande n'est pas dupliquée et l'email de
livraison n'est pas renvoyé.

**Droit de téléchargement porté par la commande.** `download_token` (uuid,
unique) + `download_expires_at` (posé à `now() + 24h` à la confirmation) +
`download_count` / `max_downloads` (3). Le lien envoyé par email est
`/download/:token` ; l'Edge Function vérifie les trois conditions, incrémente le
compteur, puis redirige vers une URL signée valable ~60 s.

**Storage rangé par boutique.** Convention de chemin `<shop_id>/<fichier>` dans
les deux buckets, ce qui permet une policy unique (`owns_shop_folder`) au lieu
d'une policy par type d'asset.

- `shop-assets` (public, 5 Mo, images) — logo, bannière, couverture produit
- `product-files` (privé, 200 Mo, tous types) — le livrable

## Appliquer la migration

```bash
supabase link --project-ref <ref>
supabase db push
```
