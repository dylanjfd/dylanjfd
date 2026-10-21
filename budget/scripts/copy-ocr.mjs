// Copie le moteur OCR (Tesseract) et les données de la langue française dans public/ocr/,
// pour que la lecture des images se fasse sans aucun service externe.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr');
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz', 'fra.traineddata.gz'],
];
mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  const src = join(root, from);
  if (!existsSync(src)) throw new Error(`Fichier OCR introuvable : ${from} (lancer npm install)`);
  copyFileSync(src, join(out, to));
}
console.log(`OCR : ${files.length} fichiers copiés dans public/ocr/`);
