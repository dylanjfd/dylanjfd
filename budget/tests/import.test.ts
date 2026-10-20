import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeCsv, applyMapping, columnNames } from '../src/lib/import/csv';
import { isOfx, parseOfx } from '../src/lib/import/ofx';
import { decodeText, detectDateFormat, parseAmount, parseDate } from '../src/lib/import/parse';
import { detectDuplicates } from '../src/lib/import/dedupe';
import { merchantOf, normalizeLabel } from '../src/lib/text';

const fixture = (name: string) => decodeText(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

function importCsv(name: string) {
  const { text, encoding } = fixture(name);
  const analysis = analyzeCsv(text);
  expect(analysis).not.toBeNull();
  const result = applyMapping(analysis!.rows, analysis!.guess);
  return { encoding, analysis: analysis!, ...result };
}

describe('parseAmount', () => {
  it.each([
    ['-1 234,56', -123456],
    ['1 234,56 €', 123456],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['-12.5', -1250],
    ['+12,50', 1250],
    ['12,50-', -1250],
    ['(12,50)', -1250],
    ['2450', 245000],
    ['1.234', 123400],
    ['0,05', 5],
    ['−3,20', -320],
  ])('%s → %i', (raw, cents) => {
    expect(parseAmount(raw)).toBe(cents);
  });

  it.each(['', 'abc', '14/10/2026', '12:30', 'EUR', '1,2,3'])('rejette « %s »', (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });
});

describe('dates', () => {
  it('lit les formats courants', () => {
    expect(parseDate('14/10/2026', 'DMY')).toBe('2026-10-14');
    expect(parseDate('4/1/26', 'DMY')).toBe('2026-01-04');
    expect(parseDate('14.10.2026', 'DMY')).toBe('2026-10-14');
    expect(parseDate('2026-10-14 10:22:01', 'YMD')).toBe('2026-10-14');
    expect(parseDate('20261014120000[+1:CET]', 'YYYYMMDD')).toBe('2026-10-14');
    expect(parseDate('31/02/2026', 'DMY')).toBeNull();
  });

  it('préfère JJ/MM à MM/JJ', () => {
    expect(detectDateFormat(['01/02/2026', '03/04/2026'])).toBe('DMY');
    expect(detectDateFormat(['10/25/2026', '12/31/2026'])).toBe('MDY');
  });
});

describe('encodage', () => {
  it('détecte ISO-8859-1 / Windows-1252', () => {
    const { text, encoding } = fixture('credit-agricole.csv');
    expect(encoding).toBe('windows-1252');
    expect(text).toContain('Téléchargement');
    expect(text).toContain('€');
  });

  it('garde l’UTF-8', () => {
    expect(fixture('boursorama.csv').encoding).toBe('utf-8');
  });
});

describe('import CSV par banque', () => {
  it('Société Générale : lignes d’en-tête avant le tableau, deux colonnes de libellé', () => {
    const { analysis, items } = importCsv('societe-generale.csv');
    expect(analysis.delimiter).toBe(';');
    expect(analysis.headerRow).toBe(2);
    expect(columnNames(analysis.rows, analysis.headerRow, analysis.columnCount)[3]).toBe("Montant de l'opération");
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({
      date: '2026-10-14',
      amountCents: -4530,
      label: 'CARTE X1234 13/10 CARREFOUR MARKET PARIS',
    });
    expect(items[3].amountCents).toBe(245000);
  });

  it('Crédit Agricole : colonnes Débit / Crédit et libellés sur plusieurs lignes', () => {
    const { analysis, items } = importCsv('credit-agricole.csv');
    expect(analysis.guess.amountMode).toBe('split');
    expect(items.map((i) => i.amountCents)).toEqual([-3215, 24500, -1349]);
    expect(items[0].label).toBe('PAIEMENT PAR CARTE LIDL 1234 13/10');
    expect(items[2].date).toBe('2026-10-10');
  });

  it('Boursorama : dates ISO, colonne amount, solde ignoré', () => {
    const { analysis, items } = importCsv('boursorama.csv');
    expect(analysis.guess.dateFormat).toBe('YMD');
    expect(items.map((i) => i.amountCents)).toEqual([-2390, 245000, -1214]);
    expect(items[0].label).toBe('CARTE 13/10/26 UBER *EATS CB*1234');
  });

  it('La Banque Postale : préambule clé/valeur, montant en euros (pas en francs)', () => {
    const { analysis, items } = importCsv('banque-postale.csv');
    expect(analysis.headerRow).toBe(7);
    expect(items.map((i) => i.amountCents)).toEqual([-5420, -6800]);
  });

  it('LCL : fichier sans en-tête, ligne de solde ignorée', () => {
    const { analysis, items, skipped } = importCsv('lcl.csv');
    expect(analysis.headerRow).toBe(-1);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ amountCents: -1250, label: 'CB MONOPRIX 13/10/26' });
    expect(skipped).toBe(1);
  });

  it('Revolut : virgule, point décimal, dates avec heure', () => {
    const { analysis, items } = importCsv('revolut.csv');
    expect(analysis.delimiter).toBe(',');
    expect(items.map((i) => [i.date, i.amountCents])).toEqual([
      ['2026-10-14', -1214],
      ['2026-10-01', 20000],
      ['2026-09-28', -123450],
    ]);
  });

  it('reconnaît un format déjà vu grâce à sa signature', () => {
    const a = importCsv('societe-generale.csv').analysis;
    const b = analyzeCsv(fixture('societe-generale.csv').text.replace('0123456789012', '999'))!;
    expect(b.signature).toBe(a.signature);
    expect(importCsv('lcl.csv').analysis.signature).not.toBe(a.signature);
  });
});

