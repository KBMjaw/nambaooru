import Link from 'next/link';
import { has, isSystemScope, type AuthUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { userDetail, canManageRole } from '@/lib/users';
import { localBodyScope } from '@/lib/scope';
import { auditLabel, auditSummary } from '@/lib/audit-labels';
import { fmtDateTime } from '@/lib/format';
import { Section } from '@/components/ui';
import { UserDetailActions, JurisdictionEditor, PermissionOverrides } from './UserDetailActions';

type Row = Record<string, unknown>;

function jurLabel(j: Row, wardWord: string) {
  return [j.district_en, j.taluk_en, j.lb_en, j.ward_number != null ? `${wardWord} ${j.ward_number}` : null, j.dept_en].filter(Boolean).join(' › ') || 'State-wide';
}

/** User profile with role, jurisdiction, permissions and the full change history (shared by /admin and /office). */
export async function UserDetailPage({ u, portal, id }: { u: AuthUser; portal: 'ADMIN' | 'OFFICE'; id: string }) {
  const { t, lang } = await getT();
  const d = await userDetail(u, id);
  const x = d.user;
  const base = portal === 'ADMIN' ? '/admin/users' : '/office/users';
  const apiBase = portal === 'ADMIN' ? '/api/admin/users' : '/api/office/users';
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const manageable = canManageRole(u, { code: x.role as string, rank: x.rank as number, portal: x.portal as string, default_scope: x.default_scope as never });
  const isSelf = x.id === u.id;
  const [lbs, districts] = manageable ? await Promise.all([
    sql`SELECT lb.id, lb.name_en FROM local_bodies lb WHERE lb.status = 'ACTIVE' AND (${localBodyScope(u)}) ORDER BY lb.name_en`,
    isSystemScope(u) ? sql`SELECT id, name_en FROM districts WHERE status = 'ACTIVE' ORDER BY name_en` : Promise.resolve([]),
  ]) : [[], []];
  const activeJ = d.jurisdictions.filter((j) => !j.revoked_at);
  const pastJ = d.jurisdictions.filter((j) => j.revoked_at);
  const editable = {
    id: x.id as string, username: x.username as string, full_name: x.full_name as string, mobile: x.mobile as string, email: (x.email as string) ?? null,
    role: x.role as string, status: x.status as string, designation: (x.designation as string) ?? null, employee_id: (x.employee_id as string) ?? null,
    department_id: (x.department_id as number) ?? null, local_body_id: (x.local_body_id as number) ?? null, ward_id: (x.ward_id as number) ?? null,
    supervisor_id: (x.supervisor_id as string) ?? null, district_id: (x.district_id as number) ?? null,
  };
  const groups = [...new Set(d.permissions.map((p) => (p.perm_group as string) ?? 'Other'))];

  return (
    <div className="space-y-4">
      <Link href={base} className="text-sm font-semibold text-navy-600">← {t('users.title')}</Link>
      <div className="card flex flex-wrap items-start justify-between gap-3 p-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">{x.full_name as string}</h1>
          <p className="font-mono text-sm text-slate-500">{x.username as string}{x.employee_id ? ` · ${x.employee_id}` : ''}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="badge bg-navy-50 text-navy-800">🎭 {L(x.role_en, x.role_ta)}</span>
            <span className={`badge ${x.status === 'ACTIVE' ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-200 text-slate-600'}`}>{t(`users.${x.status}` as never)}</span>
            <span className="badge bg-slate-100 text-slate-700">{t(`scope.${x.default_scope}` as never)}</span>
            {x.must_change_password && <span className="badge bg-amber-100 text-amber-900">🔑 {t('admin.mustChange')}</span>}
            {!manageable && <span className="badge bg-slate-100 text-slate-500">🔒 {t('users.protected')}</span>}
          </div>
          {x.status !== 'ACTIVE' && x.status_reason && <p className="mt-2 text-sm text-slate-600">{t('admin.reason')}: {x.status_reason as string}</p>}
        </div>
        {manageable && (
          <UserDetailActions apiBase={apiBase} user={editable} canEdit isSelf={isSelf} canReset={has(u, 'user.password_reset') || has(u, 'user.manage.all')} />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title={`🗺️ ${t('users.jurisdiction')}`}>
            <JurisdictionEditor apiBase={apiBase} userId={x.id as string} canEdit={manageable && !isSelf}
              localBodies={lbs.map((l) => ({ id: l.id as number, name: l.name_en as string }))} districts={districts.map((l) => ({ id: l.id as number, name: l.name_en as string }))}
              active={activeJ.map((j) => ({ id: j.id as number, primary: !!j.is_primary, label: jurLabel(j, t('complaint.ward')) }))} />
            {!activeJ.length && <p className="text-sm text-slate-500">{x.default_scope === 'SYSTEM' ? t('admin.stateWide') : '—'}</p>}
            {pastJ.length > 0 && (
              <details className="mt-3 text-xs"><summary className="cursor-pointer text-slate-500">{t('admin.history')} ({pastJ.length})</summary>
                <ul className="mt-1 space-y-1">{pastJ.map((j) => (
                  <li key={j.id as number} className="text-slate-600">{jurLabel(j, t('complaint.ward'))} · {fmtDateTime(j.created_at as string, lang)} → {fmtDateTime(j.revoked_at as string, lang)}{j.reason ? ` · ${j.reason}` : ''}</li>
                ))}</ul>
              </details>
            )}
          </Section>

          <Section title={`🔐 ${t('admin.permissions')} (${d.effective.length})`}>
            {portal === 'ADMIN' && manageable && !isSelf && (has(u, 'permission.manage') || has(u, 'user.manage.all')) ? (
              <PermissionOverrides apiBase={apiBase} userId={x.id as string}
                perms={d.permissions.filter((p) => !p.is_security || has(u, 'user.manage.all')).map((p) => ({ code: p.code as string, label: p.label as string | null, from_role: !!p.from_role, override: (p.override as string) ?? null, is_security: !!p.is_security }))} />
            ) : (
              <div className="space-y-2">
                {groups.map((g) => {
                  const list = d.permissions.filter((p) => ((p.perm_group as string) ?? 'Other') === g && d.effective.includes(p.code as string));
                  return list.length ? <div key={g}><p className="text-xs font-bold text-slate-500">{g}</p><div className="mt-1 flex flex-wrap gap-1">{list.map((p) => <span key={p.code as string} className="badge bg-slate-100 text-slate-700" title={p.description as string}>{(p.label as string) ?? (p.code as string)}{p.override === 'GRANT' ? ' +' : ''}</span>)}</div></div> : null;
                })}
              </div>
            )}
          </Section>

          <Section title={`🧾 ${t('admin.activity')}`}>
            {d.audit.length === 0 ? <p className="text-sm text-slate-500">—</p> : (
              <ol className="space-y-2 text-sm">
                {d.audit.map((a) => {
                  const l = auditLabel(a.action as string);
                  const nv = (a.new_value ?? {}) as Record<string, unknown>;
                  const pwEvent = a.action === 'PASSWORD_CHANGED' || a.action === 'PASSWORD_RESET' || String(a.action).includes('password');
                  return (
                    <li key={a.id as number} className="border-l-2 border-slate-200 pl-2">
                      <div className="font-semibold text-slate-800">{l.icon} {l.label}{pwEvent && nv.source ? <span className="ml-1 badge bg-slate-100 text-slate-600">{String(nv.source).replace(/_/g, ' ').toLowerCase()}</span> : null}</div>
                      <div className="text-xs text-slate-500">{fmtDateTime(a.created_at as string, lang)} · {(a.actor as string) ?? a.actor_role as string}{a.ip_address ? ` · IP ${a.ip_address}` : ''}</div>
                      {!pwEvent && (a.old_value != null || a.new_value != null) && <div className="text-xs text-slate-600">{auditSummary(a.old_value, a.new_value)}</div>}
                      {a.reason && <div className="text-xs italic text-slate-600">“{a.reason as string}”</div>}
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title={`👤 ${t('admin.profile')}`}>
            <dl className="space-y-1.5 text-sm">
              {([
                [t('auth.mobile'), x.mobile], [t('admin.email'), x.email], [t('users.designation'), x.designation], [t('users.employeeId'), x.employee_id],
                [t('users.createdAt'), fmtDateTime(x.created_at as string, lang)], [t('admin.lastLogin'), x.last_login_at ? fmtDateTime(x.last_login_at as string, lang) : '—'],
                [t('admin.passwordChangedAt'), x.password_changed_at ? fmtDateTime(x.password_changed_at as string, lang) : '—'],
              ] as [string, unknown][]).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium">{(v as string) || '—'}</dd></div>)}
              <div className="flex justify-between gap-2"><dt className="text-slate-500">{t('users.supervisor')}</dt>
                <dd className="text-right font-medium">{d.supervisor ? <Link className="text-navy-700 underline" href={`${base}/${d.supervisor.id}`}>{d.supervisor.full_name as string}</Link> : '—'}</dd></div>
            </dl>
          </Section>
          <Section title={`🛠️ ${t('admin.work')}`}>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">{t('admin.openAssignments')}</dt><dd className="font-bold">{d.stats.open_assignments as number}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">{t('admin.totalAssignments')}</dt><dd>{d.stats.assignments as number}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">{t('admin.actionsAssigned')}</dt><dd>{d.stats.actions as number}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">{t('admin.directReports')}</dt><dd>{d.stats.reports as number}</dd></div>
            </dl>
            <Link className="mt-2 inline-block text-sm font-semibold text-navy-600" href={`${portal === 'ADMIN' ? '/admin' : '/office'}/complaints?staff=${x.id}`}>{t('nav.complaints')} →</Link>
          </Section>
          <Section title={`🎭 ${t('admin.roleHistory')}`}>
            <ol className="space-y-1.5 text-xs">
              {d.roleHistory.map((r) => (
                <li key={r.id as number} className={r.revoked_at ? 'text-slate-500' : 'font-semibold text-slate-800'}>
                  {L(r.name_en, r.name_ta)} · {fmtDateTime(r.assigned_at as string, lang)}{r.revoked_at ? ` → ${fmtDateTime(r.revoked_at as string, lang)}` : ` (${t('admin.current')})`}
                  {r.assigned_by_name ? <div className="font-normal text-slate-400">{t('field.assignedBy')}: {r.assigned_by_name as string}{r.reason ? ` · ${r.reason}` : ''}</div> : null}
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}
