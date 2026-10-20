import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/toast';
import { Amount, CatIcon, DoneBadge, Empty, Progress, Segmented, Sheet } from '../components/ui';
import { db, type ColorKey, type Goal, type GoalContribution, type Transaction } from '../db/schema';
import { useAccounts } from '../hooks/useData';
import { todayISO } from '../lib/dates';
import { centsToInput, formatDate, formatEUR, plural } from '../lib/format';
import { goalEntries, goalProgress, type GoalEntry } from '../lib/goals';
import { parseAmount } from '../lib/import/parse';
import { COLOR_KEYS, colorVar } from '../lib/palette';
import { matchesPattern } from '../lib/rules';
import { normalizeLabel } from '../lib/text';

const GOAL_ICONS = ['🏖️', '🏠', '🚗', '🎓', '💍', '🎁', '🛟', '✈️', '💻', '📱', '🐶', '👶', '🎸', '🚲', '🏥', '💰'];

function useKeywordTransactions(goals: Goal[] | undefined): Transaction[] {
  const keywords = (goals ?? []).map((g) => normalizeLabel(g.keyword ?? '')).filter(Boolean);
  const key = keywords.join('|');
  return (
    useLiveQuery(
      () => (key ? db.transactions.filter((t) => key.split('|').some((k) => matchesPattern(t.labelNorm, k))).toArray() : []),
      [key],
    ) ?? []
  );
}

