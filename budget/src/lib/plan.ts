// Budget prévu : revenus réguliers, dépenses fixes datées (loyer, abonnements) et budgets par catégorie.
// Comparé chaque mois au réel (opérations importées).
import { CAT } from '../db/seed';
import type { Category, Transaction } from '../db/schema';
import { daysInMonth, dayInMonth, monthOf, parts } from './dates';
import type { RecurringItem } from './recurring';
import { kindOf, spendingByCategory, totals, type CatMap } from './stats';
import { normalizeLabel, prettyMerchant } from './text';

export interface PlanItem {
  id: string;
  name: string;
  /** Montant mensuel en centimes (positif). */
  amountCents: number;
  /** Jour du mois (1 à 31, ramené au dernier jour pour les mois courts). */
  day: number;
  categoryId: number;
  /** Abonnement du catalogue (pour son logo). */
  brand?: string;
}

export interface Plan {
  incomes: PlanItem[];
  fixed: PlanItem[];
  /** Démarrage guidé : à faire, terminé ou remis à plus tard. */
  setup: 'todo' | 'done' | 'skipped';
}

export const PLAN_KEY = 'plan';
export const EMPTY_PLAN: Plan = { incomes: [], fixed: [], setup: 'todo' };

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Relit un plan enregistré (ou restauré d'une sauvegarde) sans faire confiance à sa forme. */
export function normalizePlan(value: unknown): Plan {
  const v = (value ?? {}) as Partial<Plan>;
  const items = (list: unknown): PlanItem[] =>
    (Array.isArray(list) ? list : [])
      .filter((i): i is PlanItem => !!i && typeof i === 'object' && Number.isFinite((i as PlanItem).amountCents))
      .map((i) => ({
        id: String(i.id ?? newId()),
        name: String(i.name ?? ''),
        amountCents: Math.max(0, Math.round(i.amountCents)),
        day: Math.min(31, Math.max(1, Math.round(Number(i.day) || 1))),
        categoryId: Number(i.categoryId),
        ...(i.brand ? { brand: String(i.brand) } : {}),
      }));
  return {
    incomes: items(v.incomes),
    fixed: items(v.fixed),
    setup: v.setup === 'done' || v.setup === 'skipped' ? v.setup : 'todo',
  };
}

// ───────────── Catalogue d'abonnements ─────────────

export interface Brand {
  key: string;
  name: string;
  /** Prix mensuel courant, proposé par défaut (modifiable). */
  price: number;
  color: string;
  mark: string;
  categoryId: number;
  /** Mots du libellé bancaire qui désignent cet abonnement. */
  match: string[];
}

const sub = (key: string, name: string, price: number, color: string, mark: string, match: string[], categoryId: number = CAT.abonnements): Brand => ({
  key,
  name,
  price,
  color,
  mark,
  categoryId,
  match,
});

export const BRANDS: Brand[] = [
  sub('netflix', 'Netflix', 1499, '#e50914', 'N', ['NETFLIX']),
  sub('spotify', 'Spotify', 1214, '#1db954', 'S', ['SPOTIFY']),
  sub('disney', 'Disney+', 999, '#113ccf', 'D+', ['DISNEY PLUS', 'DISNEYPLUS', 'DISNEY']),
  sub('prime', 'Amazon Prime', 699, '#00a8e1', 'a', ['AMAZON PRIME', 'PRIME VIDEO', 'AMZN PRIME']),
  sub('youtube', 'YouTube Premium', 1299, '#ff0033', '▶', ['YOUTUBE', 'YOUTUBEPREMIUM']),
  sub('applemusic', 'Apple Music', 1099, '#fa243c', '♪', ['APPLE MUSIC']),
  sub('deezer', 'Deezer', 1199, '#a238ff', 'Dz', ['DEEZER']),
  sub('canal', 'Canal+', 1999, '#1a1a1a', 'C+', ['CANAL', 'CANALPLUS', 'CANAL PLUS']),
  sub('mobile', 'Forfait mobile', 1599, '#5b6472', '📱', ['FREE MOBILE', 'SOSH', 'RED BY SFR', 'B YOU', 'BOUYGUES TELECOM', 'ORANGE', 'SFR', 'NRJ MOBILE', 'PRIXTEL', 'LEBARA', 'SYMA', 'CORIOLIS']),
  sub('box', 'Box internet', 2999, '#5b6472', '🌐', ['FREEBOX', 'FREE HAUT DEBIT', 'FREE TELECOM', 'LIVEBOX', 'BBOX']),
  sub('basicfit', 'Basic-Fit', 2999, '#f47b20', 'BF', ['BASIC FIT', 'BASICFIT'], CAT.loisirs),
  sub('fitnesspark', 'Fitness Park', 2995, '#d4002a', 'FP', ['FITNESS PARK'], CAT.loisirs),
  sub('playstation', 'PlayStation Plus', 899, '#0070d1', 'PS', ['PLAYSTATION']),
  sub('xbox', 'Xbox Game Pass', 1299, '#107c10', 'X', ['XBOX', 'GAME PASS']),
  sub('icloud', 'iCloud+', 299, '#3693f3', '☁', ['ICLOUD', 'APPLE COM BILL']),
  sub('googleone', 'Google One', 199, '#4285f4', 'G1', ['GOOGLE ONE', 'GOOGLE STORAGE']),
  sub('m365', 'Microsoft 365', 1000, '#d83b01', 'M', ['MICROSOFT']),
  sub('crunchyroll', 'Crunchyroll', 699, '#f47521', 'Cr', ['CRUNCHYROLL']),
  sub('twitch', 'Twitch', 499, '#9146ff', 'Tw', ['TWITCH']),
  sub('chatgpt', 'ChatGPT Plus', 2300, '#10a37f', 'AI', ['OPENAI', 'CHATGPT']),
];

export const BRAND_BY_KEY = new Map(BRANDS.map((b) => [b.key, b]));

/** Texte lisible sur la couleur d'un abonnement. */
export function markInk(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#111' : '#fff';
}

export function brandFor(label: string): Brand | undefined {
  const norm = ` ${normalizeLabel(label)} `;
  return BRANDS.find((b) => b.match.some((m) => norm.includes(` ${m} `)));
}

// ───────────── Prévu ─────────────

/** Montant prévu par catégorie de dépense : dépenses fixes + budget libre de la catégorie. */
export function plannedByCategory(plan: Plan, categories: Category[]): Map<number, number> {
  const out = new Map<number, number>();
  const expense = new Set(categories.filter((c) => c.kind === 'expense').map((c) => c.id));
  for (const f of plan.fixed) if (expense.has(f.categoryId)) out.set(f.categoryId, (out.get(f.categoryId) ?? 0) + f.amountCents);
  for (const c of categories)
    if (expense.has(c.id) && (c.budgetCents ?? 0) > 0) out.set(c.id, (out.get(c.id) ?? 0) + c.budgetCents!);
  return out;
}

export interface Group {
  category: Category;
  planned: number;
  real: number;
}

export interface MonthSummary {
  /** Revenus prévus, ou reçus (le plus grand des deux pour le réel). */
  income: number;
  plannedIncome: number;
  realIncome: number;
  plannedSpending: number;
  realSpending: number;
  /** Dépenses à classer (réel). */
  unclassified: number;
  groups: Group[];
}

/** Prévu et réel du mois, par catégorie de dépense (ordre des catégories). */
export function monthSummary(plan: Plan, categories: Category[], monthTxs: Transaction[], cats: CatMap): MonthSummary {
  const planned = plannedByCategory(plan, categories);
  const spending = spendingByCategory(monthTxs, cats);
  const groups = categories
    .filter((c) => c.kind === 'expense' && ((planned.get(c.id) ?? 0) > 0 || (spending.get(c.id) ?? 0) > 0))
    .map((category) => ({ category, planned: planned.get(category.id) ?? 0, real: Math.max(0, spending.get(category.id) ?? 0) }));
  const plannedIncome = plan.incomes.reduce((s, i) => s + i.amountCents, 0);
  const realIncome = totals(monthTxs, cats).income;
  const unclassified = Math.max(0, spending.get(null) ?? 0);
  return {
    income: Math.max(plannedIncome, realIncome),
    plannedIncome,
    realIncome,
    plannedSpending: groups.reduce((s, g) => s + g.planned, 0),
    realSpending: groups.reduce((s, g) => s + g.real, 0) + unclassified,
    unclassified,
    groups,
  };
}

// ───────────── Calendrier ─────────────

export interface DayEvent {
  date: string;
  kind: 'income' | 'fixed';
  item: PlanItem;
}

/** Revenus et dépenses fixes prévus dans le mois, datés. */
export function plannedEvents(plan: Plan, ym: string): DayEvent[] {
  return [
    ...plan.incomes.map((item) => ({ date: dayInMonth(ym, item.day), kind: 'income' as const, item })),
    ...plan.fixed.map((item) => ({ date: dayInMonth(ym, item.day), kind: 'fixed' as const, item })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.item.name.localeCompare(b.item.name));
}

/** Solde réel de chaque jour du mois (revenus − dépenses, virements internes et épargne exclus). */
export function dailyNet(monthTxs: Transaction[], cats: CatMap): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of monthTxs) {
    const kind = kindOf(t, cats);
    if (kind !== 'expense' && kind !== 'income') continue;
    out.set(t.date, (out.get(t.date) ?? 0) + t.amountCents);
  }
  return out;
}

