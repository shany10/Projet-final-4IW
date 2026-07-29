# Tests E2E Playwright

Suite end-to-end autonome : 7 parcours critiques (10 tests) traversant
frontend Nuxt -> BFF -> backend Express -> MongoDB. Concue pour etre
demontree en soutenance et tourner sur n'importe quelle machine.

## Prerequis

- Node.js 20+ et npm. C'est tout : ni Docker, ni MongoDB local, ni `.env`.

## Installation (une seule fois)

```bash
cd e2e
npm install
npx playwright install chromium   # ~150 Mo au premier coup
```

Le premier `npm test` telecharge aussi le binaire mongod (~90 Mo) pour la
base embarquee. Les deux sont ensuite en cache.

## Lancer les tests

```bash
npm test              # headless, usage normal / CI
npm run test:headed   # navigateur visible : mode demo soutenance
npm run test:ui       # interface interactive de debug (timeline, time travel)
npm run report        # ouvre le rapport HTML du dernier run
```

## Comment ca marche

Aucun service a demarrer a la main : `playwright.config.ts` orchestre tout.

1. `scripts/backend-with-embedded-mongo.mjs` demarre un MongoDB jetable en
   memoire (mongodb-memory-server, port aleatoire, base vierge a chaque run)
   puis le backend `npm run dev` avec `MONGODB_URI` pointant dessus.
2. Le frontend Nuxt est lance sur :3001 avec `NUXT_BACKEND_BASE_URL`
   pointant sur le backend local :3000.
3. Chaque test cree son propre compte manager via l'API backend et injecte
   le cookie `auth_token` : pas de seed, pas d'etat partage, tests
   parallelisables. Le compte admin (`admin@eatplanner.local` / `Admin123!`)
   est recree automatiquement par le bootstrap backend a chaque run.

Aucun fichier applicatif (backend/ ou frontend/) n'est modifie par la suite,
et aucun `data-testid` n'a ete ajoute : selecteurs accessibles uniquement.

## Parcours couverts

| Spec | Parcours |
|---|---|
| `auth.spec.ts` | inscription, login, erreur generique, guard, deconnexion |
| `security-2fa.spec.ts` | activation 2FA avec vrais codes TOTP calcules, re-login en 2 etapes |
| `ingredients-dishes.spec.ts` | ingredient + plat via modales, prix conseille TTC verifie (2.20 EUR) |
| `sales.spec.ts` | ticket de vente + import d'un vrai fichier CSV |
| `purchase-order.spec.ts` | prevision -> panier -> validation -> paiement carte -> reception -> stock |
| `forecasts.spec.ts` | calcul, validation, correction d'une prevision de production |
| `admin.spec.ts` | creation manager, suspension (login refuse), reactivation |

## Piege connu

`reuseExistingServer: true` : si un backend de dev tourne deja sur :3000
(ou un frontend sur :3001), Playwright le reutilise tel quel - avec SA base
de donnees. Pour une isolation totale, fermer le stack de dev avant de
lancer la suite.
