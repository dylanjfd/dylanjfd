import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from './toast';

/** Signale qu'une nouvelle version est prête, sans recharger pendant une saisie. */
export function UpdateBanner() {
  const toast = useToast();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Vérifie les mises à jour toutes les heures quand l'app reste ouverte.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });

  useEffect(() => {
    if (offlineReady) {
      toast('L’application fonctionne maintenant hors ligne');
      setOfflineReady(false);
    }
  }, [offlineReady, setOfflineReady, toast]);

  if (!needRefresh) return null;
  return (
    <div className="update-banner notice info" role="alert">
      <RefreshCw size={20} />
      <div className="row-main">
        <div className="row-title">Une nouvelle version est disponible</div>
        <div className="notice-actions">
          <button className="btn btn-primary btn-sm" onClick={() => void updateServiceWorker(true)}>
            Mettre à jour
          </button>
          <button className="btn btn-sm" onClick={() => setNeedRefresh(false)}>
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}
