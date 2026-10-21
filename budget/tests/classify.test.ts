import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Rule, type Transaction } from '../src/db/schema';
import { CAT, DEFAULT_CATEGORIES, DEFAULT_RULES, RULES_ADDED_IN_V2 } from '../src/db/seed';
import {
  commitImport,
  deleteAllData,
  draftTransaction,
  getClassifyContext,
  getSetting,
  restoreCategories,
  setCategories,
  setTransactionCategory,
  upgradeClassification,
} from '../src/lib/actions';
import { buildMemory, classify, makeContext, suggestCategories, type Memory } from '../src/lib/classify';
import { sortRules } from '../src/lib/rules';
import { merchantOf, normalizeLabel } from '../src/lib/text';

const ALL_IDS = DEFAULT_CATEGORIES.map((c) => c.id);
const RULES = sortRules(DEFAULT_RULES.map((r, i) => ({ ...r, id: i + 1 })));
const EMPTY = buildMemory([]);

function ctx(memory: Memory = EMPTY, extra: Omit<Rule, 'id'>[] = [], ids = ALL_IDS) {
  return makeContext(sortRules([...RULES, ...extra.map((r, i) => ({ ...r, id: 10000 + i }))]), memory, ids);
}

function tx(label: string, amountCents: number) {
  return { labelNorm: normalizeLabel(label), merchant: merchantOf(label), amountCents };
}

function manual(label: string, categoryId: number, date = '2026-10-01') {
  return { merchant: merchantOf(label), categoryId, categorySource: 'manual' as const, date };
}

