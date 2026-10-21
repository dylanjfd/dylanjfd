import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Plus, Trash2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { MonthCalendar } from '../components/Calendar';
import { Donut, type DonutSegment } from '../components/Donut';
import { Loading } from '../components/Loading';
import { CategoryPicker, TransactionRow, TransactionSheet } from '../components/transactions';
import { useToast } from '../components/toast';
import { Amount, CatIcon, Segmented, Sheet, UNCATEGORIZED } from '../components/ui';
import { db, type Category, type Transaction } from '../db/schema';
import { CAT } from '../db/seed';
import { useAccounts, useBudgetFilter, useCategories, useMonthTransactions, usePlan, useSetting } from '../hooks/useData';
import { savePlan } from '../lib/actions';
import { recordError } from '../lib/errorLog';
import { retryWrite } from '../lib/recovery';
import { addMonths, currentMonth, diffDays, todayISO } from '../lib/dates';
import { centsToInput, formatDate, formatDayHeading, formatEUR, formatMonth, formatMonthShort, plural } from '../lib/format';
import { parseAmount } from '../lib/import/parse';
import { colorVar } from '../lib/palette';
import {
  BRAND_BY_KEY,
  dailyNet,
  forecast,
  markInk,
  monthSummary,
  newId,
  plannedEvents,
  type DayEvent,
  type Group,
  type Plan,
  type PlanItem,
} from '../lib/plan';

type View = 'calendrier' | 'budget' | 'prevision';
type Mode = 'prevu' | 'reel';

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function ItemMark({ item, category }: { item: PlanItem; category?: Category }) {
  const brand = item.brand ? BRAND_BY_KEY.get(item.brand) : undefined;
  if (!brand) return <CatIcon category={category} size="sm" />;
  return (
    <span className="brand-mark" style={{ width: 32, height: 32, background: brand.color, color: markInk(brand.color) }} aria-hidden="true">
      {brand.mark}
    </span>
  );
}

/**
 * Enregistre puis ferme la feuille ; en cas d'échec, la feuille reste ouverte avec un message
 * (au lieu d'un bouton qui ne fait rien).
 */
function useSave(onClose: () => void, setBusy: (b: boolean) => void) {
  const toast = useToast();
  return async (write: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await write();
      setBusy(false);
      toast(done);
      onClose();
    } catch (e) {
      setBusy(false);
      recordError(e, 'enregistrement du budget');
      toast('Enregistrement impossible pour le moment. Réessaie dans un instant.');
    }
  };
}

