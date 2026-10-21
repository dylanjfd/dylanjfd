import { useLiveQuery } from 'dexie-react-hooks';
import { ChartPie, Ellipsis, House, ListOrdered, Target } from 'lucide-react';
import { createContext, lazy, Suspense, useContext, useEffect, useMemo } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from './components/toast';
import { db } from './db/schema';
import { useBudgetFilter, useCategories } from './hooks/useData';
import { useThemeMode } from './hooks/useTheme';
import { budgetLines } from './lib/budget';
import { currentMonth, monthBounds } from './lib/dates';
import { spendingByCategory } from './lib/stats';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/Loading';
import { UpdateBanner } from './components/UpdateBanner';
import Home from './screens/Home';
import Operations from './screens/Operations';
import Budgets from './screens/Budgets';
import More from './screens/More';
import Categories from './screens/Categories';
import Rules from './screens/Rules';
import Accounts from './screens/Accounts';
import ImportHistory from './screens/ImportHistory';
import Backup from './screens/Backup';
import Install from './screens/Install';
import ImportFlow from './screens/import/ImportFlow';

// Les graphiques (Recharts) sont chargés à la demande pour alléger le démarrage,
// avec un second essai si le réseau ou le cache a raté le premier.
const loadAnalyses = () => import('./screens/Analyses');
const Analyses = lazy(() =>
  loadAnalyses().catch(() => new Promise<void>((r) => setTimeout(r, 800)).then(loadAnalyses)),
);

const ThemeContext = createContext<'light' | 'dark'>('light');
export const useMode = () => useContext(ThemeContext);

function useBudgetAlert(): boolean {
  const { list, map } = useCategories();
  const filter = useBudgetFilter();
  const ym = currentMonth();
  const { start, end } = monthBounds(ym);
  const txs = useLiveQuery(() => db.transactions.where('date').between(start, end, true, true).toArray(), [start, end]);
  return useMemo(() => {
    if (!txs) return false;
    return budgetLines(list, spendingByCategory(txs.filter(filter), map), ym).some((l) => l.status === 'over');
  }, [txs, list, map, filter, ym]);
}

function TabBar() {
  const alert = useBudgetAlert();
  const tabs = [
    { to: '/', label: 'Accueil', icon: House, end: true },
    { to: '/operations', label: 'Opérations', icon: ListOrdered },
    { to: '/budgets', label: 'Budgets', icon: Target, dot: alert },
    { to: '/analyses', label: 'Analyses', icon: ChartPie },
    { to: '/plus', label: 'Plus', icon: Ellipsis },
  ];
  return (
    <nav className="tabbar" aria-label="Navigation principale">
      <div className="tabbar-inner">
        {tabs.map(({ to, label, icon: Icon, end, dot }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <Icon size={24} strokeWidth={2} />
            <span>{label}</span>
            {dot && <span className="tab-dot" aria-label="Budget dépassé" />}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function Layout() {
  const location = useLocation();
  const fullScreen = location.pathname.startsWith('/import');
  useEffect(() => window.scrollTo(0, 0), [location.pathname]);
  return (
    <div className="app">
      <ErrorBoundary key={location.pathname}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/operations" element={<Operations />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/budgets/epargne" element={<Budgets tab="goals" />} />
          <Route path="/analyses" element={<Suspense fallback={<Loading />}><Analyses /></Suspense>} />
          <Route path="/analyses/recurrents" element={<Suspense fallback={<Loading />}><Analyses tab="recurring" /></Suspense>} />
          <Route path="/plus" element={<More />} />
          <Route path="/plus/categories" element={<Categories />} />
          <Route path="/plus/regles" element={<Rules />} />
          <Route path="/plus/comptes" element={<Accounts />} />
          <Route path="/plus/imports" element={<ImportHistory />} />
          <Route path="/plus/sauvegarde" element={<Backup />} />
          <Route path="/plus/installer" element={<Install />} />
          <Route path="/import" element={<ImportFlow />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </ErrorBoundary>
      {!fullScreen && <TabBar />}
    </div>
  );
}

export default function App() {
  const mode = useThemeMode();
  useEffect(() => {
    // Demande au navigateur de ne pas effacer les données (important sur iOS).
    void navigator.storage?.persist?.();
  }, []);
  return (
    <ThemeContext.Provider value={mode}>
      <ToastProvider>
        <HashRouter>
          <Layout />
        </HashRouter>
        <UpdateBanner />
      </ToastProvider>
    </ThemeContext.Provider>
  );
}
