import { Download, FileUp, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { useToast } from '../components/toast';
import { Header, Notice } from '../components/ui';
import { useSetting } from '../hooks/useData';
import { setSetting, upgradeClassification } from '../lib/actions';
import { backupFileName, backupStats, buildBackup, parseBackup, restoreBackup, saveFile } from '../lib/backup';
import { formatDate, plural } from '../lib/format';

export default function Backup() {
  const toast = useToast();
  const lastBackup = useSetting<string | null>('lastBackupAt', null);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    setBusy(true);
    try {
      const json = await buildBackup();
      const how = await saveFile(json, backupFileName());
      await setSetting('lastBackupAt', new Date().toISOString());
      toast(how === 'shared' ? 'Sauvegarde prête' : 'Sauvegarde téléchargée');
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') toast('La sauvegarde a échoué');
    } finally {
      setBusy(false);
    }
  }

  async function importData(file: File) {
    setError(null);
    try {
      const backup = parseBackup(await file.text());
      const stats = backupStats(backup);
      const period = stats.from && stats.to ? ` (du ${formatDate(stats.from)} au ${formatDate(stats.to)})` : '';
      if (
        !confirm(
          `Restaurer la sauvegarde du ${formatDate(backup.exportedAt.slice(0, 10))} : ${plural(stats.transactions, 'opération', 'opérations')}${period} ?\n\nToutes les données actuelles seront remplacées.`,
        )
      )
        return;
      setBusy(true);
      await restoreBackup(backup);
      await upgradeClassification().catch(() => 0);
      toast('Sauvegarde restaurée');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restauration impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <Header title="Sauvegarde" back="/plus" />
      <Notice tone="info" icon={<ShieldCheck size={20} />} title="Tes données ne sont que sur ce téléphone">
        <div className="small muted">
          Exporte régulièrement un fichier de sauvegarde (dans Fichiers, iCloud Drive, Google Drive…) pour ne rien perdre
          en cas de changement ou de perte du téléphone.
        </div>
      </Notice>

      <div className="section">
        <div className="section-title">Exporter</div>
        <div className="card">
          <p className="small muted" style={{ marginBottom: 12 }}>
            {lastBackup ? `Dernière sauvegarde le ${formatDate(lastBackup.slice(0, 10))}.` : 'Aucune sauvegarde pour l’instant.'} Le fichier
            JSON contient toutes tes opérations, catégories, règles, budgets et objectifs.
          </p>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={exportData}>
            <Download size={20} /> Exporter mes données
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Restaurer</div>
        <div className="card">
          <p className="small muted" style={{ marginBottom: 12 }}>
            Remplace toutes les données de l’application par celles d’un fichier de sauvegarde.
          </p>
          <button className="btn btn-block" disabled={busy} onClick={() => input.current?.click()}>
            <FileUp size={20} /> Choisir un fichier de sauvegarde
          </button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importData(f);
            }}
          />
        </div>
        {error && <Notice tone="over" icon={<FileUp size={20} />} title={error} />}
      </div>
    </main>
  );
}
