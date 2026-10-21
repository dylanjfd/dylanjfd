import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2, WandSparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db, type Category, type CategorySource, type Transaction } from '../db/schema';
import { useAccounts, useCategories } from '../hooks/useData';
import {
  confirmCategories,
  countRuleMatches,
  createRule,
  draftTransaction,
  getClassifyContext,
  setTransactionCategory,
} from '../lib/actions';
import { todayISO } from '../lib/dates';
import { formatDate, formatEUR, plural } from '../lib/format';
import { parseAmount } from '../lib/import/parse';
import { normalizeLabel, prettyMerchant } from '../lib/text';
import { useToast } from './toast';
import { Amount, CatChip, CatIcon, Segmented, Sheet } from './ui';

/** Grille de catégories ; celles qui correspondent au sens de l'opération d'abord. */
export function CategoryPicker({
  categories,
  value,
  onPick,
  sign = -1,
  allowNone,
}: {
  categories: Category[];
  value: number | null | undefined;
  onPick: (id: number | null) => void;
  sign?: number;
  allowNone?: boolean;
}) {
  const rank = (c: Category) => {
    if (sign < 0) return c.kind === 'expense' ? 0 : c.kind === 'savings' ? 1 : 2;
    return c.kind === 'income' ? 0 : c.kind === 'expense' ? 1 : 2;
  };
  const sorted = [...categories].sort((a, b) => rank(a) - rank(b) || a.order - b.order);
  return (
    <div className="cat-grid">
      {sorted.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`cat-tile${c.id === value ? ' selected' : ''}`}
          aria-pressed={c.id === value}
          onClick={() => onPick(c.id)}
        >
          <CatIcon category={c} />
          <span>{c.name}</span>
        </button>
      ))}
      {allowNone && (
        <button type="button" className={`cat-tile${value == null ? ' selected' : ''}`} onClick={() => onPick(null)}>
          <CatIcon />
          <span>À classer</span>
        </button>
      )}
    </div>
  );
}

/** « Toujours classer ce libellé ici ? » après une correction manuelle. */
export function RulePrompt({
  merchant,
  category,
  onDone,
}: {
  merchant: string;
  category: Category;
  onDone: (result: { pattern: string; updated: number } | null) => void;
}) {
  const [pattern, setPattern] = useState(merchant);
  const [apply, setApply] = useState(true);
  const toast = useToast();
  const count = useLiveQuery(() => countRuleMatches(pattern, category.id), [pattern, category.id]) ?? 0;
  const norm = normalizeLabel(pattern);

  async function create() {
    const updated = await createRule(norm, category.id, apply);
    toast(
      updated > 0
        ? `Règle créée · ${plural(updated, 'opération reclassée', 'opérations reclassées')}`
        : 'Règle créée pour les prochains imports',
    );
    onDone({ pattern: norm, updated });
  }

  return (
    <div className="notice info" style={{ marginTop: 16 }}>
      <WandSparkles size={20} />
      <div className="row-main">
        <div className="row-title">
          Toujours classer « {prettyMerchant(norm) || '…'} » dans {category.name} ?
        </div>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="label">Mot-clé recherché dans le libellé</span>
          <input className="input" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </label>
        {count > 0 && (
          <label className="check">
            <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
            <span>Reclasser aussi {plural(count, 'opération existante', 'opérations existantes')}</span>
          </label>
        )}
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-sm" onClick={() => onDone(null)}>
            Non merci
          </button>
          <button className="btn btn-primary btn-sm" disabled={!norm} onClick={create}>
            Créer la règle
          </button>
        </div>
      </div>
    </div>
  );
}

export function TransactionRow({
  tx,
  category,
  accountName,
  showDate,
  onClick,
}: {
  tx: Transaction;
  category?: Category;
  accountName?: string;
  showDate?: boolean;
  onClick?: () => void;
}) {
  const sub = [
    showDate ? formatDate(tx.date) : null,
    category?.name ?? 'À classer',
    accountName,
    tx.note ? '📝' : null,
  ].filter(Boolean);
  return (
    <button className="row" onClick={onClick}>
      <CatIcon category={category} />
      <div className="row-main">
        <div className="row-title">{prettyMerchant(tx.merchant) || tx.label}</div>
        <div className="row-sub">{sub.join(' · ')}</div>
      </div>
      <div className="row-end">
        <Amount cents={tx.amountCents} />
      </div>
    </button>
  );
}

const SOURCE_TEXT: Record<CategorySource, string> = {
  manual: 'choisie à la main',
  rule: 'classement automatique',
  auto: 'devinée par l’app',
  none: '',
};

