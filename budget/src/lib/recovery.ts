// Récupération après les coupures de la base locale, fréquentes sur iPhone : iOS ferme
// la connexion IndexedDB quand l'app reste en arrière-plan (« Connection to Indexed
// Database server lost. Refresh the page to try again »).
import { db } from '../db/schema';

const RELOAD_KEY = 'mon-budget:last-auto-reload';
const MIN_RELOAD_INTERVAL = 20_000;

/** Erreurs passagères qu'un rechargement répare (base coupée, fichier de l'app introuvable…). */
export function isRecoverable(err: unknown): boolean {
  const e = err as { name?: string; message?: string; inner?: unknown } | null | undefined;
  if (!e || typeof e !== 'object') return false;
  const text = `${e.name ?? ''} ${e.message ?? ''}`;
  if (
    /DatabaseClosed|UnknownError|InvalidStateError|TransactionInactive|Indexed Database server lost|dynamically imported module|Importing a module script failed|Load failed/i.test(
      text,
    )
  )
    return true;
  return e.inner ? isRecoverable(e.inner) : false;
}

/** Recharge la page, au plus une fois toutes les 20 secondes pour ne jamais boucler. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < MIN_RELOAD_INTERVAL) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage indisponible : on recharge quand même.
  }
  location.reload();
  return true;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Délai dépassé')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const ping = () => withTimeout(db.settings.get('theme'), 2500);

/** Vérifie que la base répond ; sinon la rouvre, et en dernier recours recharge la page. */
export async function checkDatabase(): Promise<void> {
  try {
    await ping();
  } catch {
    try {
      db.close({ disableAutoOpen: false });
      await withTimeout(db.open(), 2500);
      await ping();
    } catch {
      reloadOnce();
    }
  }
}

export function installRecovery(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkDatabase();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) void checkDatabase();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isRecoverable(e.reason)) void checkDatabase();
  });
}
