import { useLiveQuery } from 'dexie-react-hooks';
import { CircleCheck, FileUp, OctagonAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CategoryPicker, RulePrompt } from '../../components/transactions';
import { useToast } from '../../components/toast';
import { Amount, BudgetBadge, CatChip, CatIcon, Notice, Progress, Segmented, Sheet } from '../../components/ui';
import { db, type Category, type CsvMapping } from '../../db/schema';
import { useAccounts, useBudgetFilter, useCategories, useMonthTransactions } from '../../hooks/useData';
import { commitImport, undoImport } from '../../lib/actions';
import { budgetLines } from '../../lib/budget';
import { currentMonth, todayISO } from '../../lib/dates';
import { formatDate, formatEUR, plural } from '../../lib/format';
import { applyMapping } from '../../lib/import/csv';
import { matchesPattern } from '../../lib/rules';
import { spendingByCategory } from '../../lib/stats';
import { prettyMerchant } from '../../lib/text';
import { MappingStep } from './MappingStep';
import { buildPreview, defaultProfileName, findProfile, ImportError, readStatement, type PreviewRow, type Source } from './model';

type Step = 'pick' | 'mapping' | 'preview' | 'done';

interface PendingProfile {
  id?: number;
  name: string;
  mapping: CsvMapping;
  remember: boolean;
}

interface DoneInfo {
  batchId: number;
  count: number;
  duplicates: number;
  from: string;
  to: string;
}

function Steps({ step }: { step: Step }) {
  const order: Step[] = ['pick', 'mapping', 'preview', 'done'];
  const idx = order.indexOf(step);
  return (
    <div className="steps" aria-hidden="true">
      {order.map((s, i) => (
        <span key={s} className={i <= idx ? 'done' : ''} />
      ))}
    </div>
  );
}

