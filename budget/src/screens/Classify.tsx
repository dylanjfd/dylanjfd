import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CategoryPicker } from '../components/transactions';
import { useToast } from '../components/toast';
import { Amount, CatChip, CatIcon, Empty, Header, Notice, Sheet } from '../components/ui';
import { db, type Transaction } from '../db/schema';
import { useCategories } from '../hooks/useData';
import { confirmCategories, getClassifyContext, restoreCategories, setCategories } from '../lib/actions';
import { classify, suggestCategories, type ClassifyContext } from '../lib/classify';
import { formatDate, plural } from '../lib/format';
import { prettyMerchant } from '../lib/text';

/** Opérations du même commerçant (et du même sens), classées d'un seul geste. */
interface Group {
  key: string;
  title: string;
  txs: Transaction[];
  total: number;
  /** Catégorie devinée par l'app, ou null si l'opération est à classer. */
  guess: number | null;
  reason?: string;
  suggestions: number[];
}

const PAGE = 25;

function groupsOf(txs: Transaction[], ctx: ClassifyContext, guessed: boolean): Group[] {
  const byKey = new Map<string, Transaction[]>();
  for (const t of txs) {
    const key = `${t.amountCents > 0 ? '+' : '-'}${t.merchant || t.labelNorm}${guessed ? `|${t.categoryId}` : ''}`;
    byKey.set(key, [...(byKey.get(key) ?? []), t]);
  }
  return [...byKey]
    .map(([key, list]) => {
      list.sort((a, b) => b.date.localeCompare(a.date));
      const first = list[0];
      return {
        key,
        title: prettyMerchant(first.merchant) || first.label,
        txs: list,
        total: list.reduce((s, t) => s + t.amountCents, 0),
        guess: guessed ? first.categoryId : null,
        reason: guessed ? classify(first, ctx).reason : undefined,
        suggestions: suggestCategories(first, ctx, 4),
      };
    })
    .sort((a, b) => b.txs.length - a.txs.length || Math.abs(b.total) - Math.abs(a.total));
}

const snapshot = (txs: Transaction[]) => txs.map(({ id, categoryId, categorySource }) => ({ id, categoryId, categorySource }));

