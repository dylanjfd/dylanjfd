import { parts } from './dates';

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eurRounded = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });

const MINUS = '−';

/** 123456 → « 1 234,56 € » ; `sign` ajoute « + » aux montants positifs. */
export function formatEUR(cents: number, opts: { sign?: boolean; rounded?: boolean } = {}): string {
  const abs = Math.abs(cents);
  const s = (opts.rounded ? eurRounded : eur).format(abs / 100);
  const isZero = opts.rounded ? Math.round(abs / 100) === 0 : abs === 0;
  if (isZero) return s;
  if (cents < 0) return MINUS + s;
  if (opts.sign) return '+' + s;
  return s;
}

/** Montant pour un champ de saisie : 123456 → « 1234,56 ». */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
}

export function formatPercent(ratio: number): string {
  return percent.format(ratio);
}

/** « 2026-10-14 » → « 14/10/2026 ». */
export function formatDate(iso: string): string {
  const [y, m, d] = parts(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' });

/** « 2026-10-14 » → « Mercredi 14/10/2026 ». */
export function formatDayHeading(iso: string): string {
  const [y, m, d] = parts(iso);
  return capitalize(weekday.format(new Date(Date.UTC(y, m - 1, d)))) + ' ' + formatDate(iso);
}

const monthLong = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });

/** « 2026-10 » → « Octobre 2026 ». */
export function formatMonth(ym: string): string {
  const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
  return capitalize(monthLong.format(new Date(Date.UTC(y, m - 1, 1))));
}

/** « 2026-10 » → « oct. ». */
export function formatMonthShort(ym: string): string {
  const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
  return monthShort.format(new Date(Date.UTC(y, m - 1, 1)));
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('fr-FR')} ${Math.abs(n) >= 2 ? many : one}`;
}
