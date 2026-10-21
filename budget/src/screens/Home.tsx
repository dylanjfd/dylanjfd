import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, ChevronRight, HardDrive, OctagonAlert, Smartphone, Tags, TriangleAlert, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TransactionRow, TransactionSheet } from '../components/transactions';
import { useToast } from '../components/toast';
import { Amount, BudgetBadge, CatIcon, Header, Notice, Progress } from '../components/ui';
import { db } from '../db/schema';
import {
  useAccounts,
  useBudgetFilter,
  useCategories,
  useMonthTransactions,
  useRecurring,
  useResteAVivre,
  useSetting,
  useTransactionCount,
} from '../hooks/useData';
import { setSetting } from '../lib/actions';
import { budgetLines } from '../lib/budget';
import { currentMonth, diffDays, todayISO } from '../lib/dates';
import { loadDemoData } from '../lib/demo';
import { formatDate, formatEUR, formatMonth, plural } from '../lib/format';
import { spendingByCategory, totals } from '../lib/stats';
import { prettyMerchant } from '../lib/text';
import { Loading } from '../components/Loading';
import { isStandalone } from './Install';

function Welcome() {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  async function demo() {
    if (!confirm('Charger un an d’opérations fictives, avec des budgets et un objectif d’exemple ?\n\nVous pourrez tout supprimer depuis Plus › Historique des imports.')) return;
    setLoading(true);
    await loadDemoData();
    setLoading(false);
    toast('Données de démonstration chargées');
  }
  return (
    <div className="welcome">
      <img src={`${import.meta.env.BASE_URL}icons/pwa-192x192.png`} alt="" />
      <h2>Bienvenue 👋</h2>
      <p>
        Importez un relevé de votre banque (CSV, OFX ou PDF) pour commencer. Tout reste sur ce téléphone&nbsp;: aucune donnée
        n’est envoyée sur Internet.
      </p>
      <div className="stack">
        <button className="btn btn-primary btn-block" onClick={() => navigate('/import')}>
          <Upload size={20} /> Importer un relevé
        </button>
        <button className="btn btn-block" onClick={() => navigate('/plus/sauvegarde')}>
          <HardDrive size={20} /> Restaurer une sauvegarde
        </button>
        <button className="btn btn-ghost btn-block" disabled={loading} onClick={demo}>
          Essayer avec des données de démonstration
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const ym = currentMonth();
  const today = todayISO();
  const count = useTransactionCount();
  const { list, map } = useCategories();
  const accounts = useAccounts();
  const filter = useBudgetFilter();
  const monthTxs = useMonthTransactions(ym);
  const recurring = useRecurring();
  const rav = useResteAVivre();
  const lastBackup = useSetting<string | null>('lastBackupAt', null);
  const installDismissed = useSetting('installHintDismissed', false);
  const uncategorized = useLiveQuery(() => db.transactions.filter((t) => t.categoryId == null).count(), []);
  const recent = useLiveQuery(() => db.transactions.orderBy('date').reverse().limit(6).toArray(), []);
  const [openTx, setOpenTx] = useState<number | null>(null);

  const kept = useMemo(() => (monthTxs ?? []).filter(filter), [monthTxs, filter]);
  const sum = useMemo(() => totals(kept, map), [kept, map]);
  const alerts = useMemo(
    () =>
      budgetLines(list, spendingByCategory(kept, map), ym)
        .filter((l) => l.status !== 'ok')
        .sort((a, b) => b.ratio - a.ratio),
    [list, kept, map, ym],
  );
  const upcoming = useMemo(
    () =>
      (recurring?.summary.charges ?? [])
        .filter((i) => i.nextDate >= today && diffDays(today, i.nextDate) <= 15)
        .slice(0, 4),
    [recurring, today],
  );
  const increases = (recurring?.summary.charges ?? []).filter((i) => i.increase > 0);

  if (count === undefined) return <Loading />;
  if (count === 0)
    return (
      <main className="screen">
        <Header title="Mon Budget" />
        <Welcome />
      </main>
    );

  const backupDays = lastBackup ? diffDays(lastBackup.slice(0, 10), today) : null;

  return (
    <main className="screen">
      <Header title={formatMonth(ym)} />

      <section className="card">
        <div className="label">Solde du mois</div>
        <div className="hero">
          <Amount cents={sum.balance} />
        </div>
        <div className="kpis">
          <div className="kpi">
            <div className="kpi-label">Revenus</div>
            <div className="kpi-value">{formatEUR(sum.income, { rounded: true })}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Dépenses</div>
            <div className="kpi-value">{formatEUR(sum.expenses, { rounded: true })}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Épargne</div>
            <div className="kpi-value">{formatEUR(sum.savings, { rounded: true })}</div>
          </div>
        </div>
      </section>

      <div className="section">
        <button className="fab-import" onClick={() => navigate('/import')}>
          <Upload size={24} />
          <div className="row-main">
            <div>Importer un relevé</div>
            <div className="row-sub">CSV, OFX ou PDF de votre banque</div>
          </div>
          <ChevronRight size={20} />
        </button>
      </div>

      {alerts.length > 0 && (
        <div className="section">
          <div className="section-title">
            Budgets à surveiller <Link to="/budgets">Tout voir</Link>
          </div>
          <div className="list">
            {alerts.map((l) => (
              <Link key={l.category.id} to="/budgets" className="budget-row">
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
                  <span>{l.remaining >= 0 ? `Reste ${formatEUR(l.remaining)}` : `Dépassé de ${formatEUR(-l.remaining)}`}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {rav && rav.source !== 'none' && (
        <div className="section">
          <Link to="/analyses/recurrents" className="card" style={{ display: 'block', color: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="row-main">
                <div className="label">Reste à vivre par mois</div>
                <div style={{ fontSize: 26, fontWeight: 750 }}>
                  <Amount cents={rav.value} sign={false} />
                </div>
                <div className="small muted">
                  {formatEUR(rav.income, { rounded: true })} de revenus − {formatEUR(rav.charges, { rounded: true })} de charges fixes
                </div>
              </div>
              <ChevronRight className="chevron" />
            </div>
          </Link>
        </div>
      )}

      {increases.map((i) => (
        <Notice
          key={i.key}
          tone="warn"
          icon={<TriangleAlert size={20} />}
          title={`${prettyMerchant(i.merchant)} a augmenté : ${formatEUR(i.previousAmount ?? 0)} → ${formatEUR(i.amount)}`}
        >
          <div className="small muted">+{formatEUR(i.increase)} par mois, soit {formatEUR(i.increase * 12)} par an</div>
        </Notice>
      ))}

      {upcoming.length > 0 && (
        <div className="section">
          <div className="section-title">
            Prochains prélèvements <Link to="/analyses/recurrents">Tout voir</Link>
          </div>
          <div className="list">
            {upcoming.map((i) => (
              <div key={i.key} className="row">
                <CatIcon category={i.categoryId != null ? map.get(i.categoryId) : undefined} />
                <div className="row-main">
                  <div className="row-title">{prettyMerchant(i.merchant)}</div>
                  <div className="row-sub">
                    <CalendarClock size={12} style={{ verticalAlign: -1 }} /> {formatDate(i.nextDate)}
                  </div>
                </div>
                <Amount cents={-i.amount} />
              </div>
            ))}
          </div>
        </div>
      )}

      {!!uncategorized && (
        <Notice tone="info" icon={<Tags size={20} />} title={`${plural(uncategorized, 'opération', 'opérations')} à classer`}>
          <div className="notice-actions">
            <Link className="btn btn-sm" to="/operations?cat=none">
              Classer maintenant
            </Link>
          </div>
        </Notice>
      )}

      {(backupDays === null || backupDays >= 14) && (
        <Notice
          tone={backupDays === null || backupDays >= 30 ? 'over' : 'warn'}
          icon={<OctagonAlert size={20} />}
          title={backupDays === null ? 'Aucune sauvegarde pour l’instant' : `Dernière sauvegarde il y a ${backupDays} jours`}
        >
          <div className="small muted">Vos données n’existent que sur ce téléphone. Exportez-les régulièrement.</div>
          <div className="notice-actions">
            <Link className="btn btn-sm btn-primary" to="/plus/sauvegarde">
              Sauvegarder
            </Link>
          </div>
        </Notice>
      )}

      {!installDismissed && !isStandalone() && (
        <Notice tone="info" icon={<Smartphone size={20} />} title="Installez l’application sur l’écran d’accueil">
          <div className="notice-actions">
            <Link className="btn btn-sm" to="/plus/installer">
              Comment faire
            </Link>
            <button className="btn btn-sm btn-ghost" onClick={() => setSetting('installHintDismissed', true)}>
              Masquer
            </button>
          </div>
        </Notice>
      )}

      <div className="section">
        <div className="section-title">
          Dernières opérations <Link to="/operations">Tout voir</Link>
        </div>
        <div className="list">
          {(recent ?? []).map((t) => (
            <TransactionRow
              key={t.id}
              tx={t}
              category={t.categoryId != null ? map.get(t.categoryId) : undefined}
              accountName={accounts.length > 1 ? accounts.find((a) => a.id === t.accountId)?.name : undefined}
              showDate
              onClick={() => setOpenTx(t.id)}
            />
          ))}
        </div>
      </div>
      <TransactionSheet txId={openTx} onClose={() => setOpenTx(null)} />
    </main>
  );
}
