// Lecture des relevés PDF : à partir du texte positionné de chaque page, on reconstitue
// les lignes et les colonnes du tableau des opérations (date, libellé, débit / crédit).
import { diffDays, isoFromParts, isValidDate, todayISO } from '../dates';
import { normalizeLabel } from '../text';
import type { ParsedRow } from './csv';
import { parseAmount, parseDate } from './parse';

export interface PdfItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfCell {
  text: string;
  x0: number;
  x1: number;
}

export interface PdfLine {
  page: number;
  y: number;
  h: number;
  cells: PdfCell[];
}

/** Morceaux de texte utiles d'une page, tels que renvoyés par pdf.js (`getTextContent().items`). */
export function textItems(items: readonly unknown[]): PdfItem[] {
  const out: PdfItem[] = [];
  for (const raw of items) {
    const it = raw as { str?: string; transform?: number[]; width?: number; height?: number };
    if (!it.str?.trim() || !it.transform) continue;
    out.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, h: it.height || Math.abs(it.transform[3]) });
  }
  return out;
}

/** Regroupe les morceaux de texte d'une page en lignes (même hauteur) puis en cellules (écart horizontal). */
export function groupLines(page: number, items: PdfItem[]): PdfLine[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; h: number; items: PdfItem[] }[] = [];
  for (const it of sorted) {
    const h = it.h || 10;
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, Math.min(h, r.h) * 0.4));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, h, items: [it] });
  }
  return rows.map((r) => {
    const items = r.items.sort((a, b) => a.x - b.x);
    const cells: PdfCell[] = [];
    for (const it of items) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - last.x1 : Infinity;
      if (last && gap < Math.max(3, r.h * 0.45)) {
        last.text += (gap > r.h * 0.12 && !last.text.endsWith(' ') ? ' ' : '') + it.str;
        last.x1 = Math.max(last.x1, it.x + it.w);
      } else {
        cells.push({ text: it.str, x0: it.x, x1: it.x + it.w });
      }
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, ' ').trim();
    return { page, y: r.y, h: r.h, cells: cells.filter((c) => c.text) };
  });
}

const DATE_START = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?=\s|$)/;
const DATE_ONLY = /^\d{1,2}[/.-]\d{1,2}(?:[/.-](?:\d{4}|\d{2}))?$/;
const AMOUNT = /^[+\-−]?\s?(?:\d{1,3}(?:[   .]\d{3})+|\d+),\d{2}(?:\s?(?:€|EUR))?(?:\s?[+\-−])?$/;
const TRAILING_AMOUNT = /^(.*?)\s+([+\-−]?\s?(?:\d{1,3}(?:[   .]\d{3})+|\d+),\d{2}(?:\s?(?:€|EUR))?(?:\s?[+\-−])?)$/;
/** Lignes de solde ou de totaux : à ignorer. */
const SKIP =
  /^(ANCIEN |NOUVEAU )?SOLDE\b|^TOTA(L|UX)\b|^SOUS TOTAL|^REPORT\b|^A REPORTER|SOLDE (PRECEDENT|CREDITEUR|DEBITEUR|AU|FINAL|INITIAL)|TOTAL DES (OPERATIONS|MOUVEMENTS)/;
/** Indices d'un crédit quand le relevé ne permet pas de situer la colonne. */
const CREDIT_HINT =
  /\b(VIR(EMENT)?( SEPA)? RECU|VIREMENT EN VOTRE FAVEUR|REMBOURSEMENT|REMB|AVOIR|SALAIRE|CAF|PENSION|RETRAITE|INTERETS|REMISE (DE )?CHEQUE|DEPOT|VERSEMENT ESPECES)\b/;

interface Columns {
  debit?: PdfCell;
  credit?: PdfCell;
  amount?: PdfCell;
  balance?: PdfCell;
  labelX0?: number;
}

function detectHeader(line: PdfLine): Columns | null {
  const norm = line.cells.map((c) => normalizeLabel(c.text));
  const find = (re: RegExp) => line.cells[norm.findIndex((n) => re.test(n))];
  const debit = find(/^DEBITS?\b|\bDEBIT\b/);
  const credit = find(/^CREDITS?\b|\bCREDIT\b/);
  const amount = find(/^MONTANT|^AMOUNT/);
  const hasDate = norm.some((n) => /\bDATE\b/.test(n));
  if (!((debit && credit) || (amount && hasDate))) return null;
  const label = find(/LIBELLE|NATURE|OPERATION|DESCRIPTION|DETAIL/);
  return { debit, credit, amount, balance: find(/^SOLDE\b/), labelX0: label?.x0 };
}

const center = (c: PdfCell) => (c.x0 + c.x1) / 2;
/** Distance d'un montant à une colonne d'en-tête (montants alignés à droite ou centrés). */
const distance = (a: PdfCell, col: PdfCell) => Math.min(Math.abs(center(a) - center(col)), Math.abs(a.x1 - col.x1));

/** Période du relevé (« du 01/09/2026 au 30/09/2026 »), sinon la plus grande date complète trouvée. */
function statementEnd(lines: PdfLine[], today: string): string {
  const text = lines.map((l) => l.cells.map((c) => c.text).join(' ')).join('\n');
  const period = /\bdu\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s+au\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i.exec(text);
  const end = period && parseDate(period[2], 'DMY');
  if (end) return end;
  const all = [...text.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{4}\b/g)]
    .map((m) => parseDate(m[0], 'DMY'))
    .filter((d): d is string => !!d && d <= today)
    .sort();
  return all[all.length - 1] ?? today;
}

