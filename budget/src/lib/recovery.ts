// Récupération après les coupures de la base locale, fréquentes sur mobile : le système
// peut fermer la connexion IndexedDB quand l'app reste en arrière-plan (« Connection to
// Indexed Database server lost. Refresh the page to try again »).
import { db } from '../db/schema';
import { recordError } from './errorLog';

const RELOADS_KEY = 'mon-budget:auto-reloads';
const RELOAD_WINDOW = 60_000;
const MAX_RELOADS = 2;

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

/** Recharge la page, au plus deux fois par minute pour ne jamais boucler. */
export function reloadOnce(): boolean {
  try {
    const now = Date.now();
    const recent = (JSON.parse(sessionStorage.getItem(RELOADS_KEY) ?? '[]') as number[]).filter(
      (t) => now - t < RELOAD_WINDOW,
    );
    if (recent.length >= MAX_RELOADS) return false;
    sessionStorage.setItem(RELOADS_KEY, JSON.stringify([...recent, now]));
  } catch {
    // sessionStorage indisponible : on recharge quand même.
  }
  location.reload();
  return true;
}

class Timeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Timeout('Délai dépassé')), ms);
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

const ping = (ms: number) => withTimeout(db.settings.get('theme'), ms);

/**
 * Vérifie que la base répond ; si elle renvoie une erreur, la rouvre, et en dernier
 * recours recharge la page. Une base seulement lente (réveil du téléphone) est laissée
 * tranquille, sauf si `reopenIfSlow` est demandé (écran bloqué sur le chargement).
 */
export async function checkDatabase({ reopenIfSlow = false } = {}): Promise<void> {
  try {
    await ping(reopenIfSlow ? 2500 : 8000);
  } catch (e) {
    if (e instanceof Timeout && !reopenIfSlow) return;
    try {
      db.close({ disableAutoOpen: false });
      await withTimeout(db.open(), 4000);
      await ping(4000);
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
    recordError(e.reason, 'promesse non gérée');
    if (isRecoverable(e.reason)) void checkDatabase();
  });
  window.addEventListener('error', (e) => recordError(e.error ?? e.message, 'erreur globale'));
}
