import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMode } from '../App';
import { CatIcon, Empty, Header, MonthPicker, Segmented } from '../components/ui';
import { useBudgetFilter, useCategories, useTransactions } from '../hooks/useData';
import { addMonths, currentMonth, monthBounds, monthRange, todayISO } from '../lib/dates';
import { formatDate, formatEUR, formatMonth, formatMonthShort, formatPercent, plural } from '../lib/format';
import { colorHex } from '../lib/palette';
import { averageSpending, spendingByCategory, topMerchants, totalsByMonth } from '../lib/stats';
import { prettyMerchant } from '../lib/text';
import Recurring from './Recurring';

const CHROME = {
  light: { surface: '#ffffff', grid: '#e6e8ec', axis: '#c9ccd3', muted: '#7a8090', hover: 'rgba(15,18,25,0.05)', unclassified: '#b9b8b1' },
  dark: { surface: '#17191e', grid: '#2a2d34', axis: '#3a3e47', muted: '#8b92a0', hover: 'rgba(255,255,255,0.06)', unclassified: '#5d5c57' },
};

const compactEUR = (cents: number) => {
  const v = cents / 100;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(v)} €`;
};

/** Graduations rondes (1, 2, 2,5 ou 5 × 10ⁿ €) couvrant la valeur maximale. */
function niceTicks(maxCents: number, count = 4): number[] {
  const max = Math.max(maxCents / 100, 1);
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(Math.round(v * 100));
  return ticks;
}

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

interface Slice {
  id: number | null;
  name: string;
  icon: string;
  value: number;
  color: string;
}

function DonutTooltip({ active, payload, total }: { active?: boolean; payload?: { payload: Slice }[]; total: number }) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>
        {s.icon} {s.name}
      </strong>
      {formatEUR(s.value)} · {formatPercent(s.value / total)}
    </div>
  );
}

function MonthTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { ym: string; income: number; expenses: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{formatMonth(d.ym)}</strong>
      Revenus : {formatEUR(d.income)}
      <br />
      Dépenses : {formatEUR(d.expenses)}
      <br />
      Solde : {formatEUR(d.income - d.expenses, { sign: true })}
    </div>
  );
}

function Charts() {
  const navigate = useNavigate();
  const mode = useMode();
  const chrome = CHROME[mode];
  const [month, setMonth] = useState(currentMonth());
  const { map } = useCategories();
  const filter = useBudgetFilter();
  const first = addMonths(month, -11);
  const txs = useTransactions(monthBounds(first).start, monthBounds(month).end);

  const data = useMemo(() => {
    const kept = (txs ?? []).filter(filter);
    const monthTxs = kept.filter((t) => t.date.startsWith(month));
    const spending = spendingByCategory(monthTxs, map);
    const slices: Slice[] = [...spending.entries()]
      .filter(([, v]) => v > 0)
      .map(([id, value]) => {
        const c = id != null ? map.get(id) : undefined;
        return {
          id,
          name: c?.name ?? 'À classer',
          icon: c?.icon ?? '❓',
          value,
          color: c ? colorHex(c.color, mode) : chrome.unclassified,
        };
      })
      .sort((a, b) => b.value - a.value);
    const total = slices.reduce((s, x) => s + x.value, 0);

    const months = monthRange(first, month);
    const byMonth = totalsByMonth(kept, months, map);
    const series = months.map((ym) => ({ ym, label: MONTH_INITIALS[Number(ym.slice(5, 7)) - 1], ...byMonth.get(ym)! }));
    const ticks = niceTicks(Math.max(0, ...series.map((s) => Math.max(s.income, s.expenses))));

    const prev = monthRange(addMonths(month, -3), addMonths(month, -1));
    const { average, monthCount } = averageSpending(kept, prev, map);
    const ids = new Set([...spending.keys(), ...average.keys()]);
    const comparison = [...ids]
      .map((id) => ({ id, current: Math.max(0, spending.get(id) ?? 0), avg: Math.max(0, average.get(id) ?? 0) }))
      .filter((r) => r.current > 0 || r.avg > 0)
      .sort((a, b) => Math.abs(b.current - b.avg) - Math.abs(a.current - a.avg));
    const avgTotal = [...average.values()].reduce((s, v) => s + Math.max(0, v), 0);

    return { slices, total, series, ticks, comparison, monthCount, avgTotal, merchants: topMerchants(monthTxs, map, 8) };
  }, [txs, filter, month, map, mode, first, chrome.unclassified]);

  if (!txs) return null;
  const isCurrent = month === currentMonth();
  const hasData = data.series.some((s) => s.income || s.expenses);

  return (
    <>
      <MonthPicker value={month} onChange={setMonth} />
      {!hasData ? (
        <Empty icon="📊" title="Pas encore de données">
          <p>Importez un relevé pour voir vos graphiques.</p>
        </Empty>
      ) : (
        <>
          <section className="card chart-card">
            <h3>Répartition des dépenses</h3>
            <p className="chart-sub">
              {formatMonth(month)}
              {isCurrent ? ` · jusqu’au ${formatDate(todayISO())}` : ''}
            </p>
            {data.total > 0 ? (
              <>
                <div className="donut-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.slices}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="66%"
                        outerRadius="96%"
                        startAngle={90}
                        endAngle={-270}
                        stroke={chrome.surface}
                        strokeWidth={2}
                        isAnimationActive={false}
                        onClick={(s: { payload?: Slice }) =>
                          s.payload && navigate(`/operations?mois=${month}&cat=${s.payload.id ?? 'none'}`)
                        }
                      >
                        {data.slices.map((s) => (
                          <Cell key={String(s.id)} fill={s.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<DonutTooltip total={data.total} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="donut-center">
                    <span className="small muted">Dépenses</span>
                    <strong>{formatEUR(data.total, { rounded: true })}</strong>
                  </div>
                </div>
                <div className="legend">
                  {data.slices.map((s) => (
                    <button
                      key={String(s.id)}
                      className="legend-row"
                      onClick={() => navigate(`/operations?mois=${month}&cat=${s.id ?? 'none'}`)}
                    >
                      <span className="swatch" style={{ background: s.color }} />
                      <span className="name">
                        {s.icon} {s.name}
                      </span>
                      <span className="amount">{formatEUR(s.value)}</span>
                      <span className="pct">{formatPercent(s.value / data.total)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="small muted" style={{ margin: '0 4px' }}>
                Aucune dépense ce mois-ci.
              </p>
            )}
          </section>

          <section className="card chart-card" style={{ marginTop: 12 }}>
            <h3>Dépenses et revenus sur 12 mois</h3>
            <p className="chart-sub">
              {formatMonthShort(data.series[0].ym)} {data.series[0].ym.slice(0, 4)} à {formatMonthShort(month)} {month.slice(0, 4)} ·
              touchez un mois pour l’afficher
            </p>
            <div className="legend-inline">
              <span>
                <span className="swatch" style={{ background: colorHex('blue', mode) }} /> Revenus
              </span>
              <span>
                <span className="swatch" style={{ background: colorHex('orange', mode) }} /> Dépenses
              </span>
            </div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.series}
                  barGap={2}
                  margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
                  onClick={(e: { activeLabel?: string | number; activeTooltipIndex?: number | string | null }) => {
                    const i = Number(e?.activeTooltipIndex);
                    if (Number.isInteger(i) && data.series[i]) setMonth(data.series[i].ym);
                  }}
                >
                  <CartesianGrid vertical={false} stroke={chrome.grid} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={{ stroke: chrome.axis }}
                    tick={{ fill: chrome.muted, fontSize: 11 }}
                    interval={0}
                  />
                  <YAxis
                    ticks={data.ticks}
                    domain={[0, data.ticks[data.ticks.length - 1]]}
                    tickFormatter={compactEUR}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tick={{ fill: chrome.muted, fontSize: 11 }}
                  />
                  <Tooltip content={<MonthTooltip />} cursor={{ fill: chrome.hover }} />
                  <Bar dataKey="income" name="Revenus" fill={colorHex('blue', mode)} radius={[4, 4, 0, 0]} maxBarSize={12} isAnimationActive={false}>
                    {data.series.map((s) => (
                      <Cell key={s.ym} fillOpacity={s.ym === month ? 1 : 0.55} />
                    ))}
                  </Bar>
                  <Bar dataKey="expenses" name="Dépenses" fill={colorHex('orange', mode)} radius={[4, 4, 0, 0]} maxBarSize={12} isAnimationActive={false}>
                    {data.series.map((s) => (
                      <Cell key={s.ym} fillOpacity={s.ym === month ? 1 : 0.55} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="section">
            <div className="section-title">Par rapport à la moyenne</div>
            <div className="card">
              {data.monthCount === 0 ? (
                <p className="small muted">Il faut au moins un mois précédent importé pour comparer.</p>
              ) : (
                <>
                  <p className="small muted" style={{ marginBottom: 6 }}>
                    {formatMonth(month)} comparé à la moyenne {data.monthCount > 1 ? `des ${data.monthCount} mois précédents` : 'du mois précédent'}
                    {isCurrent ? ' (mois en cours, encore incomplet)' : ''}.
                  </p>
                  <div className="kv">
                    <span>Total des dépenses</span>
                    <span>
                      {formatEUR(data.total)} <Delta current={data.total} avg={data.avgTotal} />
                    </span>
                  </div>
                  {data.comparison.map((r) => {
                    const c = r.id != null ? map.get(r.id) : undefined;
                    return (
                      <div key={String(r.id)} className="kv">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <CatIcon category={c} size="sm" />
                          <span style={{ color: 'var(--text)' }}>{c?.name ?? 'À classer'}</span>
                        </span>
                        <span>
                          {formatEUR(r.current, { rounded: true })}
                          <span className="small muted"> / moy. {formatEUR(r.avg, { rounded: true })}</span>{' '}
                          <Delta current={r.current} avg={r.avg} />
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </section>

          <section className="section">
            <div className="section-title">Principaux commerçants</div>
            {data.merchants.length === 0 ? (
              <p className="small muted" style={{ margin: '0 4px' }}>
                Aucune dépense ce mois-ci.
              </p>
            ) : (
              <div className="list">
                {data.merchants.map((m, i) => (
                  <div key={m.merchant} className="row">
                    <CatIcon category={m.categoryId != null ? map.get(m.categoryId) : undefined} />
                    <div className="row-main">
                      <div className="row-title">
                        {i + 1}. {prettyMerchant(m.merchant)}
                      </div>
                      <div className="row-sub">{plural(m.count, 'opération', 'opérations')}</div>
                    </div>
                    <span className="amount">{formatEUR(m.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function Delta({ current, avg }: { current: number; avg: number }) {
  if (avg <= 0) return current > 0 ? <span className="status neutral">nouveau</span> : null;
  const ratio = (current - avg) / avg;
  if (Math.abs(ratio) < 0.05) return <span className="status neutral">=</span>;
  const up = ratio > 0;
  return (
    <span className={`small ${up ? 'delta-up' : 'delta-down'}`} style={{ fontWeight: 700 }}>
      {up ? '↑' : '↓'} {up ? '+' : '−'}
      {formatPercent(Math.abs(ratio))}
    </span>
  );
}

export default function Analyses({ tab = 'charts' }: { tab?: 'charts' | 'recurring' }) {
  const navigate = useNavigate();
  return (
    <main className="screen">
      <Header title="Analyses" />
      <Segmented
        options={[
          { value: 'charts', label: 'Graphiques' },
          { value: 'recurring', label: 'Récurrents' },
        ]}
        value={tab}
        onChange={(v) => navigate(v === 'recurring' ? '/analyses/recurrents' : '/analyses', { replace: true })}
      />
      {tab === 'recurring' ? <Recurring /> : <Charts />}
    </main>
  );
}
