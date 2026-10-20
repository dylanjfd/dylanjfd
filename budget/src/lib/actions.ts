// Opérations d'écriture sur la base locale.
import { seedDatabase } from '../db/seed';
import { db, TABLES, type CategorySource, type ImportBatch, type Rule, type Transaction } from '../db/schema';
import { categorize, matchesPattern, sortRules } from './rules';
import { merchantOf, normalizeLabel } from './text';

export async function getSortedRules(): Promise<Rule[]> {
  return sortRules(await db.rules.toArray());
}

/** Crée une opération à partir de ses champs bruts, catégorisée par les règles. */
export function draftTransaction(
  row: { date: string; amountCents: number; label: string; fitId?: string },
  sortedRules: Rule[],
): Omit<Transaction, 'id' | 'accountId'> {
  const labelNorm = normalizeLabel(row.label);
  const categoryId = categorize(labelNorm, sortedRules);
  return {
    date: row.date,
    amountCents: row.amountCents,
    label: row.label,
    labelNorm,
    merchant: merchantOf(row.label),
    categoryId,
    categorySource: categoryId === null ? 'none' : 'rule',
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

/** Réapplique toutes les règles aux opérations qui n'ont pas été classées à la main. */
export async function reapplyRules(): Promise<number> {
  return db.transaction('rw', db.rules, db.transactions, async () => {
    const rules = sortRules(await db.rules.toArray());
    const all = await db.transactions.filter((t) => t.categorySource !== 'manual').toArray();
    const updates: { key: number; changes: Partial<Transaction> }[] = [];
    for (const t of all) {
      const categoryId = categorize(t.labelNorm, rules);
      if (categoryId !== t.categoryId) {
        updates.push({ key: t.id, changes: { categoryId, categorySource: categoryId === null ? 'none' : 'rule' } });
      }
    }
    await db.transactions.bulkUpdate(updates);
    return updates.length;
  });
}

export async function setTransactionCategory(id: number, categoryId: number | null): Promise<void> {
  await db.transactions.update(id, { categoryId, categorySource: categoryId === null ? 'none' : 'manual' });
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

