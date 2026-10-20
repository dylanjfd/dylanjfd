// Nettoyage des libellés bancaires.

/** Majuscules, sans accents ni ponctuation : « Prlv SEPA Free Mobile » → « PRLV SEPA FREE MOBILE ». */
export function normalizeLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

// Mots qui décrivent le type d'opération ou du bruit, jamais le commerçant.
const NOISE = new Set(
  (
    'CB CARTE CARTES PAIEMENT PAIEMT PAR PRLV PRELEVEMENT PRELEV PRLVT SEPA EUROPEEN EUR EUROS ' +
    'VIR VIREMENT VIRT VRT RECU RECUS EMIS INST INSTANTANE PERMANENT FAVEUR VOTRE VOTRES FACTURE FACT ACHAT ' +
    'DU DE DES LE LA LES AU AUX EN ET POUR SUR CHEZ ' +
    'REF REFERENCE ID MDT RUM ECH ECHEANCE EMETTEUR MOTIF LIBELLE NUM NO REMBOURSEMENT REMB AVOIR ' +
    'TPE WEB WWW COM FR SAS SARL SA SCA SNC CIE ' +
    'JANVIER FEVRIER MARS AVRIL MAI JUIN JUILLET AOUT SEPTEMBRE OCTOBRE NOVEMBRE DECEMBRE ' +
    'JANV FEV FEVR AVR JUIL SEPT OCT NOV DEC'
  ).split(' '),
);

/**
 * Extrait le « commerçant » d'un libellé : sert à regrouper les opérations
 * (statistiques, dépenses récurrentes, suggestions de règles).
 * « CB CARREFOUR MARKET 12/10 CARTE X1234 » → « CARREFOUR MARKET ».
 */
export function merchantOf(label: string): string {
  const tokens = normalizeLabel(label).split(' ').filter(Boolean);
  const kept = tokens.filter((t) => t.length >= 2 && !/\d/.test(t) && !NOISE.has(t));
  if (kept.length > 0) return kept.slice(0, 3).join(' ');
  return tokens.slice(0, 3).join(' ');
}

/** « CARREFOUR MARKET » → « Carrefour Market ». */
export function prettyMerchant(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/** Similarité entre deux libellés normalisés (indice de Jaccard sur les mots sans chiffres). */
export function labelSimilarity(a: string, b: string): number {
  const words = (s: string) => new Set(s.split(' ').filter((t) => t.length >= 2 && !/\d/.test(t)));
  const A = words(a);
  const B = words(b);
  if (A.size === 0 && B.size === 0) return a === b ? 1 : 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
