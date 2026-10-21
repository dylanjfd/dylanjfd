import Papa from 'papaparse';
import type { CsvMapping } from '../../db/schema';
import { normalizeLabel } from '../text';
import { detectDateFormat, looksLikeDate, parseAmount, parseDate } from './parse';

export interface CsvAnalysis {
  delimiter: string;
  rows: string[][];
  /** Index de la ligne d'en-tête détectée, -1 si aucune. */
  headerRow: number;
  /** Index de la première ligne d'opération. */
  dataStart: number;
  columnCount: number;
  signature: string;
  guess: CsvMapping;
}

export interface ParsedRow {
  date: string;
  amountCents: number;
  label: string;
  fitId?: string;
  /** Compte d'origine quand un relevé PDF en regroupe plusieurs. */
  section?: string;
}

const DELIMITERS = [';', ',', '\t', '|'];

export function parseCsvRows(text: string, delimiter: string): string[][] {
  const res = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
  return res.data.map((r) => r.map((c) => (c ?? '').replace(/\s+/g, ' ').trim()));
}

/** Séparateur qui donne le plus de lignes au même nombre de colonnes (pondéré par ce nombre). */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 80).join('\n');
  let best = ';';
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const rows = parseCsvRows(sample, d).filter((r) => r.length >= 2);
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    for (const [cols, n] of counts) {
      const score = n * cols;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
  }
  return best;
}

function nonEmpty(row: string[] | undefined): boolean {
  return !!row && row.some((c) => c !== '');
}

/** Une ligne d'opération contient une date et au moins un montant dans une autre cellule. */
function isDataRow(row: string[] | undefined): boolean {
  if (!row || row.length < 2) return false;
  const dateIdx = row.findIndex((c) => looksLikeDate(c));
  if (dateIdx < 0) return false;
  return row.some((c, i) => i !== dateIdx && c !== '' && !looksLikeDate(c) && parseAmount(c) !== null);
}

export function analyzeCsv(text: string): CsvAnalysis | null {
  const delimiter = detectDelimiter(text);
  const rows = parseCsvRows(text, delimiter);

  let dataStart = -1;
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    if (isDataRow(rows[i]) && (i + 1 >= rows.length || !nonEmpty(rows[i + 1]) || isDataRow(rows[i + 1]))) {
      dataStart = i;
      break;
    }
  }
  if (dataStart < 0) return null;

  let headerRow = -1;
  for (let i = dataStart - 1; i >= 0; i--) {
    if (!nonEmpty(rows[i])) continue;
    const cells = rows[i].filter((c) => c !== '');
    if (cells.length >= 2 && !rows[i].some((c) => looksLikeDate(c))) headerRow = i;
    break;
  }

  const columnCount = Math.max(...rows.slice(dataStart, dataStart + 50).map((r) => r.length));
  const guess = guessMapping(rows, headerRow, dataStart, columnCount);
  return { delimiter, rows, headerRow, dataStart, columnCount, signature: signatureOf(rows, headerRow, delimiter, columnCount), guess };
}

export function signatureOf(rows: string[][], headerRow: number, delimiter: string, columnCount: number): string {
  const head = headerRow >= 0 ? rows[headerRow].map(normalizeLabel).join('|') : 'sans-en-tete';
  return `${delimiter}|${columnCount}|${head}`;
}

export function columnNames(rows: string[][], headerRow: number, columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, i) => {
    const h = headerRow >= 0 ? rows[headerRow]?.[i] : '';
    return h ? h : `Colonne ${i + 1}`;
  });
}

