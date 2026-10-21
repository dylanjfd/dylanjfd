import type { ReactNode } from 'react';

export interface DonutSegment {
  key: string | number;
  value: number;
  /** Couleur CSS (variable de catégorie). */
  color: string;
  icon?: string;
  label: string;
}

const R = 70;
const C = 2 * Math.PI * R;
const GAP = 2.5;

/**
 * Anneau : chaque segment est une part de `total` ; le reste de l'anneau (la piste) est ce qui
 * n'est pas dépensé. Icônes autour des parts assez grandes, part choisie mise en avant.
 */
export function Donut({
  segments,
  total,
  children,
  selected,
  onSelect,
  icons = true,
  thickness = 16,
  label,
}: {
  segments: DonutSegment[];
  total: number;
  children?: ReactNode;
  selected?: string | number | null;
  onSelect?: (key: string | number | null) => void;
  icons?: boolean;
  thickness?: number;
  label: string;
}) {
  const sum = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const base = Math.max(total, sum, 1);
  let start = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = s.value / base;
      const arc = { ...s, start, frac };
      start += frac;
      return arc;
    });
  const pad = icons ? 34 : 4;
  return (
    <div className="donut">
      <svg viewBox={`${-pad} ${-pad} ${200 + pad * 2} ${200 + pad * 2}`} role="img" aria-label={label}>
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        <g transform="rotate(-90 100 100)">
          {arcs.map((a) => {
            const length = Math.max(0.5, a.frac * C - (arcs.length > 1 || a.frac < 1 ? GAP : 0));
            const dim = selected != null && selected !== a.key;
            return (
              <circle
                key={a.key}
                className="donut-arc"
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={a.color}
                strokeWidth={thickness}
                strokeDasharray={`${length} ${C}`}
                strokeDashoffset={-a.start * C}
                opacity={dim ? 0.3 : 1}
                onClick={onSelect ? () => onSelect(selected === a.key ? null : a.key) : undefined}
              >
                <title>{a.label}</title>
              </circle>
            );
          })}
        </g>
        {icons &&
          arcs
            .filter((a) => a.frac >= 0.045 && a.icon)
            .map((a) => {
              const angle = (a.start + a.frac / 2) * 2 * Math.PI - Math.PI / 2;
              const x = 100 + (R + 30) * Math.cos(angle);
              const y = 100 + (R + 30) * Math.sin(angle);
              const dim = selected != null && selected !== a.key;
              return (
                <g
                  key={a.key}
                  className="donut-icon"
                  opacity={dim ? 0.35 : 1}
                  onClick={onSelect ? () => onSelect(selected === a.key ? null : a.key) : undefined}
                >
                  <circle cx={x} cy={y} r="15" fill="var(--surface)" stroke={a.color} strokeWidth="2.5" />
                  <text x={x} y={y + 0.5} textAnchor="middle" dominantBaseline="central" fontSize="15">
                    {a.icon}
                  </text>
                </g>
              );
            })}
      </svg>
      <div className="donut-center" onClick={onSelect ? () => onSelect(null) : undefined}>
        {children}
      </div>
    </div>
  );
}

/** Barre empilée des mêmes parts (résumé du démarrage). */
export function StackBar({ segments, total }: { segments: DonutSegment[]; total: number }) {
  const sum = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const base = Math.max(total, sum, 1);
  return (
    <div className="stackbar" role="img" aria-label={segments.map((s) => s.label).join(', ')}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <span key={s.key} style={{ width: `${(s.value / base) * 100}%`, background: s.color }} title={s.label} />
        ))}
    </div>
  );
}
