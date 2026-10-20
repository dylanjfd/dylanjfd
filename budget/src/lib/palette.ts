import type { ColorKey } from '../db/schema';

// Palette catégorielle validée (daltonisme, contraste) pour les deux thèmes.
export const PALETTE: Record<ColorKey, { light: string; dark: string; label: string }> = {
  blue: { light: '#2a78d6', dark: '#3987e5', label: 'Bleu' },
  orange: { light: '#eb6834', dark: '#d95926', label: 'Orange' },
  aqua: { light: '#1baf7a', dark: '#199e70', label: 'Turquoise' },
  yellow: { light: '#eda100', dark: '#c98500', label: 'Jaune' },
  magenta: { light: '#e87ba4', dark: '#d55181', label: 'Rose' },
  green: { light: '#008300', dark: '#008300', label: 'Vert' },
  violet: { light: '#6250d6', dark: '#9085e9', label: 'Violet' },
  red: { light: '#e34948', dark: '#e66767', label: 'Rouge' },
  gray: { light: '#898781', dark: '#898781', label: 'Gris' },
};

export const COLOR_KEYS = Object.keys(PALETTE) as ColorKey[];

export function colorHex(key: ColorKey | undefined, mode: 'light' | 'dark'): string {
  return PALETTE[key ?? 'gray']?.[mode] ?? PALETTE.gray[mode];
}

/** Variable CSS de la couleur (définie pour les deux thèmes dans styles.css). */
export function colorVar(key: ColorKey | undefined): string {
  return `var(--c-${key ?? 'gray'})`;
}
