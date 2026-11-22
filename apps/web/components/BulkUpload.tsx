'use client';

import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  RotateCcw,
  Upload,
  XCircle,
} from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { api, type ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { parseCsv, rowsToCsv, type Cell } from '@/lib/sheet';
import { Button, ErrorBox, IconChip, Modal, Spinner } from './ui';

export interface UploadColumn {
  /** Header name exactly as the API expects it, e.g. `tid`. */
  name: string;
  required?: boolean;
  /** Example value for the template's sample row. */
  example: string;
}

interface ImportResult {
  dryRun: boolean;
  valid: number;
  imported: number;
  errors: Array<{ line: number; message: string }>;
}

/** Same limit as the API's `csv` field. */
const MAX_BYTES = 2_000_000;
const PREVIEW_ROWS = 10;

type State =
  | { step: 'pick' }
  | { step: 'checking'; file: string; csv: string }
  | { step: 'checked'; file: string; csv: string; result: ImportResult }
  | { step: 'importing'; file: string; csv: string; result: ImportResult }
  | { step: 'done'; imported: number };

/**
 * Bulk upload: pick or drop an Excel (.xlsx) or CSV file, see a preview, let the API check every
 * row (dry run), then import. Excel is converted to CSV in the browser, so the API only reads CSV.
 */
export function BulkUpload({
  open,
  onClose,
  title,
  hint,
  endpoint,
  columns,
  templateName,
  reference,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  hint?: string;
  /** API path taking `{ csv, dryRun }`, e.g. `/terminals/import`. */
  endpoint: string;
  columns: UploadColumn[];
  /** File name for the templates, without extension. */
  templateName: string;
  /** Extra sheet in the Excel template (e.g. ids to copy). Its first row is the header. */
  reference?: { sheet: string; rows: string[][] };
  onImported: () => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ step: 'pick' });
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setState({ step: 'pick' });
    setError(undefined);
    if (input.current) input.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };

  const check = async (file: string, csv: string) => {
    setState({ step: 'checking', file, csv });
    try {
      const result = await api<ImportResult>(endpoint, { body: { csv, dryRun: true } });
      setState({ step: 'checked', file, csv, result });
    } catch (e) {
      setError((e as ApiError).message);
      setState({ step: 'pick' });
    }
  };

  const readFile = async (file: File) => {
    setError(undefined);
    if (file.size > MAX_BYTES) return setError(t('upload.tooLarge'));
    try {
      let csv: string;
      if (/\.xlsx$/i.test(file.name)) {
        // Loaded on demand: only people who upload Excel files download the reader.
        const { readSheet } = await import('read-excel-file/browser');
        csv = rowsToCsv((await readSheet(file)) as Cell[][]);
      } else if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
        csv = await file.text();
      } else {
        return setError(t('upload.wrongType'));
      }
      if (parseCsv(csv).length < 2) return setError(t('upload.empty'));
      await check(file.name, csv);
    } catch {
      setError(t('upload.unreadable'));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  const runImport = async () => {
    if (state.step !== 'checked') return;
    setState({ ...state, step: 'importing' });
    try {
      const r = await api<ImportResult>(endpoint, { body: { csv: state.csv, dryRun: false } });
      if (r.dryRun) setState({ step: 'checked', file: state.file, csv: state.csv, result: r });
      else {
        setState({ step: 'done', imported: r.imported });
        onImported();
      }
    } catch (e) {
      setError((e as ApiError).message);
      setState({ ...state, step: 'checked' });
    }
  };

  const downloadCsv = () => {
    const csv = rowsToCsv([columns.map((c) => c.name), columns.map((c) => c.example)]);
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${templateName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const downloadExcel = async () => {
    const { default: writeExcelFile } = await import('write-excel-file/browser');
    const text = (value: string, bold = false) => ({
      value,
      type: String,
      ...(bold ? { fontWeight: 'bold' as const } : {}),
    });
    // Text cells, so ids such as TIDs keep their leading zeros. The upload reads the first sheet.
    const sheets = [
      {
        sheet: 'Upload',
        data: [columns.map((c) => text(c.name, true)), columns.map((c) => text(c.example))],
        columns: columns.map(() => ({ width: 28 })),
        stickyRowsCount: 1,
      },
      ...(reference
        ? [
            {
              sheet: reference.sheet,
              data: reference.rows.map((row, i) => row.map((v) => text(v, i === 0))),
              columns: (reference.rows[0] ?? []).map(() => ({ width: 38 })),
              stickyRowsCount: 1,
            },
          ]
        : []),
    ];
    await writeExcelFile(sheets).toFile(`${templateName}.xlsx`);
  };

  const preview = 'csv' in state ? parseCsv(state.csv) : [];
  const result = 'result' in state ? state.result : undefined;
  const busy = state.step === 'checking' || state.step === 'importing';
  const canImport = state.step === 'checked' && result!.errors.length === 0 && result!.valid > 0;

  return (
    <Modal
      open={open}
      title={title}
      onClose={close}
      footer={
        state.step === 'done' ? (
          <>
            <Button variant="secondary" icon={RotateCcw} onClick={reset}>
              {t('upload.another')}
            </Button>
            <Button onClick={close}>{t('common.close')}</Button>
          </>
        ) : (
          <>
            {state.step !== 'pick' && (
              <Button variant="secondary" icon={RotateCcw} disabled={busy} onClick={reset}>
                {t('upload.chooseAnother')}
              </Button>
            )}
            <Button
              icon={Upload}
              loading={state.step === 'importing'}
              disabled={!canImport}
              onClick={() => void runImport()}
            >
              {result?.valid ? t('upload.import', { count: result.valid }) : t('upload.importNone')}
            </Button>
          </>
        )
      }
    >
      {state.step === 'done' ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <IconChip icon={CheckCircle2} tone="ok" size="lg" />
          <p className="font-medium">{t('upload.done', { count: state.imported })}</p>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {hint && <p className="text-ink-muted">{hint}</p>}

          {/* Columns and templates */}
          <div className="rounded-lg border border-line bg-canvas p-3">
            <div className="mb-2 text-xs font-medium text-ink-muted">{t('upload.columns')}</div>
            <div className="flex flex-wrap gap-1.5">
              {columns.map((c) => (
                <code
                  key={c.name}
                  className="ltr rounded bg-white px-1.5 py-0.5 text-xs ring-1 ring-line"
                >
                  {c.name}
                  {c.required && <span className="text-bad">*</span>}
                </code>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={Download}
                onClick={() => void downloadExcel()}
              >
                {t('upload.templateExcel')}
              </Button>
              <Button size="sm" variant="secondary" icon={Download} onClick={downloadCsv}>
                {t('upload.templateCsv')}
              </Button>
            </div>
          </div>

          {state.step === 'pick' ? (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-brand/40 ${dragging ? 'border-brand bg-brand-50' : 'border-line hover:border-brand/50 hover:bg-canvas'}`}
            >
              <IconChip icon={FileSpreadsheet} size="lg" />
              <span className="font-medium">
                {t('upload.drop')}{' '}
                <span className="text-brand underline">{t('upload.browse')}</span>
              </span>
              <span className="text-xs text-ink-muted">{t('upload.formats')}</span>
              <input
                ref={input}
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                data-testid="bulk-upload-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFile(file);
                }}
              />
            </label>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                <span className="ltr min-w-0 flex-1 truncate font-medium">{state.file}</span>
                <span className="shrink-0 text-xs text-ink-muted">
                  {t('upload.rows', { count: Math.max(0, preview.length - 1) })}
                </span>
              </div>

              {preview.length > 1 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-ink-muted">
                    {t('upload.preview')}
                  </div>
                  <div className="max-h-56 overflow-auto rounded-lg border border-line">
                    <table className="ltr w-full text-xs">
                      <thead className="sticky top-0 bg-canvas">
                        <tr>
                          <th className="px-2 py-1.5 text-start font-medium text-ink-faint">#</th>
                          {preview[0]!.map((h, i) => (
                            <th
                              key={i}
                              className="whitespace-nowrap px-2 py-1.5 text-start font-medium"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.slice(1, PREVIEW_ROWS + 1).map((row, r) => {
                          const line = r + 2;
                          const bad = result?.errors.some((e) => e.line === line);
                          return (
                            <tr
                              key={r}
                              className={`border-t border-line ${bad ? 'bg-bad-bg' : ''}`}
                            >
                              <td className="px-2 py-1 text-ink-faint">{line}</td>
                              {preview[0]!.map((_, c) => (
                                <td key={c} className="whitespace-nowrap px-2 py-1">
                                  {row[c] ?? ''}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {state.step === 'checking' && (
                <p className="flex items-center gap-2 text-ink-muted">
                  <Spinner small /> {t('upload.checking')}
                </p>
              )}
              {result && result.errors.length === 0 && (
                <p className="flex items-center gap-2 rounded-lg bg-ok-bg px-3 py-2 text-ok">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                  {t('upload.ready', { count: result.valid })}
                </p>
              )}
              {result && result.errors.length > 0 && (
                <div className="rounded-lg border border-bad/20 bg-bad-bg p-3 text-bad">
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <XCircle className="h-4 w-4 shrink-0" aria-hidden />
                    {t('upload.fixRows', { count: result.errors.length })}
                  </div>
                  <ul
                    className="max-h-40 space-y-1 overflow-y-auto text-xs"
                    data-testid="bulk-upload-errors"
                  >
                    {result.errors.map((e) => (
                      <li key={`${e.line}-${e.message}`}>
                        <span className="font-medium">
                          {e.line > 0 ? t('upload.row', { line: e.line }) : t('upload.file')}:
                        </span>{' '}
                        <span className="ltr">{e.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <ErrorBox error={error} />
        </div>
      )}
    </Modal>
  );
}
