'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { compressImage, getLocation } from '@/lib/image';
import { fmtDateTime } from '@/lib/format';
import { Alert, Spinner } from '@/components/ui';
import { PriorityBadge } from '@/components/badges';
import type { UserOpt } from './ActionForm';

export interface ActionRow {
  id: number; title: string; description: string | null; department_id: number | null; dept_en: string | null; priority: string; due_at: string | null;
  status: string; notes: string | null; created_by_name: string; created_at: string; updated_at: string; updated_by_name: string | null; verified_by_name: string | null;
  assignees: { user_id: string; assignee_role: string; full_name: string; role_en: string; designation: string | null }[];
  updates: { id: number; full_name: string; from_status: string | null; to_status: string | null; note: string | null; evidence_id: number | null; created_at: string }[];
}
interface Perms { create: boolean; edit: boolean; verify: boolean; work: boolean }

const STATUS_CLS: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700', ASSIGNED: 'bg-navy-50 text-navy-800', IN_PROGRESS: 'bg-amber-100 text-amber-900',
  COMPLETED: 'bg-violet-100 text-violet-800', VERIFIED: 'bg-leaf-100 text-leaf-800', CANCELLED: 'bg-slate-200 text-slate-500 line-through',
};

/** Work actions inside a complaint, with primary + supporting assignees. The API enforces every rule again. */
export function ActionsPanel({ code, portal, actions, staff, departments, perms, meId, open }: {
  code: string; portal: 'OFFICE' | 'ADMIN'; actions: ActionRow[]; staff: UserOpt[]; departments: { id: number; name_en: string }[]; perms: Perms; meId: string; open: boolean;
}) {
  const { t, lang } = useI18n();
  const [form, setForm] = useState<ActionRow | 'new' | null>(null);
  const base = `/api/complaints/${encodeURIComponent(code)}/actions`;
  return (
    <div className="space-y-3">
      {perms.create && open && !form && <button className="btn btn-primary btn-sm" onClick={() => setForm('new')}>+ {t('actions.add')}</button>}
      {form && <ActionEditor base={base} portal={portal} action={form === 'new' ? null : form} staff={staff} departments={departments} onDone={() => setForm(null)} />}
      {actions.length === 0 && !form && <p className="text-sm text-slate-500">{t('actions.none')}</p>}
      <ul className="space-y-2">
        {actions.map((a) => {
          const mine = a.assignees.some((x) => x.user_id === meId);
          return (
            <li key={a.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-slate-800">🛠️ {a.title}</b>
                <span className={`badge ${STATUS_CLS[a.status] ?? ''}`}>{t(`actionStatus.${a.status}` as never)}</span>
                <PriorityBadge priority={a.priority} />
                {a.due_at && <span className={`text-xs ${new Date(a.due_at) < new Date() && !['COMPLETED', 'VERIFIED', 'CANCELLED'].includes(a.status) ? 'font-bold text-red-600' : 'text-slate-500'}`}>⏳ {fmtDateTime(a.due_at, lang)}</span>}
                {a.dept_en && <span className="text-xs text-slate-500">🏛️ {a.dept_en}</span>}
              </div>
              {a.description && <p className="mt-1 text-sm text-slate-700">{a.description}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                {a.assignees.map((x) => (
                  <span key={x.user_id} className={`badge ${x.assignee_role === 'PRIMARY' ? 'bg-navy-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
                    {x.assignee_role === 'PRIMARY' ? '★ ' : ''}{x.full_name} · {x.designation ?? x.role_en}
                  </span>
                ))}
                {!a.assignees.length && <span className="text-slate-400">{t('actions.unassigned')}</span>}
              </div>
              {a.notes && <p className="mt-1 text-xs italic text-slate-600">📝 {a.notes}</p>}
              <p className="mt-1 text-[11px] text-slate-400">{t('actions.createdBy')} {a.created_by_name} · {fmtDateTime(a.created_at, lang)}{a.verified_by_name ? ` · ✔ ${a.verified_by_name}` : ''}</p>
              <ActionButtons base={base} portal={portal} a={a} perms={perms} mine={mine} onEdit={() => setForm(a)} />
              {a.updates.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-slate-500">{t('admin.history')} ({a.updates.length})</summary>
                  <ol className="mt-1 space-y-1 border-l-2 border-slate-200 pl-2">
                    {a.updates.map((up) => (
                      <li key={up.id}>
                        <b>{up.from_status && up.from_status !== up.to_status ? `${up.from_status} → ${up.to_status}` : up.from_status ? '✏️' : `➕ ${up.to_status}`}</b> · {up.full_name} · {fmtDateTime(up.created_at, lang)}
                        {up.note && <div className="text-slate-600">{up.note}</div>}
                        {up.evidence_id && <a href={`/api/evidence/${up.evidence_id}`} target="_blank" rel="noopener noreferrer"><img src={`/api/evidence/${up.evidence_id}`} alt="" className="mt-1 h-20 w-28 rounded object-cover" /></a>}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActionButtons({ base, portal, a, perms, mine, onEdit }: { base: string; portal: string; a: ActionRow; perms: Perms; mine: boolean; onEdit: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<null | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED' | 'CANCELLED' | 'SEND_BACK' | 'PENDING'>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canWork = mine && perms.work;
  const needsReason = mode === 'CANCELLED' || mode === 'SEND_BACK' || mode === 'PENDING';

  async function submit() {
    if (!mode) return;
    setBusy(true); setErr(null);
    const to = mode === 'SEND_BACK' ? 'IN_PROGRESS' : mode;
    const data: Record<string, unknown> = { status: to, note: note || null, reason: needsReason ? note : null };
    try {
      if (photo) {
        try { const g = await getLocation(); Object.assign(data, { latitude: g.latitude, longitude: g.longitude, accuracy: g.accuracy }); } catch { /* location optional for action evidence */ }
        const fd = new FormData(); fd.set('data', JSON.stringify(data)); fd.set('photo', photo.file);
        await api(`${base}/${a.id}?portal=${portal}`, { method: 'PATCH', form: fd });
      } else await api(`${base}/${a.id}?portal=${portal}`, { method: 'PATCH', body: data });
      setMode(null); setNote(''); setPhoto(null); router.refresh();
    } catch (e) { setErr(trMsg(t, (e as Error).message)); }
    finally { setBusy(false); }
  }
  const btn = (m: NonNullable<typeof mode>, label: string, cls = 'btn-outline') => <button className={`btn ${cls} btn-sm`} onClick={() => { setMode(m); setErr(null); }}>{label}</button>;
  const s = a.status;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {(canWork || perms.edit) && ['PENDING', 'ASSIGNED'].includes(s) && btn('IN_PROGRESS', `▶️ ${t('actions.start')}`)}
        {(canWork || perms.edit) && s === 'IN_PROGRESS' && btn('COMPLETED', `✅ ${t('actions.complete')}`, 'btn-primary')}
        {perms.verify && !mine && s === 'COMPLETED' && btn('VERIFIED', `✔️ ${t('actions.verify')}`, 'btn-primary')}
        {perms.edit && s === 'COMPLETED' && btn('SEND_BACK', `↩️ ${t('office.sendBack')}`)}
        {perms.edit && !['VERIFIED', 'CANCELLED'].includes(s) && <button className="btn btn-ghost btn-sm" onClick={onEdit}>✏️ {t('common.edit')}</button>}
        {perms.edit && !['VERIFIED', 'CANCELLED', 'COMPLETED'].includes(s) && btn('CANCELLED', `✖ ${t('actions.cancel')}`, 'btn-ghost text-red-600')}
        {perms.edit && s === 'CANCELLED' && btn('PENDING', `↺ ${t('actions.restore')}`, 'btn-ghost')}
      </div>
      {mode && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-2.5">
          {err && <Alert tone="error">{err}</Alert>}
          <textarea className="input min-h-16" placeholder={needsReason ? `${t('admin.reason')} *` : t('office.note')} value={note} onChange={(e) => setNote(e.target.value)} />
          {(mode === 'COMPLETED' || mode === 'IN_PROGRESS') && (
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>📷 {t('report.takePhoto')}</button>
              {photo && <img src={photo.url} alt="" className="h-14 w-14 rounded object-cover" />}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try { const c = await compressImage(f); setPhoto({ file: c.file, url: c.url }); } catch { setErr(t('err.fileType')); }
                e.target.value = '';
              }} />
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn btn-outline btn-sm" onClick={() => setMode(null)}>{t('common.cancel')}</button>
            <button className="btn btn-primary btn-sm" disabled={busy || (needsReason && note.trim().length < 3)} onClick={submit}>{busy && <Spinner className="h-4 w-4" />}{t('office.confirm')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionEditor({ base, portal, action, staff, departments, onDone }: { base: string; portal: string; action: ActionRow | null; staff: UserOpt[]; departments: { id: number; name_en: string }[]; onDone: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const primary0 = action?.assignees.find((x) => x.assignee_role === 'PRIMARY')?.user_id ?? '';
  const [f, setF] = useState({
    title: action?.title ?? '', description: action?.description ?? '', departmentId: action?.department_id ? String(action.department_id) : '',
    priority: action?.priority ?? 'MEDIUM', dueAt: action?.due_at ? action.due_at.slice(0, 10) : '', notes: action?.notes ?? '', primary: primary0, reason: '',
  });
  const [support, setSupport] = useState<Set<string>>(new Set(action?.assignees.filter((x) => x.assignee_role === 'SUPPORT').map((x) => x.user_id) ?? []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const known = new Map(staff.map((s) => [s.id, s]));
  for (const x of action?.assignees ?? []) if (!known.has(x.user_id)) known.set(x.user_id, { id: x.user_id, full_name: x.full_name, role: '', role_name: x.role_en });
  const people = [...known.values()];
  async function save() {
    setBusy(true); setErr(null);
    const assignees = [...(f.primary ? [{ userId: f.primary, role: 'PRIMARY' }] : []), ...[...support].filter((x) => x !== f.primary).map((userId) => ({ userId, role: 'SUPPORT' }))];
    const body = { title: f.title, description: f.description || null, departmentId: f.departmentId || null, priority: f.priority, dueAt: f.dueAt || null, notes: f.notes || null, assignees, reason: f.reason || null };
    try {
      if (action) await api(`${base}/${action.id}?portal=${portal}`, { method: 'PATCH', body });
      else await api(`${base}?portal=${portal}`, { body });
      onDone(); router.refresh();
    } catch (e) { setErr(trMsg(t, (e as Error).message)); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-2 rounded-xl border border-navy-200 bg-navy-50/40 p-3">
      <p className="font-bold">{action ? `✏️ ${t('common.edit')}` : `+ ${t('actions.add')}`}</p>
      {err && <Alert tone="error">{err}</Alert>}
      <input className="input" placeholder={`${t('actions.title')} * — e.g. Replace streetlight`} value={f.title} onChange={(e) => set('title', e.target.value)} />
      <textarea className="input" rows={2} placeholder={t('admin.description')} value={f.description} onChange={(e) => set('description', e.target.value)} />
      <div className="grid gap-2 sm:grid-cols-3">
        <select className="input" value={f.departmentId} onChange={(e) => set('departmentId', e.target.value)} aria-label={t('users.department')}>
          <option value="">{t('users.department')}…</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name_en}</option>)}
        </select>
        <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value)} aria-label={t('office.priority')}>
          {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => <option key={p} value={p}>{t(`priority.${p}` as never)}</option>)}
        </select>
        <input type="date" className="input" value={f.dueAt} onChange={(e) => set('dueAt', e.target.value)} aria-label={t('office.dueDate')} />
      </div>
      <label className="block"><span className="label">★ {t('actions.primary')}</span>
        <select className="input" value={f.primary} onChange={(e) => set('primary', e.target.value)}>
          <option value="">{t('actions.unassigned')}</option>{people.map((u) => <option key={u.id} value={u.id}>{u.full_name} — {u.role_name ?? u.role}{u.designation ? ` (${u.designation})` : ''}</option>)}
        </select></label>
      <fieldset className="rounded-lg border border-slate-200 bg-white p-2">
        <legend className="px-1 text-xs font-bold text-slate-600">{t('office.supportingAssignees')}</legend>
        <div className="max-h-40 space-y-0.5 overflow-y-auto">
          {people.filter((u) => u.id !== f.primary).map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={support.has(u.id)}
              onChange={(e) => setSupport((s) => { const n = new Set(s); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n; })} />{u.full_name} <span className="text-xs text-slate-500">{u.role_name ?? u.role}</span></label>
          ))}
        </div>
      </fieldset>
      <textarea className="input" rows={2} placeholder={t('complaint.notes')} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      {action && <input className="input" placeholder={`${t('admin.reason')} (${t('actions.reasonIfTeam')})`} value={f.reason} onChange={(e) => set('reason', e.target.value)} />}
      <div className="flex gap-2">
        <button className="btn btn-outline btn-sm" onClick={onDone}>{t('common.cancel')}</button>
        <button className="btn btn-primary btn-sm" disabled={busy || f.title.trim().length < 3} onClick={save}>{busy && <Spinner className="h-4 w-4" />}{t('common.save')}</button>
      </div>
    </div>
  );
}
