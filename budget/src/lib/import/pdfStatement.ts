// Lecture des relevés PDF : à partir du texte positionné de chaque page, on reconstitue
// les lignes et les colonnes du tableau des opérations (date, libellé, débit / crédit).
import { addDays, diffDays, isoFromParts, isValidDate, todayISO } from '../dates';
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
  return rows.map((r) => ({ page, y: r.y, h: r.h, cells: buildCells(r.items, r.h) }));
}

/** Regroupe les morceaux d'une même ligne en cellules, d'après l'écart horizontal. */
function buildCells(lineItems: PdfItem[], h: number): PdfCell[] {
  const cells: PdfCell[] = [];
  for (const it of [...lineItems].sort((a, b) => a.x - b.x)) {
    const last = cells[cells.length - 1];
    const gap = last ? it.x - last.x1 : Infinity;
    if (last && gap < Math.max(3, h * 0.45)) {
      last.text += (gap > h * 0.12 && !last.text.endsWith(' ') ? ' ' : '') + it.str;
      last.x1 = Math.max(last.x1, it.x + it.w);
    } else {
      cells.push({ text: it.str, x0: it.x, x1: it.x + it.w });
    }
  }
  for (const c of cells) c.text = c.text.replace(/\s+/g, ' ').trim();
  return cells.filter((c) => c.text);
}

export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Corrige les confusions de l'OCR dans les nombres (O → 0, l → 1, 45.30 → 45,30, E → €). */
function fixOcrWord(text: string): string {
  let t = text.replace(/[—–]/g, '-');
  if (/\d/.test(t) && /^[+\-−]?[\dOoIl|.,/:]+(?:€|E)?$/.test(t)) {
    t = t.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/E$/, '€');
    // « 45.30 » est un montant mal lu, mais « 02.09 » est une date (format du Crédit Agricole).
    const dot = /^[+\-−]?(\d+)\.(\d{2})€?$/.exec(t);
    if (dot && (Number(dot[1]) > 31 || Number(dot[2]) > 12 || /^[+\-−]|€$/.test(t))) t = t.replace('.', ',');
  }
  return t;
}

/** Lignes de mots d'un résultat Tesseract (`data.blocks`). */
export function ocrLines(blocks: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[] | null | undefined) {
  return (blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
}

/** Lignes d'une image à partir des lignes reconnues par l'OCR (Tesseract). */
export function linesFromOcr(page: number, ocrLines: { words: OcrWord[] }[]): PdfLine[] {
  const out: PdfLine[] = [];
  for (const l of ocrLines) {
    const words = l.words.filter((w) => w.text.trim());
    if (!words.length) continue;
    const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
    const h = heights[Math.floor(heights.length / 2)] || 10;
    const y0 = Math.min(...words.map((w) => w.bbox.y0));
    const y1 = Math.max(...words.map((w) => w.bbox.y1));
    const items = words.map((w) => ({ str: fixOcrWord(w.text.trim()), x: w.bbox.x0, y: 0, w: w.bbox.x1 - w.bbox.x0, h }));
    // L'axe vertical des images descend : on l'inverse pour suivre le sens des PDF.
    out.push({ page, y: -(y0 + y1) / 2, h, cells: buildCells(items, h) });
  }
  return out;
}

const IS_AMOUNT_PART = /^\d{3}(?:[ \u00a0\u202f.]\d{3})*,\d{2}/;

/** Remet d'aplomb les cellules : montants coupés (« 1 » « 234,56 », « - » « 12,50 »), « € » isolé, parasite après un montant. */
function tidyCells(line: PdfLine): PdfLine {
  const cells: PdfCell[] = [];
  for (const c of line.cells) {
    if (/^(€|EUR|[¤¨þ])$/i.test(c.text)) continue;
    const prev = cells[cells.length - 1];
    const gap = prev ? c.x0 - prev.x1 : Infinity;
    const joinable = gap < Math.max(4, line.h * 1.5);
    if (prev && joinable && /^[+\-−]$/.test(prev.text) && /^\d/.test(c.text)) {
      cells[cells.length - 1] = { text: prev.text + c.text, x0: prev.x0, x1: c.x1 };
    } else if (prev && joinable && /^[+\-−]?\d{1,3}$/.test(prev.text) && IS_AMOUNT_PART.test(c.text)) {
      cells[cells.length - 1] = { text: `${prev.text} ${c.text}`, x0: prev.x0, x1: c.x1 };
    } else {
      cells.push({ ...c });
    }
  }
  const last = cells[cells.length - 1];
  if (cells.length >= 2 && last.text.length <= 2 && AMOUNT.test(cells[cells.length - 2].text)) cells.pop();
  return { ...line, cells };
}

const DATE_START = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?=\s|$)/;
const DATE_ONLY = /^\d{1,2}[/.-]\d{1,2}(?:[/.-](?:\d{4}|\d{2}))?$/;
// Le symbole monétaire est parfois mal encodé dans les PDF (« ¤ », « ¨ », « þ ») : on le tolère.
const AMOUNT = /^[+\-−]?\s?(?:\d{1,3}(?:[   .]\d{3})+|\d+),\d{2}(?:\s?(?:€|EUR|[¤¨þ*]))?(?:\s?[+\-−])?$/;
const TRAILING_AMOUNT = /^(.*?)\s+([+\-−]?\s?(?:\d{1,3}(?:[   .]\d{3})+|\d+),\d{2}(?:\s?(?:€|EUR|[¤¨þ*]))?(?:\s?[+\-−])?)$/;
/** Titre d'une section de compte (« Compte de Dépôt n° 12345678901 en euros », « Livret A n° … »). */
const SECTION = /^(COMPTE|CPTE|LIVRET|LDD|LDDS|LEP|PEL|CEL|PLAN|CCHQ|CCP|EPARGNE)\b.*\bN\s?\d{5,}/;
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

