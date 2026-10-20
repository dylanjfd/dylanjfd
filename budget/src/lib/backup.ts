import { db, TABLES, type TableName } from '../db/schema';
import { todayISO } from './dates';

export const BACKUP_APP = 'mon-budget';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  data: Record<TableName, unknown[]>;
}

export async function buildBackup(): Promise<string> {
  const data = {} as Record<TableName, unknown[]>;
  await db.transaction('r', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) data[t] = await db.table(t).toArray();
  });
  const file: BackupFile = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
  return JSON.stringify(file);
}

export function backupFileName(date = todayISO()): string {
  return `mon-budget-sauvegarde-${date}.json`;
}

/** Vérifie qu'un fichier est bien une sauvegarde de l'application. */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Ce fichier n’est pas un fichier JSON valide.');
  }
  const f = parsed as Partial<BackupFile>;
  if (!f || f.app !== BACKUP_APP || typeof f.version !== 'number' || typeof f.data !== 'object' || !f.data) {
    throw new Error('Ce fichier n’est pas une sauvegarde de Mon Budget.');
  }
  if (f.version > BACKUP_VERSION) {
    throw new Error('Cette sauvegarde vient d’une version plus récente de l’application.');
  }
  for (const t of TABLES) {
    const rows = (f.data as Record<string, unknown>)[t];
    if (rows !== undefined && !Array.isArray(rows)) throw new Error(`Sauvegarde invalide (table « ${t} »).`);
  }
  return f as BackupFile;
}

export function backupStats(file: BackupFile): { transactions: number; from?: string; to?: string } {
  const txs = (file.data.transactions ?? []) as { date?: string }[];
  const dates = txs.map((t) => t.date).filter((d): d is string => !!d).sort();
  return { transactions: txs.length, from: dates[0], to: dates[dates.length - 1] };
}

/** Remplace toutes les données locales par celles de la sauvegarde. */
export async function restoreBackup(file: BackupFile): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      const rows = file.data[t];
      if (rows?.length) await db.table(t).bulkAdd(rows);
    }
  });
}

/** Propose le fichier via la feuille de partage (iOS / Android), sinon le télécharge. */
export async function saveFile(content: string, fileName: string, mime = 'application/json'): Promise<'shared' | 'downloaded'> {
  const file = new File([content], fileName, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') throw e;
    }
  }
  downloadFile(file, fileName);
  return 'downloaded';
}

export function downloadFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