function PickStep({ onFile, error, busy }: { onFile: (f: File) => void; error: string | null; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const profiles = useLiveQuery(() => db.importProfiles.orderBy('id').toArray(), []);
  return (
    <>
      <button className="drop" onClick={() => input.current?.click()} disabled={busy}>
        <FileUp size={40} />
        <strong>{busy ? 'Lecture du fichier…' : 'Choisir un relevé'}</strong>
        <span className="small muted">Fichier CSV ou OFX exporté depuis l’espace client de votre banque</span>
      </button>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      {error && <Notice tone="over" icon={<OctagonAlert size={20} />} title={error} />}
      <Notice tone="info" icon={<ShieldCheck size={20} />} title="Le fichier est lu sur ce téléphone">
        <div className="small muted">Rien n’est envoyé sur Internet. Les doublons sont détectés si vous réimportez une période.</div>
      </Notice>
      {!!profiles?.length && (
        <div className="section">
          <div className="section-title">Formats mémorisés</div>
          <div className="list">
            {profiles.map((p) => (
              <div key={p.id} className="row plain">
                <div className="row-main">
                  <div className="row-title">{p.name}</div>
                  <div className="row-sub">Dernier import le {formatDate(p.lastUsed.slice(0, 10))}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="section">
        <div className="section-title">Où trouver le fichier ?</div>
        <div className="card small">
          Dans l’application ou le site de votre banque, ouvrez le compte puis cherchez « Télécharger », « Exporter » ou
          « Relevé d’opérations » et choisissez le format <strong>CSV</strong> (ou Excel/CSV) ou <strong>OFX</strong>{' '}
          (parfois appelé « Money »). Choisissez une période d’un ou plusieurs mois : les opérations déjà importées seront
          ignorées.
        </div>
      </div>
    </>
  );
}

function PreviewStep({
  source,
  rows,
  setRows,
  accountId,
  onAccount,
  onEditMapping,
  onCommit,
  busy,
}: {
  source: Source;
  rows: PreviewRow[];
  setRows: (fn: (rows: PreviewRow[]) => PreviewRow[]) => void;
  accountId: number;
  onAccount: (id: number) => void;
  onEditMapping?: () => void;
  onCommit: () => void;
  busy: boolean;
}) {
  const { list, map } = useCategories();
  const accounts = useAccounts();
  const [filter, setFilter] = useState<'selected' | 'duplicates' | 'all'>('selected');
  const [editing, setEditing] = useState<number | null>(null);
  const [suggest, setSuggest] = useState<{ merchant: string; category: Category } | null>(null);

  const counts = useMemo(
    () => ({
      selected: rows.filter((r) => r.selected).length,
      duplicate: rows.filter((r) => r.status === 'duplicate').length,
      probable: rows.filter((r) => r.status === 'probable').length,
      uncategorized: rows.filter((r) => r.selected && r.categoryId == null).length,
    }),
    [rows],
  );
  const selectedTotals = useMemo(() => {
    let out = 0;
    let inc = 0;
    for (const r of rows) if (r.selected) r.amountCents < 0 ? (out += r.amountCents) : (inc += r.amountCents);
    return { out, inc };
  }, [rows]);
  const dates = rows.map((r) => r.date).sort();
  const visible = rows.filter((r) =>
    filter === 'all' ? true : filter === 'selected' ? r.selected : r.status !== 'new',
  );
  const editingRow = rows.find((r) => r.key === editing);

  const toggle = (key: number) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, selected: !r.selected } : r)));

  function pick(id: number | null) {
    if (!editingRow) return;
    setRows((rs) =>
      rs.map((r) => (r.key === editingRow.key ? { ...r, categoryId: id, categorySource: id == null ? 'none' : 'manual' } : r)),
    );
    const cat = id != null ? map.get(id) : undefined;
    if (cat && editingRow.merchant) setSuggest({ merchant: editingRow.merchant, category: cat });
    else setEditing(null);
  }

  function ruleCreated(result: { pattern: string } | null) {
    if (result && suggest) {
      const { pattern } = result;
      const categoryId = suggest.category.id;
      setRows((rs) =>
        rs.map((r) =>
          r.categorySource !== 'manual' && matchesPattern(r.labelNorm, pattern) ? { ...r, categoryId, categorySource: 'rule' } : r,
        ),
      );
    }
    setSuggest(null);
    setEditing(null);
  }

  return (
    <>
      <div className="card">
        <div className="row-title">{source.fileName}</div>
        <div className="small muted">
          {plural(rows.length, 'opération', 'opérations')} du {formatDate(dates[0])} au {formatDate(dates[dates.length - 1])}
        </div>
        <div className="summary-grid" style={{ marginTop: 14 }}>
          <div>
            <strong>{counts.selected}</strong>
            <span className="small muted">à importer</span>
          </div>
          <div>
            <strong>{counts.duplicate}</strong>
            <span className="small muted">déjà importées</span>
          </div>
          <div>
            <strong>{counts.probable}</strong>
            <span className="small muted">doublons probables</span>
          </div>
        </div>
        {onEditMapping && (
          <button className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 8 }} onClick={onEditMapping}>
            Modifier la correspondance des colonnes
          </button>
        )}
      </div>

      {accounts.length > 1 && (
        <label className="field" style={{ marginTop: 12 }}>
          <span className="label">Compte</span>
          <select className="select" value={accountId} onChange={(e) => onAccount(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {counts.probable > 0 && (
        <Notice tone="warn" icon={<TriangleAlert size={20} />} title={`${plural(counts.probable, 'doublon probable', 'doublons probables')}`}>
          <div className="small muted">
            Même montant à quelques jours près et libellé proche d’une opération existante. Non cochés par défaut :
            vérifiez-les dans l’onglet « Doublons ».
          </div>
        </Notice>
      )}

      <div className="section">
        <Segmented
          options={[
            { value: 'selected', label: `À importer (${counts.selected})` },
            { value: 'duplicates', label: `Doublons (${counts.duplicate + counts.probable})` },
            { value: 'all', label: 'Toutes' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        {visible.length === 0 ? (
          <p className="small muted" style={{ textAlign: 'center', padding: 16 }}>
            {filter === 'duplicates'
              ? 'Aucun doublon : tout est nouveau.'
              : counts.duplicate === rows.length
                ? 'Toutes les opérations de ce fichier sont déjà enregistrées.'
                : 'Aucune opération sélectionnée.'}
          </p>
        ) : (
          <div className="list">
            {visible.map((r) => (
              <div key={r.key} className={`preview-row${r.selected ? '' : ' excluded'}`}>
                <input
                  type="checkbox"
                  checked={r.selected}
                  onChange={() => toggle(r.key)}
                  aria-label={`Importer ${r.label}`}
                />
                <div className="row-main">
                  <div className="row-title">{prettyMerchant(r.merchant) || r.label}</div>
                  <div className="row-sub">
                    {formatDate(r.date)} · {r.label}
                  </div>
                  <div className="meta">
                    <CatChip category={r.categoryId != null ? map.get(r.categoryId) : undefined} onClick={() => setEditing(r.key)} />
                    {r.status === 'duplicate' && <span className="status neutral">Déjà importée</span>}
                    {r.status === 'probable' && (
                      <span className="status warn">
                        <TriangleAlert size={12} /> Doublon probable
                      </span>
                    )}
                  </div>
                </div>
                <div className="row-end">
                  <Amount cents={r.amountCents} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!editingRow} onClose={() => (setEditing(null), setSuggest(null))} title={editingRow ? prettyMerchant(editingRow.merchant) || 'Catégorie' : ''}>
        {editingRow &&
          (suggest ? (
            <RulePrompt merchant={suggest.merchant} category={suggest.category} onDone={ruleCreated} />
          ) : (
            <CategoryPicker categories={list} value={editingRow.categoryId} onPick={pick} sign={editingRow.amountCents} allowNone />
          ))}
      </Sheet>

      <div className="bottom-bar">
        <div>
          <div className="small muted" style={{ textAlign: 'center', marginBottom: 8 }}>
            {formatEUR(selectedTotals.out)} · {formatEUR(selectedTotals.inc, { sign: true })}
            {counts.uncategorized > 0 && ` · ${counts.uncategorized} à classer`}
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || counts.selected === 0} onClick={onCommit}>
            {counts.selected === 0 ? 'Rien à importer' : `Importer ${plural(counts.selected, 'opération', 'opérations')}`}
          </button>
        </div>
      </div>
    </>
  );
}

function DoneStep({ info, onUndo, onAnother }: { info: DoneInfo; onUndo: () => void; onAnother: () => void }) {
  const navigate = useNavigate();
  const ym = currentMonth();
  const { list, map } = useCategories();
  const filter = useBudgetFilter();
  const monthTxs = useMonthTransactions(ym);
  const alerts = useMemo(
    () =>
      info.to >= `${ym}-01`
        ? budgetLines(list, spendingByCategory((monthTxs ?? []).filter(filter), map), ym, todayISO()).filter((l) => l.status !== 'ok')
        : [],
    [info.to, ym, list, monthTxs, filter, map],
  );
  return (
    <>
      <div className="welcome">
        <CircleCheck size={56} color="var(--good)" />
        <h2 style={{ marginTop: 8 }}>{plural(info.count, 'opération importée', 'opérations importées')}</h2>
        <p>
          Du {formatDate(info.from)} au {formatDate(info.to)}
          {info.duplicates > 0 && ` · ${plural(info.duplicates, 'doublon ignoré', 'doublons ignorés')}`}
        </p>
      </div>
      {alerts.length > 0 && (
        <div className="section">
          <div className="section-title">Alertes budget</div>
          <div className="list">
            {alerts.map((l) => (
              <div key={l.category.id} className="budget-row">
                <div className="budget-head">
                  <CatIcon category={l.category} size="sm" />
                  <div className="row-main">
                    <div className="row-title">{l.category.name}</div>
                  </div>
                  <BudgetBadge status={l.status} ratio={l.ratio} />
                </div>
                <Progress ratio={l.ratio} status={l.status} />
                <div className="budget-foot">
                  <span>
                    {formatEUR(l.spent)} / {formatEUR(l.budget)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="stack section">
        <button className="btn btn-primary btn-block" onClick={() => navigate('/')}>
          Terminer
        </button>
        <Link className="btn btn-block" to={`/operations?mois=${info.to.slice(0, 7)}`}>
          Voir les opérations
        </Link>
        <button className="btn btn-block" onClick={onAnother}>
          Importer un autre relevé
        </button>
        <button className="btn btn-ghost btn-block" onClick={onUndo}>
          Annuler cet import
        </button>
      </div>
    </>
  );
}

export default function ImportFlow() {
  const navigate = useNavigate();
  const toast = useToast();
  const accounts = useAccounts();
  const [step, setStep] = useState<Step>('pick');
  const [source, setSource] = useState<Source | null>(null);
  const [profile, setProfile] = useState<PendingProfile | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<DoneInfo | null>(null);

  const account = accountId ?? accounts[0]?.id ?? 1;

  async function preview(src: Source, mapping: CsvMapping | null, acc: number) {
    const items = src.kind === 'ofx' ? src.items : applyMapping(src.analysis.rows, mapping!).items;
    setRows(await buildPreview(items, acc));
    setStep('preview');
  }

  async function onFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const src = await readStatement(file);
      setSource(src);
      if (src.kind === 'ofx') {
        setProfile(null);
        await preview(src, null, account);
        return;
      }
      const known = await findProfile(src.analysis.signature);
      if (known) {
        // Les colonnes sont les mêmes ; la ligne d'en-tête peut bouger si le préambule change.
        const mapping = { ...known.mapping, headerRow: src.analysis.headerRow };
        const acc = known.accountId && accounts.some((a) => a.id === known.accountId) ? known.accountId : account;
        setAccountId(acc);
        setProfile({ id: known.id, name: known.name, mapping, remember: true });
        await preview(src, mapping, acc);
        toast(`Format « ${known.name} » reconnu`);
      } else {
        setProfile({ name: defaultProfileName(file.name), mapping: src.analysis.guess, remember: true });
        setStep('mapping');
      }
    } catch (e) {
      setError(e instanceof ImportError ? e.message : 'Ce fichier n’a pas pu être lu.');
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function changeAccount(id: number) {
    setAccountId(id);
    if (source) await preview(source, profile?.mapping ?? null, id);
  }

  async function commit() {
    if (!source) return;
    setBusy(true);
    try {
      const selected = rows.filter((r) => r.selected);
      const toSave = selected.map(({ key: _k, status: _s, selected: _sel, ...draft }) => draft);
      const batchId = await commitImport({
        fileName: source.fileName,
        accountId: account,
        rows: toSave,
        duplicates: rows.filter((r) => !r.selected && r.status !== 'new').length,
      });
      if (source.kind === 'csv' && profile?.remember) {
        const data = {
          name: profile.name,
          signature: source.analysis.signature,
          delimiter: source.analysis.delimiter,
          mapping: profile.mapping,
          accountId: account,
          lastUsed: new Date().toISOString(),
        };
        if (profile.id) await db.importProfiles.update(profile.id, data);
        else await db.importProfiles.add(data);
      }
      const dates = toSave.map((r) => r.date).sort();
      setDone({
        batchId,
        count: toSave.length,
        duplicates: rows.length - toSave.length,
        from: dates[0],
        to: dates[dates.length - 1],
      });
      setStep('done');
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!done || !confirm('Supprimer toutes les opérations ajoutées par cet import ?')) return;
    const n = await undoImport(done.batchId);
    toast(`Import annulé · ${plural(n, 'opération supprimée', 'opérations supprimées')}`);
    setDone(null);
    setSource(null);
    setStep('pick');
  }

  const titles: Record<Step, string> = {
    pick: 'Importer un relevé',
    mapping: 'Colonnes',
    preview: 'Aperçu',
    done: 'Import terminé',
  };
  const back = () => {
    if (step === 'preview' && source?.kind === 'csv' && !profile?.id) setStep('mapping');
    else if (step === 'mapping' || step === 'preview') setStep('pick');
    else navigate(-1);
  };

  return (
    <main className="screen no-tabbar">
      <header className="header compact">
        {step !== 'done' ? (
          <button className="btn btn-ghost btn-sm" style={{ width: 84, padding: 0 }} onClick={back}>
            {step === 'pick' ? 'Fermer' : 'Retour'}
          </button>
        ) : (
          <span style={{ width: 84 }} />
        )}
        <h1>{titles[step]}</h1>
        <span style={{ width: 84 }} />
      </header>
      <Steps step={step} />

      {step === 'pick' && <PickStep onFile={onFile} error={error} busy={busy} />}

      {step === 'mapping' && source?.kind === 'csv' && profile && (
        <MappingStep
          fileName={source.fileName}
          encoding={source.encoding}
          analysis={source.analysis}
          initial={profile.mapping}
          initialName={profile.name}
          onConfirm={async (mapping, name, remember) => {
            setProfile({ ...profile, mapping, name, remember });
            await preview(source, mapping, account);
          }}
        />
      )}

      {step === 'preview' && source && (
        <PreviewStep
          source={source}
          rows={rows}
          setRows={(fn) => setRows(fn)}
          accountId={account}
          onAccount={changeAccount}
          onEditMapping={source.kind === 'csv' ? () => setStep('mapping') : undefined}
          onCommit={commit}
          busy={busy}
        />
      )}

      {step === 'done' && done && (
        <DoneStep
          info={done}
          onUndo={undo}
          onAnother={() => {
            setDone(null);
            setSource(null);
            setRows([]);
            setStep('pick');
          }}
        />
      )}
    </main>
  );
}

