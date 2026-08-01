# Plan de test — Observabilité & Tunnel de conversion

Ce guide décrit les parcours à rejouer pour remplir les dashboards Umami et
GlitchTip, puis capturer les preuves attendues dans le rapport.

## 0. Pré-requis

Stack lancée (app + monitoring, même réseau Docker) :

```bash
make up
```

Vérifier que tout répond :

- Application : http://localhost:3001
- Umami : http://localhost:3002
- GlitchTip : http://localhost:8000
- Mailpit (emails sortants) : http://localhost:8025

Le `.env` contient déjà `NUXT_PUBLIC_UMAMI_WEBSITE_ID` et les 3 DSN Sentry
(`SENTRY_DSN`, `NUXT_PUBLIC_SENTRY_DSN`, `SENTRY_SERVER_DSN`).

> Connexion : utilise ton compte manager (`demo.alertes@eatplanner.local` ou le
> tien). Le module achat est réservé au rôle **manager**.

## 1. Simuler l'origine du trafic (campagnes pub)

Pour alimenter l'attribution `utm_source` / `ref`, arrive sur le site via une URL
de campagne **avant de te connecter** (le first-touch est mémorisé pour la
session) :

```
http://localhost:3001/login?utm_source=facebook&utm_medium=cpc&utm_campaign=promo-ete
http://localhost:3001/login?utm_source=google&utm_medium=cpc&utm_campaign=black-friday
http://localhost:3001/login?ref=newsletter
```

Fais quelques sessions depuis des origines différentes (navigation privée pour
repartir d'une session vierge à chaque fois).

## 2. Parcours « conversion complète » (à répéter ~5-8 fois)

But : déclencher les 4 étapes du tunnel jusqu'à `checkout_success`.

1. Aller sur **Achats → Nouvel achat** (`/purchase-orders/new`).
2. Cliquer sur l'étape **Sélection** → déclenche `view_product`.
3. Cliquer **Ajouter** sur plusieurs ingrédients → déclenche `add_to_cart`
   (une fois par ajout, avec produit / catégorie / quantité / prix).
4. Passer au **Panier**, ajuster les quantités, puis **Passer à la validation**.
5. L'entrée dans l'étape **Validation** déclenche `checkout_start`.
6. **Valider la commande** → redirige vers la liste avec le paiement ouvert.
7. Payer (carte ou virement). En cas de succès → `checkout_success` avec le
   `montant` (panier moyen) et l'origine du trafic attachée.

> Le paiement carte échoue volontairement **~1 fois sur 3** (voir §4). Reçlaie
> jusqu'à obtenir des succès **et** au moins un échec.

## 3. Parcours « abandon » (à répéter ~4-6 fois)

But : créer un taux d'abandon mesurable par étape.

- **Abandon panier** : ajouter au panier puis quitter sans aller à la validation
  (`add_to_cart` sans `checkout_start`).
- **Abandon checkout** : aller jusqu'à la validation puis quitter sans payer
  (`checkout_start` sans `checkout_success`).
- **Abandon accueil** : ouvrir une page et repartir tout de suite (alimente le
  taux de rebond).

Varier volontairement les proportions pour que l'analyse par étape soit parlante.

## 4. Déclencher l'erreur de paiement (GlitchTip)

Le « gateway » carte simule une panne intermittente
(`simulateFlakyPaymentGateway`, ~1/3, `TypeError`) capturée via
`Sentry.captureException` → projet **frontend** dans GlitchTip.

1. Faire plusieurs tentatives de **paiement par carte**.
2. Quand le toast « Paiement refusé » apparaît, l'erreur est remontée.
3. Vérifier dans GlitchTip : http://localhost:8000 → projet frontend →
   l'issue `TypeError` avec sa stack trace, OS, navigateur.

La page **Achats → Test GlitchTip** (`/debug-sentry`) permet aussi de déclencher
à la demande les erreurs client / serveur Nuxt / backend.

## 5. Captures à récupérer pour le rapport

- [ ] Umami — vue d'ensemble (visites, pages vues, durée moyenne, rebond).
- [ ] Umami — événements du tunnel (`view_product`, `add_to_cart`,
      `checkout_start`, `checkout_success`) avec leurs volumes.
- [ ] Umami — propriétés d'événement `checkout_success` (montant → panier moyen)
      et répartition par `utm_source` / `ref`.
- [ ] GlitchTip — l'issue `TypeError` du paiement avec stack trace + détails
      (OS, navigateur).

Reporter ensuite les chiffres et les images dans [`../RAPPORT.md`](../RAPPORT.md).
