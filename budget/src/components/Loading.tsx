import { useEffect, useState } from 'react';
import { checkDatabase, reloadOnce } from '../lib/recovery';

/** Indicateur de chargement ; si la base ne répond pas, la rouvre, puis recharge la page. */
export function Loading() {
  const [visible, setVisible] = useState(false);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 200);
    const check = setTimeout(() => void checkDatabase({ reopenIfSlow: true }), 2500);
    const reload = setTimeout(() => {
      if (!reloadOnce()) setStuck(true);
    }, 9000);
    return () => {
      clearTimeout(show);
      clearTimeout(check);
      clearTimeout(reload);
    };
  }, []);
  if (!visible) return <div className="loading" />;
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {stuck ? (
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