describe('mots-clés par défaut', () => {
  it('chaque mot-clé ne vise qu’une catégorie et les nouvelles listes sont nombreuses', () => {
    const patterns = DEFAULT_RULES.map((r) => r.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(DEFAULT_RULES.length).toBeGreaterThan(900);
    expect(RULES_ADDED_IN_V2.length).toBeGreaterThan(600);
  });

  it.each([
    ['PAIEMENT PAR CARTE X1234 PHIE DE LA GARE 02/09', CAT.sante],
    ['CARTE X1234 18/09 E.LECLERC STATION', CAT.transport],
    ['PRLV SEPA TOTALENERGIES ELECTRICITE ET GAZ', CAT.logement],
    ['CB L ORANGE BLEUE NANTES', CAT.loisirs],
    ['PRLV SEPA ORANGE SA', CAT.abonnements],
    ['CB COIFFURE MARIE', CAT.shopping],
    ['PRLV SEPA PACIFICA', CAT.logement],
    ['CB SNCF INTERNET', CAT.transport],
    ['FRAIS TENUE DE COMPTE', CAT.autres],
    ['VIR SEPA VERS LIVRET JEUNE', CAT.epargne],
    ['VIREMENT INTERNE VERS COMPTE JOINT', CAT.virements],
  ])('%s', (label, expected) => {
    expect(classify(tx(label, -2000), ctx())).toMatchObject({ categoryId: expected, source: 'rule' });
  });
});

describe('revenus', () => {
  it('un salaire versé par une enseigne reste un revenu', () => {
    expect(classify(tx('VIR SEPA CARREFOUR HYPERMARCHES PAIE OCTOBRE', 180000), ctx()).categoryId).toBe(CAT.revenus);
  });

  it('un remboursement d’une enseigne connue reste dans sa catégorie', () => {
    expect(classify(tx('AVOIR CB CARREFOUR MARKET', 1299), ctx()).categoryId).toBe(CAT.courses);
  });

  it('les intérêts du livret restent de l’épargne', () => {
    expect(classify(tx('INTERETS LIVRET A', 2310), ctx()).categoryId).toBe(CAT.epargne);
  });

  it('un virement reçu inconnu est deviné comme revenu', () => {
    expect(classify(tx('VIR INST DE M DUPONT JEAN', 5000), ctx())).toEqual({
      categoryId: CAT.revenus,
      source: 'auto',
      reason: 'virement reçu',
    });
    expect(classify(tx('REMISE CHEQUE 1234567', 15000), ctx()).categoryId).toBe(CAT.revenus);
  });

  it('un remboursement par carte d’un commerçant inconnu reste à classer', () => {
    expect(classify(tx('AVOIR CB ATELIER DE JULES', 1200), ctx())).toMatchObject({ categoryId: null, source: 'none' });
  });

  it('une dépense n’est jamais devinée comme revenu', () => {
    const memory = buildMemory([manual('VIR DE DUPONT JEAN', CAT.revenus)]);
    expect(classify(tx('VIR VERS DUPONT JEAN', -5000), ctx(memory)).categoryId).toBeNull();
  });
});

describe('mots proches', () => {
  it('reconnaît un pluriel, un mot collé ou une lettre mal lue', () => {
    expect(classify(tx('CB OPTICIENS DU PORT', -1290), ctx())).toMatchObject({ categoryId: CAT.sante, source: 'auto' });
    expect(classify(tx('GOOGLE YOUTUBEPREMIUM', -1299), ctx()).categoryId).toBe(CAT.abonnements);
    expect(classify(tx('CB CARREFOUP NANTES', -4530), ctx())).toMatchObject({ categoryId: CAT.courses, source: 'auto' });
  });

  it('préfère le mot-clé dont le libellé commence plutôt qu’un mot à une lettre près', () => {
    expect(classify(tx('RETRAITS GUICHET', -4000), ctx()).categoryId).toBe(CAT.autres);
  });
});

describe('mémoire des choix', () => {
  it('un commerçant classé une fois à la main est reconnu ensuite', () => {
    const memory = buildMemory([manual('CB ATELIER DE JULES 12/09', CAT.restaurants)]);
    expect(classify(tx('PAIEMENT PAR CARTE X1234 ATELIER DE JULES 03/10', -2300), ctx(memory))).toMatchObject({
      categoryId: CAT.restaurants,
      source: 'auto',
    });
    // Libellé proche : même commerçant suivi de la ville.
    expect(classify(tx('CB ATELIER JULES NANTES', -1800), ctx(memory))).toMatchObject({
      categoryId: CAT.restaurants,
      reason: 'ressemble à « ATELIER JULES »',
    });
  });

  it('un choix isolé ne remplace pas un mot-clé, des choix répétés si', () => {
    const once = buildMemory([manual('CB AMAZON', CAT.loisirs)]);
    expect(classify(tx('CB AMAZON EU', -2000), ctx(once)).categoryId).toBe(CAT.shopping);
    const twice = buildMemory([manual('CB AMAZON EU', CAT.loisirs), manual('CB AMAZON EU', CAT.loisirs, '2026-10-05')]);
    expect(classify(tx('CB AMAZON EU', -2000), ctx(twice)).categoryId).toBe(CAT.loisirs);
  });

  it('en cas d’égalité, le choix le plus récent l’emporte', () => {
    const memory = buildMemory([manual('VIR DUPONT JEAN', CAT.logement, '2026-09-01'), manual('VIR DUPONT JEAN', CAT.autres, '2026-10-01')]);
    expect(classify(tx('VIR VERS DUPONT JEAN', -50000), ctx(memory)).categoryId).toBe(CAT.autres);
  });

  it('les règles personnelles passent avant tout', () => {
    const memory = buildMemory([manual('CB AMAZON EU', CAT.loisirs), manual('CB AMAZON EU', CAT.loisirs)]);
    const rule = { pattern: 'AMAZON', categoryId: CAT.abonnements, source: 'user' as const };
    expect(classify(tx('CB AMAZON EU', -2000), ctx(memory, [rule])).categoryId).toBe(CAT.abonnements);
  });

  it('ignore les catégories supprimées', () => {
    const ids = ALL_IDS.filter((id) => id !== CAT.revenus);
    expect(classify(tx('VIR INST DE M DUPONT JEAN', 5000), ctx(EMPTY, [], ids)).categoryId).toBeNull();
  });
});

describe('suggestions', () => {
  it('propose des catégories selon la nature de l’opération', () => {
    expect(suggestCategories(tx('PRLV SEPA SOCIETE INCONNUE', -3000), ctx())).toEqual([
      CAT.abonnements,
      CAT.logement,
      CAT.autres,
    ]);
    expect(suggestCategories(tx('CB ATELIER DE JULES', -2000), ctx())[0]).toBe(CAT.courses);
    expect(suggestCategories(tx('VIR DE M DUPONT', 2000), ctx())[0]).toBe(CAT.revenus);
  });
});

describe('dans la base', () => {
  beforeEach(async () => {
    await deleteAllData();
  });

  async function add(rows: { date: string; amountCents: number; label: string }[]) {
    const context = await getClassifyContext();
    await commitImport({ fileName: 't.csv', accountId: 1, rows: rows.map((r) => draftTransaction(r, context)), duplicates: 0 });
    return db.transactions.orderBy('id').toArray();
  }

  it('un choix manuel s’applique aux opérations semblables, et s’annule', async () => {
    const txs = await add([
      { date: '2026-10-01', amountCents: -2300, label: 'CB ATELIER DE JULES 01/10' },
      { date: '2026-10-08', amountCents: -1900, label: 'CB ATELIER DE JULES 08/10' },
      { date: '2026-10-09', amountCents: -1500, label: 'CB CHEZ PAULETTE 09/10' },
    ]);
    expect(txs.every((t) => t.categoryId === null)).toBe(true);
    const before = txs.map(({ id, categoryId, categorySource }) => ({ id, categoryId, categorySource }));
    expect(await setTransactionCategory(txs[0].id, CAT.restaurants)).toBe(1);
    const after = await db.transactions.orderBy('id').toArray();
    expect(after.map((t) => [t.categoryId, t.categorySource])).toEqual([
      [CAT.restaurants, 'manual'],
      [CAT.restaurants, 'auto'],
      [null, 'none'],
    ]);
    await restoreCategories(before);
    expect((await db.transactions.toArray()).every((t) => t.categoryId === null)).toBe(true);
  });

  it('« à classer » choisi à la main n’est plus reclassé', async () => {
    const [t] = await add([{ date: '2026-10-01', amountCents: 5000, label: 'VIR DE M DUPONT' }]);
    expect(t.categorySource).toBe('auto');
    await setCategories([t.id], null);
    expect(await db.transactions.get(t.id)).toMatchObject({ categoryId: null, categorySource: 'manual' });
  });

  it('met à jour une ancienne base : nouveaux mots-clés, sans ressusciter ceux supprimés', async () => {
    // Base d'avant la version 2 : seulement les anciens mots-clés, dont un supprimé par l'utilisateur.
    const added = new Set(RULES_ADDED_IN_V2.map((r) => r.pattern));
    await db.rules.filter((r) => added.has(r.pattern) || r.pattern === 'CAFE').delete();
    await db.settings.clear();
    const txs = await add([
      { date: '2026-10-01', amountCents: -1290, label: 'CARTE X1234 PHIE DE LA GARE' },
      { date: '2026-10-02', amountCents: -350, label: 'CB CAFE DU PORT' },
    ]);
    expect(txs.map((t) => t.categoryId)).toEqual([null, null]);

    expect(await upgradeClassification()).toBe(1);
    expect((await db.transactions.orderBy('id').toArray()).map((t) => t.categoryId)).toEqual([CAT.sante, null]);
    expect(await db.rules.where('pattern').equals('CAFE').count()).toBe(0);
    expect(await getSetting('defaultRulesVersion', 1)).toBe(2);
    const count = await db.rules.count();
    expect(await upgradeClassification()).toBe(0);
    expect(await db.rules.count()).toBe(count);
  });

  it('les opérations classées à la main ne bougent jamais', async () => {
    const [t] = await add([{ date: '2026-10-01', amountCents: -4530, label: 'CB CARREFOUR MARKET' }]);
    await setCategories([t.id], CAT.loisirs);
    await db.settings.clear();
    await upgradeClassification();
    expect(await db.transactions.get(t.id)).toMatchObject({ categoryId: CAT.loisirs, categorySource: 'manual' } satisfies Partial<Transaction>);
  });
});
