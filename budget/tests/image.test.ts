import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createWorker, type Worker } from 'tesseract.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linesFromOcr, ocrLines, parsePdfStatement, type PdfLine } from '../src/lib/import/pdfStatement';

let worker: Worker;
beforeAll(async () => {
  const langPath = fileURLToPath(new URL('../node_modules/@tesseract.js-data/fra/4.0.0_best_int', import.meta.url));
  worker = await createWorker('fra', 1, { langPath, cachePath: tmpdir(), gzip: true });
}, 60_000);
afterAll(() => worker?.terminate());

async function linesOf(...names: string[]): Promise<PdfLine[]> {
  const lines: PdfLine[] = [];
  for (const [i, name] of names.entries()) {
    const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
    const { data } = await worker.recognize(path, {}, { blocks: true });
    lines.push(...linesFromOcr(i + 1, ocrLines(data.blocks)));
  }
  return lines;
}

const simple = (items: { date: string; amountCents: number; label: string }[]) =>
  items.map((i) => [i.date, i.amountCents, i.label]);

describe('relevés en image (OCR)', () => {
  it('capture d’un relevé Crédit Agricole', async () => {
    const { items, sections } = parsePdfStatement(await linesOf('releve-capture.jpg'), '2026-10-21');
    expect(sections).toHaveLength(2);
    expect(items.map((i) => [i.date, i.amountCents])).toEqual([
      ['2026-09-02', -1599],
      ['2026-09-03', -4530],
      ['2026-09-05', 245000],
      ['2026-09-15', -20000],
      ['2026-09-15', 20000],
    ]);
    expect(items[0].label).toMatch(/^PRELEVEMENT SEPA FREE MOBILE/);
  }, 60_000);

  it('captures d’une application bancaire qui se chevauchent', async () => {
    const { items } = parsePdfStatement(await linesOf('capture-appli-1.jpg', 'capture-appli-2.jpg'), '2026-10-21');
    expect(simple(items)).toEqual([
      ['2026-10-14', -4530, 'CARREFOUR NANTES Paiement par carte'],
      ['2026-10-14', -1599, 'PRLV FREE MOBILE Prélèvement'],
      ['2026-10-13', 245000, 'VIR ACME SAS SALAIRE Virement reçu'],
      ['2026-10-13', -2390, 'UBER EATS Paiement par carte'],
      ['2026-10-11', -1240, 'PHARMACIE DE LA GARE Paiement par carte'],
      ['2026-10-11', -6000, 'RETRAIT DAB NANTES Retrait'],
    ]);
  }, 60_000);
});

describe('titres de jour', () => {
  const line = (y: number, ...cells: [string, number][]): PdfLine => ({
    page: 1,
    y,
    h: 10,
    cells: cells.map(([text, x0]) => ({ text, x0, x1: x0 + text.length * 5 })),
  });
  it('« Hier », « 3 janv. » et dates numériques, année précédente si besoin', () => {
    const { items } = parsePdfStatement(
      [
        line(900, ['Hier', 20]),
        line(880, ['CB BOULANGERIE', 20], ['-4,20 €', 300]),
        line(860, ['Samedi 28 décembre', 20]),
        line(840, ['NETFLIX', 20], ['- 15,49', 300]),
        line(820, ['03/01', 20]),
        line(800, ['VIR MAMAN', 20], ['+50,00 €', 300]),
      ],
      '2027-01-10',
    );
    expect(simple(items)).toEqual([
      ['2027-01-09', -420, 'CB BOULANGERIE'],
      ['2026-12-28', -1549, 'NETFLIX'],
      ['2027-01-03', 5000, 'VIR MAMAN'],
    ]);
  });
});
