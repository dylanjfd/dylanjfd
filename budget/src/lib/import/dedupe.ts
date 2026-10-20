import { diffDays } from '../dates';
import { labelSimilarity } from '../text';

export type DuplicateStatus = 'new' | 'duplicate' | 'probable';

export interface DedupeCandidate {
  date: string;
  amountCents: number;
  labelNorm: string;
  merchant: string;
  fitId?: string;
}

export interface DedupeExisting extends DedupeCandidate {
  id: number;
}

const keyOf = (t: DedupeCandidate) => `${t.date}|${t.amountCents}|${t.labelNorm}`;

/**
 * Compare les opérations du fichier à celles déjà enregistrées sur le même compte.
 * - doublon : même identifiant OFX, ou même date + montant + libellé. Les occurrences sont
 *   comptées : deux cafés identiques le même jour restent deux opérations distinctes.
 * - doublon probable : même montant à 3 jours près avec un libellé proche
 *   (la banque change parfois la date ou le libellé d'un export à l'autre).
 */
export function detectDuplicates(candidates: DedupeCandidate[], existing: DedupeExisting[]): DuplicateStatus[] {
  const fitIds = new Set(existing.filter((e) => e.fitId).map((e) => e.fitId!));
  const pool = new Map<string, DedupeExisting[]>();
  for (const e of existing) {
    const k = keyOf(e);
    const list = pool.get(k);
    if (list) list.push(e);
    else pool.set(k, [e]);
  }
  const consumed = new Set<number>();
  const status: DuplicateStatus[] = candidates.map((c) => {
    if (c.fitId && fitIds.has(c.fitId)) return 'duplicate';
    const list = pool.get(keyOf(c));
    // Deux identifiants OFX différents désignent deux opérations différentes.
    const idx = list?.findIndex((e) => !consumed.has(e.id) && !(c.fitId && e.fitId && c.fitId !== e.fitId)) ?? -1;
    if (list && idx >= 0) {
      consumed.add(list[idx].id);
      return 'duplicate';
    }
    return 'new';
  });

  candidates.forEach((c, i) => {
    if (status[i] !== 'new') return;
    const match = existing.find(
      (e) =>
        !consumed.has(e.id) &&
        e.amountCents === c.amountCents &&
        Math.abs(diffDays(e.date, c.date)) <= 3 &&
        !(c.fitId && e.fitId) &&
        (e.merchant === c.merchant || labelSimilarity(e.labelNorm, c.labelNorm) >= 0.5),
    );
    if (match) {
      consumed.add(match.id);
      status[i] = 'probable';
    }
  });
  return status;
}
