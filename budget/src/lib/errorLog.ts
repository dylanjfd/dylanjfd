// Journal local des incidents corrigés automatiquement, pour pouvoir en trouver la cause.

const KEY = 'mon-budget:errors';
const MAX = 10;

export interface ErrorEntry {
  at: string;
  /** Fichier principal de l'app (son nom contient l'empreinte de la version publiée). */
  build: string;
  message: string;
  stack?: string;
  where?: string;
}

const BUILD = (() => {
  try {
    return new URL(import.meta.url).pathname.split('/').pop() ?? '';
  } catch {
    return '';
  }
})();

export function readErrors(): ErrorEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as ErrorEntry[];
  } catch {
    return [];
  }
}

export function recordError(err: unknown, where?: string): void {
  try {
    const e = err as { name?: string; message?: string; stack?: string } | null;
    const entry: ErrorEntry = {
      at: new Date().toISOString(),
      build: `${__APP_VERSION__} ${BUILD}`,
      message: e?.message ? `${e.name ?? 'Error'}: ${e.message}` : String(err),
      stack: e?.stack?.slice(0, 2000),
      where: where?.trim().slice(0, 600),
    };
    localStorage.setItem(KEY, JSON.stringify([entry, ...readErrors()].slice(0, MAX)));
  } catch {
    // Stockage indisponible : on n'enregistre rien.
  }
}

export function clearErrors(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function errorReport(): string {
  return JSON.stringify({ app: 'mon-budget', userAgent: navigator.userAgent, errors: readErrors() }, null, 2);
}
