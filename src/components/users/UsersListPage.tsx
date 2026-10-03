import Link from 'next/link';
import { has, isSystemScope, type AuthUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { listUsers, manageableRoles, type ListQuery } from '@/lib/users';
import { localBodyScope } from '@/lib/scope';
import { fmtDate } from '@/lib/format';
import { ClickableRow } from '@/components/ClickableRow';
import { Empty } from '@/components/ui';
import { NewUserButton } from './NewUserButton';

/** Staff directory shared by /admin/users and /office/users. Data is filtered by the viewer's jurisdiction on the server. */
export async function UsersListPage({ u, portal, sp }: { u: AuthUser; portal: 'ADMIN' | 'OFFICE'; sp: ListQuery }) {
  const { t, lang } = await getT();
  const base = portal === 'ADMIN' ? '/admin/users' : '/office/users';
  const apiBase = portal === 'ADMIN' ? '/api/admin/users' : '/api/office/users';
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const [{ rows, total, page, pageSize }, roles, lbs, manageable] = await Promise.all([
    listUsers(u, sp),
    sql`SELECT code, name_en, name_ta FROM roles WHERE code <> 'CITIZEN' ORDER BY rank DESC, name_en`,
    sql`SELECT lb.id, lb.name_en, lb.name_ta FROM local_bodies lb WHERE lb.status = 'ACTIVE' AND (${localBodyScope(u)}) ORDER BY lb.name_en`,
    manageableRoles(u),
  ]);
  const canCreate = manageable.length > 0;
  const manageableCodes = new Set(manageable.map((r) => r.code));
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v !== undefined && v !== '') as [string, string][]);
    return `?${p}`;
  };
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-slate-800">👥 {t('users.title')} <span className="text-sm font-normal text-slate-500">({total})</span></h1>
        <div className="flex flex-wrap gap-2">
          {portal === 'ADMIN' && has(u, 'user.bulk_upload') && <Link href="/admin/users/bulk" className="btn btn-outline">📥 {t('admin.bulkUpload')}</Link>}
          {canCreate && <NewUserButton apiBase={apiBase} basePath={base} />}
        </div>
      </div>
      <form className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-6">
        <input name="q" defaultValue={sp.q} placeholder={t('users.searchPh')} className="input col-span-2" />
        <select name="role" defaultValue={sp.role ?? ''} className="input">
          <option value="">{t('users.role')}: {t('common.all')}</option>
          {roles.map((r) => <option key={r.code as string} value={r.code as string}>{L(r.name_en, r.name_ta)}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className="input">
          <option value="">{t('users.status')}: {t('common.all')}</option>
          <option value="ACTIVE">{t('users.ACTIVE')}</option><option value="INACTIVE">{t('users.INACTIVE')}</option>
        </select>
        {lbs.length > 1 ? (
          <select name="lb" defaultValue={sp.lb ?? ''} className="input">
            <option value="">{t('users.localBody')}: {t('common.all')}</option>
            {lbs.map((l) => <option key={l.id as number} value={l.id as number}>{L(l.name_en, l.name_ta)}</option>)}
          </select>
        ) : <span />}
        <div className="flex gap-2">
          <select name="sort" defaultValue={sp.sort ?? ''} className="input" aria-label={t('admin.sort')}>
            <option value="">{t('admin.sort')}: {t('users.role')}</option>
            <option value="name">{t('reg.fullName')}</option><option value="created">{t('users.createdAt')}</option>
            <option value="login">{t('admin.lastLogin')}</option><option value="status">{t('users.status')}</option>
          </select>
          <button className="btn btn-outline">{t('office.apply')}</button>
        </div>
      </form>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty icon="👥">{t('admin.noUsers')}</Empty> : (
          <table className="table-std">
            <thead><tr>
              <th>{t('reg.fullName')}</th><th>{t('users.role')}</th><th>{t('users.jurisdiction')}</th>
              <th>{t('auth.mobile')}</th><th>{t('users.status')}</th><th>{t('admin.lastLogin')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <ClickableRow key={r.id as string} href={`${base}/${r.id}`}>
                  <td><Link href={`${base}/${r.id}`} className="font-semibold text-navy-700 hover:underline">{r.full_name as string}</Link>
                    <div className="font-mono text-xs text-slate-500">{r.username as string}{r.employee_id ? ` · ${r.employee_id}` : ''}</div></td>
                  <td className="whitespace-nowrap">{L(r.role_en, r.role_ta)}{!manageableCodes.has(r.role as string) && <span className="ml-1 text-xs text-slate-400" title={t('users.protected')}>🔒</span>}
                    <div className="text-xs text-slate-500">{(r.designation as string) ?? ''}</div></td>
                  <td className="text-xs">{[L(r.lb_en, r.lb_ta), L(r.dept_en, r.dept_ta), r.ward_number != null ? `${t('complaint.ward')} ${r.ward_number}` : null, r.supervisor_name ? `↑ ${r.supervisor_name}` : null].filter(Boolean).join(' · ') || (r.portal === 'ADMIN' ? t('admin.stateWide') : '—')}</td>
                  <td className="font-mono text-xs">{r.mobile as string}<div className="text-slate-400">{(r.email as string) ?? ''}</div></td>
                  <td><span className={`badge ${r.status === 'ACTIVE' ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-200 text-slate-600'}`}>{t(`users.${r.status}` as never)}</span>
                    {r.must_change_password && <div className="mt-0.5 text-[10px] text-amber-700">🔑 {t('admin.mustChange')}</div>}</td>
                  <td className="whitespace-nowrap text-xs text-slate-500">{r.last_login_at ? fmtDate(r.last_login_at as string, lang) : '—'}</td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {page > 1 ? <Link className="btn btn-outline btn-sm" href={qs({ page: page - 1 })}>←</Link> : <span />}
          <span>{page} / {pages}</span>
          {page < pages && <Link className="btn btn-outline btn-sm" href={qs({ page: page + 1 })}>→</Link>}
        </div>
      )}
      {!isSystemScope(u) && <p className="text-xs text-slate-400">{t('admin.jurisdictionNote')}</p>}
    </div>
  );
}
