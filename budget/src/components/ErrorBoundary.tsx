import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isRecoverable, reloadOnce } from '../lib/recovery';

interface State {
  error: Error | null;
  reloading: boolean;
}

/** Évite l'écran blanc : recharge tout seul après une coupure de la base, sinon propose de recharger. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    if (isRecoverable(error) && reloadOnce()) this.setState({ reloading: true });
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="screen">
        <div className="welcome" style={{ paddingTop: 'calc(var(--safe-top) + 48px)' }}>
          <div style={{ fontSize: 44, marginBottom: 8 }} aria-hidden="true">
            🔄
          </div>
          <h2>{reloading ? 'Rechargement…' : 'L’affichage a rencontré un problème'}</h2>
          <p>Vos données ne sont pas perdues : elles restent enregistrées sur ce téléphone.</p>
          <button className="btn btn-primary btn-block" onClick={() => location.reload()}>
            Recharger
          </button>
          <p className="small muted" style={{ marginTop: 16, overflowWrap: 'anywhere' }}>
            {error.name} : {error.message}
          </p>
        </div>
      </main>
    );
  }
}
