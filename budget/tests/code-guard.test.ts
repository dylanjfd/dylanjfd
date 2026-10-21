import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('garde-fous du code', () => {
  it('aucun effet React ne renvoie de valeur implicitement', () => {
    // `useEffect(() => fn())` renvoie le résultat de fn() : si c'est une promesse (comme
    // window.scrollTo() sur Chrome récent), React l'appelle comme fonction de nettoyage
    // et plante (« l is not a function »). Les effets doivent avoir un corps entre accolades.
    const offenders = sources(new URL('../src', import.meta.url).pathname).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /use(Layout)?Effect\(\(\) => [^{]/.test(line))
        .map(({ i }) => `${file}:${i + 1}`),
    );
    expect(offenders).toEqual([]);
  });
});
