import type { Account, Goal, GoalContribution, Transaction } from '../db/schema';
import { diffDays, todayISO } from './dates';
import { matchesPattern } from './rules';
import { normalizeLabel } from './text';

export interface GoalEntry {
  date: string;
  amountCents: number;
  label: string;
  /** Saisie manuelle (supprimable) ou virement détecté automatiquement. */
  contributionId?: number;
  transactionId?: number;
}

/**
 * Versements vers l'objectif : saisies manuelles + opérations dont le libellé contient
 * le mot-clé. Sur un compte courant, un débit alimente l'objectif ; sur un compte
 * d'épargne, c'est un crédit.
 */
export function goalEntries(
  goal: Goal,
  contributions: GoalContribution[],
  txs: Transaction[],
  accounts: Account[],
): GoalEntry[] {
  const entries: GoalEntry[] = contributions
    .filter((c) => c.goalId === goal.id)
    .map((c) => ({ date: c.date, amountCents: c.amountCents, label: c.note || 'Versement manuel', contributionId: c.id }));
  const keyword = normalizeLabel(goal.keyword ?? '');
  if (keyword) {
    const savingsAccounts = new Set(accounts.filter((a) => a.kind === 'epargne').map((a) => a.id));
    for (const t of txs) {
      if (t.date < goal.startDate || !matchesPattern(t.labelNorm, keyword)) continue;
      const amount = savingsAccounts.has(t.accountId) ? t.amountCents : -t.amountCents;
      entries.push({ date: t.date, amountCents: amount, label: t.label, transactionId: t.id });
    }
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export interface GoalProgress {
  saved: number;
  remaining: number;
  ratio: number;
  monthsLeft: number;
  /** Montant à mettre de côté chaque mois pour tenir la date limite. */
  perMonth: number;
  done: boolean;
  overdue: boolean;
}

export function goalProgress(goal: Goal, entries: GoalEntry[], today = todayISO()): GoalProgress {
  const saved = goal.initialCents + entries.reduce((s, e) => s + e.amountCents, 0);
  const remaining = Math.max(0, goal.targetCents - saved);
  const daysLeft = diffDays(today, goal.deadline);
  const monthsLeft = Math.max(1, Math.ceil(daysLeft / 30.4375));
  const done = remaining === 0;
  return {
    saved,
    remaining,
    ratio: goal.targetCents > 0 ? Math.min(1, Math.max(0, saved / goal.targetCents)) : 0,
    monthsLeft: daysLeft < 0 ? 0 : monthsLeft,
    perMonth: done ? 0 : daysLeft < 0 ? remaining : Math.ceil(remaining / monthsLeft),
    done,
    overdue: !done && daysLeft < 0,
  };
}