/** Détail d'une opération : catégorie, note, suppression. */
export function TransactionSheet({ txId, onClose }: { txId: number | null; onClose: () => void }) {
  const tx = useLiveQuery(() => (txId == null ? undefined : db.transactions.get(txId)), [txId]);
  const { list, map } = useCategories();
  const accounts = useAccounts();
  const batch = useLiveQuery(() => (tx?.batchId ? db.importBatches.get(tx.batchId) : undefined), [tx?.batchId]);
  const [picking, setPicking] = useState(false);
  const [suggest, setSuggest] = useState<Category | null>(null);
  const [note, setNote] = useState('');
  const toast = useToast();

  useEffect(() => {
    setPicking(false);
    setSuggest(null);
  }, [txId]);
  useEffect(() => {
    setNote(tx?.note ?? '');
  }, [tx?.id, tx?.note]);

  if (txId == null) return null;
  const category = tx?.categoryId != null ? map.get(tx.categoryId) : undefined;

  async function pick(id: number | null) {
    if (!tx) return;
    const others = await setTransactionCategory(tx.id, id);
    setPicking(false);
    if (others > 0) toast(`${plural(others, 'opération semblable classée', 'opérations semblables classées')} aussi`);
    if (id == null || !tx.merchant) return setSuggest(null);
    const pattern = normalizeLabel(tx.merchant);
    const existing = await db.rules.where('pattern').equals(pattern).toArray();
    setSuggest(existing.some((r) => r.categoryId === id) ? null : map.get(id) ?? null);
  }

  async function remove() {
    if (!tx || !confirm('Supprimer cette opération ?')) return;
    const copy = { ...tx };
    await db.transactions.delete(tx.id);
    onClose();
    toast('Opération supprimée', { label: 'Annuler', run: () => void db.transactions.add(copy) });
  }

  return (
    <Sheet open={txId != null} onClose={onClose} title="Opération">
      {tx && (
        <>
          <div style={{ textAlign: 'center', padding: '4px 0 16px' }}>
            <CatIcon category={category} size="lg" />
            <div className="hero" style={{ marginTop: 10 }}>
              <Amount cents={tx.amountCents} />
            </div>
            <div style={{ fontWeight: 650, marginTop: 4 }}>{prettyMerchant(tx.merchant) || tx.label}</div>
            <div className="muted small">{formatDate(tx.date)}</div>
          </div>

          <div className="card">
            <div className="label" style={{ marginBottom: 8 }}>
              Catégorie
            </div>
            {picking ? (
              <CategoryPicker categories={list} value={tx.categoryId} onPick={pick} sign={tx.amountCents} allowNone />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CatChip category={category} />
                <span className="muted small" style={{ flex: 1 }}>
                  {SOURCE_TEXT[tx.categorySource]}
                </span>
                {tx.categorySource === 'auto' && (
                  <button className="btn btn-sm" onClick={() => void confirmCategories([tx.id])}>
                    Valider
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => setPicking(true)}>
                  Modifier
                </button>
              </div>
            )}
          </div>

          {suggest && <RulePrompt merchant={tx.merchant} category={suggest} onDone={() => setSuggest(null)} />}

          <div className="card">
            <div className="kv">
              <span>Libellé</span>
              <span>{tx.label}</span>
            </div>
            <div className="kv">
              <span>Date</span>
              <span>{formatDate(tx.date)}</span>
            </div>
            {accounts.length > 1 && (
              <div className="kv">
                <span>Compte</span>
                <span>{accounts.find((a) => a.id === tx.accountId)?.name}</span>
              </div>
            )}
            <div className="kv">
              <span>Origine</span>
              <span>{batch ? batch.fileName : 'Saisie manuelle'}</span>
            </div>
          </div>

          <label className="field" style={{ marginTop: 12 }}>
            <span className="label">Note</span>
            <textarea
              className="textarea"
              value={note}
              placeholder="Ajouter une note…"
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== (tx.note ?? '') && db.transactions.update(tx.id, { note: note.trim() || undefined })}
            />
          </label>

          <button className="btn btn-danger btn-block" onClick={remove}>
            <Trash2 size={18} /> Supprimer l’opération
          </button>
        </>
      )}
    </Sheet>
  );
}

/** Saisie manuelle (espèces, opération oubliée). */
export function AddTransactionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { list } = useCategories();
  const accounts = useAccounts();
  const toast = useToast();
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setLabel('');
    setDate(todayISO());
    setCategoryId(null);
  }, [open]);

  const cents = parseAmount(amount);
  const valid = cents !== null && cents > 0 && label.trim() !== '' && !!date;

  async function save() {
    if (!valid) return;
    const signed = type === 'expense' ? -Math.abs(cents!) : Math.abs(cents!);
    const draft = draftTransaction({ date, amountCents: signed, label: label.trim() }, await getClassifyContext());
    const chosen = categoryId ?? draft.categoryId;
    await db.transactions.add({
      ...draft,
      accountId: accountId ?? accounts[0]?.id ?? 1,
      categoryId: chosen,
      categorySource: categoryId != null ? 'manual' : draft.categorySource,
    });
    toast(`${formatEUR(signed, { sign: true })} ajouté`);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Nouvelle opération">
      <Segmented
        options={[
          { value: 'expense', label: 'Dépense' },
          { value: 'income', label: 'Revenu' },
        ]}
        value={type}
        onChange={setType}
      />
      <label className="field">
        <span className="label">Montant</span>
        <input
          className="input input-amount"
          inputMode="decimal"
          placeholder="0,00 €"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
      </label>
      <label className="field">
        <span className="label">Libellé</span>
        <input className="input" value={label} placeholder="Ex. Marché, espèces" onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Date</span>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {accounts.length > 1 && (
        <label className="field">
          <span className="label">Compte</span>
          <select className="select" value={accountId ?? accounts[0]?.id} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field">
        <span className="label" style={{ display: 'block', margin: '0 4px 6px' }}>
          Catégorie {categoryId == null && <span className="muted">(automatique si vide)</span>}
        </span>
        <CategoryPicker
          categories={list}
          value={categoryId}
          onPick={(id) => setCategoryId(id === categoryId ? null : id)}
          sign={type === 'expense' ? -1 : 1}
        />
      </div>
      <button className="btn btn-primary btn-block" disabled={!valid} onClick={save}>
        Ajouter
      </button>
    </Sheet>
  );
}
