import { describe, expect, it } from 'vitest';
import type { Category, Goal, Transaction } from '../src/db/schema';
import { CAT, DEFAULT_CATEGORIES, DEFAULT_RULES } from '../src/db/seed';
import { budgetLine, budgetStatus } from '../src/lib/budget';
import { addMonths, daysLeftInMonth, monthRange } from '../src/lib/dates';
import { formatDate, formatEUR, formatMonth } from '../src/lib/format';
import { goalEntries, goalProgress } from '../src/lib/goals';
import { detectRecurring, summarizeRecurring } from '../src/lib/recurring';
import { categorize, sortRules } from '../src/lib/rules';
import { averageSpending, spendingByCategory, topMerchants, totals } from '../src/lib/stats';
import { merchantOf, normalizeLabel } from '../src/lib/text';

const cats = new Map<number, Category>(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
const rules = sortRules(DEFAULT_RULES);

let nextId = 1;
function tx(date: string, amountCents: number, label: string, categoryId?: number | null): Transaction {
  const labelNorm = normalizeLabel(label);
  return {
    id: nextId++,
    accountId: 1,
    date,
    amountCents,
    label,
    labelNorm,
    merchant: merchantOf(label),
    categoryId: categoryId === undefined ? categorize(labelNorm, rules) : categoryId,
    categorySource: 'rule',
  };
}

describe('format français', () => {
  const clean = (s: string) => s.replace(/[  ]/g, ' ');
  it('montants', () => {
    expect(clean(formatEUR(123456))).toBe('1 234,56 €');
    expect(clean(formatEUR(-4530))).toBe('−45,30 €');
    expect(clean(formatEUR(1250, { sign: true }))).toBe('+12,50 €');
    expect(clean(formatEUR(0))).toBe('0,00 €');
  });
  it('dates', () => {
    expect(formatDate('2026-03-07')).toBe('07/03/2026');
    expect(formatMonth('2026-10')).toBe('Octobre 2026');
  });
});

describe('dates', () => {
  it('mois', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(daysLeftInMonth('2026-10', '2026-10-20')).toBe(12);
    expect(daysLeftInMonth('2026-09', '2026-10-20')).toBe(0);
  });
});

describe('classement automatique', () => {
  it.each([
    ['CB CARREFOUR MARKET 12/10', CAT.courses],
    ['PAIEMENT PAR CARTE E.LECLERC 12/10', CAT.courses],
    ['PRLV SEPA SNCF VOYAGEURS', CAT.transport],
    ['CARTE 13/10/26 UBER   *EATS CB*1234', CAT.restaurants],
    ['UBER *TRIP HELP.UBER.COM', CAT.transport],
    ['PRLV SEPA NETFLIX.COM', CAT.abonnements],
    ['PRLV SEPA AMAZON PRIME FR', CAT.abonnements],
    ['CB AMAZON PAYMENTS', CAT.shopping],
    ['VIR SEPA RECU ACME MOTIF SALAIRE', CAT.revenus],
    ['VIR PERMANENT LIVRET A', CAT.epargne],
    ['CB PHARMACIE DU CENTRE', CAT.sante],
    ['RETRAIT DAB 12/10 PARIS', CAT.autres],
  ])('%s', (label, expected) => {
    expect(categorize(normalizeLabel(label), rules)).toBe(expected);
  });

  it('ne confond pas les mots partiels (CAF ≠ CAFE, PAIEMENT ≠ revenus)', () => {
    expect(categorize(normalizeLabel('CB CAFE DE FLORE'), rules)).toBe(CAT.restaurants);
    expect(categorize(normalizeLabel('PAIEMENT PAR CARTE XYZ'), rules)).toBeNull();
  });

  it('une règle personnelle passe avant les règles par défaut', () => {
    const custom = sortRules([...DEFAULT_RULES, { pattern: 'CARREFOUR', categoryId: CAT.autres, source: 'user' as const }]);
    expect(categorize('CB CARREFOUR MARKET', custom)).toBe(CAT.autres);
  });
});

