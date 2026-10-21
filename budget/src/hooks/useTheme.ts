import { useEffect, useState } from 'react';
import { useSetting } from './useData';

export type ThemeSetting = 'auto' | 'light' | 'dark';

const BG = { light: '#f2efe9', dark: '#10120f' };

function systemDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Applique le thème choisi et renvoie le mode effectif (utile pour les graphiques). */
export function useThemeMode(): 'light' | 'dark' {
  const setting = useSetting<ThemeSetting>('theme', 'auto');
  const [sysDark, setSysDark] = useState(systemDark);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSysDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const mode = setting === 'auto' ? (sysDark ? 'dark' : 'light') : setting;

  useEffect(() => {
    const root = document.documentElement;
    if (setting === 'auto') delete root.dataset.theme;
    else root.dataset.theme = setting;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      const media = m.getAttribute('data-media') ?? m.getAttribute('media');
      if (!m.getAttribute('data-media') && media) m.setAttribute('data-media', media);
      if (setting === 'auto') {
        m.setAttribute('media', m.getAttribute('data-media') ?? '');
        m.setAttribute('content', media?.includes('dark') ? BG.dark : BG.light);
      } else {
        m.removeAttribute('media');
        m.setAttribute('content', BG[setting]);
      }
    });
  }, [setting]);

  return mode;
}
