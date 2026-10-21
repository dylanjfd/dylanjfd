// Opérations d'écriture sur la base locale.
import { DEFAULT_RULES_VERSION, RULES_ADDED_IN_V2, seedDatabase } from '../db/seed';
import { db, TABLES, type CategorySource, type ImportBatch, type Transaction } from '../db/schema';
import { buildMemory, classify, makeContext, type ClassifyContext } from './classify';
import { PLAN_KEY, type Plan } from './plan';
import { matchesPattern, sortRules } from './rules';
import { merchantOf, normalizeLabel } from './text';

/** Règles, choix passés et catégories : tout ce qu'il faut pour classer une opération. */
export async function getClassifyContext(): Promise<ClassifyContext> {
  const [rules, manual, categories] = await Promise.all([
    db.rules.toArray(),
    db.transactions.filter((t) => t.categorySource === 'manual').toArray(),
    db.categories.toArray(),
  ]);
  return makeContext(sortRules(rules), buildMemory(manual), categories.map((c) => c.id));
}

/** Crée une opération à partir de ses champs bruts, classée automatiquement. */
export function draftTransaction(
  row: { date: string; amountCents: number; label: string; fitId?: string },
  ctx: ClassifyContext,
): Omit<Transaction, 'id' | 'accountId'> {
  const labelNorm = normalizeLabel(row.label);
  const merchant = merchantOf(row.label);
  const { categoryId, source } = classify({ labelNorm, merchant, amountCents: row.amountCents }, ctx);
  return {
    date: row.date,
    amountCents: row.amountCents,
    label: row.label,
    labelNorm,
    merchant,
    categoryId,
    categorySource: source,
    ...(row.fitId ? { fitId: row.fitId } : {}),
  };
}

/** Opérations classées automatiquement que la règle ferait changer de catégorie. */
async function ruleTargets(pattern: string, categoryId: number): Promise<Transaction[]> {
  return db.transactions
    .filter((t) => t.categorySource !== 'manual' && t.categoryId !== categoryId && matchesPattern(t.labelNorm, pattern))
    .toArray();
}

export async function countRuleMatches(pattern: string, categoryId: number): Promise<number> {
  const p = normalizeLabel(pattern);
  if (!p) return 0;
  return (await ruleTargets(p, categoryId)).length;
}

/** Ajoute une règle personnelle ; reclasse si demandé les opérations non modifiées à la main. */
export async function createRule(pattern: string, categoryId: number, applyToExisting: boolean): Promise<number> {
  const p = normalizeLabel(pattern);
  if (!p) return 0;
  return db.transaction('rw', db.rules, db.transactions, async () => {
    const existing = await db.rules.where('pattern').equals(p).toArray();
    const userRule = existing.find((r) => r.source === 'user');
    if (userRule) await db.rules.update(userRule.id, { categoryId });
    else await db.rules.add({ pattern: p, categoryId, source: 'user' });
    if (!applyToExisting) return 0;
    const targets = await ruleTargets(p, categoryId);
    await db.transactions.bulkUpdate(targets.map((t) => ({ key: t.id, changes: { categoryId, categorySource: 'rule' as CategorySource } })));
    return targets.length;
  });
}

/**
 * Reclasse les opérations qui n'ont pas été classées à la main, avec les règles
 * et tout ce que l'app a appris de vos choix. Renvoie le nombre d'opérations modifiées.
 */
export async function reapplyRules(): Promise<number> {
  return db.transaction('rw', db.rules, db.transactions, db.categories, async () => {
    const ctx = await getClassifyContext();
    const all = await db.transactions.filter((t) => t.categorySource !== 'manual').toArray();
    const cache = new Map<string, { categoryId: number | null; source: CategorySource }>();
    const updates: { key: number; changes: Partial<Transaction> }[] = [];
    let moved = 0;
    for (const t of all) {
      const key = `${t.amountCents > 0 ? '+' : '-'}${t.merchant}|${t.labelNorm}`;
      let c = cache.get(key);
      if (!c) cache.set(key, (c = classify(t, ctx)));
      if (c.categoryId !== t.categoryId || c.source !== t.categorySource) {
        updates.push({ key: t.id, changes: { categoryId: c.categoryId, categorySource: c.source } });
        if (c.categoryId !== t.categoryId) moved++;
      }
    }
    await db.transactions.bulkUpdate(updates);
    return moved;
  });
}

/**
 * Catégorie choisie à la main (« à classer » compris : l'app ne la reclassera plus).
 * Les opérations semblables qui ne sont pas classées à la main suivent ce choix.
 * Renvoie le nombre d'autres opérations reclassées.
 */
