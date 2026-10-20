import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../components/toast';
import { Amount, BudgetBadge, CatIcon, Header, MonthPicker, Progress, Segmented, Sheet } from '../components/ui';
import { db, type Category } from '../db/schema';
import { useBudgetFilter, useCategories, useTransactions } from '../hooks/useData';
import { budgetLines, budgetStatus, perDay } from '../lib/budget';
import { addMonths, currentMonth, daysLeftInMonth, monthBounds, monthRange } from '../lib/dates';
import { centsToInput, formatEUR } from '../lib/format';
import { parseAmount } from '../lib/import/parse';
import { averageSpending, spendingByCategory } from '../lib/stats';
import Goals from './Goals';

function BudgetSheet({
  category,
  average,
  month,
  onClose,
}: {
  category: Category | null;
  average: number;
  month: string;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const toast = useToast();
  useEffect(() => setValue(centsToInput(category?.budgetCents)), [category]);
  if (!category) return null;
  const cents = parseAmount(value);

  async function save(budgetCents: number | null) {
    await db.categories.update(category!.id, { budgetCents });
    toast(budgetCents ? `Plafond ${category!.name} : ${formatEUR(budgetCents)} / mois` : 'Plafond supprimé');
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={`Budget ${category.name}`}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <CatIcon category={category} size="lg" />
      </div>
      <label className="field">
        <span className="label">Plafond mensuel</span>
        <input
          className="input input-amount"
          inputMode="decimal"
          placeholder="0 €"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {average > 0 && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div className="row-main">
            <div className="label">Moyenne des 3 derniers mois</div>
            <div style={{ fontWeight: 700 }}>{formatEUR(average)}</div>
          </div>
          <button className="btn btn-sm" onClick={() => setValue(centsToInput(Math.ceil(average / 1000) * 1000))}>
            Utiliser
          </button>
        </div>
      )}
      <div className="stack">
        <button className="btn btn-primary btn-block" disabled={!cents || cents <= 0} onClick={() => save(Math.abs(cents!))}>
          Enregistrer
        </button>
        <Link className="btn btn-block" to={`/operations?cat=${category.id}&mois=${month}`}>
          Voir les opérations
        </Link>
        {category.budgetCents != null && (
          <button className="btn btn-danger btn-block" onClick={() => save(null)}>
            Supprimer le plafond
          </button>
        )}
      </div>
    </Sheet>
  );
}

