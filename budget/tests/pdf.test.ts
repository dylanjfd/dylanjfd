import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { groupLines, parsePdfStatement, textItems, type PdfLine } from '../src/lib/import/pdfStatement';

async function linesOf(name: string): Promise<PdfLine[]> {
  const data = new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
  const doc = await pdfjs.getDocument({ data }).promise;
  const lines: PdfLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    lines.push(...groupLines(p, textItems(content.items)));
  }
  await doc.loadingTask.destroy();
  return lines;
}

const simple = (items: { date: string; amountCents: number; label: string }[]) =>
  items.map((i) => [i.date, i.amountCents, i.label]);

describe('relevés PDF', () => {
  it('relevé classique : colonnes Débit / Crédit, libellés sur plusieurs lignes, 2 pages, soldes ignorés', async () => {
    const { items, skipped } = parsePdfStatement(await linesOf('releve-classique.pdf'), '2026-10-21');
    expect(simple(items)).toEqual([
      ['2026-09-02', -78000, 'PRLV SEPA SCI DUPONT LOYER SEPTEMBRE'],
      ['2026-09-03', -4530, 'CARTE X1234 02/09 CARREFOUR MARKET PARIS'],
      ['2026-09-05', 245000, 'VIR SEPA RECU DE: ACME SAS MOTIF: SALAIRE SEPTEMBRE'],
      ['2026-09-12', -1599, 'PRLV SEPA FREE MOBILE'],
      ['2026-09-20', -6000, 'RETRAIT DAB 19/09 PARIS 15'],
      ['2026-09-28', 1750, 'REMBOURSEMENT CPAM'],
      ['2026-09-29', -1190, 'CARTE X1234 28/09 UGC CINE CITE'],
    ]);
    expect(skipped).toBe(0);
  });

  it('dates sans année sur deux années, colonne Valeur après le libellé', async () => {
    const { items } = parsePdfStatement(await linesOf('releve-dates-courtes.pdf'), '2027-01-20');
    expect(simple(items)).toEqual([
      ['2026-12-16', -123456, 'CB AMAZON PAYMENTS 15/12'],
      ['2026-12-24', 10000, 'VIR MAMIE CADEAU NOEL'],
      ['2027-01-02', -1549, 'PRLV NETFLIX.COM'],
      ['2027-01-05', -78000, 'PRLV SCI DUPONT LOYER'],
    ]);
  });

  it('une seule colonne de montants signés', async () => {
    const { items } = parsePdfStatement(await linesOf('releve-montant-signe.pdf'), '2026-10-21');
    expect(simple(items)).toEqual([
      ['2026-10-14', -2390, 'Uber Eats'],
      ['2026-10-12', 245000, 'Virement de ACME SAS — Salaire'],
      ['2026-10-11', -1214, 'Spotify'],
    ]);
  });

  it('un relevé scanné ne contient pas de texte', async () => {
    const lines = await linesOf('releve-scanne.pdf');
    expect(lines.reduce((n, l) => n + l.cells.length, 0)).toBe(0);
  });

  it('texte découpé caractère par caractère et montant collé au libellé', () => {
    const chars = (s: string, x: number, y: number) =>
      [...s].map((c, i) => ({ str: c, x: x + i * 5, y, w: 4.6, h: 9 }));
    const lines = groupLines(1, [
      ...chars('Date', 30, 700), ...chars('Libellé', 90, 700), ...chars('Débit', 400, 700), ...chars('Crédit', 470, 700),
      ...chars('03/09', 30, 680), ...chars('CB LIDL', 90, 680), ...chars('12,40', 400, 680),
      ...chars('04/09', 30, 666), ...chars('VIR RECU MAMAN', 90, 666), ...chars('50,00', 475, 666),
    ]);
    const { items } = parsePdfStatement(lines, '2026-09-30');
    expect(simple(items)).toEqual([
      ['2026-09-03', -1240, 'CB LIDL'],
      ['2026-09-04', 5000, 'VIR RECU MAMAN'],
    ]);
  });

  it('sans en-tête reconnu : le sens vient du signe ou du libellé', () => {
    const lines: PdfLine[] = [
      { page: 1, y: 700, h: 9, cells: [{ text: '01/10/2026 VIREMENT EN VOTRE FAVEUR ACME', x0: 30, x1: 300 }, { text: '2 450,00', x0: 420, x1: 470 }] },
      { page: 1, y: 686, h: 9, cells: [{ text: '02/10/2026 CB BOULANGERIE', x0: 30, x1: 200 }, { text: '4,20', x0: 440, x1: 470 }] },
      { page: 1, y: 672, h: 9, cells: [{ text: '03/10/2026', x0: 30, x1: 80 }, { text: 'AVOIR DECATHLON', x0: 90, x1: 200 }, { text: '-19,99', x0: 430, x1: 470 }] },
    ];
    expect(simple(parsePdfStatement(lines, '2026-10-21').items)).toEqual([
      ['2026-10-01', 245000, 'VIREMENT EN VOTRE FAVEUR ACME'],
      ['2026-10-02', -420, 'CB BOULANGERIE'],
      ['2026-10-03', -1999, 'AVOIR DECATHLON'],
    ]);
  });
});
