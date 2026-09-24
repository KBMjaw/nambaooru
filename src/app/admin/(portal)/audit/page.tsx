import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { auditWhere } from '@/lib/audit-query';
import { fmtDateTime } from '@/lib/format';

type F = { action?: string; entity?: string; actor?: string; from?: string; to?: string; page?: string; ref?: string };

export default async function Audit({ searchParams }: { searchParams: Promise<F> }) {
  await requirePageUser('ADMIN', 'audit.view');
  const { t, lang } = await getT();
  const f = await searchParams;
  const page = Math.max(1, Number(f.page ?? 1) || 1);
  const rows = await sql`
    SELECT a.id, a.created_at, a.actor_role, au.full_name AS actor, au.username, a.action, a.entity_type, a.entity_id, tu.username AS target,
           a.old_value, a.new_value, a.ip_address, count(*) OVER()::int AS total
    FROM audit_logs a LEFT JOIN users au ON au.id = a.actor_id LEFT JOIN users tu ON tu.id = a.target_user_id
    WHERE ${auditWhere(f)} ORDER BY a.created_at DESC LIMIT 100 OFFSET ${(page - 1) * 100}`;
  const total = (rows[0]?.total as number) ?? 0;
  const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== 'page') as [string, string][]).toString();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-slate-800">🧾 {t('nav.audit')} <span className="text-sm font-normal text-slate-500">({total}) · append-only</span></h1>
        <a className="btn btn-navy btn-sm" href={`/api/admin/audit/export?${qs}`}>⬇️ {t('common.export')}</a>
      </div>
      <form className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-6">
        <input name="action" defaultValue={f.action} placeholder="action (e.g. user.)" className="input" />
        <select name="entity" defaultValue={f.entity ?? ''} className="input">
          <option value="">entity: all</option>
          {['user', 'complaint', 'role', 'system_setting', 'data_source', 'districts', 'local_bodies', 'wards', 'streets', 'departments', 'complaint_categories', 'sla_rules', 'routing_rules', 'postal_locations'].map((e) => <option key={e}>{e}</option>)}
        </select>
        <input name="actor" defaultValue={f.actor} placeholder="actor" className="input" />
        <input type="date" name="from" defaultValue={f.from} className="input" />
        <input type="date" name="to" defaultValue={f.to} className="input" />
        <button className="btn btn-outline">{t('office.apply')}</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table-std">
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Target</th><th>Previous → New</th><th>IP</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id as number}>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at as string, lang)}</td>
                <td className="text-xs"><b>{(r.actor as string) ?? 'System'}</b><div className="text-slate-400">{r.actor_role as string}</div></td>
                <td><code className="text-xs">{r.action as string}</code></td>
                <td className="text-xs">{r.entity_type as string}{r.entity_id ? <> · {r.entity_type === 'complaint' ? <span className="font-mono">{r.entity_id as string}</span> : String(r.entity_id).slice(0, 12)}</> : null}</td>
                <td className="text-xs">{(r.target as string) ?? '—'}</td>
                <td className="max-w-md text-[11px]">
                  {r.old_value != null && <div className="truncate text-red-700" title={JSON.stringify(r.old_value)}>− {JSON.stringify(r.old_value)}</div>}
                  {r.new_value != null && <div className="truncate text-leaf-700" title={JSON.stringify(r.new_value)}>+ {JSON.stringify(r.new_value)}</div>}
                </td>
                <td className="text-xs text-slate-400">{(r.ip_address as string) ?? '—'}</td>
              </tr>
            ))}
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