/** Ajout ou modification d'un revenu régulier ou d'une dépense fixe. */
function ItemSheet({
  plan,
  item,
  kind,
  categoryId,
  onClose,
}: {
  plan: Plan;
  item: PlanItem | null;
  kind: 'income' | 'fixed';
  categoryId: number;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? (kind === 'income' ? 'Salaire' : ''));
  const [amount, setAmount] = useState(centsToInput(item?.amountCents));
  const [day, setDay] = useState(item?.day ?? 1);
  const [busy, setBusy] = useState(false);
  const cents = parseAmount(amount);
  const valid = name.trim() !== '' && cents != null && cents !== 0;
  const listKey = kind === 'income' ? 'incomes' : 'fixed';
  const run = useSave(onClose, setBusy);

  function save() {
    if (!valid || busy) return;
    const next: PlanItem = { ...(item ?? { id: newId(), categoryId }), name: name.trim(), amountCents: Math.abs(cents!), day };
    const list = plan[listKey];
    void run(() => savePlan({ ...plan, [listKey]: item ? list.map((i) => (i.id === item.id ? next : i)) : [...list, next] }), item ? 'Modifié' : 'Ajouté');
  }

  function remove() {
    if (!item || busy) return;
    void run(() => savePlan({ ...plan, [listKey]: plan[listKey].filter((i) => i.id !== item.id) }), 'Supprimé');
  }

  return (
    <Sheet open onClose={onClose} title={item ? item.name : kind === 'income' ? 'Revenu régulier' : 'Dépense fixe'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field">
          <span className="label">Nom</span>
          <input className="input" value={name} placeholder={kind === 'income' ? 'Salaire, CAF…' : 'Loyer, assurance…'} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Montant par mois</span>
          <input className="input input-amount" inputMode="decimal" placeholder="0 €" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">{kind === 'income' ? 'Versé le' : 'Payé le'}</span>
          <select className="select" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d} du mois
              </option>
            ))}
          </select>
        </label>
        <div className="stack">
          <button type="submit" className="btn btn-primary btn-block" disabled={!valid || busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {item && (
            <button type="button" className="btn btn-danger btn-block" disabled={busy} onClick={remove}>
              <Trash2 size={18} /> Supprimer
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

/** Ce qui est prévu pour une catégorie : dépenses fixes datées + budget libre. */
function CategorySheet({
  plan,
  category,
  group,
  ym,
  onClose,
  onEditItem,
}: {
  plan: Plan;
  category: Category;
  group?: Group;
  ym: string;
  onClose: () => void;
  onEditItem: (item: PlanItem | null) => void;
}) {
  const fixed = plan.fixed.filter((f) => f.categoryId === category.id);
  const [budget, setBudget] = useState(centsToInput(category.budgetCents));
  const [busy, setBusy] = useState(false);
  const cents = parseAmount(budget);
  const run = useSave(onClose, setBusy);

  function saveBudget() {
    if (busy) return;
    const value = cents != null && cents !== 0 ? Math.abs(cents) : null;
    void run(
      () => retryWrite(() => db.categories.update(category.id, { budgetCents: value })),
      value ? `Budget ${category.name} : ${formatEUR(value)} par mois` : 'Budget retiré',
    );
  }

  return (
    <Sheet open onClose={onClose} title={category.name}>
      {group && (
        <div className="sheet-stats">
          <div>
            <span className="label">Prévu</span>
            <strong>{formatEUR(group.planned)}</strong>
          </div>
          <div>
            <span className="label">Dépensé</span>
            <strong className={group.planned > 0 && group.real > group.planned ? 'negative' : ''}>{formatEUR(group.real)}</strong>
          </div>
        </div>
      )}
      {fixed.length > 0 && (
        <div className="list" style={{ marginBottom: 14 }}>
          {fixed.map((f) => (
            <button key={f.id} className="row" onClick={() => onEditItem(f)}>
              <ItemMark item={f} category={category} />
              <div className="row-main">
                <div className="row-title">{f.name}</div>
                <div className="row-sub">Chaque mois, le {f.day}</div>
              </div>
              <span className="amount">{formatEUR(f.amountCents)}</span>
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span className="label">{fixed.length ? 'Budget en plus, par mois' : 'Budget par mois'}</span>
        <input className="input input-amount" inputMode="decimal" placeholder="0 €" value={budget} onChange={(e) => setBudget(e.target.value)} />
      </label>
      <div className="stack">
        <button className="btn btn-primary btn-block" disabled={busy} onClick={saveBudget}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button className="btn btn-block" onClick={() => onEditItem(null)}>
          <Plus size={18} /> Ajouter une dépense fixe
        </button>
        <Link className="btn btn-ghost btn-block" to={`/operations?cat=${category.id}&mois=${ym}`}>
          Voir les opérations du mois
        </Link>
      </div>
    </Sheet>
  );
}

export default function Month() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const today = todayISO();
  const ym = params.get('mois') ?? currentMonth();
  const view = (params.get('vue') as View | null) ?? 'budget';
  const plan = usePlan();
  const { list, map, loaded } = useCategories();
  const accounts = useAccounts();
  const filter = useBudgetFilter();
  const monthTxs = useMonthTransactions(ym);
  const txCount = useLiveQuery(() => db.transactions.count(), []);
  const lastBackup = useSetting<string | null>('lastBackupAt', null);
  const [mode, setMode] = useState<Mode>('prevu');
  const [selected, setSelected] = useState<string | number | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [editingItem, setEditingItem] = useState<{ item: PlanItem | null; kind: 'income' | 'fixed'; categoryId: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [openTx, setOpenTx] = useState<number | null>(null);

  const kept = useMemo(() => (monthTxs ?? []).filter(filter), [monthTxs, filter]);
  const summary = useMemo(() => (plan ? monthSummary(plan, list, kept, map) : null), [plan, list, kept, map]);

  if (!plan || !loaded || !summary || txCount === undefined) return <Loading />;
  if (plan.setup === 'todo') return <Navigate to="/demarrage" replace />;

  const setParam = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (value === null) n.delete(key);
        else n.set(key, value);
        return n;
      },
      { replace: true },
    );
  const goMonth = (n: number) => {
    setSelected(null);
    setDay(null);
    setParam('mois', addMonths(ym, n) === currentMonth() ? null : addMonths(ym, n));
  };

  const reel = mode === 'reel';
  const income = reel ? summary.income : summary.plannedIncome;
  const spending = reel ? summary.realSpending : summary.plannedSpending;
  const savings = income - spending;
  const segments: DonutSegment[] = summary.groups.map((g) => ({
    key: g.category.id,
    value: reel ? g.real : g.planned,
    color: colorVar(g.category.color),
    icon: g.category.icon,
    label: `${g.category.name} ${formatEUR(reel ? g.real : g.planned)}`,
  }));
  if (reel && summary.unclassified > 0)
    segments.push({ key: 'none', value: summary.unclassified, color: colorVar('gray'), icon: UNCATEGORIZED.icon, label: `À classer ${formatEUR(summary.unclassified)}` });
  const sel = selected != null ? segments.find((s) => s.key === selected) : undefined;
  const backupDays = lastBackup ? diffDays(lastBackup.slice(0, 10), today) : null;
  const events = plannedEvents(plan, ym);
  const fc = forecast(plan, summary, list, ym, today);
  const unplanned = list.filter((c) => c.kind === 'expense' && !summary.groups.some((g) => g.category.id === c.id));

  return (
    <main className="screen month">
      <header className="band">
        <div className="band-month">
          <button className="band-side" onClick={() => goMonth(-1)} aria-label={`Mois précédent : ${formatMonth(addMonths(ym, -1))}`}>
            <ChevronLeft size={18} /> {formatMonthShort(addMonths(ym, -1))}
          </button>
          <h1>{formatMonth(ym)}</h1>
          <button className="band-side" onClick={() => goMonth(1)} aria-label={`Mois suivant : ${formatMonth(addMonths(ym, 1))}`}>
            {formatMonthShort(addMonths(ym, 1))} <ChevronRight size={18} />
          </button>
        </div>
        <div className="band-tabs" role="tablist">
          {(
            [
              ['calendrier', 'Calendrier'],
              ['budget', 'Budget'],
              ['prevision', 'Prévision'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => setParam('vue', v === 'budget' ? null : v)}>
              {label}
            </button>
          ))}
        </div>
      </header>

      {view === 'budget' && (
        <>
          <section className="card month-card">
            <Segmented
              options={[
                { value: 'prevu', label: 'Prévu' },
                { value: 'reel', label: 'Réel' },
              ]}
              value={mode}
              onChange={(m) => {
                setMode(m);
                setSelected(null);
              }}
            />
            <Donut
              segments={segments}
              total={income}
              selected={selected}
              onSelect={setSelected}
              label={`${reel ? 'Réel' : 'Prévu'} : ${formatEUR(spending)} de dépenses sur ${formatEUR(income)} de revenus`}
            >
              {sel ? (
                <>
                  <span>{sel.key === 'none' ? UNCATEGORIZED.name : map.get(Number(sel.key))?.name}</span>
                  <strong>{formatEUR(sel.value, { rounded: true })}</strong>
                  <span>{pct(sel.value, income)} % des revenus</span>
                </>
              ) : reel ? (
                <>
                  <strong className={savings < 0 ? 'negative' : ''}>{formatEUR(savings, { rounded: true })}</strong>
                  <span>{savings < 0 ? 'de dépassement' : 'restant'}</span>
                </>
              ) : (
                <>
                  <strong>
                    {pct(savings, income)}
                    <small> %</small>
                  </strong>
                  <span>d’épargne</span>
                </>
              )}
            </Donut>
            <div className="split">
              <div>
                <span className="label">Dépenses {income > 0 && `(${pct(spending, income)} %)`}</span>
                <strong>{formatEUR(spending, { rounded: true })}</strong>
              </div>
              <div>
                <span className="label">{reel ? 'Reste' : 'Épargne'} {income > 0 && `(${pct(savings, income)} %)`}</span>
                <strong className={savings < 0 ? 'negative' : 'positive'}>{formatEUR(savings, { rounded: true })}</strong>
              </div>
            </div>
            {income > 0 && (
              <div className="duo-bar" aria-hidden="true">
                <span className="duo-spent" style={{ width: `${Math.min(100, pct(spending, income))}%` }} />
                <span className="duo-saved" />
              </div>
            )}
            {reel && txCount === 0 && (
              <Link className="btn btn-primary btn-block" to="/import" style={{ marginTop: 14 }}>
                <Upload size={18} /> Importer un relevé pour voir le réel
              </Link>
            )}
          </section>

          <section className="section">
            <div className="section-title">
              <span>Revenus</span>
              <span className="section-total">{formatEUR(income, { rounded: true })}</span>
            </div>
            <div className="list">
              {plan.incomes.map((i) => (
                <button key={i.id} className="row" onClick={() => setEditingItem({ item: i, kind: 'income', categoryId: CAT.revenus })}>
                  <CatIcon category={map.get(i.categoryId)} size="sm" />
                  <div className="row-main">
                    <div className="row-title">{i.name}</div>
                    <div className="row-sub">Chaque mois, le {i.day}</div>
                  </div>
                  <span className="amount">{formatEUR(i.amountCents)}</span>
                </button>
              ))}
              {reel && (
                <div className="row">
                  <CatIcon category={map.get(CAT.revenus)} size="sm" />
                  <div className="row-main">
                    <div className="row-title">Reçu ce mois-ci</div>
                    <div className="row-sub">D’après tes relevés</div>
                  </div>
                  <Amount cents={summary.realIncome} />
                </div>
              )}
              <button className="row add-row" onClick={() => setEditingItem({ item: null, kind: 'income', categoryId: CAT.revenus })}>
                <Plus size={18} /> Ajouter un revenu régulier
              </button>
            </div>
          </section>

          <section className="section">
            <div className="section-title">
              <span>Dépenses par groupe</span>
              <span className="section-total">{formatEUR(spending, { rounded: true })}</span>
            </div>
            <div className="list">
              {summary.groups.map((g) => {
                const value = reel ? g.real : g.planned;
                const over = reel && g.planned > 0 && g.real > g.planned;
                const ratio = reel ? (g.planned > 0 ? g.real / g.planned : 1) : income > 0 ? g.planned / income : 0;
                const fixedNames = plan.fixed.filter((f) => f.categoryId === g.category.id).map((f) => f.name);
                return (
                  <button
                    key={g.category.id}
                    className={`plan-row${selected === g.category.id ? ' highlighted' : ''}`}
                    onClick={() => setEditingCat(g.category)}
                  >
                    <CatIcon category={g.category} size="sm" />
                    <div className="row-main">
                      <div className="plan-row-head">
                        <span className="row-title">{g.category.name}</span>
                        <span className="plan-row-amount">
                          {reel ? (
                            <>
                              <span className={over ? 'negative' : ''}>{formatEUR(value, { rounded: true })}</span>
                              {g.planned > 0 && <small>/ {formatEUR(g.planned, { rounded: true })}</small>}
                            </>
                          ) : (
                            <>
                              {formatEUR(value, { rounded: true })}
                              <small>{pct(value, income)} %</small>
                            </>
                          )}
                        </span>
                      </div>
                      {fixedNames.length > 0 && <div className="row-sub">{fixedNames.join(', ')}</div>}
                      <div className="thin-bar">
                        <span
                          style={{
                            width: `${Math.min(100, Math.round(ratio * 100))}%`,
                            background: over ? 'var(--critical)' : colorVar(g.category.color),
                          }}
                        />
                      </div>
                      {over && <div className="row-sub negative">{formatEUR(g.real - g.planned, { rounded: true })} de plus que prévu</div>}
                    </div>
                  </button>
                );
              })}
              {reel && summary.unclassified > 0 && (
                <Link className="plan-row" to="/classer">
                  <CatIcon size="sm" />
                  <div className="row-main">
                    <div className="plan-row-head">
                      <span className="row-title">À classer</span>
                      <span className="plan-row-amount">{formatEUR(summary.unclassified, { rounded: true })}</span>
                    </div>
                    <div className="row-sub">Touche pour les classer</div>
                  </div>
                </Link>
              )}
              {unplanned.length > 0 && (
                <button className="row add-row" onClick={() => setPicking(true)}>
                  <Plus size={18} /> Ajouter un budget
                </button>
              )}
            </div>
          </section>
        </>
      )}

      {view === 'calendrier' && (
        <CalendarView
          ym={ym}
          today={today}
          events={events}
          monthTxs={kept}
          map={map}
          accounts={accounts.map((a) => [a.id, a.name] as const)}
          day={day}
          onDay={setDay}
          onOpenTx={setOpenTx}
        />
      )}

      {view === 'prevision' && (
        <section className="forecast">
          <div className="card forecast-hero">
            <span className="label">{ym < currentMonth() ? 'Épargne du mois' : 'Épargne prévue en fin de mois'}</span>
            <strong className={fc.savings < 0 ? 'negative' : 'positive'}>{formatEUR(fc.savings, { sign: true, rounded: true })}</strong>
            <span className="muted small">
              {ym < currentMonth()
                ? 'Revenus du mois moins ses dépenses'
                : fc.savings >= 0
                  ? 'si tu restes dans ton budget'
                  : 'tes dépenses dépassent tes revenus ce mois-ci'}
            </span>
          </div>
          <div className="kpi3">
            <div>
              <span className="label">Revenus</span>
              <strong>{formatEUR(fc.income, { rounded: true })}</strong>
            </div>
            <div>
              <span className="label">Dépensé</span>
              <strong>{formatEUR(fc.spent, { rounded: true })}</strong>
            </div>
            <div>
              <span className="label">Encore prévu</span>
              <strong>{formatEUR(fc.stillPlanned, { rounded: true })}</strong>
            </div>
          </div>
          {fc.daysLeft > 0 && fc.freeLeft > 0 && (
            <div className="card forecast-free">
              <span className="label">Tu peux encore dépenser</span>
              <strong>{formatEUR(fc.freeLeft, { rounded: true })}</strong>
              <span className="muted small">
                soit {formatEUR(fc.perDay ?? 0, { rounded: true })} par jour pendant {plural(fc.daysLeft, 'jour', 'jours')} (courses, sorties, shopping…)
              </span>
            </div>
          )}
          {fc.over.length > 0 && (
            <div className="section">
              <div className="section-title">Au-delà du prévu</div>
              <div className="list">
                {fc.over.map((g) => (
                  <button key={g.category.id} className="row" onClick={() => setEditingCat(g.category)}>
                    <CatIcon category={g.category} size="sm" />
                    <div className="row-main">
                      <div className="row-title">{g.category.name}</div>
                      <div className="row-sub">
                        {formatEUR(g.real, { rounded: true })} sur {formatEUR(g.planned, { rounded: true })} prévus
                      </div>
                    </div>
                    <span className="amount negative">+{formatEUR(g.real - g.planned, { rounded: true })}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {fc.upcoming.length > 0 && (
            <div className="section">
              <div className="section-title">À venir ce mois-ci</div>
              <div className="list">
                {fc.upcoming.map((e) => (
                  <EventRow key={`${e.item.id}-${e.date}`} event={e} category={map.get(e.item.categoryId)} />
                ))}
              </div>
            </div>
          )}
          <div className="section links-list">
            <Link className="btn btn-block" to="/analyses">
              Analyses détaillées
            </Link>
            <Link className="btn btn-block" to="/analyses/recurrents">
              Dépenses récurrentes repérées
            </Link>
          </div>
        </section>
      )}

      {(backupDays === null ? txCount > 0 : backupDays >= 14) && (
        <button className="gentle-reminder" onClick={() => navigate('/plus/sauvegarde')}>
          {backupDays === null ? 'Pense à sauvegarder tes données' : `Dernière sauvegarde il y a ${backupDays} jours`} ›
        </button>
      )}

      {editingCat && (
        <CategorySheet
          plan={plan}
          category={map.get(editingCat.id) ?? editingCat}
          group={summary.groups.find((g) => g.category.id === editingCat.id)}
          ym={ym}
          onClose={() => setEditingCat(null)}
          onEditItem={(item) => {
            const c = editingCat;
            setEditingCat(null);
            setEditingItem({ item, kind: 'fixed', categoryId: c.id });
          }}
        />
      )}
      {editingItem && (
        <ItemSheet
          plan={plan}
          item={editingItem.item}
          kind={editingItem.kind}
          categoryId={editingItem.categoryId}
          onClose={() => setEditingItem(null)}
        />
      )}
      <Sheet open={picking} onClose={() => setPicking(false)} title="Ajouter un budget">
        <CategoryPicker
          categories={unplanned}
          value={null}
          onPick={(id) => {
            setPicking(false);
            const c = id != null ? map.get(id) : undefined;
            if (c) setEditingCat(c);
          }}
        />
      </Sheet>
      <TransactionSheet txId={openTx} onClose={() => setOpenTx(null)} />
    </main>
  );
}

function EventRow({ event, category }: { event: DayEvent; category?: Category }) {
  const signed = event.kind === 'income' ? event.item.amountCents : -event.item.amountCents;
  return (
    <div className="row">
      <ItemMark item={event.item} category={category} />
      <div className="row-main">
        <div className="row-title">{event.item.name}</div>
        <div className="row-sub">Prévu le {formatDate(event.date).slice(0, 5)}</div>
      </div>
      <Amount cents={signed} />
    </div>
  );
}

function CalendarView({
  ym,
  today,
  events,
  monthTxs,
  map,
  accounts,
  day,
  onDay,
  onOpenTx,
}: {
  ym: string;
  today: string;
  events: DayEvent[];
  monthTxs: Transaction[];
  map: Map<number, Category>;
  accounts: (readonly [number, string])[];
  day: string | null;
  onDay: (d: string) => void;
  onOpenTx: (id: number) => void;
}) {
  const net = useMemo(() => dailyNet(monthTxs, map), [monthTxs, map]);
  const selectedDay = day ?? (today.startsWith(ym) ? today : `${ym}-01`);
  const dayEvents = events.filter((e) => e.date === selectedDay);
  const dayTxs = monthTxs.filter((t) => t.date === selectedDay);
  const accountName = new Map(accounts);
  return (
    <>
      <section className="card">
        <MonthCalendar ym={ym} events={events} net={net} categories={map} today={today} selected={selectedDay} onSelect={onDay} />
      </section>
      <section className="section">
        <div className="section-title">{formatDayHeading(selectedDay)}</div>
        {dayEvents.length === 0 && dayTxs.length === 0 ? (
          <p className="small muted" style={{ margin: '0 4px' }}>
            Rien de prévu ni de dépensé ce jour-là.
          </p>
        ) : (
          <div className="list">
            {dayEvents.map((e) => (
              <EventRow key={e.item.id} event={e} category={map.get(e.item.categoryId)} />
            ))}
            {dayTxs.map((t) => (
              <TransactionRow
                key={t.id}
                tx={t}
                category={t.categoryId != null ? map.get(t.categoryId) : undefined}
                accountName={accounts.length > 1 ? accountName.get(t.accountId) : undefined}
                onClick={() => onOpenTx(t.id)}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
