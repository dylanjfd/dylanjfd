import { useMemo, useState } from 'react';
import { Segmented } from '../../components/ui';
import type { CsvMapping, DateFormat } from '../../db/schema';
import { formatDate, formatEUR, plural } from '../../lib/format';
import { applyMapping, columnNames, type CsvAnalysis } from '../../lib/import/csv';
import { DATE_FORMATS, type Encoding } from '../../lib/import/parse';
import { mappingIsUsable } from './model';

const DELIMITER_NAMES: Record<string, string> = { ';': 'point-virgule', ',': 'virgule', '\t': 'tabulation', '|': 'barre verticale' };

export function MappingStep({
  fileName,
  encoding,
  analysis,
  initial,
  initialName,
  onConfirm,
}: {
  fileName: string;
  encoding: Encoding;
  analysis: CsvAnalysis;
  initial: CsvMapping;
  initialName: string;
  onConfirm: (mapping: CsvMapping, profileName: string, remember: boolean) => void;
}) {
  const [m, setM] = useState<CsvMapping>(initial);
  const [name, setName] = useState(initialName);
  const [remember, setRemember] = useState(true);
  const { rows, columnCount, dataStart } = analysis;

  const set = (patch: Partial<CsvMapping>) => setM((prev) => ({ ...prev, ...patch }));
  const names = columnNames(rows, m.headerRow, columnCount);
  const sampleRow = rows.slice(Math.max(m.headerRow + 1, dataStart)).find((r) => r.some((c) => c));
  const columnOptions = names.map((n, i) => {
    const ex = sampleRow?.[i];
    return { value: i, label: ex ? `${n} (ex. ${ex.length > 24 ? ex.slice(0, 24) + '…' : ex})` : n };
  });

  const usable = mappingIsUsable(m);
  const result = useMemo(() => (usable ? applyMapping(rows, m) : { items: [], skipped: 0 }), [rows, m, usable]);
  const headerChoices = rows.slice(0, Math.min(rows.length, Math.max(dataStart + 1, 12)));

  const select = (value: number, onChange: (v: number) => void, withNone?: boolean) => (
    <select className="select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {withNone && <option value={-1}>Aucune</option>}
      {columnOptions.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <div className="card">
        <h3>Correspondance des colonnes</h3>
        <p className="small muted" style={{ margin: '4px 4px 0' }}>
          Première fois avec ce format : indique où se trouvent la date, le libellé et le montant. Ce sera mémorisé pour
          les prochains imports.
        </p>
        <div className="kv small" style={{ marginTop: 8 }}>
          <span>Fichier</span>
          <span>{fileName}</span>
        </div>
        <div className="kv small">
          <span>Encodage · séparateur</span>
          <span>
            {encoding === 'utf-8' ? 'UTF-8' : 'ISO-8859-1'} · {DELIMITER_NAMES[analysis.delimiter] ?? analysis.delimiter}
          </span>
        </div>
      </div>

      <div className="section">
        <label className="field">
          <span className="label">Ligne des titres de colonnes</span>
          <select className="select" value={m.headerRow} onChange={(e) => set({ headerRow: Number(e.target.value) })}>
            <option value={-1}>Aucune (le tableau commence directement)</option>
            {headerChoices.map((r, i) => (
              <option key={i} value={i}>
                Ligne {i + 1} : {r.filter(Boolean).join(' | ').slice(0, 60) || '(vide)'}
              </option>
            ))}
          </select>
        </label>

        <div className="table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                {names.map((n, i) => (
                  <th key={i}>{n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows
                .slice(Math.max(m.headerRow + 1, 0))
                .filter((r) => r.some((c) => c))
                .slice(0, 4)
                .map((r, i) => (
                  <tr key={i}>
                    {names.map((_, c) => (
                      <td key={c}>{r[c] ?? ''}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <label className="field">
          <span className="label">Date</span>
          {select(m.dateCol, (v) => set({ dateCol: v }))}
        </label>
        <label className="field">
          <span className="label">Format de date</span>
          <select className="select" value={m.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}>
            {DATE_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Libellé</span>
          {select(m.labelCols[0] ?? -1, (v) => set({ labelCols: [v, ...m.labelCols.slice(1).filter((c) => c !== v)] }))}
        </label>
        <label className="field">
          <span className="label">Complément de libellé (facultatif)</span>
          {select(
            m.labelCols[1] ?? -1,
            (v) => set({ labelCols: v < 0 ? m.labelCols.slice(0, 1) : [m.labelCols[0], v] }),
            true,
          )}
        </label>

        <span className="label" style={{ display: 'block', margin: '0 4px 6px' }}>
          Montant
        </span>
        <Segmented
          options={[
            { value: 'single', label: 'Une colonne' },
            { value: 'split', label: 'Débit et Crédit' },
          ]}
          value={m.amountMode}
          onChange={(v) =>
            set({
              amountMode: v,
              debitCol: m.debitCol >= 0 ? m.debitCol : m.amountCol,
              creditCol: m.creditCol >= 0 ? m.creditCol : Math.min(m.amountCol + 1, columnCount - 1),
            })
          }
        />
        {m.amountMode === 'single' ? (
          <label className="field">
            <span className="label">Colonne du montant (négatif = dépense)</span>
            {select(m.amountCol, (v) => set({ amountCol: v }))}
          </label>
        ) : (
          <>
            <label className="field">
              <span className="label">Colonne Débit (dépenses)</span>
              {select(m.debitCol, (v) => set({ debitCol: v }))}
            </label>
            <label className="field">
              <span className="label">Colonne Crédit (revenus)</span>
              {select(m.creditCol, (v) => set({ creditCol: v }))}
            </label>
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={m.invert} onChange={(e) => set({ invert: e.target.checked })} />
          <span>
            Inverser le signe
            <span className="small muted" style={{ display: 'block' }}>
              À cocher si tes dépenses apparaissent en positif dans l’aperçu.
            </span>
          </span>
        </label>
      </div>

      <div className="section">
        <div className="section-title">Aperçu du résultat</div>
        {result.items.length === 0 ? (
          <div className="notice warn">
            <div className="row-main">
              <div className="row-title">Aucune opération reconnue avec ces réglages</div>
              <div className="small muted">Vérifie la colonne et le format de la date, puis la colonne du montant.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Libellé</th>
                    <th style={{ textAlign: 'right' }}>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.slice(0, 6).map((it, i) => (
                    <tr key={i}>
                      <td>{formatDate(it.date)}</td>
                      <td>{it.label}</td>
                      <td className="num">{formatEUR(it.amountCents, { sign: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ margin: '0 4px' }}>
              {plural(result.items.length, 'opération reconnue', 'opérations reconnues')}
              {result.skipped > 0 && ` · ${plural(result.skipped, 'ligne ignorée', 'lignes ignorées')} (soldes, totaux…)`}
            </p>
          </>
        )}
      </div>

      <div className="section">
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Mémoriser ce format pour les prochains imports</span>
        </label>
        {remember && (
          <label className="field">
            <span className="label">Nom du format</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Crédit Agricole" />
          </label>
        )}
      </div>

      <div className="bottom-bar">
        <div>
          <button
            className="btn btn-primary btn-block"
            disabled={result.items.length === 0}
            onClick={() => onConfirm(m, name.trim() || 'Ma banque', remember)}
          >
            Continuer
          </button>
        </div>
      </div>
    </>
  );
}
