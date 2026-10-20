// Lecture des valeurs brutes des relevés : encodage, montants, dates.
import type { DateFormat } from '../../db/schema';
import { isoFromParts, isValidDate } from '../dates';

export type Encoding = 'utf-8' | 'windows-1252';

// Caractères Windows-1252 de la plage 0x80–0x9F (le reste coïncide avec ISO-8859-1).
const CP1252_EXTRA: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰',
  0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•',
  0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function decodeWindows1252(bytes: Uint8Array): string {
  const chars = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    chars[i] = CP1252_EXTRA[b] ?? String.fromCharCode(b);
  }
  return chars.join('');
}

/** Décode en UTF-8, ou en Windows-1252 (sur-ensemble d'ISO-8859-1) si le fichier n'est pas de l'UTF-8 valide. */
export function decodeText(buffer: ArrayBuffer | Uint8Array): { text: string; encoding: Encoding } {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let text: string;
  let encoding: Encoding;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    encoding = 'utf-8';
  } catch {
    text = decodeWindows1252(bytes);
    encoding = 'windows-1252';
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, encoding };
}

/**
 * Montant texte → centimes. Gère « -1 234,56 », « 1.234,56 € », « 1,234.56 », « +12,5 »,
 * « 12,50- », « (12,50) ». Renvoie null si la valeur n'est pas un montant.
 */
export function parseAmount(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s  ']/g, '').replace(/€|EUR$/i, '');
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart: string;
  let decPart = '';
  if (lastComma >= 0 && lastDot >= 0) {
    const sep = lastComma > lastDot ? ',' : '.';
    const idx = Math.max(lastComma, lastDot);
    intPart = s.slice(0, idx).replace(/[.,]/g, '');
    decPart = s.slice(idx + 1);
    if (decPart.includes(sep)) return null;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const pieces = s.split(sep);
    const tail = pieces[pieces.length - 1];
    // Un seul séparateur suivi de 3 chiffres (« 1.234 ») ou plusieurs (« 1.234.567 ») : séparateur de milliers.
    if (pieces.length > 2 || (tail.length === 3 && pieces[0].length > 0 && pieces[0] !== '0')) {
      if (!pieces.slice(1).every((p) => p.length === 3)) return null;
      intPart = pieces.join('');
    } else {
      intPart = pieces[0];
      decPart = tail;
    }
  } else {
    intPart = s;
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart)) return null;
  if (decPart.length > 2) {
    // Arrondi au centime pour les rares exports à 3 décimales.
    const v = Math.round(Number(`${intPart || '0'}.${decPart}`) * 100);
    return negative ? -v : v;
  }
  const cents = Number(intPart || '0') * 100 + Number(decPart.padEnd(2, '0') || '0');
  return negative ? -cents : cents;
}

const DATE_PATTERNS: Record<DateFormat, RegExp> = {
  DMY: /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[ T].*)?$/,
  MDY: /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[ T].*)?$/,
  YMD: /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[ T].*)?$/,
  YYYYMMDD: /^(\d{4})(\d{2})(\d{2})(?:\d{6}(?:\.\d+)?)?(?:\[.*\])?$/,
};

function fullYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

/** Date texte → « AAAA-MM-JJ » selon le format donné, ou null. */
export function parseDate(raw: string | undefined | null, format: DateFormat): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = DATE_PATTERNS[format].exec(s);
  if (!m) return null;
  let y: number, mo: number, d: number;
  switch (format) {
    case 'DMY':
      [d, mo, y] = [Number(m[1]), Number(m[2]), fullYear(m[3])];
      break;
    case 'MDY':
      [mo, d, y] = [Number(m[1]), Number(m[2]), fullYear(m[3])];
      break;
    default:
      [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return isValidDate(y, mo, d) ? isoFromParts(y, mo, d) : null;
}

export const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: 'DMY', label: 'JJ/MM/AAAA' },
  { value: 'YMD', label: 'AAAA-MM-JJ' },
  { value: 'YYYYMMDD', label: 'AAAAMMJJ' },
  { value: 'MDY', label: 'MM/JJ/AAAA (anglais)' },
];

/** Format de date reconnaissant le plus de valeurs (JJ/MM prioritaire sur MM/JJ). */
export function detectDateFormat(values: string[]): DateFormat | null {
  const sample = values.filter((v) => v && v.trim()).slice(0, 200);
  if (sample.length === 0) return null;
  let best: DateFormat | null = null;
  let bestScore = 0;
  for (const f of ['DMY', 'YMD', 'YYYYMMDD', 'MDY'] as DateFormat[]) {
    const score = sample.filter((v) => parseDate(v, f) !== null).length;
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return bestScore / sample.length >= 0.6 ? best : null;
}

/** La valeur ressemble-t-elle à une date (n'importe quel format) ? */
export function looksLikeDate(v: string): boolean {
  return (['DMY', 'YMD', 'YYYYMMDD'] as DateFormat[]).some((f) => parseDate(v, f) !== null);
}