// ───────────── Prévision ─────────────

export interface Forecast {
  /** Revenus attendus sur le mois. */
  income: number;
  /** Déjà dépensé. */
  spent: number;
  /** Encore prévu : part non dépensée de chaque catégorie (loyer pas encore payé, budget restant…). */
  stillPlanned: number;
  /** Épargne de fin de mois si le reste du budget est respecté. */
  savings: number;
  /** Ce qui reste à dépenser dans les budgets libres (courses, restaurants…), et par jour. */
  freeLeft: number;
  perDay: number | null;
  daysLeft: number;
  /** Catégories déjà au-delà du prévu. */
  over: Group[];
  /** Revenus et dépenses fixes encore à venir ce mois-ci. */
  upcoming: DayEvent[];
}

export function forecast(plan: Plan, summary: MonthSummary, categories: Category[], ym: string, today: string): Forecast {
  const cur = monthOf(today);
  const daysLeft = ym < cur ? 0 : ym > cur ? daysInMonth(ym) : daysInMonth(ym) - parts(today)[2] + 1;
  const upcoming = ym < cur ? [] : plannedEvents(plan, ym).filter((e) => ym > cur || e.date >= today);
  // Dépenses fixes pas encore passées : elles ne font pas partie du budget libre restant.
  const fixedToCome = new Map<number, number>();
  for (const e of upcoming)
    if (e.kind === 'fixed') fixedToCome.set(e.item.categoryId, (fixedToCome.get(e.item.categoryId) ?? 0) + e.item.amountCents);
  let stillPlanned = 0;
  let freeLeft = 0;
  for (const g of summary.groups) {
    const left = Math.max(0, g.planned - g.real);
    stillPlanned += left;
    const budget = categories.find((c) => c.id === g.category.id)?.budgetCents ?? 0;
    if (budget > 0) freeLeft += Math.min(budget, Math.max(0, left - (fixedToCome.get(g.category.id) ?? 0)));
  }
  return {
    income: summary.income,
    spent: summary.realSpending,
    stillPlanned,
    savings: summary.income - summary.realSpending - stillPlanned,
    freeLeft,
    perDay: daysLeft > 0 ? Math.floor(freeLeft / daysLeft) : null,
    daysLeft,
    over: summary.groups.filter((g) => g.planned > 0 && g.real > g.planned),
    upcoming,
  };
}

