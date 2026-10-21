import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db, type Account, type Category, type Transaction } from '../db/schema';
import { addDays, addMonths, currentMonth, monthBounds, todayISO } from '../lib/dates';
import { normalizePlan, PLAN_KEY, plannedByCategory, type Plan } from '../lib/plan';
import { detectRecurring, summarizeRecurring } from '../lib/recurring';
import { budgetAccountFilter, totals, type CatMap } from '../lib/stats';

const EMPTY: never[] = [];

export function useCategories(): { list: Category[]; map: CatMap; loaded: boolean } {
  const list = useLiveQuery(() => db.categories.orderBy('order').toArray(), []);
  const map = useMemo(() => new Map((list ?? []).map((c) => [c.id, c])), [list]);
  return { list: list ?? EMPTY, map, loaded: list !== undefined };
}

export function useAccounts(): Account[] {
  return useLiveQuery(() => db.accounts.toArray(), []) ?? EMPTY;
}

export function useSetting<T>(key: string, fallback: T): T {
  const row = useLiveQuery(() => db.settings.get(key), [key]);
  return row ? (row.value as T) : fallback;
}

/** Budget prévu (undefined pendant le chargement). */
export function usePlan(): Plan | undefined {
  const row = useLiveQuery(async () => (await db.settings.get(PLAN_KEY)) ?? null, []);
  return useMemo(() => (row === undefined ? undefined : normalizePlan(row?.value)), [row]);
}

/** Montant prévu par catégorie de dépense (dépenses fixes + budget). */
export function usePlanned(): Map<number, number> {
  const plan = usePlan();
  const { list } = useCategories();
  return useMemo(() => plannedByCategory(plan ?? normalizePlan(null), list), [plan, list]);
}

/** Opérations entre deux dates incluses (undefined pendant le chargement). */
export function useTransactions(from: string, to: string): Transaction[] | undefined {
  return useLiveQuery(() => db.transactions.where('date').between(from, to, true, true).toArray(), [from, to]);
}

export function useMonthTransactions(ym: string): Transaction[] | undefined {
  const { start, end } = monthBounds(ym);
  return useTransactions(start, end);
}

/** Opérations comptées dans le budget (hors comptes d'épargne). */
export function useBudgetFilter(): (t: Pick<Transaction, 'accountId'>) => boolean {
  const accounts = useAccounts();
  return useMemo(() => budgetAccountFilter(accounts), [accounts]);
}

export function useTransactionCount(): number | undefined {
  return useLiveQuery(() => db.transactions.count(), []);
}

/** Dépenses et revenus récurrents détectés sur les 13 derniers mois. */
export function useRecurring() {
  const { map, loaded } = useCategories();
  const filter = useBudgetFilter();
  const today = todayISO();
  const txs = useTransactions(addDays(today, -400), '9999-12-31');
  const lastDate = useLiveQuery(async () => (await db.transactions.orderBy('date').last())?.date, []);
  const prefs = useLiveQuery(() => db.recurringPrefs.toArray(), []);
  return useMemo(() => {
    if (!txs || !loaded || prefs === undefined) return undefined;
    const items = detectRecurring(txs.filter(filter), map, lastDate ?? today);
    const ignored = new Set(prefs.filter((p) => p.status === 'ignored').map((p) => p.key));
    return { items, ignored, summary: summarizeRecurring(items, ignored) };
  }, [txs, loaded, prefs, lastDate, today, filter, map]);
}

/**
 * Reste à vivre = revenus mensuels − charges fixes. Les revenus sont ceux détectés comme
 * réguliers, sinon la moyenne des revenus des 3 derniers mois complets.
 */
export function useResteAVivre() {
  const recurring = useRecurring();
  const { map } = useCategories();
  const filter = useBudgetFilter();
  const cur = currentMonth();
  const from = monthBounds(addMonths(cur, -3)).start;
  const to = monthBounds(addMonths(cur, -1)).end;
  const past = useTransactions(from, to);
  return useMemo(() => {
    if (!recurring || !past) return undefined;
    const { summary } = recurring;
    let income = summary.incomesTotal;
    let source: 'recurring' | 'average' | 'none' = 'recurring';
    if (income <= 0) {
      const kept = past.filter(filter);
      const months = new Set(kept.map((t) => t.date.slice(0, 7))).size;
      income = months > 0 ? Math.round(totals(kept, map).income / months) : 0;
      source = income > 0 ? 'average' : 'none';
    }
    return { income, source, charges: summary.chargesTotal, savings: summary.savingsTotal, value: income - summary.chargesTotal };
  }, [recurring, past, filter, map]);
}
