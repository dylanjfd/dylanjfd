import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../src/db/schema';
import { CAT, DEFAULT_CATEGORIES } from '../src/db/seed';
import {
  brandFor,
  dailyNet,
  forecast,
  monthSummary,
  normalizePlan,
  plannedByCategory,
  plannedEvents,
  suggestFromHistory,
  type Plan,
} from '../src/lib/plan';
import type { RecurringItem } from '../src/lib/recurring';
import { merchantOf, normalizeLabel } from '../src/lib/text';

const cats = (budgets: Record<number, number> = {}): Category[] =>
  DEFAULT_CATEGORIES.map((c) => ({ ...c, budgetCents: budgets[c.id] ?? null }));
const catMap = (list: Category[]) => new Map(list.map((c) => [c.id, c]));

const PLAN: Plan = {
  setup: 'done',
  incomes: [{ id: 'sal', name: 'Salaire', amountCents: 180000, day: 27, categoryId: CAT.revenus }],
  fixed: [
    { id: 'loyer', name: 'Loyer', amountCents: 60000, day: 1, categoryId: CAT.logement },
    { id: 'yt', name: 'YouTube Premium', amountCents: 1299, day: 11, categoryId: CAT.abonnements, brand: 'youtube' },
    { id: 'sp', name: 'Spotify', amountCents: 1214, day: 18, categoryId: CAT.abonnements, brand: 'spotify' },
  ],
};

let nextId = 1;
function tx(date: string, amountCents: number, label: string, categoryId: number | null): Transaction {
  return {
    id: nextId++,
    accountId: 1,
    date,
    amountCents,
    label,
    labelNorm: normalizeLabel(label),
    merchant: merchantOf(label),
    categoryId,
    categorySource: 'rule',
  };
}

describe('budget prévu', () => {
  it('additionne dépenses fixes et budgets par catégorie', () => {
    const planned = plannedByCategory(PLAN, cats({ [CAT.courses]: 22000, [CAT.logement]: 5000 }));
    expect(planned.get(CAT.logement)).toBe(65000);
    expect(planned.get(CAT.abonnements)).toBe(2513);
    expect(planned.get(CAT.courses)).toBe(22000);
    expect(planned.has(CAT.revenus)).toBe(false);
  });

  it('résume le mois : prévu, réel, épargne', () => {
    const list = cats({ [CAT.courses]: 22000, [CAT.restaurants]: 20000 });
    const txs = [
      tx('2026-10-01', -60000, 'PRLV LOYER', CAT.logement),
      tx('2026-10-05', -4530, 'CB CARREFOUR', CAT.courses),
      tx('2026-10-06', -2500, 'CB ATELIER', CAT.restaurants),
      tx('2026-10-07', -1500, 'CB INCONNU', null),
      tx('2026-10-08', -20000, 'VIR LIVRET A', CAT.epargne),
    ];
    const s = monthSummary(PLAN, list, txs, catMap(list));
    expect(s.plannedIncome).toBe(180000);
    expect(s.realIncome).toBe(0);
    expect(s.income).toBe(180000);
    expect(s.plannedSpending).toBe(60000 + 2513 + 22000 + 20000);
    // L'épargne n'est pas une dépense ; les opérations à classer en sont.
    expect(s.realSpending).toBe(60000 + 4530 + 2500 + 1500);
    expect(s.unclassified).toBe(1500);
    expect(s.groups.map((g) => g.category.id)).toEqual([CAT.logement, CAT.courses, CAT.restaurants, CAT.abonnements]);
  });

  it('place les échéances dans le mois, même un 31 en février', () => {
    const plan = { ...PLAN, incomes: [{ ...PLAN.incomes[0], day: 31 }] };
    const events = plannedEvents(plan, '2027-02');
    expect(events.map((e) => [e.date, e.item.name])).toEqual([
      ['2027-02-01', 'Loyer'],
      ['2027-02-11', 'YouTube Premium'],
      ['2027-02-18', 'Spotify'],
      ['2027-02-28', 'Salaire'],
    ]);
  });

  it('calcule le solde de chaque jour sans compter l’épargne', () => {
    const list = cats();
    const net = dailyNet(
      [
        tx('2026-10-05', -4530, 'CB CARREFOUR', CAT.courses),
        tx('2026-10-05', 1200, 'AVOIR', CAT.courses),
        tx('2026-10-08', -20000, 'VIR LIVRET A', CAT.epargne),
      ],
      catMap(list),
    );
    expect([...net]).toEqual([['2026-10-05', -3330]]);
  });

  it('prévoit la fin du mois et le reste à dépenser par jour', () => {
    const list = cats({ [CAT.courses]: 22000, [CAT.restaurants]: 20000 });
    const txs = [
      tx('2026-10-01', -60000, 'PRLV LOYER', CAT.logement),
      tx('2026-10-05', -12000, 'CB CARREFOUR', CAT.courses),
      tx('2026-10-06', -25000, 'CB RESTAURANTS', CAT.restaurants),
      tx('2026-10-11', -1299, 'YOUTUBE', CAT.abonnements),
    ];
    const s = monthSummary(PLAN, list, txs, catMap(list));
    const f = forecast(PLAN, s, list, '2026-10', '2026-10-17');
    // Reste prévu : Spotify (le 18) + 100 € de courses ; restaurants déjà dépassés.
    expect(f.stillPlanned).toBe(1214 + 10000);
    expect(f.freeLeft).toBe(10000);
    expect(f.daysLeft).toBe(15);
    expect(f.perDay).toBe(666);
    expect(f.savings).toBe(180000 - (60000 + 12000 + 25000 + 1299) - (1214 + 10000));
    expect(f.over.map((g) => g.category.id)).toEqual([CAT.restaurants]);
    expect(f.upcoming.map((e) => e.item.name)).toEqual(['Spotify', 'Salaire']);
  });

  it('relit un plan abîmé sans planter', () => {
    expect(normalizePlan(null)).toEqual({ incomes: [], fixed: [], setup: 'todo' });
    const p = normalizePlan({ incomes: [{ name: 'X', amountCents: 1000.4, day: 45, categoryId: 9 }, 'oops'], setup: 'done' });
    expect(p.incomes).toHaveLength(1);
    expect(p.incomes[0]).toMatchObject({ amountCents: 1000, day: 31 });
    expect(p.setup).toBe('done');
  });
});

