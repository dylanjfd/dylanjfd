import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CategoryPicker } from '../components/transactions';
import { useToast } from '../components/toast';
import { CatChip, Header, Sheet } from '../components/ui';
import { db, type Rule } from '../db/schema';
import { useCategories } from '../hooks/useData';
import { countRuleMatches, reapplyRules } from '../lib/actions';
import { plural } from '../lib/format';
import { normalizeLabel } from '../lib/text';

function RuleForm({ rule, open, onClose }: { rule: Rule | null; open: boolean; onClose: () => void }) {
  const { list } = useCategories();
  const toast = useToast();
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    setPattern(rule?.pattern ?? '');
    setCategoryId(rule?.categoryId ?? null);
  }, [open, rule]);
  const norm = normalizeLabel(pattern);
  const matches = useLiveQuery(
    () => (norm && categoryId != null ? countRuleMatches(norm, categoryId) : 0),
    [norm, categoryId],
  );

  async function save() {
    if (!norm || categoryId == null) return;
    if (rule) await db.rules.update(rule.id, { pattern: norm, categoryId, source: 'user' });
    else await db.rules.add({ pattern: norm, categoryId, source: 'user' });
    const n = await reapplyRules();
    toast(n ? `Règle enregistrée · ${plural(n, 'opération reclassée', 'opérations reclassées')}` : 'Règle enregistrée');
    onClose();
  }

  async function remove() {
    if (!rule) return;
    await db.rules.delete(rule.id);
    toast('Règle supprimée');
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={rule ? 'Modifier la règle' : 'Nouvelle règle'}>
      <label className="field">
        <span className="label">Si le libellé contient</span>
        <input className="input" value={pattern} placeholder="Ex. BOULANGERIE MARIE" onChange={(e) => setPattern(e.target.value)} />
      </label>
      <p className="small muted" style={{ margin: '-6px 4px 14px' }}>
        Mots entiers, sans tenir compte des majuscules ni des accents.
        {matches ? ` ${plural(matches, 'opération existante sera reclassée', 'opérations existantes seront reclassées')}.` : ''}
      </p>
      <div className="field">
        <span className="label" style={{ display: 'block', margin: '0 4px 6px' }}>
          Classer dans
        </span>
        <CategoryPicker categories={list} value={categoryId} onPick={setCategoryId} />
      </div>
      <div className="stack">
        <button className="btn btn-primary btn-block" disabled={!norm || categoryId == null} onClick={save}>
          Enregistrer
        </button>
        {rule && (
          <button className="btn btn-danger btn-block" onClick={remove}>
            <Trash2 size={18} /> Supprimer la règle
          </button>
        )}
      </div>
    </Sheet>
  );
}

export default function Rules() {
  const rules = useLiveQuery(() => db.rules.toArray(), []);
  const { map } = useCategories();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => {
    const n = normalizeLabel(q);
    return (rules ?? [])
      .filter((r) => !n || r.pattern.includes(n) || normalizeLabel(map.get(r.categoryId)?.name ?? '').includes(n))
      .sort(
        (a, b) =>
          (a.source === 'user' ? 0 : 1) - (b.source === 'user' ? 0 : 1) ||
          (map.get(a.categoryId)?.order ?? 99) - (map.get(b.categoryId)?.order ?? 99) ||
          a.pattern.localeCompare(b.pattern),
      );
  }, [rules, q, map]);

  async function reapply() {
    setBusy(true);
    const n = await reapplyRules();
    setBusy(false);
    toast(n ? plural(n, 'opération reclassée', 'opérations reclassées') : 'Tout est déjà à jour');
  }

  return (
    <main className="screen">
      <Header
        title="Règles"
        back="/plus"
        actions={
          <button className="icon-btn filled" aria-label="Nouvelle règle" onClick={() => setCreating(true)}>
            <Plus size={24} />
          </button>
        }
      />
      <p className="small muted" style={{ margin: '0 4px 12px' }}>
        Chaque opération importée est classée selon le mot-clé le plus précis trouvé dans son libellé. Vos règles passent
        avant tout ; sans mot-clé, l’app s’appuie sur vos choix passés pour le même commerçant, puis devine (virement
        reçu, mot proche…). Les catégories choisies à la main ne sont jamais modifiées.
      </p>
      <div className="search">
        <Search size={18} />
        <input
          className="input"
          type="search"
          placeholder="Rechercher un mot-clé ou une catégorie"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Rechercher une règle"
        />
      </div>
      <button className="btn btn-block btn-sm" style={{ marginBottom: 12 }} disabled={busy} onClick={reapply}>
        <RotateCcw size={16} /> Réappliquer les règles
      </button>
      <div className="list">
        {sorted.map((r) => (
          <button key={r.id} className="row plain" onClick={() => setEditing(r)}>
            <div className="row-main">
              <div className="row-title">{r.pattern}</div>
              {r.source === 'user' && <div className="row-sub">Règle personnelle</div>}
            </div>
            <CatChip category={map.get(r.categoryId)} />
          </button>
        ))}
      </div>
      <RuleForm
        rule={editing}
        open={creating || !!editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </main>
  );
}
