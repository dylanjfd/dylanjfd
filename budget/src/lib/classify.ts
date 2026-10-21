// Classement automatique des opérations : règles, mémoire des choix passés, puis indices du libellé.
import { CAT } from '../db/seed';
import type { CategorySource, Rule, Transaction } from '../db/schema';
import { categorize } from './rules';

type Tx = Pick<Transaction, 'labelNorm' | 'merchant' | 'amountCents'>;

export interface Classification {
  categoryId: number | null;
  source: CategorySource;
  /** Pourquoi l'app a choisi cette catégorie (affiché quand elle l'a devinée). */
  reason?: string;
}

interface Vote {
  n: number;
  last: string;
}

/** Ce que l'utilisateur a choisi à la main, par commerçant. */
export interface Memory {
  byMerchant: Map<string, Map<number, Vote>>;
  /** Mots de chaque commerçant mémorisé, pour retrouver les libellés proches. */
  words: [string, Set<string>][];
}

type RuleLike = Pick<Rule, 'pattern' | 'categoryId' | 'source'>;

export interface ClassifyContext {
  /** Règles triées avec `sortRules` (personnelles d'abord). */
  rules: RuleLike[];
  userRules: RuleLike[];
  /** Mots-clés d'un seul mot, assez longs pour reconnaître un mot proche (pluriel, faute de lecture…). */
  fuzzy: RuleLike[];
  memory: Memory;
  /** Catégories existantes (l'utilisateur peut en supprimer). */
  categoryIds: Set<number>;
}

export function makeContext(sortedRules: RuleLike[], memory: Memory, categoryIds: Iterable<number>): ClassifyContext {
  return {
    rules: sortedRules,
    userRules: sortedRules.filter((r) => r.source === 'user'),
    fuzzy: sortedRules
      .filter((r) => r.source === 'default' && r.pattern.length >= 5 && !r.pattern.includes(' ') && !/\d/.test(r.pattern))
      .sort((a, b) => b.pattern.length - a.pattern.length),
    memory,
    categoryIds: new Set(categoryIds),
  };
}

const merchantWords = (m: string) => new Set(m.split(' ').filter((w) => w.length >= 3));

export function buildMemory(txs: Pick<Transaction, 'merchant' | 'categoryId' | 'categorySource' | 'date'>[]): Memory {
  const byMerchant = new Map<string, Map<number, Vote>>();
  for (const t of txs) {
    if (t.categorySource !== 'manual' || t.categoryId == null || !t.merchant) continue;
    const votes = byMerchant.get(t.merchant) ?? new Map<number, Vote>();
    const v = votes.get(t.categoryId) ?? { n: 0, last: '' };
    votes.set(t.categoryId, { n: v.n + 1, last: t.date > v.last ? t.date : v.last });
    byMerchant.set(t.merchant, votes);
  }
  return { byMerchant, words: [...byMerchant.keys()].map((m) => [m, merchantWords(m)]) };
}

/** Catégorie la plus choisie pour ce commerçant (la plus récente en cas d'égalité). */
function recall(memory: Memory, merchant: string, ids: Set<number>) {
  const votes = memory.byMerchant.get(merchant);
  if (!votes) return null;
  let best: { categoryId: number; n: number; last: string } | null = null;
  let total = 0;
  for (const [categoryId, v] of votes) {
    if (!ids.has(categoryId)) continue;
    total += v.n;
    if (!best || v.n > best.n || (v.n === best.n && v.last > best.last)) best = { categoryId, ...v };
  }
  return best && { categoryId: best.categoryId, n: best.n, share: best.n / total };
}

/** Commerçant mémorisé qui partage la plupart de ses mots avec celui-ci. */
function recallSimilar(memory: Memory, merchant: string, ids: Set<number>) {
  const words = merchantWords(merchant);
  if (words.size === 0) return null;
  let best: { merchant: string; score: number } | null = null;
  for (const [m, w] of memory.words) {
    let inter = 0;
    for (const x of words) if (w.has(x)) inter++;
    if (inter === 0) continue;
    const score = inter / (words.size + w.size - inter);
    if (score >= 0.5 && (!best || score > best.score)) best = { merchant: m, score };
  }
  if (!best) return null;
  const r = recall(memory, best.merchant, ids);
  return r && { ...r, merchant: best.merchant };
}

// Mots qui signalent un revenu quand l'opération est un crédit.
const INCOME =
  /\b(SALAIRES?|PAIE|PAYE|REMUNERATION|INDEMNITES?|ALLOCATIONS?|ALLOC|APL|AAH|RSA|ARE|PRIMES?|BOURSE|DIVIDENDES?|INTERETS|PENSION|RETRAITE|CAF|POLE EMPLOI|FRANCE TRAVAIL|NOTE DE FRAIS|NDF|HONORAIRES)\b/;
const TRANSFER = /\b(VIR|VIREMENT|VIRT|VRT|VIRMT)\b/;
const CHEQUE = /\b(CHQ|CHEQUES?|REM CHQ|REMISE CHEQUES?)\b/;
const CASH_DEPOSIT = /\b(VERSEMENT|DEPOT) ESPECES\b/;
const REFUND = /\b(AVOIR|REMBOURSEMENT|REMB|REMBT|RETOUR|ANNULATION|CB|CARTE)\b/;
const BANK_FEES = /\b(FRAIS|COMMISSION|AGIOS|COTISATION|COTIS)\b/;
const DIRECT_DEBIT = /\b(PRLV|PRELEVEMENT|PRELEV|PRLVT)\b/;
const CARD = /\b(CB|CARTE|PAIEMENT|PAIEMT|ACHAT)\b/;

