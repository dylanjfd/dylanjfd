import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db/schema';
import { CAT, DEFAULT_CATEGORIES } from '../src/db/seed';
import { commitImport, createRule, deleteAllData, draftTransaction, getClassifyContext, reapplyRules, undoImport } from '../src/lib/actions';
import { buildBackup, parseBackup, restoreBackup } from '../src/lib/backup';

async function importSample() {
  const rules = await getClassifyContext();
  const rows = [
    { date: '2026-10-01', amountCents: 245000, label: 'VIR SEPA ACME SALAIRE' },
    { date: '2026-10-03', amountCents: -4530, label: 'CB CARREFOUR MARKET 02/10' },
    { date: '2026-10-04', amountCents: -1250, label: 'CB CHEZ PAULETTE 04/10' },
  ].map((r) => draftTransaction(r, rules));
  return commitImport({ fileName: 'test.csv', accountId: 1, rows, duplicates: 0 });
}

describe('base locale', () => {
  it('crée les catégories, règles et le compte par défaut', async () => {
    expect(await db.categories.count()).toBe(DEFAULT_CATEGORIES.length);
    expect(await db.rules.count()).toBeGreaterThan(200);
    expect(await db.accounts.count()).toBe(1);
  });

  it('importe, classe et annule un import', async () => {
    const batchId = await importSample();
    const txs = await db.transactions.orderBy('date').toArray();
    expect(txs.map((t) => t.categoryId)).toEqual([CAT.revenus, CAT.courses, null]);
    expect(await undoImport(batchId)).toBe(3);
    expect(await db.transactions.count()).toBe(0);
  });

  it('une règle personnelle reclasse les opérations non modifiées à la main', async () => {
    await importSample();
    const updated = await createRule('chez paulette', CAT.restaurants, true);
    expect(updated).toBe(1);
    const t = await db.transactions.filter((x) => x.merchant === 'PAULETTE').first();
    expect(t?.categoryId).toBe(CAT.restaurants);
    expect(await reapplyRules()).toBe(0);
  });

  it('sauvegarde puis restaure toutes les données', async () => {
    await db.categories.update(CAT.courses, { budgetCents: 40000 });
    const json = await buildBackup();
    const before = await db.transactions.count();
    await deleteAllData();
    expect(await db.transactions.count()).toBe(0);
    expect((await db.categories.get(CAT.courses))?.budgetCents).toBeNull();

    await restoreBackup(parseBackup(json));
    expect(await db.transactions.count()).toBe(before);
    expect((await db.categories.get(CAT.courses))?.budgetCents).toBe(40000);
    expect(await db.rules.filter((r) => r.source === 'user').count()).toBe(1);
  });

  it('refuse un fichier qui n’est pas une sauvegarde', () => {
    expect(() => parseBackup('pas du json')).toThrow(/JSON/);
    expect(() => parseBackup('{"app":"autre"}')).toThrow(/sauvegarde/);
  });
});
