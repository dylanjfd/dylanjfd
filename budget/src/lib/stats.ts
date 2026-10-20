import type { Account, Category, CategoryKind, Transaction } from '../db/schema';
import { monthOf } from './dates';

export type CatMap = Map<number, Category>;
type Tx = Pick<Transaction, 'categoryId' | 'amountCents' | 'date' | 'merchant' | 'accountId'>;

/** Nature d'une opération : celle de sa catégorie, ou selon le signe si elle est à classer. */
export function kindOf(t: Pick<Transaction, 'categoryId' | 'amountCents'>, cats: CatMap): CategoryKind {
  const c = t.categoryId != null ? cats.get(t.categoryId) : undefined;
  if (c) return c.kind;
  return t.amountCents < 0 ? 'expense' : 'income';
}

/** Les comptes d'épargne ne comptent pas dans les dépenses et revenus du quotidien. */
export function budgetAccountFilter(accounts: Account[]): (t: Pick<Transaction, 'accountId'>) => boolean {
  const savings = new Set(accounts.filter((a) => a.kind === 'epargne').map((a) => a.id));
  return (t) => !savings.has(t.accountId);
}

export interface Totals {
  income: number;
  expenses: number;
  savings: number;
  /** Revenus − dépenses − épargne. */
  balance: number;
}

export function totals(txs: Tx[], cats: CatMap): Totals {
  let income = 0;
  let expenses = 0;
  let savings = 0;
  for (const t of txs) {
    switch (kindOf(t, cats)) {
      case 'expense':
        expenses -= t.amountCents;
        break;
      case 'income':
        income += t.amountCents;
        break;
      case 'savings':
        savings -= t.amountCents;
        break;
    }
  }
  return { income, expenses, savings, balance: income - expenses - savings };
}

/** Dépenses nettes par catégorie (les remboursements viennent en déduction). Clé null = à classer. */
export function spendingByCategory(txs: Tx[], cats: CatMap): Map<number | null, number> {
  const out = new Map<number | null, number>();
  for (const t of txs) {
    if (kindOf(t, cats) !== 'expense') continue;
    const key = t.categoryId != null && cats.has(t.categoryId) ? t.categoryId : null;
    out.set(key, (out.get(key) ?? 0) - t.amountCents);
  }
  return out;
}

export function totalsByMonth(txs: Tx[], months: string[], cats: CatMap): Map<string, Totals> {
  const groups = new Map<string, Tx[]>(months.map((m) => [m, []]));
  for (const t of txs) groups.get(monthOf(t.date))?.push(t);
  return new Map(months.map((m) => [m, totals(groups.get(m)!, cats)]));
}

/**
 * Dépense moyenne par catégorie sur les mois donnés, en ne comptant que les mois
 * où au moins une opération a été importée (pour ne pas diluer la moyenne).
 */
export function averageSpending(
  txs: Tx[],
  months: string[],
  cats: CatMap,
): { average: Map<number | null, number>; monthCount: number } {
  const set = new Set(months);
  const inRange = txs.filter((t) => set.has(monthOf(t.date)));
  const active = new Set(inRange.map((t) => monthOf(t.date)));
  const sums = spendingByCategory(inRange, cats);
  const n = active.size;
  const average = new Map<number | null, number>();
  if (n > 0) for (const [k, v] of sums) average.set(k, Math.round(v / n));
  return { average, monthCount: n };
}

export interface MerchantStat {
  merchant: string;
  total: number;
  count: number;
  categoryId: number | null;
}

/** Commerçants où l'on dépense le plus. */
export function topMerchants(txs: Tx[], cats: CatMap, limit = 8): MerchantStat[] {
  const map = new Map<string, MerchantStat>();
  for (const t of txs) {
    if (kindOf(t, cats) !== 'expense' || !t.merchant) continue;
    const m = map.get(t.merchant) ?? { merchant: t.merchant, total: 0, count: 0, categoryId: t.categoryId };
    m.total -= t.amountCents;
    m.count += 1;
    map.set(t.merchant, m);
  }
  return [...map.values()]
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
