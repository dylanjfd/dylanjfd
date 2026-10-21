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
  | { kind: 'ofx'; fileName: string; encoding: Encoding; items: ParsedRow[]; skipped: number }
  | { kind: 'pdf'; fileName: string; items: ParsedRow[]; skipped: number };

export class ImportError extends Error {}

function sniffBinary(bytes: Uint8Array): string | null {
  const head = Array.from(bytes.slice(0, 4));
  if (head[0] === 0x50 && head[1] === 0x4b) return 'Ce fichier est un classeur Excel (.xlsx). Exportez plutôt votre relevé au format CSV ou OFX depuis l’espace client de votre banque.';
  if (head[0] === 0xd0 && head[1] === 0xcf) return 'Ce fichier est un classeur Excel (.xls). Exportez plutôt votre relevé au format CSV ou OFX.';
  return null;
}

const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-');

async function readPdf(file: File, bytes: Uint8Array): Promise<Source> {
  // pdf.js (plus d'1 Mo) n'est chargé que pour les relevés PDF.
  const { readPdfStatement, PdfReadError } = await import('../../lib/import/pdfReader');
  try {
    const { items, skipped } = await readPdfStatement(bytes, () =>
      prompt('Ce PDF est protégé. Saisissez son mot de passe (il n’est pas enregistré) :'),
    );
    if (items.length === 0)
      throw new ImportError(
        'Aucune opération reconnue dans ce PDF. Vérifiez qu’il s’agit bien d’un relevé de compte, ou exportez-le en CSV depuis votre banque.',
      );
    return { kind: 'pdf', fileName: file.name, items, skipped };
  } catch (e) {
    if (e instanceof ImportError) throw e;
    if (e instanceof PdfReadError) throw new ImportError(e.message);
    console.error(e);
    throw new ImportError('Ce PDF n’a pas pu être lu (fichier abîmé ou format non pris en charge).');
  }
}

export async function readStatement(file: File): Promise<Source> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPdf(bytes)) return readPdf(file, bytes);
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

/** Inverse le sens (débit ↔ crédit) d'opérations lues dans un PDF ambigu. */
export function invertItems(items: ParsedRow[]): ParsedRow[] {
  return items.map((i) => ({ ...i, amountCents: -i.amountCents }));
}

export function defaultProfileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\d{4,}/g, '').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Ma banque';
}

export function mappingIsUsable(m: CsvMapping): boolean {
  if (m.dateCol < 0 || m.labelCols.length === 0) return false;
  return m.amountMode === 'single' ? m.amountCol >= 0 : m.debitCol >= 0 && m.creditCol >= 0 && m.debitCol !== m.creditCol;
}
