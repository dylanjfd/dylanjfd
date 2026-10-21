# Mon Budget — PWA de gestion de budget personnel

Application web mobile, installable sur l’écran d’accueil (iPhone et Android), pour suivre ses dépenses, ses budgets
et son épargne. **Aucun serveur** : toutes les données restent dans le téléphone (IndexedDB) et l’application fonctionne
hors ligne.

## Fonctionnalités

| Écran | Contenu |
|---|---|
| **Accueil** | Solde du mois (revenus, dépenses, épargne), budgets à surveiller, reste à vivre, prochains prélèvements, hausses d’abonnements, opérations à classer, rappel de sauvegarde |
| **Opérations** | Liste par mois, recherche (libellé, note ou montant), filtres par catégorie et par compte, fiche détaillée (catégorie, note, suppression), saisie manuelle |
| **Budgets** | Plafond mensuel par catégorie, barre de progression, alertes à 80 % et 100 %, montant restant et « reste par jour » |
| **Budgets › Objectifs d’épargne** | Montant cible et date limite, somme à mettre de côté par mois, versements manuels ou virements reconnus par mot-clé (ex. « LIVRET A ») |
| **Analyses › Graphiques** | Répartition des dépenses (donut), dépenses et revenus sur 12 mois, comparaison avec la moyenne des 3 mois précédents, principaux commerçants |
| **Analyses › Récurrents** | Loyer, abonnements, crédits et salaire détectés automatiquement, prochaine date, total des charges fixes, reste à vivre, hausses de prix |
| **Plus** | Import, historique des imports (annulables), sauvegarde/restauration JSON, catégories, règles, comptes, thème clair/sombre, installation |

### Import des relevés bancaires

- **CSV** : séparateur détecté (`;`, `,`, tabulation), encodage UTF-8 ou ISO-8859-1/Windows-1252, lignes d’en-tête
  avant le tableau, virgule décimale, colonnes Débit/Crédit séparées ou une seule colonne Montant, libellés sur
  plusieurs lignes, dates JJ/MM/AAAA, AAAA-MM-JJ…
- **OFX / QFX** (versions 1.x SGML et 2.x XML), avec l’identifiant unique de chaque opération.
- **PDF** : relevés de compte mensuels (texte lu sur le téléphone avec pdf.js, chargé seulement à ce moment-là).
  Le tableau est reconstitué à partir de la position du texte : date (avec ou sans année), libellé sur plusieurs
  lignes, colonnes Débit/Crédit ou montant signé ; les lignes de solde et de totaux sont ignorées. PDF protégés par
  mot de passe acceptés ; les PDF scannés sont lus par reconnaissance de texte (voir ci-dessous). Quand un relevé regroupe plusieurs comptes
  (compte de dépôt, Livret A…), l’aperçu demande lequel importer. L’aperçu permet d’inverser le sens d’une
  opération ou de tout le relevé si besoin.
- **Images (JPG, PNG, WebP)** : captures d’écran de l’application de la banque ou photos d’un relevé papier, une ou
  plusieurs à la fois (dans l’ordre). Le texte est reconnu sur le téléphone avec Tesseract (moteur et données de
  langue française servis par l’app depuis `ocr/`, environ 4 Mo téléchargés au premier usage puis gardés en cache :
  fonctionne ensuite hors connexion). Les titres de jour (« Aujourd’hui », « Mardi 14 octobre ») sont reconnus et les
  opérations répétées d’une capture à la suivante ne sont comptées qu’une fois. Format HEIC non pris en charge
  (réglage iPhone : Appareil photo › Formats › Le plus compatible, ou faire une capture d’écran).
- **Correspondance des colonnes** au premier import d’un format, mémorisée pour les suivants (reconnaissance par les
  en-têtes du fichier).
- **Aperçu** avant validation, catégories modifiables ligne par ligne.
- **Doublons** : une opération déjà enregistrée (même date, montant et libellé, ou même identifiant OFX) est écartée ;
  une opération très proche (même montant à 3 jours près, libellé similaire) est signalée comme doublon probable.
  Deux opérations identiques le même jour restent bien deux opérations.
- **Annulation** d’un import entier depuis l’historique.

