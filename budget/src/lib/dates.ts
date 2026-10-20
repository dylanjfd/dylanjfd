// Dates manipulées sous forme de chaînes ISO « AAAA-MM-JJ » (sans fuseau horaire)
// et mois sous forme « AAAA-MM ».

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

export function isoFromParts(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parts(iso: string): [number, number, number] {
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function currentMonth(): string {
  return monthOf(todayISO());
}

export function daysInMonth(ym: string): number {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${pad(mm + 1)}`;
}

/** Premier et dernier jour du mois (inclus). */
export function monthBounds(ym: string): { start: string; end: string } {
  return { start: `${ym}-01`, end: `${ym}-${pad(daysInMonth(ym))}` };
}

/** Liste des mois de `from` à `to` inclus. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

function utc(iso: string): number {
  const [y, m, d] = parts(iso);
  return Date.UTC(y, m - 1, d);
}

/** Nombre de jours de `a` à `b` (positif si b est après a). */
export function diffDays(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(utc(iso) + n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Même jour (ou le dernier jour possible) dans le mois `ym`. */
export function dayInMonth(ym: string, day: number): string {
  return `${ym}-${pad(Math.min(day, daysInMonth(ym)))}`;
}

export function isValidDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(`${y}-${pad(m)}`);
}

/** Nombre de jours restants dans le mois, aujourd'hui compris (0 si le mois est passé). */
export function daysLeftInMonth(ym: string, today = todayISO()): number {
  const cur = monthOf(today);
  if (ym < cur) return 0;
  if (ym > cur) return daysInMonth(ym);
  return daysInMonth(ym) - parts(today)[2] + 1;
}
