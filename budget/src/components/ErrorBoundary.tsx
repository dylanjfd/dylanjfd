import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { recordError } from '../lib/errorLog';
import { checkDatabase, reloadOnce } from '../lib/recovery';
import { Loading } from './Loading';

interface State {
  error: Error | null;
  attempt: number;
  fatal: boolean;
}

/**
 * Évite tout écran d'erreur pour un incident passager : l'écran est reconstruit
 * discrètement (la base est vérifiée au passage), puis la page est rechargée si
 * l'erreur revient. Le message n'apparaît qu'en tout dernier recours.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, State> {
  state: State = { error: null, attempt: 0, fatal: false };
  private failures: number[] = [];
  private timer: number | undefined;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordError(error, info.componentStack ?? undefined);
    const now = Date.now();
    this.failures = [...this.failures.filter((t) => now - t < 15_000), now];
    if (this.failures.length <= 3) {
      const retry = () => {
        this.timer = window.setTimeout(
          () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 })),
          150 * this.failures.length,
        );
      };
      void checkDatabase().then(retry, retry);
    } else if (!reloadOnce()) {
      this.setState({ fatal: true });
    }
  }

  componentWillUnmount() {
    window.clearTimeout(this.timer);
  }

  render() {
    const { error, attempt, fatal } = this.state;
    if (!error) return <Fragment key={attempt}>{this.props.children}</Fragment>;
    const { fallback } = this.props;
    if (!fatal || fallback !== undefined) return fallback === undefined ? <Loading /> : fallback;
    return (
      <main className="screen">
        <div className="welcome" style={{ paddingTop: 'calc(var(--safe-top) + 48px)' }}>
          <div style={{ fontSize: 44, marginBottom: 8 }} aria-hidden="true">
            🔄
          </div>
          <h2>L’affichage a rencontré un problème</h2>
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