Formats testés (voir `tests/fixtures`) : Société Générale, Crédit Agricole, BoursoBank, La Banque Postale, LCL,
Revolut, OFX génériques, et des relevés PDF de plusieurs mises en page (Débit/Crédit, dates sans année, montant signé,
mise en page Crédit Agricole : dates JJ.MM, en-tête sur deux lignes, plusieurs comptes dans le même relevé), un PDF
scanné et des captures d’écran. Les autres banques passent par l’écran de correspondance des colonnes.

### Catégorisation

Catégories par défaut modifiables : Logement, Courses, Transport, Restaurants, Loisirs, Abonnements, Santé, Shopping,
Revenus, Épargne, Autres (+ Virements internes, ignorés dans les totaux). Environ 300 mots-clés français sont fournis
(CARREFOUR → Courses, SNCF → Transport, NETFLIX → Abonnements…). Les mots-clés sont recherchés en mots entiers et le
plus précis l’emporte (UBER EATS → Restaurants, UBER → Transport). Quand une catégorie est corrigée à la main,
l’application propose « Toujours classer ce libellé ici » et peut reclasser les opérations similaires.

## Installer sur le téléphone

L’application doit être servie en HTTPS (par exemple GitHub Pages, voir plus bas).

- **iPhone (Safari)** : bouton Partager → « Sur l’écran d’accueil ».
- **Android (Chrome)** : menu ⋮ → « Installer l’application ».

Une fois installée, elle s’ouvre en plein écran et fonctionne sans connexion.

> **Sauvegardez régulièrement** (Plus › Sauvegarde) : le fichier JSON exporté permet de tout restaurer sur un autre
> téléphone ou après une réinstallation. L’accueil rappelle de le faire au-delà de 14 jours.

## Déploiement sur GitHub Pages

Le workflow `.github/workflows/budget.yml` teste et construit l’application à chaque modification de `budget/`, puis
la publie sur GitHub Pages depuis la branche `main`.

1. Dans le dépôt GitHub : **Settings › Pages › Build and deployment › Source : GitHub Actions**.
2. Fusionner sur `main` (ou lancer le workflow à la main depuis l’onglet Actions).
3. L’application est en ligne sur `https://<utilisateur>.github.io/<dépôt>/`.

Seul le code est publié. Vos données bancaires ne quittent jamais le téléphone.

## Développement

```bash
cd budget
npm install
npm run dev        # serveur de développement
npm test           # tests unitaires (import CSV/OFX, doublons, règles, budgets, récurrences…)
npm run build      # vérification TypeScript + build de production dans dist/
npm run preview    # sert le build (service worker actif)
```

Stack : React 19, Vite, TypeScript, Dexie (IndexedDB), vite-plugin-pwa (Workbox), PapaParse, pdf.js, Tesseract.js,
Recharts, Vitest. `scripts/copy-ocr.mjs` copie le moteur OCR et les données françaises dans `public/ocr/` avant
`dev` et `build`.

```
src/
├─ db/            schéma Dexie, catégories et mots-clés par défaut
├─ lib/
│  ├─ import/     décodage, montants et dates, analyse CSV, OFX, PDF, images (OCR), doublons
│  ├─ rules.ts    classement par mots-clés
│  ├─ budget.ts   plafonds, alertes, reste par jour
│  ├─ recurring.ts détection des dépenses récurrentes
│  ├─ stats.ts    totaux, répartition, moyennes, commerçants
│  ├─ goals.ts    objectifs d’épargne
│  └─ backup.ts   export / import JSON
├─ screens/       écrans (dont import/ en 4 étapes)
└─ components/    composants partagés
```

Les montants sont stockés en centimes (entiers) et les dates au format `AAAA-MM-JJ` ; l’affichage suit le format
français (`1 234,56 €`, `JJ/MM/AAAA`).

## Limites connues

- Pas de synchronisation bancaire automatique : il faut importer les relevés (choix volontaire, aucun serveur).
- Les alertes de budget s’affichent dans l’application : une PWA sans serveur ne peut pas envoyer de notifications
  fiables.
- Les relevés Excel (.xls/.xlsx) ne sont pas lus : exporter en CSV, OFX ou PDF depuis la banque.
- La lecture des PDF repose sur la mise en page : sur un format inhabituel, vérifier l’aperçu avant d’importer.
- La reconnaissance de texte des images peut se tromper (photo floue, de travers, mal éclairée) : vérifier dates et
  montants dans l’aperçu. Un PDF ou un CSV de la banque reste plus fiable.
