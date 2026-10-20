import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2, Undo2 } from 'lucide-react';
import { useToast } from '../components/toast';
import { Empty, Header } from '../components/ui';
import { db, type ImportProfile } from '../db/schema';
import { useAccounts } from '../hooks/useData';
import { undoImport } from '../lib/actions';
import { formatDate, plural } from '../lib/format';

export default function ImportHistory() {
  const batches = useLiveQuery(() => db.importBatches.orderBy('createdAt').reverse().toArray(), []);
  const profiles = useLiveQuery(() => db.importProfiles.toArray(), []);
  const accounts = useAccounts();
  const toast = useToast();

  async function undo(id: number, name: string) {
    if (!confirm(`Annuler l’import « ${name} » ? Toutes ses opérations seront supprimées.`)) return;
    const n = await undoImport(id);
    toast(`${plural(n, 'opération supprimée', 'opérations supprimées')}`);
  }

  async function renameProfile(p: ImportProfile) {
    const name = prompt('Nom du format', p.name)?.trim();
    if (name) await db.importProfiles.update(p.id, { name });
  }

  async function removeProfile(p: ImportProfile) {
    if (!confirm(`Oublier le format « ${p.name} » ? La correspondance des colonnes sera redemandée au prochain import.`)) return;
    await db.importProfiles.delete(p.id);
  }

  return (
    <main className="screen">
      <Header title="Imports" back="/plus" />
      {batches && batches.length === 0 ? (
        <Empty icon="📥" title="Aucun import" />
      ) : (
        <>
          <div className="section-title">Historique</div>
          <div className="list">
            {(batches ?? []).map((b) => (
              <div key={b.id} className="row plain">
                <div className="row-main">
                  <div className="row-title">{b.fileName}</div>
                  <div className="row-sub">
                    {formatDate(b.createdAt.slice(0, 10))} · {plural(b.count, 'opération', 'opérations')}
                    {b.from && b.to ? ` du ${formatDate(b.from)} au ${formatDate(b.to)}` : ''}
                    {accounts.length > 1 ? ` · ${accounts.find((a) => a.id === b.accountId)?.name ?? ''}` : ''}
                  </div>
                </div>
                <button className="icon-btn" aria-label={`Annuler l’import ${b.fileName}`} onClick={() => undo(b.id, b.fileName)}>
                  <Undo2 size={20} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {!!profiles?.length && (
        <div className="section">
          <div className="section-title">Formats mémorisés</div>
          <div className="list">
            {profiles.map((p) => (
              <div key={p.id} className="row plain">
                <button className="row-main" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }} onClick={() => renameProfile(p)}>
                  <div className="row-title">{p.name}</div>
                  <div className="row-sub">Utilisé le {formatDate(p.lastUsed.slice(0, 10))} · toucher pour renommer</div>
                </button>
                <button className="icon-btn" aria-label={`Oublier le format ${p.name}`} onClick={() => removeProfile(p)}>
                  <Trash2 size={20} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
