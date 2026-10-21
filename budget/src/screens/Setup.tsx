import { Check, ChevronLeft, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MonthCalendar } from '../components/Calendar';
import { Donut, StackBar, type DonutSegment } from '../components/Donut';
import { Loading } from '../components/Loading';
import { CatIcon } from '../components/ui';
import { db, type Category } from '../db/schema';
import { CAT } from '../db/seed';
import { useBudgetFilter, useCategories, usePlan, useRecurring, useTransactions } from '../hooks/useData';
import { savePlan } from '../lib/actions';
import { addMonths, currentMonth, monthBounds, monthRange, todayISO } from '../lib/dates';
import { loadDemoData } from '../lib/demo';
import { centsToInput, formatEUR } from '../lib/format';
import { parseAmount } from '../lib/import/parse';
import { colorVar } from '../lib/palette';
import {
  BRAND_BY_KEY,
  BRANDS,
  markInk,
  newId,
  plannedByCategory,
  plannedEvents,
  suggestFromHistory,
  type Plan,
  type PlanItem,
  type Suggestions,
} from '../lib/plan';
import { averageSpending } from '../lib/stats';

const BUDGET_STEPS = [CAT.transport, CAT.courses, CAT.restaurants, CAT.shopping];
const WEEKLY_STEPS: number[] = [CAT.courses, CAT.restaurants];

type StepKey = 'salary' | 'rent' | 'subs' | `cat:${number}` | 'summary';

interface Draft {
  salary: number | null;
  salaryDay: number;
  rent: number | null;
  rentDay: number;
  subs: PlanItem[];
  budgets: Record<number, number | null>;
  /** Montants proposés d'après les relevés (pour le signaler). */
  suggested: Set<string>;
}

const isSubscription = (f: PlanItem) => !!f.brand || f.categoryId === CAT.abonnements;

function initialDraft(plan: Plan, categories: Category[], s: Suggestions): Draft {
  const suggested = new Set<string>();
  const salaryItem = plan.incomes.find((i) => i.id === 'salaire');
  const rentItem = plan.fixed.find((f) => f.id === 'loyer');
  const planSubs = plan.fixed.filter((f) => f.id !== 'loyer' && isSubscription(f));
  if (!salaryItem && s.salary) suggested.add('salary');
  if (!rentItem && s.rent) suggested.add('rent');
  if (planSubs.length === 0 && s.subscriptions.length > 0) suggested.add('subs');
  const budgets: Record<number, number | null> = {};
  for (const id of BUDGET_STEPS) {
    const current = categories.find((c) => c.id === id)?.budgetCents ?? null;
    budgets[id] = current ?? s.budgets.get(id) ?? null;
    if (current == null && s.budgets.has(id)) suggested.add(`cat:${id}`);
  }
  return {
    salary: salaryItem?.amountCents ?? s.salary?.amountCents ?? null,
    salaryDay: salaryItem?.day ?? s.salary?.day ?? 28,
    rent: rentItem?.amountCents ?? s.rent?.amountCents ?? null,
    rentDay: rentItem?.day ?? s.rent?.day ?? 1,
    subs: planSubs.length > 0 ? planSubs : s.subscriptions,
    budgets,
    suggested,
  };
}

/** Plan enregistré à partir du brouillon ; les autres revenus et dépenses fixes sont gardés. */
function planFrom(d: Draft, plan: Plan, setup: Plan['setup']): Plan {
  const salary: PlanItem[] = d.salary
    ? [{ id: 'salaire', name: 'Salaire', amountCents: d.salary, day: d.salaryDay, categoryId: CAT.revenus }]
    : [];
  const rent: PlanItem[] = d.rent ? [{ id: 'loyer', name: 'Loyer', amountCents: d.rent, day: d.rentDay, categoryId: CAT.logement }] : [];
  const subs = d.subs.filter((s) => s.amountCents > 0).map((s) => ({ ...s, name: s.name.trim() || 'Abonnement' }));
  return {
    setup,
    incomes: [...salary, ...plan.incomes.filter((i) => i.id !== 'salaire')],
    fixed: [...rent, ...subs, ...plan.fixed.filter((f) => f.id !== 'loyer' && !isSubscription(f))],
  };
}