/** Date d'opération ; sans année, on prend celle qui place l'opération avant la fin du relevé. */
function resolveDate(d: number, m: number, y: string | undefined, end: string): string | null {
  if (y) {
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return isValidDate(year, m, d) ? isoFromParts(year, m, d) : null;
  }
  const year = Number(end.slice(0, 4));
  if (!isValidDate(year, m, d) && !isValidDate(year - 1, m, d)) return null;
  const iso = isValidDate(year, m, d) ? isoFromParts(year, m, d) : isoFromParts(year - 1, m, d);
  return diffDays(end, iso) > 31 ? isoFromParts(year - 1, m, d) : iso;
}

interface Pending {
  date: string | null;
  label: string[];
  amount?: PdfCell;
  page: number;
  lastY: number;
  h: number;
  labelX0: number;
  cols: Columns;
  skip: boolean;
}

/** Sépare une ligne en date(s) de tête, libellé et montant(s). */
function splitLine(line: PdfLine, cols: Columns) {
  const cells = line.cells.map((c) => ({ ...c }));
  // Montants : cellules de droite (et éventuellement un montant collé à la fin du libellé).
  const amounts: PdfCell[] = [];
  while (cells.length && AMOUNT.test(cells[cells.length - 1].text) && amounts.length < 3) amounts.unshift(cells.pop()!);
  if (!amounts.length && cells.length) {
    const last = cells[cells.length - 1];
    const m = TRAILING_AMOUNT.exec(last.text);
    if (m && (!cols.labelX0 || last.x0 >= cols.labelX0 - 2)) {
      const ratio = m[1].length / last.text.length;
      const cut = last.x0 + (last.x1 - last.x0) * ratio;
      cells[cells.length - 1] = { text: m[1].trim(), x0: last.x0, x1: cut };
      amounts.push({ text: m[2], x0: cut, x1: last.x1 });
    }
  }
  // Date d'opération en tête de ligne (puis éventuelle date de valeur).
  let date: RegExpExecArray | null = null;
  if (cells.length && (!cols.labelX0 || cells[0].x0 < cols.labelX0 - 1)) {
    date = DATE_START.exec(cells[0].text);
    if (date) {
      cells[0].text = cells[0].text.slice(date[0].length).trim();
      if (!cells[0].text) cells.shift();
      const valeur = cells.length ? DATE_START.exec(cells[0].text) : null;
      if (valeur && (!cols.labelX0 || cells[0].x0 < cols.labelX0 - 1)) {
        cells[0].text = cells[0].text.slice(valeur[0].length).trim();
        if (!cells[0].text) cells.shift();
      }
    }
  }
  // Une date seule dans une colonne « Valeur » après le libellé n'en fait pas partie.
  const labelCells = cells.filter((c, i) => !(i > 0 && DATE_ONLY.test(c.text)));
  return { date, label: labelCells.map((c) => c.text).join(' ').trim(), labelX0: labelCells[0]?.x0, amounts };
}

function pickAmount(amounts: PdfCell[], cols: Columns): PdfCell | undefined {
  let list = amounts;
  if (cols.balance && list.length > 1) {
    const bal = cols.balance;
    const closest = list.reduce((a, b) => (distance(a, bal) <= distance(b, bal) ? a : b));
    list = list.filter((a) => a !== closest);
  }
  // Sans colonne de solde identifiée, le solde courant est le montant le plus à droite :
  // le montant de l'opération est le premier.
  return list[0];
}

function signedAmount(cell: PdfCell, cols: Columns, label: string): number | null {
  const value = parseAmount(cell.text.replace(/\s?(€|EUR)/, ''));
  if (value === null) return null;
  const raw = cell.text.trim();
  if (/^[-−]|[-−]$/.test(raw)) return -Math.abs(value);
  if (/^\+|\+$/.test(raw)) return Math.abs(value);
  if (cols.debit && cols.credit) return distance(cell, cols.debit) <= distance(cell, cols.credit) ? -Math.abs(value) : Math.abs(value);
  return CREDIT_HINT.test(normalizeLabel(label)) ? Math.abs(value) : -Math.abs(value);
}

/** Opérations d'un relevé PDF à partir de ses lignes de texte. */
export function parsePdfStatement(lines: PdfLine[], today = todayISO()): { items: ParsedRow[]; skipped: number } {
  const end = statementEnd(lines, today);
  const items: ParsedRow[] = [];
  let skipped = 0;
  let cols: Columns = {};
  let current: Pending | null = null;

  const finish = () => {
    const op = current;
    current = null;
    if (!op || op.skip) return;
    const label = op.label.join(' ').replace(/\s+/g, ' ').trim();
    const amount = op.amount ? signedAmount(op.amount, op.cols, label) : null;
    if (!op.date || amount === null || amount === 0) skipped++;
    else items.push({ date: op.date, amountCents: amount, label: label || 'Opération' });
  };

  for (const line of lines) {
    const header = detectHeader(line);
    if (header) {
      finish();
      cols = header;
      continue;
    }
    const { date, label, labelX0, amounts } = splitLine(line, cols);
    const skip = SKIP.test(normalizeLabel(label));
    if (date) {
      finish();
      current = {
        date: resolveDate(Number(date[1]), Number(date[2]), date[3], end),
        label: label ? [label] : [],
        amount: pickAmount(amounts, cols),
        page: line.page,
        lastY: line.y,
        h: line.h,
        labelX0: cols.labelX0 ?? labelX0 ?? line.cells[0].x0,
        cols,
        skip,
      };
      continue;
    }
    const continues =
      current &&
      !skip &&
      current.page === line.page &&
      current.lastY - line.y <= current.h * 1.8 &&
      line.cells[0].x0 >= current.labelX0 - 3;
    if (current && continues) {
      if (label) current.label.push(label);
      if (!current.amount) current.amount = pickAmount(amounts, current.cols);
      current.lastY = line.y;
    } else {
      finish();
    }
  }
  finish();
  return { items, skipped };
}
