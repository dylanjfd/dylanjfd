// Données fictives pour découvrir l'application sans importer de relevé.
import { db } from '../db/schema';
import { CAT } from '../db/seed';
import { commitImport, draftTransaction, getClassifyContext } from './actions';
import { addMonths, dayInMonth, monthOf, monthRange, todayISO } from './dates';

export const DEMO_FILE_NAME = 'Données de démonstration';

function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTH_NAMES = ['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE'];

export function demoRows(today = todayISO()): { date: string; amountCents: number; label: string }[] {
  const rand = random(20261020);
  const between = (min: number, max: number) => Math.round((min + rand() * (max - min)) * 100);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const end = monthOf(today);
  const months = monthRange(addMonths(end, -11), end);
  const rows: { date: string; amountCents: number; label: string }[] = [];

  months.forEach((m, i) => {
    const day = (d: number) => dayInMonth(m, d);
    const ddmm = (d: number) => `${String(d).padStart(2, '0')}/${m.slice(5, 7)}`;
    const add = (d: number, amountCents: number, label: string) => {
      const date = day(d);
      if (date <= today) rows.push({ date, amountCents, label });
    };
    const randomDay = () => 1 + Math.floor(rand() * 27);
    const card = (amountCents: number, merchant: string) => {
      const d = randomDay();
      add(d, amountCents, `CB ${merchant} ${ddmm(d)}`);
    };
    const fromEnd = months.length - 1 - i;

    add(28, m.endsWith('-12') ? 310000 : 245000, `VIR SEPA RECU /DE ACME SAS /MOTIF SALAIRE ${MONTH_NAMES[Number(m.slice(5, 7)) - 1]}`);
    add(5, -78000, 'PRLV SEPA SCI LES TILLEULS LOYER');
    add(10, -6800, 'PRLV SEPA EDF CLIENTS PARTICULIERS');
    add(12, -1599, 'PRLV SEPA FREE MOBILE');
    add(15, fromEnd <= 1 ? -1549 : -1349, 'PRLV SEPA NETFLIX.COM');
    add(18, -1112, 'PRLV SEPA SPOTIFY');
    add(3, -2999, 'PRLV SEPA BASIC FIT');
    add(1, -8880, 'PRLV SEPA NAVIGO ANNUEL');
    add(8, -2430, 'PRLV SEPA MAIF ASSURANCE HABITATION');
    add(6, -18950, 'PRLV SEPA ECHEANCE PRET AUTO COFIDIS');
    add(2, -20000, 'VIR PERMANENT LIVRET A');

    const shops = ['CARREFOUR MARKET', 'LIDL', 'MONOPRIX', 'PICARD', 'BOULANGERIE DU MARCHE', 'GRAND FRAIS'];
    for (let k = 0; k < 7; k++) card(-between(8, 95), pick(shops));
    const restos = ['UBER EATS', 'MCDONALDS', 'STARBUCKS', 'RESTAURANT LE PETIT ZINC', 'SUSHI SHOP'];
    for (let k = 0; k < 4; k++) card(-between(6, 38), pick(restos));
    const shopping = ['AMAZON PAYMENTS', 'FNAC', 'DECATHLON', 'ZARA', 'ACTION'];
    for (let k = 0; k < 2; k++) card(-between(10, 70), pick(shopping));
    if (rand() < 0.8) card(-1190, 'UGC CINE CITE');
    if (rand() < 0.35) add(randomDay(), -between(35, 110), 'PRLV SEPA SNCF VOYAGEURS');
    if (rand() < 0.5) card(-between(45, 70), 'TOTALENERGIES STATION');
    card(-between(6, 28), 'PHARMACIE DE LA GARE');
    if (rand() < 0.3) {
      const d = randomDay();
      add(d, -pick([2650, 3000, 6000]), `CB DOCTOLIB DR MARTIN ${ddmm(d)}`);
      add(Math.min(d + 5, 28), 1750, 'VIR CPAM REMBOURSEMENT SOINS');
    }
    card(-between(2, 6) * 10, 'RETRAIT DAB PARIS');
    if (rand() < 0.5) card(-between(15, 45), 'CHEZ PAULETTE');
  });
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function loadDemoData(): Promise<void> {
  const ctx = await getClassifyContext();
  const account = await db.accounts.toCollection().first();
  const rows = demoRows().map((r) => draftTransaction(r, ctx));
  await commitImport({ fileName: DEMO_FILE_NAME, accountId: account?.id ?? 1, rows, duplicates: 0 });

  const budgets: Record<number, number> = {
    [CAT.courses]: 40000,
    [CAT.restaurants]: 12000,
    [CAT.loisirs]: 6000,
    [CAT.shopping]: 10000,
    [CAT.transport]: 15000,
  };
  await db.transaction('rw', db.categories, db.goals, async () => {
    for (const [id, cents] of Object.entries(budgets)) {
      const c = await db.categories.get(Number(id));
      if (c && c.budgetCents == null) await db.categories.update(c.id, { budgetCents: cents });
    }
    if ((await db.goals.count()) === 0) {
      const today = todayISO();
      await db.goals.add({
        name: 'Vacances d’été',
        icon: '🏖️',
        color: 'aqua',
        targetCents: 180000,
        deadline: `${Number(today.slice(0, 4)) + 1}-06-30`,
        startDate: dayInMonth(addMonths(monthOf(today), -3), 1),
        initialCents: 30000,
        keyword: 'LIVRET A',
      });
    }
  });
}