function AmountField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="amount-field">
      <span className="sr-only">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        placeholder="0"
        autoFocus
        style={{ width: `${Math.max(1, value.length) + 0.6}ch` }}
        onChange={(e) => onChange(e.target.value.replace(/[^\d,.\s]/g, ''))}
        onFocus={(e) => e.target.select()}
      />
      <span className="amount-suffix" aria-hidden="true">
        €
      </span>
    </label>
  );
}

function DaySelect({ value, onChange, label }: { value: number; onChange: (d: number) => void; label: string }) {
  return (
    <label className="day-select">
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <span>du mois</span>
    </label>
  );
}

function BrandMark({ item, size = 40 }: { item: Pick<PlanItem, 'brand' | 'name'>; size?: number }) {
  const brand = item.brand ? BRAND_BY_KEY.get(item.brand) : undefined;
  const bg = brand?.color ?? 'var(--surface-3)';
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size, background: bg, color: brand ? markInk(brand.color) : 'var(--text)' }}
      aria-hidden="true"
    >
      {brand?.mark ?? item.name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function Setup() {
  const navigate = useNavigate();
  const plan = usePlan();
  const { list, map, loaded } = useCategories();
  const recurring = useRecurring();
  const filter = useBudgetFilter();
  const cur = currentMonth();
  const past = useTransactions(monthBounds(addMonths(cur, -3)).start, monthBounds(addMonths(cur, -1)).end);

  const suggestions = useMemo(() => {
    if (!recurring || !past) return null;
    const kept = past.filter(filter);
    const { average } = averageSpending(kept, monthRange(addMonths(cur, -3), addMonths(cur, -1)), map);
    const active = (l: typeof recurring.items) => l.filter((i) => !recurring.ignored.has(i.key));
    return suggestFromHistory(active(recurring.summary.incomes), active(recurring.summary.charges), average);
  }, [recurring, past, filter, cur, map]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(0);
  const [text, setText] = useState('');
  const [weekly, setWeekly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [subText, setSubText] = useState('');
  const [welcome, setWelcome] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (draft || !plan || !loaded || !suggestions) return;
    const d = initialDraft(plan, list, suggestions);
    setDraft(d);
    setText(textFor('salary', d));
  }, [draft, plan, loaded, suggestions, list]);

  const steps = useMemo<StepKey[]>(
    () => ['salary', 'rent', 'subs', ...BUDGET_STEPS.filter((id) => map.has(id)).map((id) => `cat:${id}` as const), 'summary'],
    [map],
  );
  const key = steps[step];
  const catId = key.startsWith('cat:') ? Number(key.slice(4)) : null;

  if (!draft || !plan) return <Loading />;

  const typed = parseAmount(text);
  const typedCents = typed != null && typed > 0 ? Math.abs(typed) : null;
  const monthly = (cents: number | null) => (cents != null && weekly ? Math.round((cents * 52) / 12) : cents);

  // Brouillon avec la saisie en cours : l'anneau bouge pendant qu'on tape.
  const liveDraft: Draft = {
    ...draft,
    salary: key === 'salary' ? typedCents : draft.salary,
    rent: key === 'rent' ? typedCents : draft.rent,
    budgets: catId != null ? { ...draft.budgets, [catId]: monthly(typedCents) } : draft.budgets,
  };
  const live = {
    salary: liveDraft.salary,
    rent: liveDraft.rent,
    budget: (id: number) => liveDraft.budgets[id],
  };
  const subsTotal = draft.subs.reduce((s, i) => s + i.amountCents, 0);
  const cat = (id: number) => map.get(id);

  const livePlan = planFrom(liveDraft, plan, 'done');
  const liveCats = list.map((c) => (c.id in liveDraft.budgets && liveDraft.budgets[c.id] != null ? { ...c, budgetCents: liveDraft.budgets[c.id] } : c));
  const planned = plannedByCategory(livePlan, liveCats);
  const segments: DonutSegment[] = list
    .filter((c) => (planned.get(c.id) ?? 0) > 0)
    .map((c) => ({ key: c.id, value: planned.get(c.id)!, color: colorVar(c.color), icon: c.icon, label: `${c.name} ${formatEUR(planned.get(c.id)!)}` }));
  const income = livePlan.incomes.reduce((s, i) => s + i.amountCents, 0);
  const spending = segments.reduce((s, x) => s + x.value, 0);
  const remaining = income - spending;

  function textFor(k: StepKey, d: Draft): string {
    const v = k === 'salary' ? d.salary : k === 'rent' ? d.rent : k.startsWith('cat:') ? d.budgets[Number(k.slice(4))] : null;
    return v ? centsToInput(v) : '';
  }

  function goTo(i: number, d: Draft) {
    const target = Math.max(0, Math.min(steps.length - 1, i));
    setStep(target);
    setText(textFor(steps[target], d));
    setWeekly(false);
    setEditing(null);
  }

  function next(update: Partial<Draft>) {
    const d = { ...draft!, ...update };
    setDraft(d);
    goTo(step + 1, d);
  }

  function validate() {
    if (key === 'salary') next({ salary: typedCents });
    else if (key === 'rent') next({ rent: typedCents });
    else if (catId != null) next({ budgets: { ...draft!.budgets, [catId]: monthly(typedCents) } });
    else next({});
  }

  function later() {
    if (key === 'salary') next({ salary: null });
    else if (key === 'rent') next({ rent: null });
    else if (catId != null) next({ budgets: { ...draft!.budgets, [catId]: null } });
    else next({});
  }

  function toggleBrand(brandKey: string) {
    const existing = draft!.subs.find((s) => s.brand === brandKey);
    if (existing) {
      setEditing(editing === existing.id ? null : existing.id);
      setSubText(centsToInput(existing.amountCents));
      return;
    }
    const b = BRAND_BY_KEY.get(brandKey)!;
    const item: PlanItem = { id: newId(), name: b.name, amountCents: b.price, day: 1, categoryId: b.categoryId, brand: b.key };
    setDraft({ ...draft!, subs: [...draft!.subs, item] });
    setEditing(item.id);
    setSubText(centsToInput(b.price));
  }

  function addCustom() {
    const item: PlanItem = { id: newId(), name: '', amountCents: 0, day: 1, categoryId: CAT.abonnements };
    setDraft({ ...draft!, subs: [...draft!.subs, item] });
    setEditing(item.id);
    setSubText('');
  }

  function updateSub(id: string, change: Partial<PlanItem>) {
    setDraft((d) => (d ? { ...d, subs: d.subs.map((s) => (s.id === id ? { ...s, ...change } : s)) } : d));
  }

  function removeSub(id: string) {
    setDraft((d) => (d ? { ...d, subs: d.subs.filter((s) => s.id !== id) } : d));
    setEditing(null);
  }

  async function save(setup: Plan['setup']) {
    setBusy(true);
    const next = planFrom(draft!, plan!, setup);
    await db.transaction('rw', db.categories, db.settings, async () => {
      for (const [id, cents] of Object.entries(draft!.budgets)) if (cents != null) await db.categories.update(Number(id), { budgetCents: cents });
      await savePlan(next);
    });
    setBusy(false);
  }

  async function finish() {
    await save('done');
    setWelcome(true);
    setTimeout(() => navigate('/', { replace: true }), 1400);
  }

  async function skip() {
    await save(step === 0 && !draft!.salary ? 'skipped' : 'done');
    navigate('/', { replace: true });
  }

  async function demo() {
    if (!confirm('Charger un exemple : un an d’opérations fictives avec un budget déjà rempli ?\n\nTu pourras tout effacer depuis Plus.')) return;
    setBusy(true);
    await loadDemoData();
    navigate('/', { replace: true });
  }

  if (welcome)
    return (
      <main className="setup-welcome">
        <img src={`${import.meta.env.BASE_URL}icons/pwa-192x192.png`} alt="" />
        <p>Bienvenue dans Mon Budget !</p>
      </main>
    );

  const trail = steps.slice(0, -1).map((k) => {
    if (k === 'salary') return { k, icon: cat(CAT.revenus)?.icon ?? '💶', color: cat(CAT.revenus)?.color, value: live.salary };
    if (k === 'rent') return { k, icon: cat(CAT.logement)?.icon ?? '🏠', color: cat(CAT.logement)?.color, value: live.rent };
    if (k === 'subs') return { k, icon: cat(CAT.abonnements)?.icon ?? '📺', color: cat(CAT.abonnements)?.color, value: subsTotal || null };
    const id = Number(k.slice(4));
    return { k, icon: cat(id)?.icon ?? '•', color: cat(id)?.color, value: live.budget(id) };
  });

  const editingItem = draft.subs.find((s) => s.id === editing);
  const showRing = key !== 'salary' && key !== 'summary';
  const canValidate = key === 'subs' ? draft.subs.some((s) => s.amountCents > 0) : typedCents != null;
  const suggestedHere = draft.suggested.has(key);

  return (
    <main className="setup">
      <div className="setup-top">
        <button
          className="icon-btn"
          aria-label="Étape précédente"
          style={{ visibility: step > 0 ? 'visible' : 'hidden' }}
          onClick={() => goTo(step - 1, draft)}
        >
          <ChevronLeft size={24} />
        </button>
        <ol className="setup-trail" aria-label="Étapes">
          {trail.map((t, i) => (
            <li key={t.k} className={i === step ? 'current' : i < step ? 'done' : ''}>
              <button
                type="button"
                className="trail-icon"
                style={{ ['--cat' as string]: colorVar(t.color) }}
                aria-label={`Étape ${i + 1}`}
                disabled={i > step}
                onClick={() => goTo(i, draft)}
              >
                {t.icon}
              </button>
              <span>{t.value ? formatEUR(t.value, { rounded: true }) : ''}</span>
            </li>
          ))}
        </ol>
        <button className="setup-skip" onClick={() => void skip()} disabled={busy}>
          {key === 'summary' ? '' : 'Passer'}
        </button>
      </div>

      {key === 'salary' && (
        <section className="setup-salary">
          <CatIcon category={cat(CAT.revenus)} size="lg" />
          <h1>Pour commencer, inscris ton salaire</h1>
          <div className="salary-ring">
            <AmountField value={text} onChange={setText} label="Salaire mensuel" />
          </div>
          <DaySelect value={draft.salaryDay} onChange={(salaryDay) => setDraft({ ...draft, salaryDay })} label="Versé le" />
          {suggestedHere && <p className="setup-hint">Proposé d’après tes relevés</p>}
        </section>
      )}

      {showRing && (
        <div className="setup-ring">
          <Donut segments={segments} total={income} icons={false} thickness={14} label={`${formatEUR(remaining)} restant sur ${formatEUR(income)}`}>
            <strong className={remaining < 0 ? 'negative' : ''}>{formatEUR(Math.abs(remaining), { rounded: true })}</strong>
            <span>{remaining < 0 ? 'en trop' : 'restant'}</span>
          </Donut>
        </div>
      )}

      {key === 'rent' && (
        <section className="card setup-card">
          <div className="setup-card-head">
            <CatIcon category={cat(CAT.logement)} />
            <div>
              <h2>Loyer</h2>
              <p>Montant mensuel</p>
            </div>
          </div>
          <AmountField value={text} onChange={setText} label="Loyer mensuel" />
          <DaySelect value={draft.rentDay} onChange={(rentDay) => setDraft({ ...draft, rentDay })} label="Payé le" />
          {suggestedHere && <p className="setup-hint">Proposé d’après tes relevés</p>}
        </section>
      )}

      {key === 'subs' && (
        <section className="card setup-card">
          {editingItem ? (
            <div className="sub-editor">
              <div className="setup-card-head">
                <BrandMark item={editingItem} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingItem.brand ? (
                    <h2>{editingItem.name}</h2>
                  ) : (
                    <input
                      className="input sub-name"
                      placeholder="Nom de l’abonnement"
                      value={editingItem.name}
                      autoFocus
                      onChange={(e) => updateSub(editingItem.id, { name: e.target.value })}
                    />
                  )}
                  <p>Montant mensuel</p>
                </div>
                <button className="chip" onClick={() => removeSub(editingItem.id)}>
                  <X size={14} /> Retirer
                </button>
              </div>
              <AmountField
                value={subText}
                onChange={(v) => {
                  setSubText(v);
                  const c = parseAmount(v);
                  updateSub(editingItem.id, { amountCents: c != null ? Math.abs(c) : 0 });
                }}
                label={`Montant de ${editingItem.name || 'l’abonnement'}`}
              />
              <DaySelect value={editingItem.day} onChange={(day) => updateSub(editingItem.id, { day })} label="Prélevé le" />
              <button className="btn btn-sm btn-block" onClick={() => setEditing(null)}>
                OK
              </button>
            </div>
          ) : (
            <div className="setup-card-head">
              <CatIcon category={cat(CAT.abonnements)} />
              <div>
                <h2>Abonnements</h2>
                <p>{draft.subs.length ? `${draft.subs.length} choisis · ${formatEUR(subsTotal)} par mois` : 'Touche ceux que tu as'}</p>
              </div>
            </div>
          )}
          <div className="sub-grid">
            {BRANDS.map((b) => {
              const chosen = draft.subs.find((s) => s.brand === b.key);
              return (
                <button key={b.key} type="button" className={`sub-tile${chosen ? ' chosen' : ''}`} aria-pressed={!!chosen} onClick={() => toggleBrand(b.key)}>
                  <BrandMark item={{ brand: b.key, name: b.name }} size={36} />
                  <span className="sub-name-label">{b.name}</span>
                  {chosen && <span className="sub-price">{formatEUR(chosen.amountCents)}</span>}
                  {chosen && <Check className="sub-check" size={14} />}
                </button>
              );
            })}
            {draft.subs
              .filter((s) => !s.brand)
              .map((s) => (
                <button key={s.id} type="button" className="sub-tile chosen" aria-pressed onClick={() => {
                  setEditing(editing === s.id ? null : s.id);
                  setSubText(centsToInput(s.amountCents));
                }}>
                  <BrandMark item={s} size={36} />
                  <span className="sub-name-label">{s.name || 'Sans nom'}</span>
                  <span className="sub-price">{formatEUR(s.amountCents)}</span>
                  <Check className="sub-check" size={14} />
                </button>
              ))}
            <button type="button" className="sub-tile" onClick={addCustom}>
              <span className="brand-mark" style={{ width: 36, height: 36 }} aria-hidden="true">
                <Plus size={18} />
              </span>
              <span className="sub-name-label">Autre</span>
            </button>
          </div>
          {suggestedHere && <p className="setup-hint">Trouvés dans tes relevés : vérifie les montants</p>}
        </section>
      )}

      {catId != null && cat(catId) && (
        <section className="card setup-card">
          <div className="setup-card-head">
            <CatIcon category={cat(catId)} />
            <div>
              <h2>{cat(catId)!.name}</h2>
              <p>{weekly ? 'Budget par semaine' : 'Budget par mois'}</p>
            </div>
          </div>
          <AmountField value={text} onChange={setText} label={`Budget ${cat(catId)!.name}`} />
          {WEEKLY_STEPS.includes(catId) && (
            <div className="freq">
              <p>À quelle fréquence ?</p>
              <div className="freq-options">
                <button type="button" className={weekly ? 'active' : ''} aria-pressed={weekly} onClick={() => setWeekly(true)}>
                  <strong>Chaque semaine</strong>
                  <span>{typedCents ? `${formatEUR(typedCents, { rounded: true })} / semaine` : 'par semaine'}</span>
                </button>
                <button type="button" className={!weekly ? 'active' : ''} aria-pressed={!weekly} onClick={() => setWeekly(false)}>
                  <strong>Ça dépend</strong>
                  <span>{typedCents ? `${formatEUR(monthly(typedCents)!, { rounded: true })} / mois` : 'par mois'}</span>
                </button>
              </div>
            </div>
          )}
          {suggestedHere && <p className="setup-hint">Proposé d’après ta moyenne des 3 derniers mois</p>}
        </section>
      )}

      {key === 'summary' && <Summary draftPlan={livePlan} segments={segments} income={income} map={map} />}

      <div className="setup-actions">
        {key !== 'summary' && <p className="setup-note">Tu pourras modifier ce montant plus tard</p>}
        {key === 'summary' ? (
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void finish()}>
            C’est parti !
          </button>
        ) : canValidate ? (
          <button className="btn btn-primary btn-block" onClick={validate}>
            {key === 'subs' ? 'Continuer' : 'Valider'}
          </button>
        ) : (
          <button className="btn btn-block btn-later" onClick={later}>
            Plus tard →
          </button>
        )}
        {key === 'salary' && (
          <div className="setup-links">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/plus/sauvegarde')}>
              J’ai une sauvegarde
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void demo()}>
              Voir un exemple
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function Summary({
  draftPlan,
  segments,
  income,
  map,
}: {
  draftPlan: Plan;
  segments: DonutSegment[];
  income: number;
  map: Map<number, Category>;
}) {
  const spending = segments.reduce((s, x) => s + x.value, 0);
  const savings = income - spending;
  const ratio = (v: number) => (income > 0 ? Math.round((v / income) * 100) : 0);
  const today = todayISO();
  const ym = currentMonth();
  return (
    <section className="setup-summary">
      <h1>Ton budget du mois</h1>
      <StackBar segments={segments} total={income} />
      <div className="card split">
        <div>
          <span className="label">Dépenses</span>
          <strong>{formatEUR(spending, { rounded: true })}</strong>
          <span className="muted small">{ratio(spending)} %</span>
        </div>
        <div>
          <span className="label">Épargne</span>
          <strong className={savings < 0 ? 'negative' : 'positive'}>{formatEUR(savings, { rounded: true })}</strong>
          <span className="muted small">{income > 0 ? `${ratio(savings)} %` : 'ajoute ton salaire'}</span>
        </div>
      </div>
      {savings < 0 && (
        <p className="setup-warn">Tes dépenses prévues dépassent ton salaire de {formatEUR(-savings, { rounded: true })}.</p>
      )}
      <div className="card">
        <MonthCalendar ym={ym} events={plannedEvents(draftPlan, ym)} categories={map} today={today} />
      </div>
      <div className="list">
        {segments.map((s) => {
          const c = map.get(Number(s.key));
          const items = draftPlan.fixed.filter((f) => f.categoryId === Number(s.key)).map((f) => f.name);
          return (
            <div key={s.key} className="plan-row">
              <CatIcon category={c} size="sm" />
              <div className="row-main">
                <div className="plan-row-head">
                  <span className="row-title">{c?.name}</span>
                  <span className="plan-row-amount">
                    {formatEUR(s.value, { rounded: true })} <small>{ratio(s.value)} %</small>
                  </span>
                </div>
                {items.length > 0 && <div className="row-sub">{items.join(', ')}</div>}
                <div className="thin-bar">
                  <span style={{ width: `${Math.min(100, ratio(s.value))}%`, background: s.color }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
