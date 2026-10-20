import type { Category } from '../db/schema';
import { daysLeftInMonth, todayISO } from './dates';

export type BudgetStatus = 'ok' | 'warn' | 'over';

export interface BudgetLine {
  category: Category;
  spent: number;
  budget: number;
  ratio: number;
  remaining: number;
  /** Montant disponible par jour jusqu'à la fin du mois (mois en cours ou à venir uniquement). */
  perDay: number | null;
  status: BudgetStatus;
}

export const WARN_RATIO = 0.8;

export function budgetStatus(ratio: number): BudgetStatus {
  if (ratio >= 1) return 'over';
  if (ratio >= WARN_RATIO) return 'warn';
  return 'ok';
}

export function perDay(remaining: number, ym: string, today = todayISO()): number | null {
  const days = daysLeftInMonth(ym, today);
  if (days <= 0) return null;
  return Math.max(0, Math.floor(remaining / days));
}

export function budgetLine(category: Category, spent: number, ym: string, today = todayISO()): BudgetLine {
  const budget = category.budgetCents ?? 0;
  const ratio = budget > 0 ? spent / budget : 0;
  const remaining = budget - spent;
  return { category, spent, budget, ratio, remaining, perDay: perDay(remaining, ym, today), status: budgetStatus(ratio) };
}

/** Lignes de budget des catégories de dépenses qui ont un plafond. */
export function budgetLines(
  categories: Category[],
  spending: Map<number | null, number>,
  ym: string,
  today = todayISO(),
): BudgetLine[] {
  return categories
    .filter((c) => c.kind === 'expense' && (c.budgetCents ?? 0) > 0)
    .map((c) => budgetLine(c, spending.get(c.id) ?? 0, ym, today));
}
