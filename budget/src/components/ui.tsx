import { ChevronLeft, ChevronRight, CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Category } from '../db/schema';
import type { BudgetStatus } from '../lib/budget';
import { addMonths } from '../lib/dates';
import { formatEUR, formatMonth, formatPercent } from '../lib/format';
import { colorVar } from '../lib/palette';

export function Header({
  title,
  back,
  actions,
  compact,
}: {
  title: string;
  back?: string | boolean;
  actions?: ReactNode;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <header className={`header${compact || back ? ' compact' : ''}`}>
      {back && (
        <button
          className="icon-btn"
          aria-label="Retour"
          onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
        >
          <ChevronLeft size={26} />
        </button>
      )}
      <h1>{title}</h1>
      {actions ?? (back ? <span style={{ width: 44 }} /> : null)}
    </header>
  );
}

export function Amount({
  cents,
  sign = true,
  className = '',
  rounded,
}: {
  cents: number;
  sign?: boolean;
  className?: string;
  rounded?: boolean;
}) {
  return (
    <span className={`amount${cents > 0 && sign ? ' positive' : ''} ${className}`}>
      {formatEUR(cents, { sign, rounded })}
    </span>
  );
}

export const UNCATEGORIZED = { icon: '❓', name: 'À classer', color: 'gray' as const };

export function catStyle(category: Pick<Category, 'color'> | undefined): CSSProperties {
  return { '--cat': colorVar(category?.color) } as CSSProperties;
}

export function CatIcon({ category, size }: { category?: Pick<Category, 'icon' | 'color'>; size?: 'sm' | 'lg' }) {
  const c = category ?? UNCATEGORIZED;
  return (
    <span className={`cat-icon${size ? ' ' + size : ''}`} style={catStyle(c)} aria-hidden="true">
      {c.icon}
    </span>
  );
}

export function CatChip({ category, onClick }: { category?: Pick<Category, 'icon' | 'color' | 'name'>; onClick?: () => void }) {
  const c = category ?? UNCATEGORIZED;
  const content = (
    <>
      <span aria-hidden="true">{c.icon}</span>
      <span>{c.name}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="cat-chip" style={catStyle(c)} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className="cat-chip" style={catStyle(c)}>
      {content}
    </span>
  );
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (ym: string) => void }) {
  return (
    <div className="month-picker">
      <button className="icon-btn" aria-label="Mois précédent" onClick={() => onChange(addMonths(value, -1))}>
        <ChevronLeft />
      </button>
      <strong aria-live="polite">{formatMonth(value)}</strong>
      <button className="icon-btn" aria-label="Mois suivant" onClick={() => onChange(addMonths(value, 1))}>
        <ChevronRight />
      </button>
    </div>
  );
}

export function Progress({ ratio, status, label }: { ratio: number; status?: BudgetStatus | 'good'; label?: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div
      className={`progress ${status ?? ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label={label}
    >
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Badge d'alerte budget : icône + libellé, jamais la couleur seule. */
export function BudgetBadge({ status, ratio }: { status: BudgetStatus; ratio: number }) {
  if (status === 'ok') return <span className="status neutral">{formatPercent(ratio)}</span>;
  if (status === 'warn')
    return (
      <span className="status warn">
        <TriangleAlert size={13} /> {formatPercent(ratio)}
      </span>
    );
  return (
    <span className="status over">
      <OctagonAlert size={13} /> {ratio > 1 ? 'Dépassé' : '100 %'}
    </span>
  );
}

export function DoneBadge({ children }: { children: ReactNode }) {
  return (
    <span className="status good">
      <CircleCheck size={13} /> {children}
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Fermer
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}

export function Notice({
  tone = 'info',
  icon,
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'over';
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`notice ${tone}`}>
      {icon}
      <div className="row-main">
        <div className="row-title">{title}</div>
        {children}
      </div>
    </div>
  );
}