const MONTHS = ['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE'];

/** Dates complètes du texte : « 30/09/2026 », « 30.09.2026 » ou « 30 septembre 2026 ». */
function fullDates(text: string): string[] {
  const numeric = [...text.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{4}\b/g)].map((m) => parseDate(m[0], 'DMY'));
  const words = [...normalizeLabel(text).matchAll(/\b(\d{1,2})(?: ?ER)? ([A-Z]+) (\d{4})\b/g)].map((m) => {
    const month = MONTHS.indexOf(m[2]) + 1;
    const [y, d] = [Number(m[3]), Number(m[1])];
    return month > 0 && isValidDate(y, month, d) ? isoFromParts(y, month, d) : null;
  });
  return [...numeric, ...words].filter((d): d is string => !!d);
}

/** Fin de la période du relevé (« du … au 30/09/2026 »), sinon la plus grande date complète trouvée. */
function statementEnd(lines: PdfLine[], today: string): string {
  const text = lines.map((l) => l.cells.map((c) => c.text).join(' ')).join('\n');
  const period = /\bdu\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s+au\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i.exec(text);
  const end = period && parseDate(period[2], 'DMY');
  if (end) return end;
  const all = fullDates(text)
    .filter((d) => diffDays(today, d) <= 31)
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

const WEEKDAYS = 'LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI|SAMEDI|DIMANCHE';
const MONTH_WORDS: Record<string, number> = {
  JANVIER: 1, JANV: 1, JAN: 1, FEVRIER: 2, FEVR: 2, FEV: 2, MARS: 3, MAR: 3, AVRIL: 4, AVR: 4, MAI: 5, JUIN: 6,
  JUILLET: 7, JUIL: 7, AOUT: 8, SEPTEMBRE: 9, SEPT: 9, SEP: 9, OCTOBRE: 10, OCT: 10, NOVEMBRE: 11, NOV: 11,
  DECEMBRE: 12, DEC: 12,
};

/** Ligne qui n'est qu'une date (titre de jour dans une capture d'application bancaire). */
function headingDate(label: string, end: string, today: string): string | null {
  const n = normalizeLabel(label);
  if (n === 'AUJOURD HUI') return today;
  if (n === 'HIER') return addDays(today, -1);
  const m = new RegExp(`^(?:(?:${WEEKDAYS}) )?(\\d{1,2})(?: ?ER)? ([A-Z]+)(?: (\\d{4}))?$`).exec(n);
  if (m && MONTH_WORDS[m[2]]) return resolveDate(Number(m[1]), MONTH_WORDS[m[2]], m[3], end);
  const d = new RegExp(`^(?:(?:${WEEKDAYS}) )?(\\d{1,2}) (\\d{1,2})(?: (\\d{4}|\\d{2}))?$`).exec(n);
  if (d && /[/.-]/.test(label)) return resolveDate(Number(d[1]), Number(d[2]), d[3], end);
  return null;
}

interface Pending {
  section?: string;
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
  const value = parseAmount(cell.text.replace(/\s?(€|EUR|[¤¨þ*])/, ''));
  if (value === null) return null;
  const raw = cell.text.trim();
  if (/^[-−]|[-−]$/.test(raw)) return -Math.abs(value);
  if (/^\+|\+$/.test(raw)) return Math.abs(value);
  if (cols.debit && cols.credit) return distance(cell, cols.debit) <= distance(cell, cols.credit) ? -Math.abs(value) : Math.abs(value);
  return CREDIT_HINT.test(normalizeLabel(label)) ? Math.abs(value) : -Math.abs(value);
}

/** Opérations d'un relevé PDF à partir de ses lignes de texte. */
export function parsePdfStatement(
  rawLines: PdfLine[],
  today = todayISO(),
): { items: ParsedRow[]; skipped: number; sections: string[] } {
  const lines = rawLines.map(tidyCells).filter((l) => l.cells.length);
  const end = statementEnd(lines, today);
  const items: ParsedRow[] = [];
  const pages: number[] = [];
  let skipped = 0;
  let cols: Columns = {};
  let section: string | undefined;
  let dayHeading: string | null = null;
  let current: Pending | null = null;

  const finish = () => {
    const op = current;
    current = null;
    if (!op || op.skip) return;
    const label = op.label.join(' ').replace(/\s+/g, ' ').trim();
    const amount = op.amount ? signedAmount(op.amount, op.cols, label) : null;
    if (!op.date || amount === null || amount === 0) skipped++;
    else {
      items.push({ date: op.date, amountCents: amount, label: label || 'Opération', ...(op.section ? { section: op.section } : {}) });
      pages.push(op.page);
    }
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
    if (!date && !amounts.length && SECTION.test(normalizeLabel(label))) {
      finish();
      section = label.replace(/\s+en euros?$/i, '').trim();
      continue;
    }
    const heading = amounts.length
      ? null
      : date
        ? label
          ? null
          : resolveDate(Number(date[1]), Number(date[2]), date[3], end)
        : headingDate(label, end, today);
    if (heading) {
      finish();
      dayHeading = heading;
      continue;
    }
    if (date) {
      finish();
      current = {
        section,
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
    if (current && continues && !(current.amount && amounts.length && dayHeading)) {
      if (label) current.label.push(label);
      if (!current.amount) current.amount = pickAmount(amounts, current.cols);
      current.lastY = line.y;
    } else if (dayHeading && amounts.length && label && !skip) {
      // Capture d'application : opération sous un titre de jour, sans date sur la ligne.
      finish();
      current = {
        section,
        date: dayHeading,
        label: [label],
        amount: pickAmount(amounts, cols),
        page: line.page,
        lastY: line.y,
        h: line.h,
        labelX0: labelX0 ?? line.cells[0].x0,
        cols,
        skip: false,
      };
    } else {
      finish();
    }
  }
  finish();
  dropPageOverlaps(items, pages);
  const sections = [...new Set(items.map((i) => i.section).filter((s): s is string => !!s))];
  return { items, skipped, sections };
}

/**
 * Captures d'écran successives qui se chevauchent : une opération déjà lue sur la page
 * précédente (même date, montant et libellé) n'est pas comptée deux fois.
 */
function dropPageOverlaps(items: ParsedRow[], pages: number[]): void {
  const key = (i: ParsedRow) => `${i.date}|${i.amountCents}|${normalizeLabel(i.label)}`;
  const used = new Set<number>();
  const drop = new Set<number>();
  items.forEach((item, i) => {
    if (pages[i] <= 1) return;
    // Chaque opération de la page précédente ne peut « absorber » qu'une seule répétition.
    const twin = items.findIndex((o, j) => pages[j] === pages[i] - 1 && !used.has(j) && key(o) === key(item));
    if (twin >= 0) {
      used.add(twin);
      drop.add(i);
    }
  });
  for (let i = items.length - 1; i >= 0; i--) if (drop.has(i)) items.splice(i, 1);
}
