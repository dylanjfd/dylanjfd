import type { Category } from '../db/schema';
import { daysInMonth, isoFromParts, parts } from '../lib/dates';
import { formatEUR } from '../lib/format';
import type { DayEvent } from '../lib/plan';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Petit montant pour une case du calendrier : « −23 », « +1,8 k ». */
function compact(cents: number): string {
  const euros = Math.round(cents / 100);
  const abs = Math.abs(euros);
  const text = abs >= 1000 ? `${(abs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k` : String(abs);
  return (euros < 0 ? '−' : '+') + text;
}

/** Calendrier du mois : échéances prévues (icônes) et solde réel de chaque jour. */
export function MonthCalendar({
  ym,
  events,
  net,
  categories,
  today,
  selected,
  onSelect,
}: {
  ym: string;
  events: DayEvent[];
  net?: Map<string, number>;
  categories: Map<number, Category>;
  today: string;
  selected?: string | null;
  onSelect?: (date: string) => void;
}) {
  const [y, m] = parts(`${ym}-01`);
  const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const count = daysInMonth(ym);
  const byDate = new Map<string, DayEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const cells: (string | null)[] = [...Array<null>(first).fill(null)];
  for (let d = 1; d <= count; d++) cells.push(isoFromParts(y, m, d));

  return (
    <div className="calendar" role="grid" aria-label="Calendrier du mois">
      {WEEKDAYS.map((w, i) => (
        <div key={i} className="calendar-head" aria-hidden="true">
          {w}
        </div>
      ))}
      {cells.map((date, i) => {
        if (!date) return <div key={`x${i}`} />;
        const dayEvents = byDate.get(date) ?? [];
        const amount = net?.get(date);
        const label = [
          String(parts(date)[2]),
          ...dayEvents.map((e) => `${e.item.name} ${formatEUR(e.kind === 'income' ? e.item.amountCents : -e.item.amountCents)}`),
          amount ? formatEUR(amount, { sign: true }) : '',
        ]
          .filter(Boolean)
          .join(', ');
        return (
          <button
            key={date}
            type="button"
            className={`calendar-day${date === today ? ' today' : ''}${date === selected ? ' selected' : ''}`}
            onClick={onSelect ? () => onSelect(date) : undefined}
            aria-label={label}
            aria-pressed={date === selected}
          >
            <span className="calendar-num">{parts(date)[2]}</span>
            {dayEvents.length > 0 && (
              <span className="calendar-icons">
                {dayEvents.slice(0, 2).map((e) => (
                  <span
                    key={e.item.id}
                    className={`calendar-icon${e.kind === 'income' ? ' income' : ''}`}
                    style={{ ['--cat' as string]: `var(--c-${categories.get(e.item.categoryId)?.color ?? 'gray'})` }}
                  >
                    {categories.get(e.item.categoryId)?.icon ?? '•'}
                  </span>
                ))}
                {dayEvents.length > 2 && <span className="calendar-more">+{dayEvents.length - 2}</span>}
              </span>
            )}
            {amount ? <span className={`calendar-amount${amount > 0 ? ' positive' : ''}`}>{compact(amount)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