// ───────────── Suggestions d'après les relevés ─────────────

export interface Suggestions {
  salary?: { amountCents: number; day: number };
  rent?: { amountCents: number; day: number };
  subscriptions: PlanItem[];
  /** Budget mensuel proposé par catégorie (moyenne des derniers mois, arrondie à 10 € au-dessus). */
  budgets: Map<number, number>;
}

const roundUp10 = (cents: number) => Math.ceil(cents / 1000) * 1000;

export function suggestFromHistory(
  incomes: RecurringItem[],
  charges: RecurringItem[],
  averages: Map<number | null, number>,
): Suggestions {
  const salary = [...incomes].sort((a, b) => b.amount - a.amount)[0];
  const rent = charges
    .filter((c) => c.categoryId === CAT.logement && c.amount >= 20000)
    .sort((a, b) => b.amount - a.amount)[0];
  const seen = new Set<string>();
  const subscriptions: PlanItem[] = [];
  for (const c of charges) {
    const brand = brandFor(c.label) ?? brandFor(c.merchant);
    if (!brand && c.categoryId !== CAT.abonnements) continue;
    const key = brand?.key ?? c.merchant;
    if (seen.has(key)) continue;
    seen.add(key);
    subscriptions.push({
      id: newId(),
      name: brand?.name ?? prettyMerchant(c.merchant),
      amountCents: c.amount,
      day: c.day,
      categoryId: brand?.categoryId ?? c.categoryId ?? CAT.abonnements,
      ...(brand ? { brand: brand.key } : {}),
    });
  }
  const budgets = new Map<number, number>();
  for (const id of [CAT.transport, CAT.courses, CAT.restaurants, CAT.shopping]) {
    const avg = averages.get(id) ?? 0;
    if (avg > 0) budgets.set(id, roundUp10(avg));
  }
  return {
    ...(salary ? { salary: { amountCents: salary.amount, day: salary.day } } : {}),
    ...(rent ? { rent: { amountCents: rent.amount, day: rent.day } } : {}),
    subscriptions,
    budgets,
  };
}
