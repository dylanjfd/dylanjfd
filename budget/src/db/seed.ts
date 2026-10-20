import type { Transaction as DexieTransaction } from 'dexie';
import type { Account, Category, Rule } from './schema';
import { normalizeLabel } from '../lib/text';

export const CAT = {
  logement: 1,
  courses: 2,
  transport: 3,
  restaurants: 4,
  loisirs: 5,
  abonnements: 6,
  sante: 7,
  shopping: 8,
  revenus: 9,
  epargne: 10,
  autres: 11,
  virements: 12,
} as const;

export const DEFAULT_CATEGORIES: Category[] = [
  { id: CAT.logement, name: 'Logement', icon: '🏠', color: 'blue', kind: 'expense', budgetCents: null, order: 1 },
  { id: CAT.courses, name: 'Courses', icon: '🛒', color: 'orange', kind: 'expense', budgetCents: null, order: 2 },
  { id: CAT.transport, name: 'Transport', icon: '🚆', color: 'aqua', kind: 'expense', budgetCents: null, order: 3 },
  { id: CAT.restaurants, name: 'Restaurants', icon: '🍽️', color: 'yellow', kind: 'expense', budgetCents: null, order: 4 },
  { id: CAT.loisirs, name: 'Loisirs', icon: '🎉', color: 'magenta', kind: 'expense', budgetCents: null, order: 5 },
  { id: CAT.abonnements, name: 'Abonnements', icon: '📺', color: 'violet', kind: 'expense', budgetCents: null, order: 6 },
  { id: CAT.sante, name: 'Santé', icon: '💊', color: 'red', kind: 'expense', budgetCents: null, order: 7 },
  { id: CAT.shopping, name: 'Shopping', icon: '🛍️', color: 'green', kind: 'expense', budgetCents: null, order: 8 },
  { id: CAT.revenus, name: 'Revenus', icon: '💶', color: 'green', kind: 'income', budgetCents: null, order: 9 },
  { id: CAT.epargne, name: 'Épargne', icon: '🐷', color: 'violet', kind: 'savings', budgetCents: null, order: 10 },
  { id: CAT.autres, name: 'Autres', icon: '📦', color: 'gray', kind: 'expense', budgetCents: null, order: 11 },
  { id: CAT.virements, name: 'Virements internes', icon: '🔁', color: 'gray', kind: 'transfer', budgetCents: null, order: 12 },
];

