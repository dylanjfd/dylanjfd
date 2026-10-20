import type { CategoryKind, Transaction } from '../db/schema';
import { addMonths, dayInMonth, diffDays, monthOf, parts } from './dates';
import { kindOf, type CatMap } from './stats';

export interface RecurringItem {
  key: string;
  merchant: string;
  /** Libellé complet de la dernière occurrence. */
  label: string;
  categoryId: number | null;
  kind: CategoryKind;
  sign: 1 | -1;
  occurrences: Pick<Transaction, 'id' | 'date' | 'amountCents'>[];
  /** Dernier montant (valeur absolue, en centimes). */
  amount: number;
  /** Montant avant le dernier changement de prix (ou montant précédent). */
  previousAmount: number | null;
  /** Hausse du dernier montant par rapport au précédent (0 si aucune). */
  increase: number;
  averageAmount: number;
  day: number;
  lastDate: string;
  nextDate: string;
}

/** Écart relatif au-delà duquel deux montants d'un même commerçant sont deux abonnements distincts. */
const SPLIT_RATIO = 1.25;
/** Une récurrence sans occurrence depuis ce nombre de jours est considérée comme terminée. */
const STALE_DAYS = 45;

/** Coefficient de variation des montants (écart type / moyenne). */
function variation(list: Transaction[]): number {
  const v = list.map((t) => Math.abs(t.amountCents));
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return mean ? sd / mean : 0;
}

/** Écart entre deux jours du mois, en tenant compte du passage d'un mois à l'autre (30 ↔ 2). */
function dayDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 31 - d);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Détecte les opérations mensuelles : même commerçant, montant proche (±25 %),
 * espacées d'environ un mois. `refDate` sert à écarter les récurrences terminées
 * (on passe la date de la dernière opération importée).
 */
export function detectRecurring(txs: Transaction[], cats: CatMap, refDate: string): RecurringItem[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (!t.merchant || t.amountCents === 0 || kindOf(t, cats) === 'transfer') continue;
    const key = `${t.amountCents < 0 ? -1 : 1}|${t.merchant}`;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const items: RecurringItem[] = [];
  for (const [groupKey, list] of groups) {
    if (list.length < 2) continue;
    const byAmount = [...list].sort((a, b) => Math.abs(a.amountCents) - Math.abs(b.amountCents));
    const clusters: Transaction[][] = [[byAmount[0]]];
    for (const t of byAmount.slice(1)) {
      const cur = clusters[clusters.length - 1];
      const prev = Math.abs(cur[cur.length - 1].amountCents);
      const next = Math.abs(t.amountCents);
      if (next > prev * SPLIT_RATIO && next - prev > 50) clusters.push([t]);
      else cur.push(t);
    }
    // Commerçant fréquent (courses…) : seuls des montants quasi identiques peuvent être un abonnement.
    const dates = list.map((t) => t.date).sort();
    const months = Math.max(1, diffDays(dates[0], dates[dates.length - 1]) / 30.4);
    const frequent = list.length / months > 1.5;
    clusters.forEach((cluster, idx) => {
      if (frequent && variation(cluster) > 0.03) return;
      const item = evaluate(cluster, `${groupKey}|${idx}`, cats, refDate);
      if (item) items.push(item);
    });
  }
  return items.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

function evaluate(cluster: Transaction[], key: string, cats: CatMap, refDate: string): RecurringItem | null {
  const occ = [...cluster].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  if (occ.length < 2) return null;
  const intervals = occ.slice(1).map((t, i) => diffDays(occ[i].date, t.date));
  const med = median(intervals);
  if (med < 26 || med > 35) return null;
  if (intervals.filter((d) => d >= 20 && d <= 40).length / intervals.length < 0.75) return null;
  // Un prélèvement tombe à peu près le même jour chaque mois.
  const days = occ.map((t) => parts(t.date)[2]);
  const day = Math.round(median(days));
  if (days.filter((d) => dayDistance(d, day) <= 4).length / days.length < 0.75) return null;

  const last = occ[occ.length - 1];
  const amount = Math.abs(last.amountCents);
  // Dernier changement de montant : la hausse reste signalée environ deux mois.
  let k = occ.length - 2;
  while (k > 0 && Math.abs(occ[k].amountCents) === amount) k--;
  const previousAmount = Math.abs(occ[k].amountCents);
  const changedRecently = diffDays(occ[k + 1].date, refDate) <= 62;
  // Avec deux occurrences seulement, on exige un montant quasi identique.
  if (occ.length === 2 && Math.abs(amount - previousAmount) > previousAmount * 0.03) return null;
  if (diffDays(last.date, refDate) > STALE_DAYS) return null;

  let nextMonth = addMonths(monthOf(last.date), 1);
  let nextDate = dayInMonth(nextMonth, day);
  if (diffDays(last.date, nextDate) < 15) {
    nextMonth = addMonths(nextMonth, 1);
    nextDate = dayInMonth(nextMonth, day);
  }

  const diff = amount - previousAmount;
  const increase = changedRecently && diff >= Math.max(10, previousAmount * 0.01) ? diff : 0;

  return {
    key,
    merchant: last.merchant,
    label: last.label,
    categoryId: last.categoryId,
    kind: kindOf(last, cats),
    sign: last.amountCents < 0 ? -1 : 1,
    occurrences: occ.map(({ id, date, amountCents }) => ({ id, date, amountCents })),
    amount,
    previousAmount,
    increase,
    averageAmount: Math.round(occ.reduce((s, t) => s + Math.abs(t.amountCents), 0) / occ.length),
    day,
    lastDate: last.date,
    nextDate,
  };
}

export interface RecurringSummary {
  charges: RecurringItem[];
  incomes: RecurringItem[];
  savings: RecurringItem[];
  chargesTotal: number;
  incomesTotal: number;
  savingsTotal: number;
}

export function summarizeRecurring(items: RecurringItem[], ignored: Set<string>): RecurringSummary {
  const active = items.filter((i) => !ignored.has(i.key));
  const charges = active.filter((i) => i.sign < 0 && i.kind === 'expense');
  const incomes = active.filter((i) => i.sign > 0 && i.kind === 'income');
  const savings = active.filter((i) => i.sign < 0 && i.kind === 'savings');
  const sum = (l: RecurringItem[]) => l.reduce((s, i) => s + i.amount, 0);
  return {
    charges,
    incomes,
    savings,
    chargesTotal: sum(charges),
    incomesTotal: sum(incomes),
    savingsTotal: sum(savings),
  };
}
