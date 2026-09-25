'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { Alert, Spinner, Stat } from '@/components/ui';

interface Result {
  importId: number | null; mode: string; total: number; valid: number; created: number; failed: number; committed: boolean;
  errors: { row: number; field?: string; message: string }[];
  createdUsers: { row: number; username: string; fullName: string; role: string; tempPassword: string | null }[];
}

/** Upload → row-level validation report → import (all-or-nothing, or valid rows only). */
export function BulkUpload() {
  const { t } = useI18n();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'ALL_OR_NOTHING' | 'VALID_ONLY'>('ALL_OR_NOTHING');
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send(m: 'VALIDATE' | 'ALL_OR_NOTHING' | 'VALID_ONLY') {
    if (!file) return;
    setBusy(m); setErr(null);
    const fd = new FormData(); fd.append('file', file); fd.append('mode', m);
    try { const r = await api<Result>('/api/admin/users/bulk', { form: fd }); setRes(r); if (r.committed) router.refresh(); }
    catch (e) { setErr(trMsg(t, (e as Error).message)); setRes(null); }
    finally { setBusy(null); }
  }
  function downloadCreds() {
    if (!res) return;
    const lines = ['Row,Full Name,Username,Role,Temporary Password', ...res.createdUsers.map((c) => [c.row, c.fullName, c.username, c.role, c.tempPassword ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))];
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `nammaooru-import-${res.importId}-credentials.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <h2 className="font-bold text-slate-800">① {t('admin.downloadTemplate')}</h2>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-navy btn-sm" href="/api/admin/users/bulk/template?format=xlsx">⬇️ Excel (.xlsx)</a>
          <a className="btn btn-outline btn-sm" href="/api/admin/users/bulk/template?format=csv">⬇️ CSV</a>
        </div>
        <p className="text-xs text-slate-500">{t('admin.templateNote')}</p>
      </div>
      <div className="card space-y-3 p-4">
        <h2 className="font-bold text-slate-800">② {t('admin.uploadFile')}</h2>
        <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="block text-sm"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); setErr(null); }} />
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'ALL_OR_NOTHING'} onChange={() => setMode('ALL_OR_NOTHING')} /> {t('admin.modeAll')}</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'VALID_ONLY'} onChange={() => setMode('VALID_ONLY')} /> {t('admin.modeValid')}</label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-outline" disabled={!file || !!busy} onClick={() => send('VALIDATE')}>{busy === 'VALIDATE' && <Spinner className="h-4 w-4" />}🔎 {t('admin.validateOnly')}</button>
          <button className="btn btn-primary" disabled={!file || !!busy} onClick={() => send(mode)}>{busy && busy !== 'VALIDATE' && <Spinner className="h-4 w-4" />}📥 {t('admin.importUsers')}</button>
        </div>
      </div>
      {err && <Alert tone="error">{err}</Alert>}
      {res && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('admin.rows')} value={res.total} />
            <Stat label={t('admin.validRows')} value={res.valid} tone="leaf" />
            <Stat label={t('admin.failedRows')} value={res.failed} tone={res.failed ? 'pin' : 'slate'} />
            <Stat label={t('admin.createdRows')} value={res.created} tone="navy" />
          </div>
          <Alert tone={res.committed ? 'success' : res.mode === 'VALIDATE' ? (res.failed ? 'warn' : 'info') : 'error'}>
            {res.mode === 'VALIDATE' ? (res.failed ? t('admin.validateFailed') : t('admin.validateOk'))
              : res.committed ? t('admin.importDone', { n: res.created }) : t('admin.importRolledBack')}
          </Alert>
          {res.errors.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="table-std text-sm">
                <thead><tr><th>{t('admin.row')}</th><th>{t('admin.column')}</th><th>{t('admin.problem')}</th></tr></thead>
                <tbody>{res.errors.map((e, i) => <tr key={i}><td className="font-mono">{e.row}</td><td>{e.field ?? '—'}</td><td className="text-red-700">{trMsg(t, e.message)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {res.committed && res.createdUsers.length > 0 && (
            <div className="card space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold">✅ {t('admin.createdUsers')}</h3>
                <button className="btn btn-navy btn-sm" onClick={downloadCreds}>⬇️ {t('admin.downloadCredentials')}</button>
              </div>
              <p className="text-xs text-amber-800">{t('admin.credentialsOnce')}</p>
              <div className="overflow-x-auto"><table className="table-std text-sm">
                <thead><tr><th>{t('admin.row')}</th><th>{t('reg.fullName')}</th><th>{t('auth.username')}</th><th>{t('users.role')}</th><th>{t('admin.tempPassword')}</th></tr></thead>
                <tbody>{res.createdUsers.map((c) => <tr key={c.row}><td>{c.row}</td><td>{c.fullName}</td><td className="font-mono">{c.username}</td><td>{c.role}</td><td className="font-mono">{c.tempPassword ?? '—'}</td></tr>)}</tbody>
              </table></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
