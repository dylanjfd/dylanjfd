import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronRight,
  ClipboardCopy,
  HardDrive,
  History,
  Landmark,
  ListChecks,
  ShieldCheck,
  Smartphone,
  Tags,
  Trash2,
  Upload,
  WandSparkles,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../components/toast';
import { Header, Segmented } from '../components/ui';
import { clearErrors, errorReport, readErrors } from '../lib/errorLog';
import { db } from '../db/schema';
import { useSetting } from '../hooks/useData';
import type { ThemeSetting } from '../hooks/useTheme';
import { deleteAllData, setSetting } from '../lib/actions';
import { formatDate, plural } from '../lib/format';

function LinkRow({ to, icon, title, sub }: { to: string; icon: ReactNode; title: string; sub?: string }) {
  return (
    <Link to={to} className="row">
      <span className="cat-icon" style={{ background: 'var(--primary-soft)', boxShadow: 'none', color: 'var(--primary)' }}>
        {icon}
      </span>
      <div className="row-main">
        <div className="row-title">{title}</div>
        {sub && <div className="row-sub">{sub}</div>}
      </div>
      <ChevronRight className="chevron" size={18} />
    </Link>
  );
}

function useStorageInfo() {
  const [info, setInfo] = useState<{ persisted: boolean | null; usage: number | null }>({ persisted: null, usage: null });
  useEffect(() => {
    void (async () => {
      const persisted = (await navigator.storage?.persisted?.()) ?? null;
      const estimate = await navigator.storage?.estimate?.();
      setInfo({ persisted, usage: estimate?.usage ?? null });
    })();
  }, []);
  return info;
}

export default function More() {
  const theme = useSetting<ThemeSetting>('theme', 'auto');
  const lastBackup = useSetting<string | null>('lastBackupAt', null);
  const counts = useLiveQuery(async () => ({
    tx: await db.transactions.count(),
    rules: await db.rules.count(),
    accounts: await db.accounts.count(),
    imports: await db.importBatches.count(),
    todo: await db.transactions.filter((t) => t.categoryId == null).count(),
    guessed: await db.transactions.filter((t) => t.categorySource === 'auto').count(),
  }));
  const storage = useStorageInfo();
  const navigate = useNavigate();

  const [incidents, setIncidents] = useState(readErrors);
  const toast = useToast();

  async function copyReport() {
    const report = errorReport();
    try {
      await navigator.clipboard.writeText(report);
      clearErrors();
      setIncidents([]);
      toast('Rapport copié : collez-le dans un message pour le transmettre');
    } catch {
      prompt('Copiez ce rapport :', report);
    }
  }

  async function wipe() {
    if (!confirm('Effacer toutes les données de l’application sur ce téléphone ?')) return;
    if (prompt('Cette action est définitive. Tapez EFFACER pour confirmer.')?.trim().toUpperCase() !== 'EFFACER') return;
    await deleteAllData();
    navigate('/');
  }

  return (
    <main className="screen">
      <Header title="Plus" />

      <div className="section-title">Données</div>
      <div className="list">
        <LinkRow to="/import" icon={<Upload size={20} />} title="Importer un relevé" sub="CSV, OFX, PDF ou captures d’écran" />
        <LinkRow
          to="/plus/imports"
          icon={<History size={20} />}
          title="Historique des imports"
          sub={counts ? `${plural(counts.imports, 'import', 'imports')} · formats mémorisés` : undefined}
        />
        <LinkRow
          to="/plus/sauvegarde"
          icon={<HardDrive size={20} />}
          title="Sauvegarde et restauration"
          sub={lastBackup ? `Dernière sauvegarde le ${formatDate(lastBackup.slice(0, 10))}` : 'Aucune sauvegarde'}
        />
      </div>

      <div className="section">
        <div className="section-title">Classement</div>
        <div className="list">
          <LinkRow
            to="/classer"
            icon={<ListChecks size={20} />}
            title="Classer les opérations"
            sub={
              counts
                ? [
                    counts.todo && `${counts.todo} à classer`,
                    counts.guessed && `${plural(counts.guessed, 'devinée', 'devinées')} à vérifier`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Tout est classé'
                : undefined
            }
          />
          <LinkRow to="/plus/categories" icon={<Tags size={20} />} title="Catégories" sub="Noms, icônes, couleurs" />
          <LinkRow
            to="/plus/regles"
            icon={<WandSparkles size={20} />}
            title="Règles de classement"
            sub={counts ? plural(counts.rules, 'mot-clé', 'mots-clés') : undefined}
          />
          <LinkRow
            to="/plus/comptes"
            icon={<Landmark size={20} />}
            title="Comptes"
            sub={counts ? plural(counts.accounts, 'compte', 'comptes') : undefined}
          />
        </div>
      </div>

      <div className="section">
        <div className="section-title">Apparence</div>
        <Segmented
          options={[
            { value: 'auto', label: 'Automatique' },
            { value: 'light', label: 'Clair' },
            { value: 'dark', label: 'Sombre' },
          ]}
          value={theme}
          onChange={(v) => setSetting('theme', v)}
        />
      </div>

      <div className="section">
        <div className="section-title">Application</div>
        <div className="list">
          <LinkRow to="/plus/installer" icon={<Smartphone size={20} />} title="Installer sur l’écran d’accueil" />
          <div className="row">
            <span className="cat-icon" style={{ background: 'var(--primary-soft)', boxShadow: 'none', color: 'var(--primary)' }}>
              <ShieldCheck size={20} />
            </span>
            <div className="row-main">
              <div className="row-title">Données 100 % locales</div>
              <div className="row-sub" style={{ whiteSpace: 'normal' }}>
                {counts ? plural(counts.tx, 'opération', 'opérations') : '…'}
                {storage.usage != null && ` · ${(storage.usage / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`}
                {storage.persisted === true && ' · stockage persistant'}
                {storage.persisted === false && ' · installez l’app pour protéger le stockage'}
              </div>
            </div>
          </div>
          {incidents.length > 0 && (
            <button className="row" onClick={copyReport}>
              <span className="cat-icon" style={{ background: 'var(--primary-soft)', boxShadow: 'none', color: 'var(--primary)' }}>
                <ClipboardCopy size={20} />
              </span>
              <div className="row-main">
                <div className="row-title">Rapport technique</div>
                <div className="row-sub" style={{ whiteSpace: 'normal' }}>
                  {plural(incidents.length, 'incident corrigé', 'incidents corrigés')} automatiquement · toucher pour copier
                </div>
              </div>
            </button>
          )}
        </div>
      </div>

      <div className="section">
        <button className="btn btn-danger btn-block" onClick={wipe}>
          <Trash2 size={18} /> Effacer toutes les données
        </button>
        <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>
          Mon Budget · version {__APP_VERSION__}
          <br />
          Aucune donnée ne quitte ce téléphone.
        </p>
      </div>
    </main>
  );
}