export default function Classify() {
  const { list, map } = useCategories();
  const toast = useToast();
  const [picking, setPicking] = useState<Group | null>(null);
  const [shown, setShown] = useState({ todo: PAGE, guessed: PAGE });

  const data = useLiveQuery(async () => {
    const [txs, total, ctx] = await Promise.all([
      db.transactions.filter((t) => t.categoryId == null || t.categorySource === 'auto').toArray(),
      db.transactions.count(),
      getClassifyContext(),
    ]);
    return { txs, total, ctx };
  }, []);

  const { todo, guessed, todoCount, guessedCount } = useMemo(() => {
    if (!data) return { todo: [], guessed: [], todoCount: 0, guessedCount: 0 };
    const open = data.txs.filter((t) => t.categoryId == null);
    const auto = data.txs.filter((t) => t.categoryId != null);
    return {
      todo: groupsOf(open, data.ctx, false),
      guessed: groupsOf(auto, data.ctx, true),
      todoCount: open.length,
      guessedCount: auto.length,
    };
  }, [data]);

  async function apply(group: Group, categoryId: number) {
    const before = snapshot(group.txs);
    const others = await setCategories(
      group.txs.map((t) => t.id),
      categoryId,
    );
    const name = map.get(categoryId)?.name ?? '';
    toast(
      `${group.txs.length > 1 ? `${group.txs.length} opérations classées` : 'Classée'} dans ${name}` +
        (others ? ` · ${plural(others, 'opération semblable aussi', 'opérations semblables aussi')}` : ''),
      { label: 'Annuler', run: () => void restoreCategories(before) },
    );
  }

  async function confirm(groups: Group[]) {
    const txs = groups.flatMap((g) => g.txs);
    const before = snapshot(txs);
    await confirmCategories(txs.map((t) => t.id));
    toast(txs.length > 1 ? `${txs.length} classements validés` : 'Classement validé', {
      label: 'Annuler',
      run: () => void restoreCategories(before),
    });
  }

  if (!data) return <main className="screen" />;
  const classified = data.total - todoCount;
  const ratio = data.total ? Math.round((classified / data.total) * 100) : 100;

  function card(g: Group) {
    const guess = g.guess != null ? map.get(g.guess) : undefined;
    const last = g.txs[0];
    return (
      <div key={g.key} className="card classify-group">
        <div className="classify-head">
          <CatIcon category={guess} />
          <div className="row-main">
            <div className="row-title">{g.title}</div>
            <div className="row-sub">
              {g.txs.length > 1 ? `${g.txs.length} opérations · ${formatDate(last.date)}` : formatDate(last.date)}
            </div>
          </div>
          <div className="row-end">
            <Amount cents={g.total} />
          </div>
        </div>
        <div className="classify-label small muted">{last.label}</div>
        {guess && (
          <div className="small classify-reason">
            <Sparkles size={14} />
            <span>
              Devinée : <strong>{guess.name}</strong>
              {g.reason ? `, ${g.reason}` : ''}
            </span>
          </div>
        )}
        <div className="classify-actions">
          {guess && (
            <button className="btn btn-sm btn-primary" onClick={() => void confirm([g])}>
              <Check size={16} /> C’est bien ça
            </button>
          )}
          {g.suggestions
            .filter((id) => id !== g.guess)
            .slice(0, guess ? 2 : 4)
            .map((id) => (
              <CatChip key={id} category={map.get(id)} onClick={() => void apply(g, id)} />
            ))}
          <button className="btn btn-sm" onClick={() => setPicking(g)}>
            Autre…
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="screen">
      <Header title="Classer" back="/" />

      {todo.length === 0 && guessed.length === 0 ? (
        <Empty icon="🎉" title="Tout est classé">
          <p className="muted">Chaque nouvelle opération importée sera classée automatiquement.</p>
        </Empty>
      ) : (
        <Notice tone="info" icon={<Sparkles size={20} />} title={`${ratio} % de vos opérations sont classées`}>
          <div className="small muted">
            L’app classe toute seule ce qu’elle reconnaît. Pour le reste, choisissez une catégorie : votre choix
            s’applique aux opérations semblables, et à celles des prochains imports.
          </div>
        </Notice>
      )}

      {todo.length > 0 && (
        <div className="section">
          <div className="section-title">À classer · {todoCount}</div>
          {todo.slice(0, shown.todo).map(card)}
          {todo.length > shown.todo && (
            <button className="btn btn-block btn-sm" style={{ marginTop: 12 }} onClick={() => setShown((s) => ({ ...s, todo: s.todo + PAGE }))}>
              Afficher plus
            </button>
          )}
        </div>
      )}

      {guessed.length > 0 && (
        <div className="section">
          <div className="section-title">
            <span>Devinées par l’app · {guessedCount}</span>
            <button onClick={() => void confirm(guessed)}>Tout valider</button>
          </div>
          <p className="small muted" style={{ margin: '0 4px 10px' }}>
            Elles comptent déjà dans vos budgets. Vérifiez-les quand vous avez un moment.
          </p>
          {guessed.slice(0, shown.guessed).map(card)}
          {guessed.length > shown.guessed && (
            <button
              className="btn btn-block btn-sm"
              style={{ marginTop: 12 }}
              onClick={() => setShown((s) => ({ ...s, guessed: s.guessed + PAGE }))}
            >
              Afficher plus
            </button>
          )}
        </div>
      )}

      <Sheet open={!!picking} onClose={() => setPicking(null)} title={picking?.title ?? ''}>
        {picking && (
          <>
            <p className="small muted" style={{ margin: '0 4px 12px' }}>
              {picking.txs.length > 1 ? `${picking.txs.length} opérations · ` : ''}
              {picking.txs[0].label}
            </p>
            <CategoryPicker
              categories={list}
              value={picking.guess}
              sign={picking.total}
              onPick={(id) => {
                const g = picking;
                setPicking(null);
                if (id != null) void apply(g, id);
              }}
            />
          </>
        )}
      </Sheet>
    </main>
  );
}
