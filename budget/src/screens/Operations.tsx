import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AddTransactionSheet, TransactionRow, TransactionSheet } from '../components/transactions';
import { Empty, Header, MonthPicker } from '../components/ui';
import { db, type Transaction } from '../db/schema';
import { useAccounts, useBudgetFilter, useCategories } from '../hooks/useData';
import { currentMonth, monthBounds } from '../lib/dates';
import { formatDayHeading, formatEUR, plural } from '../lib/format';
import { parseAmount } from '../lib/import/parse';
import { totals } from '../lib/stats';
import { normalizeLabel } from '../lib/text';

const MAX_RESULTS = 400;

export default function Operations() {
  const [params, setParams] = useSearchParams();
  const month = params.get('mois') ?? currentMonth();
  const cat = params.get('cat');
  const [query, setQuery] = useState('');
  const [openTx, setOpenTx] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const { list, map } = useCategories();
  const accounts = useAccounts();
  const filter = useBudgetFilter();
  const [account, setAccount] = useState<number | 'all'>('all');

  const q = query.trim();
  const searching = q.length >= 2;
  const allPeriods = searching || cat === 'none';

  const txs = useLiveQuery(async () => {
    let coll;
    if (allPeriods) {
      const n = normalizeLabel(q);
      const amount = parseAmount(q);
      coll = db.transactions.filter(
        (t) =>
          (!searching ||
            t.labelNorm.includes(n) ||
            (!!t.note && normalizeLabel(t.note).includes(n)) ||
            (amount !== null && Math.abs(t.amountCents) === Math.abs(amount))) &&
          (cat !== 'none' || t.categoryId == null),
      );
    } else {
      const { start, end } = monthBounds(month);
      coll = db.transactions.where('date').between(start, end, true, true);
    }
    return coll.reverse().sortBy('date');
  }, [month, q, searching, allPeriods, cat]);

  const filtered = useMemo(() => {
    let out = txs ?? [];
    if (cat === 'none') out = out.filter((t) => t.categoryId == null);
    else if (cat) out = out.filter((t) => t.categoryId === Number(cat));
    if (account !== 'all') out = out.filter((t) => t.accountId === account);
    return out;
  }, [txs, cat, account]);

  const groups = useMemo(() => {
    const g: { date: string; items: Transaction[] }[] = [];
    for (const t of filtered.slice(0, MAX_RESULTS)) {
      const last = g[g.length - 1];
      if (last && last.date === t.date) last.items.push(t);
      else g.push({ date: t.date, items: [t] });
    }
    return g;
  }, [filtered]);

  const sum = useMemo(() => totals(filtered.filter(filter), map), [filtered, filter, map]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <main className="screen">
      <Header
        title="Opérations"
        actions={
          <button className="icon-btn filled" aria-label="Ajouter une opération" onClick={() => setAdding(true)}>
            <Plus size={24} />
          </button>
        }
      />

      <div className="search">
        <Search size={18} />
        <input
          className="input"
          type="search"
          placeholder="Rechercher un libellé, un montant…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Rechercher"
        />
      </div>

      <div className="chips" role="toolbar" aria-label="Filtrer par catégorie">
        <button className={`chip${!cat ? ' active' : ''}`} onClick={() => setParam('cat', null)}>
          Toutes
        </button>
        <button className={`chip${cat === 'none' ? ' active' : ''}`} onClick={() => setParam('cat', 'none')}>
          ❓ À classer
        </button>
        {list.map((c) => (
          <button
            key={c.id}
            className={`chip${cat === String(c.id) ? ' active' : ''}`}
            onClick={() => setParam('cat', cat === String(c.id) ? null : String(c.id))}
          >
            {c.icon} {c.name}
          </button>
        ))}
      </div>

      {accounts.length > 1 && (
        <div className="chips" role="toolbar" aria-label="Filtrer par compte">
          <button className={`chip${account === 'all' ? ' active' : ''}`} onClick={() => setAccount('all')}>
            Tous les comptes
          </button>
          {accounts.map((a) => (
            <button key={a.id} className={`chip${account === a.id ? ' active' : ''}`} onClick={() => setAccount(a.id)}>
              {a.name}
            </button>
          ))}
        </div>
      )}

      {allPeriods ? (
        <div className="small muted" style={{ margin: '0 4px 4px' }}>
          {searching ? 'Résultats sur toutes les périodes' : 'Toutes les périodes'}
          {cat === 'none' && !searching && ' · touchez une opération pour la classer'}
        </div>
      ) : (
        <MonthPicker value={month} onChange={(m) => setParam('mois', m)} />
      )}

      {txs && filtered.length > 0 && (
        <div className="small muted" style={{ margin: '0 4px' }}>
          {plural(filtered.length, 'opération', 'opérations')} · dépenses {formatEUR(sum.expenses)} · revenus{' '}
          {formatEUR(sum.income)}
        </div>
      )}

      {txs && filtered.length === 0 && (
        <Empty icon={searching ? '🔍' : '🗓️'} title={searching ? 'Aucun résultat' : 'Aucune opération'}>
          <p>{searching ? 'Essaie un autre mot ou un montant (ex. 12,50).' : 'Rien sur cette période avec ces filtres.'}</p>
          {(cat || searching) && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setQuery('');
                setParam('cat', null);
              }}
            >
              <X size={16} /> Effacer les filtres
            </button>
          )}
        </Empty>
      )}

      {groups.map((g) => (
        <section key={g.date}>
          <h2 className="day-heading">
            <span>{formatDayHeading(g.date)}</span>
          </h2>
          <div className="list">
            {g.items.map((t) => (
              <TransactionRow
                key={t.id}
                tx={t}
                category={t.categoryId != null ? map.get(t.categoryId) : undefined}
                accountName={accounts.length > 1 ? accounts.find((a) => a.id === t.accountId)?.name : undefined}
                onClick={() => setOpenTx(t.id)}
              />
            ))}
          </div>
        </section>
      ))}
      {filtered.length > MAX_RESULTS && (
        <p className="small muted" style={{ textAlign: 'center', marginTop: 12 }}>
          {MAX_RESULTS} premières opérations affichées. Affinez la recherche pour voir les autres.
        </p>
      )}

      <TransactionSheet txId={openTx} onClose={() => setOpenTx(null)} />
      <AddTransactionSheet open={adding} onClose={() => setAdding(false)} />
    </main>
  );
}
