import Link from 'next/link';
import { has, type AuthUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { listCitizens, getCitizen, type CitizenQuery } from '@/lib/citizens';
import { localBodyScope } from '@/lib/scope';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { ClickableRow } from '@/components/ClickableRow';
import { StatusBadge, PriorityBadge } from '@/components/badges';
import { Empty, Section } from '@/components/ui';
import { NewCitizenButton, CitizenActions } from './CitizenActions';

export async function CitizensListPage({ u, portal, sp }: { u: AuthUser; portal: 'ADMIN' | 'OFFICE'; sp: CitizenQuery }) {
  const { t, lang } = await getT();
  const base = portal === 'ADMIN' ? '/admin/citizens' : '/office/citizens';
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const [{ rows, total, page, pageSize }, lbs] = await Promise.all([
    listCitizens(u, sp),
    sql`SELECT lb.id, lb.name_en, lb.name_ta FROM local_bodies lb WHERE lb.status = 'ACTIVE' AND (${localBodyScope(u)}) ORDER BY lb.name_en`,
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-slate-800">🧑‍🤝‍🧑 {t('admin.citizens')} <span className="text-sm font-normal text-slate-500">({total})</span></h1>
        {has(u, 'citizen.manage') && <NewCitizenButton portal={portal} />}
      </div>
      <form className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-5">
        <input name="q" defaultValue={sp.q} placeholder={t('users.searchPh')} className="input col-span-2" />
        {lbs.length > 1 ? (
          <select name="lb" defaultValue={sp.lb ?? ''} className="input"><option value="">{t('users.localBody')}: {t('common.all')}</option>
            {lbs.map((l) => <option key={l.id as number} value={l.id as number}>{L(l.name_en, l.name_ta)}</option>)}</select>
        ) : <span />}
        <select name="status" defaultValue={sp.status ?? ''} className="input"><option value="">{t('users.status')}: {t('common.all')}</option>
          <option value="ACTIVE">{t('users.ACTIVE')}</option><option value="INACTIVE">{t('users.INACTIVE')}</option></select>
        <button className="btn btn-outline">{t('office.apply')}</button>
      </form>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty icon="🧑">{t('admin.noCitizens')}</Empty> : (
          <table className="table-std">
            <thead><tr><th>{t('reg.fullName')}</th><th>{t('auth.mobile')}</th><th>{t('users.localBody')}</th><th>{t('complaint.ward')}</th><th>{t('nav.complaints')}</th><th>{t('users.status')}</th><th>{t('admin.registered')}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <ClickableRow key={r.id as string} href={`${base}/${r.id}`}>
                <td><Link className="font-semibold text-navy-700 hover:underline" href={`${base}/${r.id}`}>{r.full_name as string}</Link><div className="font-mono text-xs text-slate-400">{r.username as string}</div></td>
                <td className="font-mono text-xs">{r.mobile as string}</td>
                <td className="text-xs">{L(r.lb_en, r.lb_ta) || '—'}<div className="text-slate-400">{(r.district_en as string) ?? ''}</div></td>
                <td>{(r.ward_number as number) ?? '—'}</td>
                <td><b>{r.complaints as number}</b>{(r.open_complaints as number) > 0 && <span className="ml-1 text-xs text-amber-700">({r.open_complaints as number} {t('office.pending').toLowerCase()})</span>}</td>
                <td><span className={`badge ${r.status === 'ACTIVE' ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-200 text-slate-600'}`}>{t(`users.${r.status}` as never)}</span></td>
                <td className="whitespace-nowrap text-xs text-slate-500">{fmtDate(r.created_at as string, lang)}</td>
              </ClickableRow>
            ))}</tbody>
          </table>
        )}
      </div>
      {pages > 1 && <div className="flex items-center justify-center gap-3 text-sm">
        {page > 1 && <Link className="btn btn-outline btn-sm" href={qs(page - 1)}>←</Link>}<span>{page} / {pages}</span>{page < pages && <Link className="btn btn-outline btn-sm" href={qs(page + 1)}>→</Link>}
      </div>}
    </div>
  );
}