describe('statistiques', () => {
  const txs = [
    tx('2026-10-01', 245000, 'VIR SALAIRE ACME'),
    tx('2026-10-03', -4530, 'CB CARREFOUR'),
    tx('2026-10-04', -2000, 'CB LIDL'),
    tx('2026-10-05', 1000, 'REMBOURSEMENT CARREFOUR'),
    tx('2026-10-06', -20000, 'VIR LIVRET A'),
    tx('2026-10-07', -999, 'CB INCONNU'),
    tx('2026-10-08', -50000, 'VIREMENT VERS MON AUTRE COMPTE', CAT.virements),
  ];

  it('revenus, dépenses, épargne', () => {
    expect(totals(txs, cats)).toEqual({ income: 245000, expenses: 6529, savings: 20000, balance: 218471 });
  });

  it('les remboursements viennent en déduction de la catégorie', () => {
    const s = spendingByCategory(txs, cats);
    expect(s.get(CAT.courses)).toBe(5530);
    expect(s.get(null)).toBe(999);
  });

  it('principaux commerçants', () => {
    expect(topMerchants(txs, cats, 2).map((m) => [m.merchant, m.total])).toEqual([
      ['CARREFOUR', 3530],
      ['LIDL', 2000],
    ]);
  });

  it('moyenne sur les seuls mois importés', () => {
    const { average, monthCount } = averageSpending(txs, ['2026-08', '2026-09', '2026-10'], cats);
    expect(monthCount).toBe(1);
    expect(average.get(CAT.courses)).toBe(5530);
  });
});

describe('budgets', () => {
  const courses = { ...cats.get(CAT.courses)!, budgetCents: 40000 };
  it('alertes à 80 % et 100 %', () => {
    expect(budgetStatus(0.79)).toBe('ok');
    expect(budgetStatus(0.8)).toBe('warn');
    expect(budgetStatus(1)).toBe('over');
  });
  it('reste et reste par jour', () => {
    const line = budgetLine(courses, 28000, '2026-10', '2026-10-20');
    expect(line.remaining).toBe(12000);
    expect(line.perDay).toBe(1000); // 120 € sur 12 jours
    expect(line.status).toBe('ok');
    expect(budgetLine(courses, 45000, '2026-10', '2026-10-20').perDay).toBe(0);
    expect(budgetLine(courses, 1000, '2026-09', '2026-10-20').perDay).toBeNull();
  });
});

describe('dépenses récurrentes', () => {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const history = [
    ...months.map((m) => tx(`${m}-05`, -78000, 'PRLV SEPA SCI DUPONT LOYER')),
    ...months.map((m, i) => tx(`${m}-1${i % 2}`, i < 5 ? -1349 : -1549, 'PRLV SEPA NETFLIX.COM')),
    ...months.map((m) => tx(`${m}-28`, 245000 + (m === '2026-08' ? 5000 : 0), 'VIR SEPA ACME SALAIRE')),
    ...months.map((m) => tx(`${m}-02`, -99, 'APPLE.COM/BILL')),
    ...months.map((m) => tx(`${m}-02`, -999, 'APPLE.COM/BILL')),
    // Courses : montants et rythme irréguliers, ne doivent pas ressortir.
    ...months.flatMap((m, i) => [
      tx(`${m}-03`, -4530 - i * 37, 'CB CARREFOUR'),
      tx(`${m}-11`, -6120 + i * 113, 'CB CARREFOUR'),
      tx(`${m}-19`, -3890 - i * 271, 'CB CARREFOUR'),
      tx(`${m}-26`, -7210 + i * 59, 'CB CARREFOUR'),
    ]),
    // Abonnement résilié il y a longtemps.
    tx('2026-01-15', -999, 'PRLV SEPA DEEZER'),
    tx('2026-02-15', -999, 'PRLV SEPA DEEZER'),
    tx('2026-03-15', -999, 'PRLV SEPA DEEZER'),
  ];
  const items = detectRecurring(history, cats, '2026-10-28');

  it('trouve loyer, abonnements et salaire', () => {
    const names = items.map((i) => `${i.merchant} ${i.amount}`).sort();
    expect(names).toEqual(['ACME SALAIRE 245000', 'APPLE BILL 99', 'APPLE BILL 999', 'NETFLIX 1549', 'SCI DUPONT LOYER 78000']);
  });

  it('prochaine date attendue', () => {
    const loyer = items.find((i) => i.merchant === 'SCI DUPONT LOYER')!;
    expect(loyer.nextDate).toBe('2026-11-05');
  });

  it('signale une hausse de prix', () => {
    const netflix = items.find((i) => i.merchant === 'NETFLIX')!;
    expect(netflix.increase).toBe(200);
    expect(netflix.previousAmount).toBe(1349);
  });

  it('garde la hausse signalée le mois suivant, puis l’oublie', () => {
    const more = [...history, tx('2026-11-10', -1549, 'PRLV SEPA NETFLIX.COM')];
    const next = detectRecurring(more, cats, '2026-11-28').find((i) => i.merchant === 'NETFLIX')!;
    expect(next.increase).toBe(200);
    const later = [...more, tx('2026-12-10', -1549, 'PRLV SEPA NETFLIX.COM'), tx('2027-01-10', -1549, 'PRLV SEPA NETFLIX.COM')];
    expect(detectRecurring(later, cats, '2027-01-20').find((i) => i.merchant === 'NETFLIX')!.increase).toBe(0);
  });

  it('charges fixes et revenus', () => {
    const s = summarizeRecurring(items, new Set());
    expect(s.chargesTotal).toBe(78000 + 1549 + 99 + 999);
    expect(s.incomesTotal).toBe(245000);
    const ignored = summarizeRecurring(items, new Set([items.find((i) => i.merchant === 'NETFLIX')!.key]));
    expect(ignored.chargesTotal).toBe(78000 + 99 + 999);
  });
});