export async function setTransactionCategory(id: number, categoryId: number | null): Promise<number> {
  return setCategories([id], categoryId);
}

export async function setCategories(ids: number[], categoryId: number | null): Promise<number> {
  await db.transactions.bulkUpdate(ids.map((key) => ({ key, changes: { categoryId, categorySource: 'manual' as const } })));
  return reapplyRules();
}

/** Valide des catégories devinées par l'app : elles comptent ensuite comme des choix manuels. */
export async function confirmCategories(ids: number[]): Promise<void> {
  await db.transactions.bulkUpdate(ids.map((key) => ({ key, changes: { categorySource: 'manual' as const } })));
  await reapplyRules();
}

/** Remet des opérations dans l'état où elles étaient (pour « Annuler »), puis reclasse le reste. */
export async function restoreCategories(
  before: Pick<Transaction, 'id' | 'categoryId' | 'categorySource'>[],
): Promise<void> {
  await db.transactions.bulkUpdate(
    before.map((t) => ({ key: t.id, changes: { categoryId: t.categoryId, categorySource: t.categorySource } })),
  );
  await reapplyRules();
}

const CLASSIFIER_VERSION = 2;

/**
 * Au démarrage : ajoute les nouveaux mots-clés par défaut aux bases existantes,
 * puis reclasse une fois les opérations avec la version actuelle du classement.
 */
export async function upgradeClassification(): Promise<number> {
  const rulesVersion = await getSetting('defaultRulesVersion', 1);
  if (rulesVersion < DEFAULT_RULES_VERSION) {
    await db.transaction('rw', db.rules, db.categories, db.settings, async () => {
      const known = new Set((await db.rules.toArray()).map((r) => r.pattern));
      const categories = new Set((await db.categories.toCollection().primaryKeys()) as number[]);
      await db.rules.bulkAdd(RULES_ADDED_IN_V2.filter((r) => !known.has(r.pattern) && categories.has(r.categoryId)));
      await setSetting('defaultRulesVersion', DEFAULT_RULES_VERSION);
    });
  }
  if ((await getSetting('classifierVersion', 1)) >= CLASSIFIER_VERSION) return 0;
  const n = await reapplyRules();
  await setSetting('classifierVersion', CLASSIFIER_VERSION);
  return n;
}

/** Supprime une catégorie : ses opérations repassent « à classer » et ses règles disparaissent. */
export async function deleteCategory(id: number): Promise<void> {
  await db.transaction('rw', db.categories, db.rules, db.transactions, async () => {
    await db.transactions.where('categoryId').equals(id).modify({ categoryId: null, categorySource: 'none' });
    await db.rules.where('categoryId').equals(id).delete();
    await db.categories.delete(id);
  });
}

export interface ImportCommit {
  fileName: string;
  accountId: number;
  rows: Omit<Transaction, 'id' | 'accountId'>[];
  duplicates: number;
}

export async function commitImport({ fileName, accountId, rows, duplicates }: ImportCommit): Promise<number> {
  return db.transaction('rw', db.transactions, db.importBatches, async () => {
    const dates = rows.map((r) => r.date).sort();
    const batch: Omit<ImportBatch, 'id'> = {
      createdAt: new Date().toISOString(),
      fileName,
      accountId,
      count: rows.length,
      duplicates,
      from: dates[0],
      to: dates[dates.length - 1],
    };
    const batchId = await db.importBatches.add(batch);
    await db.transactions.bulkAdd(rows.map((r) => ({ ...r, accountId, batchId })));
    return batchId;
  });
}

/** Annule un import : supprime toutes les opérations qu'il a ajoutées. */
export async function undoImport(batchId: number): Promise<number> {
  return db.transaction('rw', db.transactions, db.importBatches, async () => {
    const n = await db.transactions.where('batchId').equals(batchId).delete();
    await db.importBatches.delete(batchId);
    return n;
  });
}

export async function deleteAccount(id: number): Promise<void> {
  await db.transaction('rw', [db.accounts, db.transactions, db.importBatches, db.importProfiles], async () => {
    await db.transactions.where('accountId').equals(id).delete();
    await db.importBatches.filter((b) => b.accountId === id).delete();
    await db.importProfiles.filter((p) => p.accountId === id).modify({ accountId: undefined });
    await db.accounts.delete(id);
  });
}

export async function savePlan(plan: Plan): Promise<void> {
  await setSetting(PLAN_KEY, plan);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

/** Efface toutes les données puis recrée les catégories et règles par défaut. */
export async function deleteAllData(): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async (tx) => {
    for (const t of TABLES) await db.table(t).clear();
    seedDatabase(tx);
  });
}