export async function CitizenDetailPage({ u, portal, id }: { u: AuthUser; portal: 'ADMIN' | 'OFFICE'; id: string }) {
  const { t, lang } = await getT();
  const d = await getCitizen(u, id);
  const c = d.citizen;
  const base = portal === 'ADMIN' ? '/admin' : '/office';
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const open = d.complaints.filter((x) => !['CLOSED', 'REJECTED', 'DUPLICATE'].includes(x.status as string)).length;
  const info: [string, unknown][] = [
    [t('auth.mobile'), c.mobile], [t('admin.email'), c.email], [t('auth.username'), c.username], [t('users.status'), t(`users.${c.status}` as never)],
    [t('admin.registered'), fmtDateTime(c.created_at as string, lang)], [t('admin.lastLogin'), c.last_login_at ? fmtDateTime(c.last_login_at as string, lang) : '—'],
    [t('reg.door'), c.pii ? c.address || '—' : '🔒'], [t('reg.street'), c.street_en ?? c.street_text], [t('reg.ward'), c.ward_number != null ? `${t('complaint.ward')} ${c.ward_number}` : null],
    [t('users.localBody'), L(c.lb_en, c.lb_ta)], [t('reg.taluk'), c.taluk_en], [t('reg.district'), c.district_en], [t('reg.pincode'), c.pincode],
    [t('reg.landmark'), c.landmark], [t('admin.complaintCount'), `${d.totalComplaints} (${open} ${t('office.pending').toLowerCase()})`],
  ];
  return (
    <div className="space-y-4">
      <Link href={`${base}/citizens`} className="text-sm font-semibold text-navy-600">← {t('admin.citizens')}</Link>
      <div className="card flex flex-wrap items-start justify-between gap-3 p-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">🧑 {c.full_name as string}</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            <span className={`badge ${c.status === 'ACTIVE' ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-200 text-slate-600'}`}>{t(`users.${c.status}` as never)}</span>
            {!!c.must_change_password && <span className="badge bg-amber-100 text-amber-900">🔑 {t('admin.mustChange')}</span>}
            {!c.pii && <span className="badge bg-slate-100 text-slate-500">🔒 {t('admin.piiMasked')}</span>}
          </div>
        </div>
        <CitizenActions portal={portal} canManage={has(u, 'citizen.manage')} canReset={has(u, 'user.password_reset') || has(u, 'user.manage.all')}
          citizen={{ id: c.id as string, username: c.username as string, full_name: c.full_name as string, mobile: c.mobile as string, email: (c.email as string) ?? null,
            local_body_id: (c.local_body_id as number) ?? null, ward_id: (c.ward_id as number) ?? null, street_id: (c.street_id as number) ?? null,
            street_text: (c.street_text as string) ?? null, pincode: (c.pincode as string) ?? null, landmark: (c.landmark as string) ?? null, address: '', status: c.status as string }} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={`👤 ${t('admin.citizenProfile')}`}>
          <dl className="space-y-1.5 text-sm">{info.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium">{(v as string) || '—'}</dd></div>)}</dl>
        </Section>
        <Section title={`📋 ${t('admin.complaintHistory')} (${d.complaints.length})`} className="lg:col-span-2">
          {d.complaints.length === 0 ? <Empty icon="📭">{t('admin.noComplaints')}</Empty> : (
            <div className="space-y-2">
              {d.totalComplaints > d.complaints.length && <p className="text-xs text-slate-500">{t('admin.outsideScope', { n: d.totalComplaints - d.complaints.length })}</p>}
              {d.complaints.map((x) => {
                const hist = d.history.filter((h) => h.complaint_id === x.id);
                return (
                  <details key={x.id as number} className="rounded-xl border border-slate-200 p-2.5">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                      <Link href={`${base}/complaints/${x.code}`} className="font-mono font-bold text-navy-700 hover:underline">{x.code as string}</Link>
                      <span>{x.icon as string} {L(x.category_en, x.category_ta)}</span>
                      <StatusBadge status={x.status as string} /><PriorityBadge priority={x.priority as string} />
                      <span className="text-xs text-slate-500">{fmtDate(x.created_at as string, lang)}</span>
                      <span className="text-xs text-slate-500">👷 {(x.assigned_name as string) ?? '—'}</span>
                      <span className="text-xs text-slate-500">{x.status === 'CLOSED' ? `✅ ${t('admin.resolved')} ${fmtDate(x.closed_at as string, lang)}` : ['REJECTED', 'DUPLICATE'].includes(x.status as string) ? `⛔ ${t('admin.notResolved')}` : `⏳ ${t('admin.inProcess')}`}</span>
                    </summary>
                    <ol className="mt-2 space-y-1 border-l-2 border-navy-100 pl-3 text-xs">
                      {hist.map((h, i) => (
                        <li key={i}><b>{h.from_status === h.to_status ? '📝' : t(`status.${h.to_status}` as never)}</b> · {fmtDateTime(h.created_at as string, lang)} · {(h.actor_label as string) ?? 'System'}{h.note ? <div className="text-slate-600">{h.note as string}</div> : null}</li>
                      ))}
                    </ol>
                  </details>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
