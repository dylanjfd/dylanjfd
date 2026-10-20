import type { Rule } from '../db/schema';

/** Le mot-clé apparaît-il en mots entiers dans le libellé normalisé ? */
export function matchesPattern(labelNorm: string, pattern: string): boolean {
  if (!pattern) return false;
  return (' ' + labelNorm + ' ').includes(' ' + pattern + ' ');
}

/** Règles personnelles d'abord, puis les mots-clés les plus longs (les plus précis). */
export function sortRules<T extends Pick<Rule, 'pattern' | 'source'>>(rules: T[]): T[] {
  return [...rules].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'user' ? -1 : 1;
    return b.pattern.length - a.pattern.length;
  });
}

/** Catégorie proposée pour un libellé, ou null. `rules` doit être trié avec `sortRules`. */
export function categorize(labelNorm: string, sortedRules: Pick<Rule, 'pattern' | 'categoryId'>[]): number | null {
  for (const r of sortedRules) if (matchesPattern(labelNorm, r.pattern)) return r.categoryId;
  return null;
}
