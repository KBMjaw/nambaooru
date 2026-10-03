'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { Alert } from '@/components/ui';

/** Streets / areas of one ward: add, rename, deactivate (never delete — complaints reference them). */
export function StreetsEditor({ wardId, portal, streets, canEdit }: { wardId: number; portal: 'ADMIN' | 'OFFICE'; streets: { id: number; name_en: string; name_ta: string | null; status: string }[]; canEdit: boolean }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [en, setEn] = useState('');
  const [ta, setTa] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); router.refresh(); } catch (e) { setErr(trMsg(t, (e as Error).message)); } };
  return (
    <div className="space-y-2">
      {err && <Alert tone="error">{err}</Alert>}
      <ul className="space-y-1 text-sm">
        {streets.map((s) => (
          <li key={s.id} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${s.status === 'ACTIVE' ? 'bg-slate-50' : 'bg-slate-50 text-slate-400 line-through'}`}>
            <span>{lang === 'ta' ? s.name_ta || s.name_en : s.name_en}{s.name_ta && lang !== 'ta' ? <span className="text-xs text-slate-400"> · {s.name_ta}</span> : null}</span>
            {canEdit && (
              <span className="flex gap-1">
                <button className="btn btn-ghost btn-sm" onClick={() => { const n = window.prompt(t('admin.renameStreet'), s.name_en); if (n && n.trim() !== s.name_en) void run(() => api(`/api/streets/${s.id}?portal=${portal}`, { method: 'PATCH', body: { nameEn: n.trim() } })); }}>✏️</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { if (window.confirm(s.status === 'ACTIVE' ? t('users.deactivate') : t('users.activate'))) void run(() => api(`/api/streets/${s.id}?portal=${portal}`, { method: 'PATCH', body: { status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } })); }}>{s.status === 'ACTIVE' ? '⏸' : '▶'}</button>
              </span>
            )}
          </li>
        ))}
        {!streets.length && <li className="text-slate-500">—</li>}
      </ul>
      {canEdit && (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (en.trim().length >= 2) void run(async () => { await api(`/api/wards/${wardId}/streets?portal=${portal}`, { body: { nameEn: en.trim(), nameTa: ta.trim() || null } }); setEn(''); setTa(''); }); }}>
          <input className="input flex-1" placeholder={`${t('reg.street')} (EN)`} value={en} onChange={(e) => setEn(e.target.value)} />
          <input className="input flex-1" placeholder={`${t('reg.street')} (த)`} value={ta} onChange={(e) => setTa(e.target.value)} />
          <button className="btn btn-outline">+ {t('admin.addStreet')}</button>
        </form>
      )}
    </div>
  );
}
