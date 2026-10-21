import { useLiveQuery } from 'dexie-react-hooks';
import { Landmark, PiggyBank, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../components/toast';
import { Header, Segmented, Sheet } from '../components/ui';
import { db, type Account, type AccountKind } from '../db/schema';
import { useAccounts } from '../hooks/useData';
import { deleteAccount } from '../lib/actions';
import { plural } from '../lib/format';

function AccountForm({ account, open, onClose }: { account: Account | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const accounts = useAccounts();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('courant');
  const count = useLiveQuery(() => (account ? db.transactions.where('accountId').equals(account.id).count() : 0), [account]);
  useEffect(() => {
    if (!open) return;
    setName(account?.name ?? '');
    setKind(account?.kind ?? 'courant');
  }, [open, account]);

  async function save() {
    if (account) await db.accounts.update(account.id, { name: name.trim(), kind });
    else await db.accounts.add({ name: name.trim(), kind });
    toast(account ? 'Compte modifié' : 'Compte ajouté');
    onClose();
  }

  async function remove() {
    if (!account) return;
    if (!confirm(`Supprimer « ${account.name} » et ses ${plural(count ?? 0, 'opération', 'opérations')} ?`)) return;
    await deleteAccount(account.id);
    toast('Compte supprimé');
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={account ? 'Modifier le compte' : 'Nouveau compte'}>
      <label className="field">
        <span className="label">Nom</span>
        <input className="input" value={name} placeholder="Ex. Compte joint, Livret A" onChange={(e) => setName(e.target.value)} />
      </label>
      <Segmented
        options={[
          { value: 'courant', label: 'Compte courant' },
          { value: 'epargne', label: 'Compte d’épargne' },
        ]}
        value={kind}
        onChange={setKind}
      />
      <p className="small muted" style={{ margin: '-4px 4px 14px' }}>
        {kind === 'courant'
          ? 'Ses opérations comptent dans les dépenses, revenus et budgets.'
          : 'Ses opérations ne comptent pas dans les dépenses : elles servent aux objectifs d’épargne.'}
      </p>
      <div className="stack">
        <button className="btn btn-primary btn-block" disabled={!name.trim()} onClick={save}>
          Enregistrer
        </button>
        {account && accounts.length > 1 && (
          <button className="btn btn-danger btn-block" onClick={remove}>
            <Trash2 size={18} /> Supprimer le compte
          </button>
        )}
      </div>
    </Sheet>
  );
}

export default function Accounts() {
  const accounts = useAccounts();
  const counts = useLiveQuery(async () => {
    const out = new Map<number, number>();
    for (const a of await db.accounts.toArray()) out.set(a.id, await db.transactions.where('accountId').equals(a.id).count());
    return out;
  }, [accounts.length]);
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <main className="screen">
      <Header
        title="Comptes"
        back="/plus"
        actions={
          <button className="icon-btn filled" aria-label="Nouveau compte" onClick={() => setCreating(true)}>
            <Plus size={24} />
          </button>
        }
      />
      <p className="small muted" style={{ margin: '0 4px 12px' }}>
        Ajoute un compte par relevé importé (autre banque, compte joint, livret). Les doublons sont recherchés compte par
        compte. Les virements entre tes comptes peuvent être classés dans « Virements internes ».
      </p>
      <div className="list">
        {accounts.map((a) => (
          <button key={a.id} className="row" onClick={() => setEditing(a)}>
            <span className="cat-icon" style={{ background: 'var(--primary-soft)', boxShadow: 'none', color: 'var(--primary)' }}>
              {a.kind === 'epargne' ? <PiggyBank size={20} /> : <Landmark size={20} />}
            </span>
            <div className="row-main">
              <div className="row-title">{a.name}</div>
              <div className="row-sub">
                {a.kind === 'epargne' ? 'Épargne' : 'Courant'} · {plural(counts?.get(a.id) ?? 0, 'opération', 'opérations')}
              </div>
            </div>
          </button>
        ))}
      </div>
      <AccountForm
        account={editing}
        open={creating || !!editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </main>
  );
}