function BudgetsTab() {
  const [month, setMonth] = useState(currentMonth());
  const [editing, setEditing] = useState<Category | null>(null);
  const { list, map } = useCategories();
  const filter = useBudgetFilter();
  const histStart = monthBounds(addMonths(month, -3)).start;
  const { end } = monthBounds(month);
  const txs = useTransactions(histStart, end);

  const { lines, unbudgeted, averages, total } = useMemo(() => {
    const kept = (txs ?? []).filter(filter);
    const monthTxs = kept.filter((t) => t.date.startsWith(month));
    const spending = spendingByCategory(monthTxs, map);
    const { average } = averageSpending(kept, monthRange(addMonths(month, -3), addMonths(month, -1)), map);
    const lines = budgetLines(list, spending, month);
    const unbudgeted = list
      .filter((c) => c.kind === 'expense' && !(c.budgetCents && c.budgetCents > 0))
      .map((c) => ({ category: c, spent: spending.get(c.id) ?? 0 }));
    const budget = lines.reduce((s, l) => s + l.budget, 0);
    const spent = lines.reduce((s, l) => s + l.spent, 0);
    return {
      lines,
      unbudgeted,
      averages: average,
      total: { budget, spent, remaining: budget - spent, ratio: budget ? spent / budget : 0 },
    };
  }, [txs, filter, month, map, list]);

  const days = daysLeftInMonth(month);
  const totalPerDay = perDay(total.remaining, month);

  return (
    <>
      <MonthPicker value={month} onChange={setMonth} />

      {lines.length > 0 ? (
        <section className="card">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div className="row-main">
              <div className="label">{total.remaining >= 0 ? 'Reste à dépenser' : 'Dépassement'}</div>
              <div className="hero">
                <Amount cents={Math.abs(total.remaining)} sign={false} />
              </div>
            </div>
            <BudgetBadge status={budgetStatus(total.ratio)} ratio={total.ratio} />
          </div>
          <div style={{ marginTop: 12 }}>
            <Progress ratio={total.ratio} status={budgetStatus(total.ratio)} label="Budget total" />
          </div>
          <div className="budget-foot">
            <span>
              {formatEUR(total.spent)} dépensés sur {formatEUR(total.budget)}
            </span>
            {totalPerDay !== null && days > 0 && <span>{formatEUR(totalPerDay)} / jour</span>}
          </div>
        </section>
      ) : (
        <div className="card">
          <h3>Fixez vos plafonds</h3>
          <p className="small muted" style={{ margin: '4px 4px 0' }}>
            Choisissez une catégorie ci-dessous pour définir un plafond mensuel. Vous serez alerté à 80&nbsp;% et 100&nbsp;%.
          </p>
        </div>
      )}

      {lines.length > 0 && (
        <div className="section">
          <div className="section-title">Plafonds</div>
          <div className="list">
            {lines
              .sort((a, b) => b.ratio - a.ratio)
              .map((l) => (
                <button key={l.category.id} className="budget-row" onClick={() => setEditing(l.category)}>
                  <div className="budget-head">
                    <CatIcon category={l.category} size="sm" />
                    <div className="row-main">
                      <div className="row-title">{l.category.name}</div>
                    </div>
                    <BudgetBadge status={l.status} ratio={l.ratio} />
                  </div>
                  <Progress ratio={l.ratio} status={l.status} label={`Budget ${l.category.name}`} />
                  <div className="budget-foot">
                    <span>
                      {formatEUR(l.spent)} / {formatEUR(l.budget)}
                    </span>
                    <span>
                      {l.remaining >= 0
                        ? `Reste ${formatEUR(l.remaining)}${l.perDay !== null && days > 0 ? ` · ${formatEUR(l.perDay)}/j` : ''}`
                        : `+${formatEUR(-l.remaining)}`}
                    </span>
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}

      {unbudgeted.length > 0 && (
        <div className="section">
          <div className="section-title">Sans plafond</div>
          <div className="list">
            {unbudgeted.map(({ category, spent }) => (
              <button key={category.id} className="row" onClick={() => setEditing(category)}>
                <CatIcon category={category} />
                <div className="row-main">
                  <div className="row-title">{category.name}</div>
                  <div className="row-sub">Définir un plafond</div>
                </div>
                <span className="amount muted">{formatEUR(spent)}</span>
                <ChevronRight className="chevron" size={18} />
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="small muted" style={{ margin: '16px 4px 0' }}>
        Les catégories, leurs icônes et couleurs se modifient dans{' '}
<Link to="/plus/categories">Plus › Catégories</Link>
        .
      </p>

      <BudgetSheet
        category={editing ? (map.get(editing.id) ?? editing) : null}
        average={editing ? (averages.get(editing.id) ?? 0) : 0}
        month={month}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

export default function Budgets({ tab = 'budgets' }: { tab?: 'budgets' | 'goals' }) {
  const navigate = useNavigate();
  return (
    <main className="screen">
      <Header title={tab === 'goals' ? 'Épargne' : 'Budgets'} />
      <Segmented
        options={[
          { value: 'budgets', label: 'Budgets' },
          { value: 'goals', label: 'Objectifs d’épargne' },
        ]}
        value={tab}
        onChange={(v) => navigate(v === 'goals' ? '/budgets/epargne' : '/budgets', { replace: true })}
      />
      {tab === 'goals' ? <Goals /> : <BudgetsTab />}
    </main>
  );
}