function guessMapping(rows: string[][], headerRow: number, dataStart: number, columnCount: number): CsvMapping {
  const header = headerRow >= 0 ? rows[headerRow].map(normalizeLabel) : [];
  const data = rows.slice(dataStart, dataStart + 150).filter(nonEmpty);
  const values = (c: number) => data.map((r) => r[c] ?? '').filter((v) => v !== '');
  const ratio = (c: number, test: (v: string) => boolean) => {
    const v = values(c);
    return v.length === 0 ? 0 : v.filter(test).length / v.length;
  };
  const cols = Array.from({ length: columnCount }, (_, i) => i);
  const h = (c: number) => header[c] ?? '';
  const isDateCol = (c: number) => ratio(c, looksLikeDate) >= 0.8;
  const isAmountCol = (c: number) =>
    values(c).length > 0 && ratio(c, (v) => !looksLikeDate(v) && parseAmount(v) !== null) >= 0.8;
  const excluded = (c: number) => /SOLDE|BALANCE|FRANCS|FEE|FRAIS/.test(h(c));

  // Date : de préférence la date d'opération plutôt que la date de valeur.
  const dateCols = cols.filter(isDateCol);
  const dateCol =
    dateCols.find((c) => /DATE/.test(h(c)) && /OP|COMPTA/.test(h(c))) ??
    dateCols.find((c) => /DATE/.test(h(c)) && !/VALEUR|VAL\b/.test(h(c))) ??
    dateCols[0] ??
    0;
  const dateFormat = detectDateFormat(values(dateCol)) ?? 'DMY';

  // Montant : colonnes Débit / Crédit séparées, ou une seule colonne.
  const debitCol = cols.find((c) => /DEBIT/.test(h(c)) && !excluded(c));
  const creditCol = cols.find((c) => /CREDIT/.test(h(c)) && !excluded(c));
  const split = debitCol !== undefined && creditCol !== undefined && debitCol !== creditCol;

  const amountCandidates = cols.filter((c) => c !== dateCol && isAmountCol(c) && !excluded(c));
  const amountCol =
    amountCandidates.find((c) => /MONTANT|AMOUNT|SOMME/.test(h(c)) && /EUR/.test(h(c))) ??
    amountCandidates.find((c) => /MONTANT|AMOUNT|SOMME/.test(h(c))) ??
    [...amountCandidates].sort(
      (a, b) => ratio(b, (v) => /[.,]\d{1,2}$/.test(v)) - ratio(a, (v) => /[.,]\d{1,2}$/.test(v)),
    )[0] ??
    (dateCol === 0 ? 1 : 0);

  // Libellé : colonnes nommées comme telles, sinon la colonne de texte la plus longue.
  const used = new Set([dateCol, ...(split ? [debitCol!, creditCol!] : [amountCol])]);
  let labelCols = cols.filter(
    (c) =>
      !used.has(c) &&
      !isDateCol(c) &&
      /\b(LIBELLE|DESCRIPTION|INTITULE|DETAIL|LABEL|NATURE|OPERATION|BENEFICIAIRE|TIERS)\b/.test(h(c)) &&
      !/DATE|TYPE|CATEG|COMPTE|ACCOUNT/.test(h(c)),
  );
  if (labelCols.length === 0) {
    const avgLen = (c: number) => {
      const v = values(c);
      return v.length ? v.reduce((s, x) => s + x.length, 0) / v.length : 0;
    };
    const textCols = cols.filter((c) => !used.has(c) && !isDateCol(c) && !isAmountCol(c));
    const best = textCols.sort((a, b) => avgLen(b) - avgLen(a))[0];
    labelCols = best !== undefined ? [best] : [];
  }

  return {
    headerRow,
    dateCol,
    dateFormat,
    labelCols: labelCols.slice(0, 2),
    amountMode: split ? 'split' : 'single',
    amountCol,
    debitCol: debitCol ?? -1,
    creditCol: creditCol ?? -1,
    invert: false,
  };
}

function joinLabel(cells: string[]): string {
  const parts = cells.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // Supprime une cellule déjà contenue dans une autre (libellé court + libellé détaillé).
  const kept = parts.filter(
    (p, i) => !parts.some((q, j) => j !== i && q.length > p.length && q.toUpperCase().includes(p.toUpperCase())),
  );
  return [...new Set(kept)].join(' ');
}

/** Applique la correspondance des colonnes : lignes valides + nombre de lignes ignorées. */
export function applyMapping(rows: string[][], mapping: CsvMapping): { items: ParsedRow[]; skipped: number } {
  const items: ParsedRow[] = [];
  let skipped = 0;
  for (let i = mapping.headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!nonEmpty(row)) continue;
    const date = parseDate(row[mapping.dateCol], mapping.dateFormat);
    let amount: number | null;
    if (mapping.amountMode === 'split') {
      const debit = parseAmount(row[mapping.debitCol]);
      const credit = parseAmount(row[mapping.creditCol]);
      amount = debit === null && credit === null ? null : Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    } else {
      amount = parseAmount(row[mapping.amountCol]);
    }
    if (!date || amount === null || amount === 0) {
      skipped++;
      continue;
    }
    if (mapping.invert) amount = -amount;
    const label = joinLabel(mapping.labelCols.map((c) => row[c] ?? ''));
    items.push({ date, amountCents: amount, label: label || 'Opération' });
  }
  return { items, skipped };
}
