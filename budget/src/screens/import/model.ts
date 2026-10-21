import { db, type CsvMapping, type Transaction } from '../../db/schema';
import { draftTransaction, getClassifyContext } from '../../lib/actions';
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
  /** Compte d'origine dans un relevé PDF qui en regroupe plusieurs. */
  section?: string;
}

export type Source =
  | { kind: 'csv'; fileName: string; encoding: Encoding; analysis: CsvAnalysis }
  | { kind: 'ofx'; fileName: string; encoding: Encoding; items: ParsedRow[]; skipped: number }
  | { kind: 'pdf'; fileName: string; items: ParsedRow[]; skipped: number; sections: string[] }
  | { kind: 'image'; fileName: string; items: ParsedRow[]; skipped: number; sections: string[] };

export class ImportError extends Error {}

function sniffBinary(bytes: Uint8Array): string | null {
  const head = Array.from(bytes.slice(0, 4));
  if (head[0] === 0x50 && head[1] === 0x4b) return 'Ce fichier est un classeur Excel (.xlsx). Exportez plutôt votre relevé au format CSV ou OFX depuis l’espace client de votre banque.';
  if (head[0] === 0xd0 && head[1] === 0xcf) return 'Ce fichier est un classeur Excel (.xls). Exportez plutôt votre relevé au format CSV ou OFX.';
  return null;
}

/** Format d'image reconnu d'après les premiers octets du fichier. */
function imageKind(bytes: Uint8Array): 'jpg' | 'png' | 'webp' | 'heic' | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  const ascii = new TextDecoder('latin1').decode(b.slice(0, 16));
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp';
  if (/ftyp(heic|heix|mif1|msf1)/.test(ascii)) return 'heic';
  return null;
}

async function readImages(files: File[], onProgress: (text: string) => void): Promise<Source> {
  for (const f of files) {
    const kind = imageKind(new Uint8Array(await f.slice(0, 16).arrayBuffer()));
    if (kind === 'heic')
      throw new ImportError('Les photos HEIC ne sont pas lues : faites plutôt une capture d’écran, ou choisissez le format JPG.');
    if (!kind) throw new ImportError(`« ${f.name} » n’est pas une image JPG ou PNG.`);
  }
  // Le moteur de reconnaissance de texte n'est chargé que pour les images.
  const { readImageStatement } = await import('../../lib/import/imageReader');
  const { items, skipped, sections, textLength } = await readImageStatement(files, (ratio, step) =>
    onProgress(`${step} ${Math.round(ratio * 100)} %`),
  );
  if (textLength < 20) throw new ImportError('Aucun texte lisible dans cette image : essayez une capture plus nette.');
  if (items.length === 0)
    throw new ImportError(
      'Aucune opération reconnue. Prenez une capture nette de la liste des opérations (dates, libellés et montants visibles), ou importez le relevé PDF ou CSV.',
    );
  return { kind: 'image', fileName: files.length > 1 ? `${files.length} images` : files[0].name, items, skipped, sections };
}

/** Un fichier de relevé, ou plusieurs images (captures d'écran successives). */
export async function readStatements(files: File[], onProgress: (text: string) => void): Promise<Source> {
  const heads = await Promise.all(files.map(async (f) => imageKind(new Uint8Array(await f.slice(0, 16).arrayBuffer()))));
  if (heads.every((k) => k)) return readImages(files, onProgress);
  if (files.length > 1)
    throw new ImportError('Plusieurs fichiers à la fois : seules les images (captures d’écran) peuvent être importées ensemble.');
  return readStatement(files[0], onProgress);
}

const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-');

async function readPdf(file: File, bytes: Uint8Array, onProgress: (text: string) => void): Promise<Source> {
  // pdf.js (plus d'1 Mo) n'est chargé que pour les relevés PDF.
  const { readPdfStatement, renderPdfPages, PdfReadError, PdfNoTextError } = await import('../../lib/import/pdfReader');
  let password: string | undefined;
  let scanned = false;
  const ask = () => {
    const p = prompt('Ce PDF est protégé. Saisissez son mot de passe (il n’est pas enregistré) :');
    if (p !== null) password = p;
    return p;
  };
  try {
    const { items, skipped, sections } = await readPdfStatement(bytes, ask).catch(async (e) => {
      if (!(e instanceof PdfNoTextError)) throw e;
      // Relevé scanné : les pages sont lues comme des images.
      scanned = true;
      onProgress('Relevé scanné : préparation des pages…');
      const pages = await renderPdfPages(bytes, password);
      const { readImageStatement } = await import('../../lib/import/imageReader');
      const result = await readImageStatement(pages, (ratio, step) => onProgress(`${step} ${Math.round(ratio * 100)} %`));
      if (result.textLength < 20) throw new ImportError('Ce PDF scanné ne contient pas de texte lisible.');
      return result;
    });
    if (items.length === 0)
      throw new ImportError(
        'Aucune opération reconnue dans ce PDF. Vérifiez qu’il s’agit bien d’un relevé de compte, ou exportez-le en CSV depuis votre banque.',
      );
    return { kind: scanned ? 'image' : 'pdf', fileName: file.name, items, skipped, sections };
  } catch (e) {
    if (e instanceof ImportError) throw e;
    if (e instanceof PdfReadError) throw new ImportError(e.message);
    console.error(e);
    throw new ImportError('Ce PDF n’a pas pu être lu (fichier abîmé ou format non pris en charge).');
  }
}

export async function readStatement(file: File, onProgress: (text: string) => void = () => {}): Promise<Source> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPdf(bytes)) return readPdf(file, bytes, onProgress);
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
  const ctx = await getClassifyContext();
  const drafts = items.map((i) => draftTransaction(i, ctx));
  const dates = drafts.map((d) => d.date).sort();
  const existing = await db.transactions
    .where('date')
    .between(addDays(dates[0], -3), addDays(dates[dates.length - 1], 3), true, true)
    .filter((t) => t.accountId === accountId)
    .toArray();
  const statuses = detectDuplicates(drafts, existing);
  return drafts
    .map((d, i) => ({
      ...d,
      key: i,
      status: statuses[i],
      selected: statuses[i] === 'new',
      ...(items[i].section ? { section: items[i].section } : {}),
    }))
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
