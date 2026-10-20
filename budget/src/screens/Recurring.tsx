import { TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Amount, CatIcon, Empty, Notice, Sheet } from '../components/ui';
import { db } from '../db/schema';
import { useCategories, useRecurring, useResteAVivre } from '../hooks/useData';
import { formatDate, formatEUR, plural } from '../lib/format';
import type { RecurringItem } from '../lib/recurring';
import { prettyMerchant } from '../lib/text';

function RecurringRows({ items, onOpen }: { items: RecurringItem[]; onOpen: (i: RecurringItem) => void }) {
  const { map } = useCategories();
  return (
    <div className="list">
      {items.map((i) => (
        <button key={i.key} className="row" onClick={() => onOpen(i)}>
          <CatIcon category={i.categoryId != null ? map.get(i.categoryId) : undefined} />
          <div className="row-main">
            <div className="row-title">{prettyMerchant(i.merchant)}</div>
            <div className="row-sub">Prochain : {formatDate(i.nextDate)}</div>
          </div>
          <div className="row-end">
            <Amount cents={i.sign * i.amount} />
            {i.increase > 0 && (
              <div>
                <span className="status warn">
                  <TrendingUp size={12} /> +{formatEUR(i.increase)}
                </span>
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function RecurringSheet({ item, ignored, onClose }: { item: RecurringItem | null; ignored: boolean; onClose: () => void }) {
  if (!item) return null;
  async function toggle() {
    if (ignored) await db.recurringPrefs.delete(item!.key);
    else await db.recurringPrefs.put({ key: item!.key, status: 'ignored' });
    onClose();
  }
  return (
    <Sheet open onClose={onClose} title={prettyMerchant(item.merchant)}>
      <div className="card">
        <div className="kv">
          <span>Montant actuel</span>
          <span>{formatEUR(item.amount)}</span>
        </div>
        {item.increase > 0 && (
          <div className="kv">
            <span>Avant l’augmentation</span>
            <span>
              {formatEUR(item.previousAmount ?? 0)} (+{formatEUR(item.increase)}/mois, {formatEUR(item.increase * 12)}/an)
            </span>
          </div>
        )}
        <div className="kv">
          <span>Montant moyen</span>
          <span>{formatEUR(item.averageAmount)}</span>
        </div>
        <div className="kv">
          <span>Jour habituel</span>
          <span>le {item.day} du mois</span>
        </div>
        <div className="kv">
          <span>Prochaine date attendue</span>
          <span>{formatDate(item.nextDate)}</span>
        </div>
        <div className="kv">
          <span>Libellé</span>
          <span>{item.label}</span>
        </div>
      </div>
      <div className="section">
        <div className="section-title">{plural(item.occurrences.length, 'occurrence', 'occurrences')}</div>
        <div className="list">
          {[...item.occurrences].reverse().map((o) => (
            <div key={o.id} className="row plain">
              <div className="row-main">{formatDate(o.date)}</div>
              <Amount cents={o.amountCents} />
            </div>
          ))}
        </div>
      </div>
      <button className="btn btn-block" style={{ marginTop: 16 }} onClick={toggle}>
        {ignored ? 'Compter à nouveau comme récurrent' : 'Ce n’est pas une dépense récurrente'}
      </button>
    </Sheet>
  );
}

export default function Recurring() {
  const data = useRecurring();
  const rav = useResteAVivre();
  const [open, setOpen] = useState<RecurringItem | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  if (!data || !rav) return null;
  const { summary, items, ignored } = data;
  const ignoredItems = items.filter((i) => ignored.has(i.key));
  const increases = summary.charges.filter((i) => i.increase > 0);

  if (items.length === 0)
    return (
      <Empty icon="🔁" title="Rien de détecté pour l’instant">
        <p>
          Loyer, abonnements et crédits sont repérés automatiquement à partir de 2 à 3 mois de relevés (même libellé,
          montant proche, chaque mois).
        </p>
      </Empty>
    );

  return (
    <>
      <section className="card">
        <div className="label">Reste à vivre par mois</div>
        <div className="hero">
          <Amount cents={rav.value} sign={false} />
        </div>
        <div className="kpis">
          <div className="kpi">
            <div className="kpi-label">Revenus</div>
            <div className="kpi-value">{formatEUR(rav.income, { rounded: true })}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Charges fixes</div>
            <div className="kpi-value">{formatEUR(summary.chargesTotal, { rounded: true })}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Épargne auto</div>
            <div className="kpi-value">{formatEUR(summary.savingsTotal, { rounded: true })}</div>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          {rav.source === 'recurring'
            ? 'Revenus réguliers détectés'
            : rav.source === 'average'
              ? 'Revenus : moyenne des 3 derniers mois'
              : 'Aucun revenu détecté'}{' '}
          moins les charges fixes. L’épargne automatique n’est pas déduite.
        </p>
      </section>

      {increases.map((i) => (
        <Notice
          key={i.key}
          tone="warn"
          icon={<TrendingUp size={20} />}
          title={`${prettyMerchant(i.merchant)} : ${formatEUR(i.previousAmount ?? 0)} → ${formatEUR(i.amount)}`}
        >
          <div className="small muted">Augmentation de {formatEUR(i.increase * 12)} par an</div>
        </Notice>
      ))}

      {summary.charges.length > 0 && (
        <div className="section">
          <div className="section-title">
            Charges fixes <span>{formatEUR(summary.chargesTotal)}</span>
          </div>
          <RecurringRows items={summary.charges} onOpen={setOpen} />
        </div>
      )}
      {summary.incomes.length > 0 && (
        <div className="section">
          <div className="section-title">
            Revenus réguliers <span>{formatEUR(summary.incomesTotal)}</span>
          </div>
          <RecurringRows items={summary.incomes} onOpen={setOpen} />
        </div>
      )}
      {summary.savings.length > 0 && (
        <div className="section">
          <div className="section-title">
            Épargne programmée <span>{formatEUR(summary.savingsTotal)}</span>
          </div>
          <RecurringRows items={summary.savings} onOpen={setOpen} />
        </div>
      )}
      {ignoredItems.length > 0 && (
        <div className="section">
          <div className="section-title">
            Ignorées
            <button onClick={() => setShowIgnored((v) => !v)}>{showIgnored ? 'Masquer' : `Afficher (${ignoredItems.length})`}</button>
          </div>
          {showIgnored && <RecurringRows items={ignoredItems} onOpen={setOpen} />}
        </div>
      )}
      <RecurringSheet item={open} ignored={!!open && ignored.has(open.key)} onClose={() => setOpen(null)} />
    </>
  );
}