describe('suggestions d’après les relevés', () => {
  const item = (label: string, amount: number, day: number, categoryId: number, sign: 1 | -1 = -1): RecurringItem => ({
    key: label,
    merchant: merchantOf(label),
    label,
    categoryId,
    kind: sign > 0 ? 'income' : 'expense',
    sign,
    occurrences: [],
    amount,
    previousAmount: null,
    increase: 0,
    averageAmount: amount,
    day,
    lastDate: '2026-10-01',
    nextDate: '2026-11-01',
  });

  it('retrouve salaire, loyer, abonnements et budgets', () => {
    const s = suggestFromHistory(
      [item('VIR ACME SALAIRE', 245000, 28, CAT.revenus, 1), item('VIR CAF', 12000, 5, CAT.revenus, 1)],
      [
        item('PRLV SCI LES TILLEULS LOYER', 78000, 5, CAT.logement),
        item('PRLV EDF', 6800, 10, CAT.logement),
        item('PRLV SEPA NETFLIX.COM', 1549, 15, CAT.abonnements),
        item('PRLV SEPA FREE MOBILE', 1599, 12, CAT.abonnements),
        item('PRLV SEPA BASIC FIT', 2999, 3, CAT.loisirs),
        item('PRLV SEPA JOURNAL LOCAL', 990, 20, CAT.abonnements),
        item('PRLV SEPA COFIDIS', 18950, 6, CAT.autres),
      ],
      new Map([
        [CAT.courses, 31234],
        [CAT.restaurants, 8000],
      ]),
    );
    expect(s.salary).toEqual({ amountCents: 245000, day: 28 });
    expect(s.rent).toEqual({ amountCents: 78000, day: 5 });
    expect(s.subscriptions.map((i) => [i.name, i.amountCents, i.day, i.brand])).toEqual([
      ['Netflix', 1549, 15, 'netflix'],
      ['Forfait mobile', 1599, 12, 'mobile'],
      ['Basic-Fit', 2999, 3, 'basicfit'],
      ['Journal Local', 990, 20, undefined],
    ]);
    expect([...s.budgets]).toEqual([
      [CAT.courses, 32000],
      [CAT.restaurants, 8000],
    ]);
  });

  it('reconnaît les abonnements dans les libellés', () => {
    expect(brandFor('PRLV SEPA Spotify AB')?.key).toBe('spotify');
    expect(brandFor('GOOGLE YouTubePremium')?.key).toBe('youtube');
    expect(brandFor('CB CARREFOUR')).toBeUndefined();
  });
});
