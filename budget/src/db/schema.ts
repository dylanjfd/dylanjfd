import Dexie, { type EntityTable } from 'dexie';
import { seedDatabase } from './seed';

export type CategoryKind = 'expense' | 'income' | 'savings' | 'transfer';
export type ColorKey =
  | 'blue'
  | 'orange'
  | 'aqua'
  | 'yellow'
  | 'magenta'
  | 'green'
  | 'violet'
  | 'red'
  | 'gray';

export type AccountKind = 'courant' | 'epargne';

export interface Account {
  id: number;
  name: string;
  kind: AccountKind;
}

export interface Category {
  id: number;
  name: string;
  icon: string;
  color: ColorKey;
  kind: CategoryKind;
  /** Plafond mensuel en centimes (dépenses uniquement). */
  budgetCents: number | null;
  order: number;
}

export interface Rule {
  id: number;
  /** Mot-clé normalisé (majuscules, sans accents), recherché en mots entiers dans le libellé. */
  pattern: string;
  categoryId: number;
  source: 'default' | 'user';
}

/**
 * Origine de la catégorie : mot-clé ou règle, choix manuel, devinée par l'app
 * (choix passés, mot proche, nature de l'opération), ou aucune (à classer).
 */
export type CategorySource = 'rule' | 'manual' | 'auto' | 'none';

export interface Transaction {
  id: number;
  accountId: number;
  date: string;
  /** Montant signé en centimes : négatif = débit. */
  amountCents: number;
  label: string;
  labelNorm: string;
  merchant: string;
  categoryId: number | null;
  categorySource: CategorySource;
  note?: string;
  batchId?: number;
  /** Identifiant unique fourni par les fichiers OFX. */
  fitId?: string;
}

export type DateFormat = 'DMY' | 'YMD' | 'MDY' | 'YYYYMMDD';

export interface CsvMapping {
  /** Index de la ligne d'en-tête, -1 si le fichier n'en a pas. */
  headerRow: number;
  dateCol: number;
  dateFormat: DateFormat;
  labelCols: number[];
  amountMode: 'single' | 'split';
  amountCol: number;
  debitCol: number;
  creditCol: number;
  /** Inverse le signe des montants (banques qui exportent les débits en positif). */
  invert: boolean;
}

export interface ImportProfile {
  id: number;
  name: string;
  /** Empreinte des en-têtes pour reconnaître le format au prochain import. */
  signature: string;
  delimiter: string;
  mapping: CsvMapping;
  accountId?: number;
  lastUsed: string;
}

export interface ImportBatch {
  id: number;
  createdAt: string;
  fileName: string;
  accountId: number;
  count: number;
  duplicates: number;
  from?: string;
  to?: string;
}

export interface RecurringPref {
  key: string;
  status: 'ignored';
}

export interface Goal {
  id: number;
  name: string;
  icon: string;
  color: ColorKey;
  targetCents: number;
  deadline: string;
  startDate: string;
  /** Montant déjà épargné à la création de l'objectif. */
  initialCents: number;
  /** Mot-clé des virements qui alimentent automatiquement l'objectif. */
  keyword?: string;
}

export interface GoalContribution {
  id: number;
  goalId: number;
  date: string;
  amountCents: number;
  note?: string;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class BudgetDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  rules!: EntityTable<Rule, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  importProfiles!: EntityTable<ImportProfile, 'id'>;
  importBatches!: EntityTable<ImportBatch, 'id'>;
  recurringPrefs!: EntityTable<RecurringPref, 'key'>;
  goals!: EntityTable<Goal, 'id'>;
  goalContributions!: EntityTable<GoalContribution, 'id'>;
  settings!: EntityTable<Setting, 'key'>;

  constructor(name = 'mon-budget') {
    super(name);
    this.version(1).stores({
      accounts: '++id',
      categories: '++id, order',
      rules: '++id, pattern, categoryId',
      transactions: '++id, date, accountId, categoryId, batchId, merchant',
      importProfiles: '++id, signature',
      importBatches: '++id, createdAt',
      recurringPrefs: 'key',
      goals: '++id',
      goalContributions: '++id, goalId',
      settings: 'key',
    });
    this.on('populate', (tx) => seedDatabase(tx));
  }
}

export const TABLES = [
  'accounts',
  'categories',
  'rules',
  'transactions',
  'importProfiles',
  'importBatches',
  'recurringPrefs',
  'goals',
  'goalContributions',
  'settings',
] as const;

export type TableName = (typeof TABLES)[number];

export const db = new BudgetDB();