/** Distance d'édition au plus 1 (une lettre en trop, en moins ou différente). */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Mot du libellé qui commence par un mot-clé (PHARMACIES, YOUTUBEPREMIUM…), sinon qui en diffère d'une lettre. */
function fuzzyKeyword(labelNorm: string, patterns: RuleLike[]) {
  const tokens = labelNorm.split(' ').filter((t) => t.length >= 5 && !/\d/.test(t));
  if (tokens.length === 0) return null;
  for (const r of patterns) if (tokens.some((t) => t.startsWith(r.pattern))) return r;
  for (const r of patterns) if (r.pattern.length >= 7 && tokens.some((t) => oneEditApart(t, r.pattern))) return r;
  return null;
}

/**
 * Catégorie d'une opération, de la source la plus sûre à la moins sûre :
 * vos règles, vos choix répétés pour ce commerçant, les mots d'un revenu,
 * les mots-clés connus, un choix unique, un mot proche, un commerçant ressemblant,
 * puis la nature de l'opération (virement reçu, chèque, frais).
 */
export function classify(t: Tx, ctx: ClassifyContext): Classification {
  const { memory, categoryIds: ids } = ctx;
  const has = (id: number) => ids.has(id);
  const credit = t.amountCents > 0;
  // Une dépense n'est jamais devinée comme revenu.
  const plausible = (id: number) => has(id) && (credit || id !== CAT.revenus);

  const byUser = categorize(t.labelNorm, ctx.userRules);
  if (byUser !== null) return { categoryId: byUser, source: 'rule' };

  const recalled = t.merchant ? recall(memory, t.merchant, ids) : null;
  if (recalled && recalled.n >= 2 && recalled.share >= 2 / 3)
    return { categoryId: recalled.categoryId, source: 'auto', reason: 'comme tes opérations précédentes' };

  const keyword = categorize(t.labelNorm, ctx.rules);
  // Un salaire versé par CARREFOUR reste un revenu ; « INTERETS LIVRET A » reste de l'épargne.
  if (credit && has(CAT.revenus) && INCOME.test(t.labelNorm) && keyword !== CAT.epargne && keyword !== CAT.virements)
    return { categoryId: CAT.revenus, source: 'rule' };
  if (keyword !== null) return { categoryId: keyword, source: 'rule' };

  if (recalled && plausible(recalled.categoryId))
    return { categoryId: recalled.categoryId, source: 'auto', reason: 'comme ton dernier choix' };

  const near = fuzzyKeyword(t.labelNorm, ctx.fuzzy);
  if (near && plausible(near.categoryId))
    return { categoryId: near.categoryId, source: 'auto', reason: `proche du mot-clé « ${near.pattern} »` };

  const similar = t.merchant ? recallSimilar(memory, t.merchant, ids) : null;
  if (similar && plausible(similar.categoryId))
    return { categoryId: similar.categoryId, source: 'auto', reason: `ressemble à « ${similar.merchant} »` };

  if (credit && has(CAT.revenus)) {
    if (TRANSFER.test(t.labelNorm)) return { categoryId: CAT.revenus, source: 'auto', reason: 'virement reçu' };
    if (CHEQUE.test(t.labelNorm)) return { categoryId: CAT.revenus, source: 'auto', reason: 'chèque encaissé' };
    if (CASH_DEPOSIT.test(t.labelNorm)) return { categoryId: CAT.revenus, source: 'auto', reason: 'dépôt d’espèces' };
    // Un remboursement par carte d'un commerçant inconnu : on ne sait pas de quelle dépense il s'agit.
    if (!REFUND.test(t.labelNorm)) return { categoryId: CAT.revenus, source: 'auto', reason: 'argent reçu' };
  }
  if (!credit && has(CAT.autres) && BANK_FEES.test(t.labelNorm))
    return { categoryId: CAT.autres, source: 'auto', reason: 'frais bancaires' };

  return { categoryId: null, source: 'none' };
}

/** Catégories à proposer en premier pour une opération à classer. */
export function suggestCategories(t: Tx, ctx: ClassifyContext, max = 3): number[] {
  const out: number[] = [];
  const add = (id: number | null | undefined) => {
    if (id != null && ctx.categoryIds.has(id) && !out.includes(id)) out.push(id);
  };
  add(classify(t, ctx).categoryId);
  if (t.merchant) add(recallSimilar(ctx.memory, t.merchant, ctx.categoryIds)?.categoryId);
  const n = t.labelNorm;
  let likely: number[];
  if (t.amountCents > 0) likely = [CAT.revenus, CAT.virements, CAT.epargne];
  else if (DIRECT_DEBIT.test(n)) likely = [CAT.abonnements, CAT.logement, CAT.autres];
  else if (TRANSFER.test(n)) likely = [CAT.logement, CAT.virements, CAT.epargne, CAT.autres];
  else if (CHEQUE.test(n)) likely = [CAT.logement, CAT.autres, CAT.shopping];
  else if (CARD.test(n)) likely = [CAT.courses, CAT.restaurants, CAT.shopping, CAT.loisirs];
  else likely = [CAT.courses, CAT.shopping, CAT.autres];
  likely.forEach(add);
  return out.slice(0, max);
}