function GoalForm({ goal, open, onClose }: { goal: Goal | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(GOAL_ICONS[0]);
  const [color, setColor] = useState<ColorKey>('blue');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [initial, setInitial] = useState('');
  const [keyword, setKeyword] = useState('');
  const [startDate, setStartDate] = useState(todayISO());

  useEffect(() => {
    if (!open) return;
    setName(goal?.name ?? '');
    setIcon(goal?.icon ?? GOAL_ICONS[0]);
    setColor(goal?.color ?? 'blue');
    setTarget(centsToInput(goal?.targetCents));
    setDeadline(goal?.deadline ?? '');
    setInitial(centsToInput(goal?.initialCents || null));
    setKeyword(goal?.keyword ?? '');
    setStartDate(goal?.startDate ?? todayISO());
  }, [open, goal]);

  const kw = normalizeLabel(keyword);
  const matches = useLiveQuery(
    () => (kw ? db.transactions.filter((t) => t.date >= startDate && matchesPattern(t.labelNorm, kw)).count() : 0),
    [kw, startDate],
  );
  const targetCents = parseAmount(target);
  const valid = name.trim() && targetCents && targetCents > 0 && deadline;

  async function save() {
    if (!valid) return;
    const data = {
      name: name.trim(),
      icon,
      color,
      targetCents: Math.abs(targetCents!),
      deadline,
      startDate,
      initialCents: Math.abs(parseAmount(initial) ?? 0),
      keyword: kw || undefined,
    };
    if (goal) await db.goals.update(goal.id, data);
    else await db.goals.add(data);
    toast(goal ? 'Objectif modifié' : 'Objectif créé');
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={goal ? 'Modifier l’objectif' : 'Nouvel objectif'}>
      <label className="field">
        <span className="label">Nom</span>
        <input className="input" value={name} placeholder="Ex. Vacances, apport immobilier" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span className="label" style={{ display: 'block', margin: '0 4px 6px' }}>
          Icône
        </span>
        <div className="option-grid">
          {GOAL_ICONS.map((i) => (
            <button key={i} type="button" className={i === icon ? 'selected' : ''} onClick={() => setIcon(i)} aria-label={i}>
              {i}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label" style={{ display: 'block', margin: '0 4px 6px' }}>
          Couleur
        </span>
        <div className="option-grid">
          {COLOR_KEYS.map((c) => (
            <button key={c} type="button" className={c === color ? 'selected' : ''} onClick={() => setColor(c)} aria-label={c}>
              <span className="color-dot" style={{ background: colorVar(c) }} />
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="label">Montant cible</span>
        <input className="input" inputMode="decimal" placeholder="Ex. 1 500" value={target} onChange={(e) => setTarget(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Date limite</span>
        <input className="input" type="date" value={deadline} min={todayISO()} onChange={(e) => setDeadline(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Déjà épargné (facultatif)</span>
        <input className="input" inputMode="decimal" placeholder="0" value={initial} onChange={(e) => setInitial(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Virements automatiques : mot-clé du libellé (facultatif)</span>
        <input className="input" placeholder="Ex. LIVRET A" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </label>
      {kw && (
        <>
          <label className="field">
            <span className="label">Compter les virements à partir du</span>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <p className="small muted" style={{ margin: '-6px 4px 14px' }}>
            {matches
              ? `${plural(matches, 'opération correspond', 'opérations correspondent')} déjà.`
              : 'Aucune opération ne correspond pour l’instant.'}{' '}
            Chaque virement dont le libellé contient « {kw} » alimentera l’objectif.
          </p>
        </>
      )}
      <button className="btn btn-primary btn-block" disabled={!valid} onClick={save}>
        {goal ? 'Enregistrer' : 'Créer l’objectif'}
      </button>
    </Sheet>
  );
}

function ContributionForm({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const [kind, setKind] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  useEffect(() => {
    setAmount('');
    setNote('');
    setDate(todayISO());
    setKind('in');
  }, [goal]);
  if (!goal) return null;
  const cents = parseAmount(amount);

  async function save() {
    if (!cents) return;
    const v = Math.abs(cents) * (kind === 'in' ? 1 : -1);
    await db.goalContributions.add({ goalId: goal!.id, date, amountCents: v, note: note.trim() || undefined });
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={goal.name}>
      <Segmented
        options={[
          { value: 'in', label: 'Versement' },
          { value: 'out', label: 'Retrait' },
        ]}
        value={kind}
        onChange={setKind}
      />
      <label className="field">
        <span className="label">Montant</span>
        <input
          className="input input-amount"
          inputMode="decimal"
          placeholder="0,00 €"
          value={amount}
          autoFocus
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="label">Date</span>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Note (facultatif)</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button className="btn btn-primary btn-block" disabled={!cents} onClick={save}>
        Enregistrer
      </button>
    </Sheet>
  );
}

function GoalCard({ goal, entries, onOpen }: { goal: Goal; entries: GoalEntry[]; onOpen: () => void }) {
  const p = goalProgress(goal, entries);
  return (
    <button className="budget-row" onClick={onOpen}>
      <div className="budget-head">
        <CatIcon category={goal} />
        <div className="row-main">
          <div className="row-title">{goal.name}</div>
          <div className="row-sub">avant le {formatDate(goal.deadline)}</div>
        </div>
        {p.done ? <DoneBadge>Atteint</DoneBadge> : <span className="status neutral">{Math.round(p.ratio * 100)} %</span>}
      </div>
      <Progress ratio={p.ratio} status={p.done ? 'good' : undefined} label={`Objectif ${goal.name}`} />
      <div className="budget-foot">
        <span>
          {formatEUR(p.saved)} / {formatEUR(goal.targetCents)}
        </span>
        <span style={p.overdue ? { color: 'var(--critical-text)' } : undefined}>
          {p.done
            ? 'Objectif atteint 🎉'
            : p.overdue
              ? `Date dépassée · reste ${formatEUR(p.remaining)}`
              : `${formatEUR(p.perMonth)} / mois`}
        </span>
      </div>
    </button>
  );
}

function GoalDetail({
  goal,
  entries,
  onClose,
  onEdit,
  onContribute,
}: {
  goal: Goal | null;
  entries: GoalEntry[];
  onClose: () => void;
  onEdit: () => void;
  onContribute: () => void;
}) {
  const toast = useToast();
  if (!goal) return null;
  const p = goalProgress(goal, entries);

  async function remove() {
    if (!confirm(`Supprimer l’objectif « ${goal!.name} » ?`)) return;
    await db.transaction('rw', db.goals, db.goalContributions, async () => {
      await db.goalContributions.where('goalId').equals(goal!.id).delete();
      await db.goals.delete(goal!.id);
    });
    toast('Objectif supprimé');
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={goal.name}>
      <div className="card">
        <div className="label">Épargné</div>
        <div className="hero">{formatEUR(p.saved)}</div>
        <div className="small muted">sur {formatEUR(goal.targetCents)} · avant le {formatDate(goal.deadline)}</div>
        <div style={{ marginTop: 12 }}>
          <Progress ratio={p.ratio} status={p.done ? 'good' : undefined} />
        </div>
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="kpi">
            <div className="kpi-label">Reste à épargner</div>
            <div className="kpi-value">{formatEUR(p.remaining)}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{p.overdue ? 'Date dépassée' : `Par mois (${plural(p.monthsLeft, 'mois', 'mois')})`}</div>
            <div className="kpi-value">{p.done ? '—' : formatEUR(p.perMonth)}</div>
          </div>
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={onContribute}>
          <Plus size={18} /> Versement
        </button>
        <button className="btn" onClick={onEdit}>
          <Pencil size={18} /> Modifier
        </button>
      </div>

      <div className="section">
        <div className="section-title">Historique</div>
        {goal.initialCents > 0 && (
          <div className="small muted" style={{ margin: '0 4px 8px' }}>
            Montant de départ : {formatEUR(goal.initialCents)}
          </div>
        )}
        {entries.length === 0 ? (
          <p className="small muted" style={{ margin: '0 4px' }}>
            Aucun versement pour l’instant.
            {goal.keyword ? ` Les virements contenant « ${goal.keyword} » apparaîtront ici après l’import.` : ''}
          </p>
        ) : (
          <div className="list">
            {entries.map((e, i) => (
              <div key={i} className="row plain">
                <div className="row-main">
                  <div className="row-title">{e.label}</div>
                  <div className="row-sub">
                    {formatDate(e.date)} · {e.contributionId ? 'manuel' : 'virement détecté'}
                  </div>
                </div>
                <Amount cents={e.amountCents} />
                {e.contributionId && (
                  <button
                    className="icon-btn"
                    aria-label="Supprimer ce versement"
                    onClick={() => db.goalContributions.delete(e.contributionId!)}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="btn btn-danger btn-block" style={{ marginTop: 20 }} onClick={remove}>
        <Trash2 size={18} /> Supprimer l’objectif
      </button>
    </Sheet>
  );
}

export default function Goals() {
  const goals = useLiveQuery(() => db.goals.toArray(), []);
  const contributions = useLiveQuery(() => db.goalContributions.toArray(), []) ?? ([] as GoalContribution[]);
  const accounts = useAccounts();
  const txs = useKeywordTransactions(goals);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [contributeTo, setContributeTo] = useState<Goal | null>(null);

  const entriesById = useMemo(
    () => new Map((goals ?? []).map((g) => [g.id, goalEntries(g, contributions, txs, accounts)])),
    [goals, contributions, txs, accounts],
  );
  const open = goals?.find((g) => g.id === openId) ?? null;
  const totalPerMonth = (goals ?? []).reduce((s, g) => s + goalProgress(g, entriesById.get(g.id) ?? []).perMonth, 0);

  if (!goals) return null;
  return (
    <>
      {goals.length === 0 ? (
        <Empty icon="🐷" title="Aucun objectif">
          <p>Fixez un montant et une date : l’application calcule combien mettre de côté chaque mois.</p>
          <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
            <Plus size={18} /> Créer un objectif
          </button>
        </Empty>
      ) : (
        <>
          <section className="card">
            <div className="label">À mettre de côté chaque mois</div>
            <div className="hero">{formatEUR(totalPerMonth)}</div>
            <div className="small muted">pour tenir tous vos objectifs à temps</div>
          </section>
          <div className="section">
            <div className="section-title">
              Objectifs
              <button onClick={() => setFormOpen(true)}>
                <Plus size={16} style={{ verticalAlign: -3 }} /> Ajouter
              </button>
            </div>
            <div className="list">
              {goals.map((g) => (
                <GoalCard key={g.id} goal={g} entries={entriesById.get(g.id) ?? []} onOpen={() => setOpenId(g.id)} />
              ))}
            </div>
          </div>
        </>
      )}

      <GoalForm
        goal={editing}
        open={formOpen || !!editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
      {!formOpen && !editing && !contributeTo && (
        <GoalDetail
          goal={open}
          entries={open ? (entriesById.get(open.id) ?? []) : []}
          onClose={() => setOpenId(null)}
          onEdit={() => setEditing(open)}
          onContribute={() => setContributeTo(open)}
        />
      )}
      <ContributionForm goal={contributeTo} onClose={() => setContributeTo(null)} />
    </>
  );
}
