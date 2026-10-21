import { useEffect, useState } from 'react';
import { checkDatabase } from '../lib/recovery';

/** Indicateur de chargement ; si la base ne répond pas, tente de la rouvrir puis propose de recharger. */
export function Loading() {
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 200);
    const check = setTimeout(() => void checkDatabase(), 2000);
    const late = setTimeout(() => setSlow(true), 6000);
    return () => {
      clearTimeout(show);
      clearTimeout(check);
      clearTimeout(late);
    };
  }, []);
  if (!visible) return <div className="loading" />;
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {slow ? (
        <>
          <p className="small muted">Le chargement prend plus de temps que prévu.</p>
          <button className="btn btn-sm" onClick={() => location.reload()}>
            Recharger
          </button>
        </>
      ) : (
        <span className="sr-only">Chargement…</span>
      )}
    </div>
  );
}
