// Extraction du texte des relevés PDF avec pdf.js, chargé uniquement quand on importe un PDF.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&url';
import { groupLines, parsePdfStatement, textItems, type PdfLine } from './pdfStatement';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfReadError extends Error {}

/** Lignes de texte positionnées de toutes les pages du PDF. */
export async function extractPdfLines(data: Uint8Array, password?: string): Promise<PdfLine[]> {
  const doc = await pdfjs.getDocument({ data, password }).promise;
  const lines: PdfLine[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      lines.push(...groupLines(p, textItems(content.items)));
    }
  } finally {
    void doc.loadingTask.destroy();
  }
  return lines;
}

/** Opérations d'un relevé PDF ; demande le mot de passe si le fichier est protégé. */
export async function readPdfStatement(data: Uint8Array, askPassword: () => string | null) {
  let password: string | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      // pdf.js peut transférer le tampon au worker : on lui passe une copie à chaque essai.
      const lines = await extractPdfLines(data.slice(), password);
      const textLength = lines.reduce((n, l) => n + l.cells.reduce((m, c) => m + c.text.length, 0), 0);
      if (textLength < 40)
        throw new PdfReadError(
          'Ce PDF ne contient pas de texte (relevé scanné ou photo) : il ne peut pas être lu. Téléchargez le relevé depuis l’espace client de votre banque, ou exportez-le en CSV.',
        );
      return parsePdfStatement(lines);
    } catch (e) {
      if ((e as { name?: string }).name === 'PasswordException' && attempt < 3) {
        const p = askPassword();
        if (p === null) throw new PdfReadError('Ce PDF est protégé par un mot de passe.');
        password = p;
        continue;
      }
      throw e;
    }
  }
}
