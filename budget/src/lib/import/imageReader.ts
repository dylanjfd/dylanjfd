// Lecture des relevés en image (captures d'écran, photos) par reconnaissance de texte (OCR).
// Tesseract tourne dans le téléphone : moteur et données de langue sont servis par l'app
// (dossier ocr/), chargés au premier usage puis gardés en cache.
import { createWorker } from 'tesseract.js';
import { linesFromOcr, ocrLines, parsePdfStatement, type PdfLine } from './pdfStatement';

const MAX_SIDE = 2400;

/** Image redressée (orientation de l'appareil photo) et réduite si elle est très grande. */
async function prepare(file: File | HTMLCanvasElement): Promise<File | HTMLCanvasElement> {
  if (file instanceof HTMLCanvasElement) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  } catch {
    return file;
  }
}

/** Opérations lues dans une ou plusieurs images (dans l'ordre : captures successives). */
export async function readImageStatement(
  files: (File | HTMLCanvasElement)[],
  onProgress: (ratio: number, step: string) => void,
) {
  const base = `${import.meta.env.BASE_URL}ocr`;
  let current = 0;
  onProgress(0, 'Préparation de la lecture…');
  const worker = await createWorker('fra', 1, {
    workerPath: `${base}/worker.min.js`,
    corePath: base,
    langPath: base,
    gzip: true,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress((current + m.progress) / files.length, 'Lecture du texte…');
    },
  });
  const lines: PdfLine[] = [];
  try {
    for (const [i, file] of files.entries()) {
      current = i;
      const { data } = await worker.recognize(await prepare(file), {}, { blocks: true });
      lines.push(...linesFromOcr(i + 1, ocrLines(data.blocks)));
    }
  } finally {
    void worker.terminate();
  }
  onProgress(1, 'Analyse des opérations…');
  const textLength = lines.reduce((n, l) => n + l.cells.reduce((m, c) => m + c.text.length, 0), 0);
  return { ...parsePdfStatement(lines), textLength };
}
