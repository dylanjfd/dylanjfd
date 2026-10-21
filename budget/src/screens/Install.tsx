import { Download, Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Header, Notice } from '../components/ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });
}

export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export default function Install() {
  const [canPrompt, setCanPrompt] = useState(!!deferredPrompt);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onPrompt = () => setTimeout(() => setCanPrompt(!!deferredPrompt));
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    deferredPrompt = null;
    setCanPrompt(false);
  }

  return (
    <main className="screen">
      <Header title="Installer l’application" back="/plus" />
      {installed ? (
        <Notice tone="info" icon={<Download size={20} />} title="L’application est installée 🎉">
          <div className="small muted">Elle s’ouvre depuis l’écran d’accueil et fonctionne sans connexion.</div>
        </Notice>
      ) : (
        <>
          {canPrompt && (
            <button className="btn btn-primary btn-block" onClick={install}>
              <Download size={20} /> Installer maintenant
            </button>
          )}

          <div className="section">
            <div className="section-title">Sur iPhone / iPad (Safari)</div>
            <div className="card">
              <ol className="steps-list">
                <li>Ouvrez cette page dans Safari.</li>
                <li>
                  <span>
                    Touchez le bouton Partager <Share size={16} style={{ verticalAlign: -2 }} /> en bas de l’écran.
                  </span>
                </li>
                <li>Choisis « Sur l’écran d’accueil », puis « Ajouter ».</li>
              </ol>
            </div>
          </div>

          <div className="section">
            <div className="section-title">Sur Android (Chrome)</div>
            <div className="card">
              <ol className="steps-list">
                <li>Ouvrez le menu ⋮ en haut à droite.</li>
                <li>Choisis « Installer l’application » ou « Ajouter à l’écran d’accueil ».</li>
              </ol>
            </div>
          </div>
          {isIOS() && (
            <p className="small muted" style={{ margin: '16px 4px 0' }}>
              Une fois installée, l’application conserve ses données durablement. Dans Safari seul, iOS peut effacer les
              données d’un site non consulté pendant plusieurs semaines.
            </p>
          )}
        </>
      )}
    </main>
  );
}