// Mots-clés recherchés en mots entiers dans le libellé normalisé.
// En cas de conflit, la règle la plus longue l'emporte (UBER EATS avant UBER).
const KEYWORDS: Record<number, string> = {
  [CAT.logement]:
    'LOYER, EDF, ENGIE, GDF, EKWATEUR, OHM ENERGIE, MINT ENERGIE, ENI GAS, VEOLIA, SUEZ, SAUR, EAU DE PARIS, ' +
    'FONCIA, NEXITY, CITYA, ORPI, SYNDIC, COPROPRIETE, TAXE FONCIERE, TAXE HABITATION, ASSURANCE HABITATION, ' +
    'LEROY MERLIN, CASTORAMA, BRICO DEPOT, BRICOMARCHE, MR BRICOLAGE, IKEA',
  [CAT.courses]:
    'CARREFOUR, LECLERC, AUCHAN, LIDL, ALDI, INTERMARCHE, SUPER U, HYPER U, U EXPRESS, MAGASINS U, CASINO, ' +
    'MONOPRIX, FRANPRIX, PICARD, GRAND FRAIS, BIOCOOP, NATURALIA, LA VIE CLAIRE, CORA, NETTO, LEADER PRICE, ' +
    'SPAR, VIVAL, COCCINELLE, PROXI, G20, SIMPLY MARKET, CHRONODRIVE, LECLERC DRIVE, BOULANGERIE, BOUCHERIE, ' +
    'PRIMEUR, FROMAGERIE, MARCHE',
  [CAT.transport]:
    'SNCF, OUIGO, TGV, RATP, NAVIGO, TRANSILIEN, UBER, BOLT, HEETCH, FREENOW, G7, BLABLACAR, FLIXBUS, TOTAL, ' +
    'TOTALENERGIES, ESSO, SHELL, BP, AVIA, CARBURANT, STATION, AUTOROUTE, AUTOROUTES, VINCI, SANEF, APRR, ' +
    'PEAGE, PARKING, INDIGO, EFFIA, SAEMES, LIME, DOTT, VELIB, TCL, AIR FRANCE, EASYJET, RYANAIR, TRANSAVIA, ' +
    'VOLOTEA, VUELING, GETAROUND, NORAUTO, FEU VERT, MIDAS, SPEEDY, CONTROLE TECHNIQUE',
  [CAT.restaurants]:
    'UBER EATS, DELIVEROO, JUST EAT, MCDONALD, MCDONALDS, MC DONALD, MC DONALDS, BURGER KING, KFC, QUICK, ' +
    'SUBWAY, DOMINO, DOMINOS, PIZZA HUT, STARBUCKS, BRIOCHE DOREE, COLUMBUS, O TACOS, FIVE GUYS, ' +
    'BUFFALO GRILL, HIPPOPOTAMUS, COURTEPAILLE, LEON DE BRUXELLES, FLUNCH, RESTAURANT, RESTO, BRASSERIE, ' +
    'CAFE, BAR, BISTROT, BISTRO, PIZZERIA, PIZZA, SUSHI, KEBAB, CREPERIE, TRAITEUR',
  [CAT.loisirs]:
    'CINEMA, UGC, PATHE, GAUMONT, MK2, CGR, TICKETMASTER, FNAC SPECTACLES, BASIC FIT, FITNESS PARK, NEONESS, ' +
    'KEEP COOL, STEAM, PLAYSTATION, NINTENDO, XBOX, EPIC GAMES, MUSEE, DISNEYLAND, AIRBNB, BOOKING, HOTEL, ' +
    'ACCOR, IBIS, CENTER PARCS, BOWLING, LASER GAME, ESCAPE GAME, CONCERT, THEATRE, FESTIVAL, FDJ, PMU, ' +
    'BETCLIC, WINAMAX',
  [CAT.abonnements]:
    'NETFLIX, SPOTIFY, DEEZER, DISNEY PLUS, CANAL, AMAZON PRIME, PRIME VIDEO, APPLE COM BILL, ITUNES, ' +
    'GOOGLE ONE, GOOGLE STORAGE, GOOGLE PLAY, YOUTUBE, DAZN, MOLOTOV, OCS, PARAMOUNT, FREE MOBILE, ' +
    'FREE TELECOM, FREE, ORANGE, SOSH, SFR, RED BY SFR, BOUYGUES TELECOM, BOUYGUES, B YOU, NRJ MOBILE, ' +
    'PRIXTEL, MICROSOFT, ADOBE, DROPBOX, ICLOUD, OPENAI, CHATGPT, ANTHROPIC, AUDIBLE, KINDLE, LE MONDE, ' +
    'MEDIAPART',
  [CAT.sante]:
    'PHARMACIE, PHARMA, DOCTOLIB, MEDECIN, DOCTEUR, DENTISTE, DENTAIRE, OPTICIEN, OPTIQUE, KRYS, AFFLELOU, ' +
    'OPTIC, LABORATOIRE, LABO, CPAM, AMELI, MUTUELLE, HARMONIE MUTUELLE, MGEN, KINE, KINESITHERAPEUTE, ' +
    'OSTEOPATHE, HOPITAL, CLINIQUE, RADIOLOGIE',
  [CAT.shopping]:
    'AMAZON, AMZN, FNAC, DARTY, BOULANGER, CDISCOUNT, ZALANDO, ZARA, H M, KIABI, PRIMARK, UNIQLO, CELIO, ' +
    'DECATHLON, INTERSPORT, GO SPORT, SEPHORA, NOCIBE, MARIONNAUD, YVES ROCHER, ACTION, GIFI, HEMA, ' +
    'LA HALLE, VINTED, LEBONCOIN, SHEIN, TEMU, ALIEXPRESS, APPLE STORE, CULTURA, MAISONS DU MONDE, ETSY, ' +
    'EBAY, BACK MARKET, BACKMARKET, NIKE, ADIDAS',
  [CAT.revenus]:
    'SALAIRE, SALAIRES, CAF, POLE EMPLOI, FRANCE TRAVAIL, PRIME ACTIVITE, PRIME D ACTIVITE, PENSION, RETRAITE',
  [CAT.epargne]: 'LIVRET A, LIVRET, LDDS, LEP, PEL, CEL, ASSURANCE VIE, PEA, EPARGNE',
  [CAT.autres]: 'RETRAIT, DAB, IMPOT, IMPOTS, DGFIP, AMENDE, AGIOS, COMMISSION, COTISATION',
};

export const DEFAULT_RULES: Omit<Rule, 'id'>[] = Object.entries(KEYWORDS).flatMap(([categoryId, list]) =>
  list
    .split(',')
    .map((k) => normalizeLabel(k))
    .filter(Boolean)
    .map((pattern) => ({ pattern, categoryId: Number(categoryId), source: 'default' as const })),
);

export const DEFAULT_ACCOUNT: Account = { id: 1, name: 'Compte courant', kind: 'courant' };

export function seedDatabase(tx: DexieTransaction): void {
  void tx.table('categories').bulkAdd(DEFAULT_CATEGORIES);
  void tx.table('rules').bulkAdd(DEFAULT_RULES);
  void tx.table('accounts').add(DEFAULT_ACCOUNT);
}