describe('import OFX', () => {
  it('OFX 1.x (SGML)', () => {
    const { text } = fixture('releve-sgml.ofx');
    expect(isOfx(text)).toBe(true);
    const { items, accountRef } = parseOfx(text);
    expect(accountRef).toBe('00012345678');
    expect(items).toEqual([
      { date: '2026-10-14', amountCents: -4530, label: 'CB CARREFOUR MARKET 13/10 PARIS', fitId: '2026101400001' },
      { date: '2026-10-01', amountCents: 245000, label: 'VIR ACME SAS SALAIRE OCTOBRE', fitId: '2026100100002' },
      { date: '2026-10-05', amountCents: -1250, label: 'Boulangerie Médicis & Fils', fitId: '2026100500003' },
    ]);
  });

  it('OFX 2.x (XML)', () => {
    const { text } = fixture('releve-xml.ofx');
    const { items } = parseOfx(text);
    expect(items).toEqual([
      { date: '2026-10-14', amountCents: -4530, label: 'CB CARREFOUR 13/10', fitId: 'A1' },
      { date: '2026-10-13', amountCents: -1599, label: 'PRLV FREE MOBILE', fitId: 'A2' },
    ]);
  });
});

describe('libellés', () => {
  it.each([
    ['CB CARREFOUR MARKET 12/10 CARTE X1234', 'CARREFOUR MARKET'],
    ['PRLV SEPA FREE MOBILE ECH/151026 ID EMETTEUR/FR12ZZZ123456', 'FREE MOBILE'],
    ['CARTE 13/10/26 UBER   *EATS CB*1234', 'UBER EATS'],
    ['VIR SEPA RECU /DE ACME SAS /MOTIF SALAIRE OCTOBRE', 'ACME SALAIRE'],
    ['PRLV SEPA NETFLIX.COM', 'NETFLIX'],
    ['Prélèvement Électricité', 'ELECTRICITE'],
  ])('%s → %s', (label, merchant) => {
    expect(merchantOf(label)).toBe(merchant);
  });

  it('normalise accents et ponctuation', () => {
    expect(normalizeLabel("Boulangerie Médicis & Fils")).toBe('BOULANGERIE MEDICIS FILS');
  });
});

describe('doublons', () => {
  const tx = (id: number, date: string, amountCents: number, label: string, fitId?: string) => ({
    id,
    date,
    amountCents,
    labelNorm: normalizeLabel(label),
    merchant: merchantOf(label),
    fitId,
  });

  it('ignore les opérations déjà importées et garde les nouvelles', () => {
    const existing = [tx(1, '2026-10-01', -500, 'CB CAFE DE LA GARE'), tx(2, '2026-10-02', -1000, 'CB LIDL')];
    const file = [
      tx(0, '2026-10-01', -500, 'CB CAFE DE LA GARE'),
      tx(0, '2026-10-01', -500, 'CB CAFE DE LA GARE'),
      tx(0, '2026-10-02', -1000, 'CB LIDL'),
      tx(0, '2026-10-03', -2000, 'CB FNAC'),
    ];
    // Deux cafés identiques le même jour : un seul était déjà enregistré.
    expect(detectDuplicates(file, existing)).toEqual(['duplicate', 'new', 'duplicate', 'new']);
  });

  it('signale un doublon probable quand la date ou le libellé a un peu changé', () => {
    const existing = [tx(1, '2026-10-01', -4530, 'CB CARREFOUR MARKET 30/09')];
    const file = [tx(0, '2026-10-02', -4530, 'CARTE X1234 CARREFOUR MARKET')];
    expect(detectDuplicates(file, existing)).toEqual(['probable']);
  });

  it('se fie aux identifiants OFX', () => {
    const existing = [tx(1, '2026-10-01', -500, 'CB CAFE', 'F1')];
    const file = [tx(0, '2026-10-01', -500, 'CB CAFE', 'F1'), tx(0, '2026-10-01', -500, 'CB CAFE', 'F2')];
    expect(detectDuplicates(file, existing)).toEqual(['duplicate', 'new']);
  });
});
