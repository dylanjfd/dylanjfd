import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../components/toast';
import { CatIcon, Header, Segmented, Sheet } from '../components/ui';
import { db, type Category, type CategoryKind, type ColorKey } from '../db/schema';
import { useCategories } from '../hooks/useData';
import { deleteCategory } from '../lib/actions';
import { COLOR_KEYS, colorVar, PALETTE } from '../lib/palette';

const ICONS = [
  '🏠', '🛒', '🚆', '🚗', '⛽', '🍽️', '☕', '🍔', '🎉', '🎬', '🎮', '📺', '📱', '💡', '💊', '🩺', '🛍️', '👕',
  '💄', '🎁', '✈️', '🏖️', '🐶', '👶', '🎓', '📚', '🏋️', '💇', '🧾', '🏦', '💶', '💼', '🐷', '📦', '🔁', '❤️',
];

const KINDS: { value: CategoryKind; label: string; help: string }[] = [
  { value: 'expense', label: 'Dépense', help: 'Comptée dans les dépenses et les budgets.' },
  { value: 'income', label: 'Revenu', help: 'Comptée dans les revenus.' },
  { value: 'savings', label: 'Épargne', help: 'Argent mis de côté : ni dépense ni revenu.' },
  { value: 'transfer', label: 'Virement', help: 'Virement entre tes comptes : ignoré dans les totaux.' },
];

function CategoryForm({ category, open, onClose }: { category: Category | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { list } = useCategories();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📦');
  const [color, setColor] = useState<ColorKey>('blue');
  const [kind, setKind] = useState<CategoryKind>('expense');

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setIcon(category?.icon ?? '📦');
    setColor(category?.color ?? 'blue');
    setKind(category?.kind ?? 'expense');
  }, [open, category]);

  async function save() {
    const data = { name: name.trim(), icon, color, kind };
    if (category) {
      await db.categories.update(category.id, { ...data, budgetCents: kind === 'expense' ? category.budgetCents : null });
    } else {
      const order = Math.max(0, ...list.map((c) => c.order)) + 1;
      await db.categories.add({ ...data, budgetCents: null, order });
    }
    toast(category ? 'Catégorie modifiée' : 'Catégorie créée');
    onClose();
  }

  async function remove() {
    if (!category) return;
    const n = await db.transactions.where('categoryId').equals(category.id).count();
    const msg =
      n > 0
        ? `Supprimer « ${category.name} » ? ${n} opération(s) repasseront « à classer » et ses règles seront supprimées.`
        : `Supprimer « ${category.name} » ?`;
    if (!confirm(msg)) return;
    await deleteCategory(category.id);
    toast('Catégorie supprimée');
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={category ? 'Modifier la catégorie' : 'Nouvelle catégorie'}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <CatIcon category={{ icon, color }} size="lg" />
      </div>
      <label className="field">
        <span className="label">Nom</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Animaux" />
      </label>
      <div className="field">
        <span className="label" style={{ display: 'block', margin: '0 4px 6px' }}>
          Type
        </span>
        <Segmented options={KINDS.map(({ value, label }) => ({ value, label }))} value={kind} onChange={setKind} />
        <p className="small muted" style={{ margin: '-4px 4px 0' }}>
          {KINDS.find((k) => k.value === kind)?.help}
        </p>
      </div>
      <div className="field">
        <span className="label" style={{ display: 'block', margin: '0 4px 6px' }}>
          Icône
        </span>
        <div className="option-grid">
          {ICONS.map((i) => (
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
            <button
              key={c}
              type="button"
              className={c === color ? 'selected' : ''}
              onClick={() => setColor(c)}
              aria-label={PALETTE[c].label}
            >
              <span className="color-dot" style={{ background: colorVar(c) }} />
            </button>
          ))}
        </div>
      </div>
      <div className="stack">
        <button className="btn btn-primary btn-block" disabled={!name.trim()} onClick={save}>
          Enregistrer
        </button>
        {category && (
          <button className="btn btn-danger btn-block" onClick={remove}>
            <Trash2 size={18} /> Supprimer
          </button>
        )}
      </div>
    </Sheet>
  );
}

export default function Categories() {
  const { list } = useCategories();
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);

  async function move(index: number, delta: number) {
    const other = list[index + delta];
    const cur = list[index];
    if (!other) return;
    await db.transaction('rw', db.categories, async () => {
      await db.categories.update(cur.id, { order: other.order });
      await db.categories.update(other.id, { order: cur.order });
    });
  }

  const kindLabel = (k: CategoryKind) => KINDS.find((x) => x.value === k)?.label;

  return (
    <main className="screen">
      <Header
        title="Catégories"
        back="/plus"
        actions={
          <button className="icon-btn filled" aria-label="Nouvelle catégorie" onClick={() => setCreating(true)}>
            <Plus size={24} />
          </button>
        }
      />
      <div className="list">
        {list.map((c, i) => (
          <div key={c.id} className="row">
            <button
              className="row"
              style={{ padding: 0, minHeight: 0, flex: 1 }}
              onClick={() => setEditing(c)}
              aria-label={`Modifier ${c.name}`}
            >
              <CatIcon category={c} />
              <div className="row-main">
                <div className="row-title">{c.name}</div>
                <div className="row-sub">{kindLabel(c.kind)}</div>
              </div>
            </button>
            <button className="icon-btn" aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={18} />
            </button>
            <button className="icon-btn" aria-label="Descendre" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown size={18} />
            </button>
          </div>
        ))}
      </div>
      <CategoryForm
        category={editing}
        open={creating || !!editing}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
      />
    </main>
  );
}
