import { db, type CsvMapping, type Transaction } from '../../db/schema';
import { draftTransaction, getSortedRules } from '../../lib/actions';
import { addDays } from '../../lib/dates';
import { analyzeCsv, type CsvAnalysis, type ParsedRow } from '../../lib/import/csv';
import { detectDuplicates, type DuplicateStatus } from '../../lib/import/dedupe';
import { isOfx, parseOfx } from '../../lib/import/ofx';
import { decodeText, type Encoding } from '../../lib/import/parse';

export type Draft = Omit<Transaction, 'id' | 'accountId'>;

export interface PreviewRow extends Draft {
  key: number;
  status: DuplicateStatus;
  selected: boolean;
}

export type Source =
  | { kind: 'csv'; fileName: string; encoding: Encoding; analysis: CsvAnalysis }
  | { kind: 'ofx'; fileName: string; encoding: Encoding; items: ParsedRow[]; skipped: number };

export class ImportError extends Error {}

function sniffBinary(bytes: Uint8Array): string | null {
  const head = Array.from(bytes.slice(0, 4));
  if (head[0] === 0x50 && head[1] === 0x4b) return 'Ce fichier est un classeur Excel (.xlsx). Exportez plutôt votre relevé au format CSV ou OFX depuis l’espace client de votre banque.';
  if (head[0] === 0xd0 && head[1] === 0xcf) return 'Ce fichier est un classeur Excel (.xls). Exportez plutôt votre relevé au format CSV ou OFX.';
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)
    return 'Les relevés PDF ne peuvent pas être lus. Exportez votre relevé au format CSV ou OFX depuis l’espace client de votre banque.';
  return null;
}

export async function readStatement(file: File): Promise<Source> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const binary = sniffBinary(bytes);
  if (binary) throw new ImportError(binary);
  const { text, encoding } = decodeText(bytes);
  if (isOfx(text)) {
    const { items, skipped } = parseOfx(text);
    if (items.length === 0) throw new ImportError('Aucune opération trouvée dans ce fichier OFX.');
    return { kind: 'ofx', fileName: file.name, encoding, items, skipped };
  }
  const analysis = analyzeCsv(text);
  if (!analysis)
    throw new ImportError(
      'Impossible de trouver des opérations dans ce fichier. Il doit contenir au moins une colonne de dates et une colonne de montants.',
    );
  return { kind: 'csv', fileName: file.name, encoding, analysis };
}

export async function findProfile(signature: string) {
  return db.importProfiles.where('signature').equals(signature).first();
}

/** Catégorise les lignes et repère les doublons avec les opérations déjà enregistrées sur le compte. */
export async function buildPreview(items: ParsedRow[], accountId: number): Promise<PreviewRow[]> {
  if (items.length === 0) return [];
  const rules = await getSortedRules();
  const drafts = items.map((i) => draftTransaction(i, rules));
  const dates = drafts.map((d) => d.date).sort();
  const existing = await db.transactions
    .where('date')
    .between(addDays(dates[0], -3), addDays(dates[dates.length - 1], 3), true, true)
    .filter((t) => t.accountId === accountId)
    .toArray();
  const statuses = detectDuplicates(drafts, existing);
  return drafts
    .map((d, i) => ({ ...d, key: i, status: statuses[i], selected: statuses[i] === 'new' }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.key - b.key);
}

export function defaultProfileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\d{4,}/g, '').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Ma banque';
}

export function mappingIsUsable(m: CsvMapping): boolean {
  if (m.dateCol < 0 || m.labelCols.length === 0) return false;
  return m.amountMode === 'single' ? m.amountCol >= 0 : m.debitCol >= 0 && m.creditCol >= 0 && m.debitCol !== m.creditCol;
}