describe('objectifs d’épargne', () => {
  const goal: Goal = {
    id: 1,
    name: 'Vacances',
    icon: '🏖️',
    color: 'blue',
    targetCents: 300000,
    deadline: '2027-06-30',
    startDate: '2026-09-01',
    initialCents: 50000,
    keyword: 'LIVRET A',
  };
  const txs = [
    tx('2026-08-05', -20000, 'VIR LIVRET A'), // avant le début de l'objectif
    tx('2026-09-05', -20000, 'VIR LIVRET A'),
    tx('2026-10-05', -20000, 'VIR LIVRET A'),
    tx('2026-10-12', 5000, 'VIR DEPUIS LIVRET A'),
  ];

  it('additionne versements manuels et virements reconnus', () => {
    const entries = goalEntries(goal, [{ id: 1, goalId: 1, date: '2026-10-01', amountCents: 10000 }], txs, [
      { id: 1, name: 'Courant', kind: 'courant' },
    ]);
    expect(entries).toHaveLength(4);
    const p = goalProgress(goal, entries, '2026-10-20');
    expect(p.saved).toBe(50000 + 10000 + 20000 + 20000 - 5000);
    expect(p.remaining).toBe(300000 - 95000);
    expect(p.monthsLeft).toBe(9);
    expect(p.perMonth).toBe(Math.ceil(205000 / 9));
  });

  it('objectif atteint ou dépassé', () => {
    expect(goalProgress({ ...goal, initialCents: 300000 }, [], '2026-10-20').done).toBe(true);
    const late = goalProgress({ ...goal, deadline: '2026-10-01' }, [], '2026-10-20');
    expect(late.overdue).toBe(true);
    expect(late.perMonth).toBe(250000);
  });
});

describe('données de démonstration', () => {
  it('seules les vraies charges fixes ressortent comme récurrentes', async () => {
    const { demoRows } = await import('../src/lib/demo');
    const txs = demoRows('2026-10-20').map((r) => tx(r.date, r.amountCents, r.label));
    const found = detectRecurring(txs, cats, '2026-10-20')
      .map((i) => i.merchant)
      .sort();
    expect(found).toEqual([
      'ACME SALAIRE',
      'BASIC FIT',
      'EDF CLIENTS PARTICULIERS',
      'FREE MOBILE',
      'LIVRET',
      'MAIF ASSURANCE HABITATION',
      'NAVIGO ANNUEL',
      'NETFLIX',
      'PRET AUTO COFIDIS',
      'SCI TILLEULS LOYER',
      'SPOTIFY',
    ]);
  });
});
