import Link from 'next/link';
import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { auditWhere } from '@/lib/audit-query';
import { auditLabel, auditSummary, AUDIT_LABELS } from '@/lib/audit-labels';
import { fmtDateTime } from '@/lib/format';
import { Tabs } from '@/components/admin/Tabs';

type F = { action?: string; group?: string; entity?: string; actor?: string; target?: string; from?: string; to?: string; page?: string; ref?: string; tab?: string; event?: string };

function device(ua: unknown) {
  const s = String(ua ?? '');
  if (!s) return '';
  const os = /Android/i.test(s) ? 'Android' : /iPhone|iPad/i.test(s) ? 'iOS' : /Windows/i.test(s) ? 'Windows' : /Mac OS/i.test(s) ? 'macOS' : /Linux/i.test(s) ? 'Linux' : '';
  const br = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : /node|curl/i.test(s) ? 'Script' : '';
  return [br, os].filter(Boolean).join(' / ');
}

export default async function Audit({ searchParams }: { searchParams: Promise<F> }) {
  const u = await requirePageUser('ADMIN', ['audit.view', 'audit.manage']);
  const { t, lang } = await getT();
  const f = await searchParams;
  const tab = f.tab === 'security' && has(u, 'audit.manage') ? 'security' : 'audit';
  const page = Math.max(1, Number(f.page ?? 1) || 1);
  const tabs: [string, string][] = [['audit', t('admin.auditTab')]];
  if (has(u, 'audit.manage')) tabs.push(['security', t('admin.securityTab')]);
  const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== 'page') as [string, string][]).toString();
  const groups = [...new Set(Object.values(AUDIT_LABELS).map((v) => v.group))];

  if (tab === 'security') {
    const ev = f.event && /^[A-Z_]+$/.test(f.event) ? f.event : null;
    const rows = await sql`
      SELECT s.id, s.created_at, s.event, s.portal, s.identifier, s.ip_address, s.user_agent, s.detail, x.full_name, x.id AS uid, count(*) OVER()::int AS total
      FROM security_logs s LEFT JOIN users x ON x.id = s.user_id WHERE ${ev ? sql`s.event = ${ev}` : sql`TRUE`}
      ORDER BY s.created_at DESC LIMIT 100 OFFSET ${(page - 1) * 100}`;
    const total = (rows[0]?.total as number) ?? 0;
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-extrabold text-slate-800">🧾 {t('nav.audit')}</h1>
        <Tabs tabs={tabs} active="security" base="/admin/audit" />
        <p className="text-sm text-slate-500">{t('admin.securityIntro')}</p>
        <form className="card flex flex-wrap gap-2 p-3"><input type="hidden" name="tab" value="security" />
          <select name="event" defaultValue={ev ?? ''} className="input max-w-xs"><option value="">{t('common.all')}</option>
            {['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_LOCKED', 'LOGIN_BLOCKED', 'LOGOUT'].map((e) => <option key={e}>{e}</option>)}</select>
          <button className="btn btn-outline">{t('office.apply')}</button></form>
        <div className="card overflow-x-auto"><table className="table-std text-sm">
          <thead><tr><th>{t('admin.when')}</th><th>{t('admin.event')}</th><th>{t('admin.account')}</th><th>{t('admin.portal')}</th><th>IP</th><th>{t('admin.device')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id as number}>
              <td className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at as string, lang)}</td>
              <td><span className={`badge ${r.event === 'LOGIN_SUCCESS' || r.event === 'LOGOUT' ? 'bg-slate-100 text-slate-700' : 'bg-red-100 text-red-700'}`}>{r.event as string}</span></td>
              <td className="text-xs">{r.uid ? <Link className="text-navy-700 underline" href={`/admin/users/${r.uid}`}>{r.full_name as string}</Link> : '—'}<div className="font-mono text-slate-400">{(r.identifier as string) ?? ''}</div></td>
              <td className="text-xs">{(r.portal as string) ?? ''}</td><td className="text-xs text-slate-500">{(r.ip_address as string) ?? '—'}</td><td className="text-xs text-slate-500">{device(r.user_agent)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="flex justify-center gap-3 text-sm">
          {page > 1 && <Link className="btn btn-outline btn-sm" href={`?${qs}&page=${page - 1}`}>←</Link>}<span>{page} / {Math.max(1, Math.ceil(total / 100))}</span>
          {page * 100 < total && <Link className="btn btn-outline btn-sm" href={`?${qs}&page=${page + 1}`}>→</Link>}
        </div>
      </div>
    );
  }

  const rows = await sql`
    SELECT a.id, a.created_at, a.actor_role, au.full_name AS actor, au.id AS actor_id, a.action, a.entity_type, a.entity_id, tu.full_name AS target, tu.id AS target_id,
           tr.code AS target_role, a.old_value, a.new_value, a.reason, a.ip_address, a.user_agent, count(*) OVER()::int AS total
    FROM audit_logs a LEFT JOIN users au ON au.id = a.actor_id LEFT JOIN users tu ON tu.id = a.target_user_id LEFT JOIN roles tr ON tr.id = tu.role_id
    WHERE ${auditWhere(f)} ORDER BY a.created_at DESC LIMIT 100 OFFSET ${(page - 1) * 100}`;
  const total = (rows[0]?.total as number) ?? 0;
  const targetHref = (r: Record<string, unknown>) => (r.target_id ? (r.target_role === 'CITIZEN' ? `/admin/citizens/${r.target_id}` : `/admin/users/${r.target_id}`) : null);
  const entityHref = (r: Record<string, unknown>) => (r.entity_type === 'complaint' ? `/admin/complaints/${r.entity_id}` : r.entity_type === 'local_bodies' ? `/admin/local-bodies/${r.entity_id}` : null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-slate-800">🧾 {t('nav.audit')} <span className="text-sm font-normal text-slate-500">({total}) · {t('admin.appendOnly')}</span></h1>
        <a className="btn btn-navy btn-sm" href={`/api/admin/audit/export?${qs}`}>⬇️ {t('common.export')}</a>
      </div>
      <Tabs tabs={tabs} active="audit" base="/admin/audit" />
      <form className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-7">
        <select name="group" defaultValue={f.group ?? ''} className="input"><option value="">{t('admin.category')}: {t('common.all')}</option>{groups.map((g) => <option key={g}>{g}</option>)}</select>
        <select name="action" defaultValue={f.action ?? ''} className="input"><option value="">{t('admin.event')}: {t('common.all')}</option>
          {Object.entries(AUDIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <input name="actor" defaultValue={f.actor} placeholder={t('admin.actor')} className="input" />
        <input name="target" defaultValue={f.target} placeholder={t('admin.target')} className="input" />
        <input type="date" name="from" defaultValue={f.from} className="input" aria-label="from" />
        <input type="date" name="to" defaultValue={f.to} className="input" aria-label="to" />
        <button className="btn btn-outline">{t('office.apply')}</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table-std">
          <thead><tr><th>{t('admin.when')}</th><th>{t('admin.actor')}</th><th>{t('admin.event')}</th><th>{t('admin.target')}</th><th>{t('admin.change')}</th><th>{t('admin.reason')}</th><th>IP / {t('admin.device')}</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const l = auditLabel(r.action as string);
              const nv = (r.new_value ?? {}) as Record<string, unknown>;
              const pw = ['PASSWORD_CHANGED', 'PASSWORD_RESET', 'user.password_change', 'user.password_reset'].includes(r.action as string);
              const th = targetHref(r); const eh = entityHref(r);
              return (
                <tr key={r.id as number}>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at as string, lang)}</td>
                  <td className="text-xs">{r.actor_id ? <Link className="font-semibold text-navy-700 hover:underline" href={`/admin/users/${r.actor_id}`}>{r.actor as string}</Link> : <b>System</b>}<div className="text-slate-400">{r.actor_role as string}</div></td>
                  <td className="text-sm"><span aria-hidden>{l.icon}</span> <b>{l.label}</b><div className="font-mono text-[10px] text-slate-400">{r.action as string}</div></td>
                  <td className="text-xs">{th ? <Link className="text-navy-700 underline" href={th}>{r.target as string}</Link> : null}
                    {r.entity_id && !th ? (eh ? <Link className="font-mono text-navy-700 underline" href={eh}>{String(r.entity_id)}</Link> : <span>{r.entity_type as string} · {String(r.entity_id).slice(0, 14)}</span>) : null}
                    {!th && !r.entity_id ? '—' : null}</td>
                  <td className="max-w-md text-[11px] text-slate-600">
                    {pw ? <span>🔑 {t('admin.passwordChangedNoValue')}{nv.source ? ` · ${String(nv.source).replace(/_/g, ' ').toLowerCase()}` : ''}</span>
                      : <span className="line-clamp-3" title={auditSummary(r.old_value, r.new_value)}>{auditSummary(r.old_value, r.new_value)}</span>}
                  </td>
                  <td className="max-w-[12rem] text-xs italic text-slate-600">{(r.reason as string) ?? ''}</td>
                  <td className="text-xs text-slate-400">{(r.ip_address as string) ?? '—'}<div>{device(r.user_agent)}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-center gap-3 text-sm">
        {page > 1 && <Link className="btn btn-outline btn-sm" href={`?${qs}&page=${page - 1}`}>←</Link>}
        <span>{page} / {Math.max(1, Math.ceil(total / 100))}</span>
        {page * 100 < total && <Link className="btn btn-outline btn-sm" href={`?${qs}&page=${page + 1}`}>→</Link>}
      </div>
    </div>
  );
}
