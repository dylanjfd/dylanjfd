import type { ParsedRow } from './csv';
import { parseAmount, parseDate } from './parse';

export function isOfx(text: string): boolean {
  const head = text.slice(0, 2000).toUpperCase();
  return head.includes('OFXHEADER') || head.includes('<OFX>');
}

/** Lit les champs « <TAG>valeur » d'un bloc OFX (SGML 1.x ou XML 2.x). */
function fields(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<([A-Z0-9.]+)>([^<\r\n]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const value = m[2].trim();
    if (value && !(m[1].toUpperCase() in out)) out[m[1].toUpperCase()] = decodeEntities(value);
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Opérations d'un fichier OFX / QFX. */
export function parseOfx(text: string): { items: ParsedRow[]; skipped: number; accountRef?: string } {
  const items: ParsedRow[] = [];
  let skipped = 0;
  const chunks = text.split(/<STMTTRN>/i).slice(1);
  for (const chunk of chunks) {
    const block = chunk.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0];
    const f = fields(block);
    const date = parseDate(f.DTPOSTED ?? f.DTUSER, 'YYYYMMDD');
    const amount = parseAmount(f.TRNAMT);
    if (!date || amount === null || amount === 0) {
      skipped++;
      continue;
    }
    const name = f.NAME ?? f.PAYEE ?? '';
    const memo = f.MEMO ?? '';
    let label = name;
    if (memo && !name.toUpperCase().includes(memo.toUpperCase())) {
      label = memo.toUpperCase().includes(name.toUpperCase()) ? memo : `${name} ${memo}`.trim();
    }
    items.push({ date, amountCents: amount, label: label || 'Opération', fitId: f.FITID });
  }
  const acct = /<ACCTID>([^<\r\n]+)/i.exec(text);
  return { items, skipped, accountRef: acct?.[1].trim() };
}
