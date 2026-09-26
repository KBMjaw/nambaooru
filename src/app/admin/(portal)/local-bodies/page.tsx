import Link from 'next/link';
import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { ClickableRow } from '@/components/ClickableRow';

export const metadata = { title: 'Local bodies' };

export default async function LocalBodies({ searchParams }: { searchParams: Promise<{ q?: string; district?: string }> }) {
  const u = await requirePageUser('ADMIN', ['location.manage', 'ward.manage', 'wardmap.view']);
  const { t, lang } = await getT();
  const sp = await searchParams;
  const like = sp.q ? `%${sp.q.slice(0, 60)}%` : null;
  const [rows, districts] = await Promise.all([
    sql`SELECT lb.id, lb.code, lb.name_en, lb.name_ta, lb.status, lb.controlling_authority, lt.name_en AS type_en, lt.category, d.name_en AS district_en, tk.name_en AS taluk_en,
               ro.full_name AS officer, (SELECT count(*) FROM wards w WHERE w.local_body_id = lb.id)::int AS wards,
               (SELECT count(*) FROM complaints c WHERE c.local_body_id = lb.id)::int AS complaints,
               (SELECT count(*) FROM officials o JOIN users x ON x.id = o.user_id WHERE o.local_body_id = lb.id AND x.status = 'ACTIVE')::int AS staff
        FROM local_bodies lb JOIN local_body_types lt ON lt.id = lb.type_id JOIN districts d ON d.id = lb.district_id LEFT JOIN taluks tk ON tk.id = lb.taluk_id
        LEFT JOIN users ro ON ro.id = lb.responsible_officer_id
        WHERE TRUE ${like ? sql`AND (lb.name_en ILIKE ${like} OR lb.name_ta ILIKE ${like} OR lb.code ILIKE ${like})` : sql``}
          ${sp.district ? sql`AND lb.district_id = ${Number(sp.district)}` : sql``}
        ORDER BY d.name_en, lb.name_en LIMIT 500`,
    sql`SELECT id, name_en FROM districts ORDER BY name_en`,
  ]);
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-slate-800">🏛️ {t('admin.localBodies')} <span className="text-sm font-normal text-slate-500">({rows.length})</span></h1>
        {has(u, 'location.manage') && <Link href="/admin/local-bodies/new" className="btn btn-primary">+ {t('admin.addLocalBody')}</Link>}
      </div>
      <form className="card flex flex-wrap gap-2 p-3">
        <input name="q" defaultValue={sp.q} className="input max-w-xs" placeholder={t('common.search')} />
        <select name="district" defaultValue={sp.district ?? ''} className="input max-w-xs"><option value="">{t('reg.district')}: {t('common.all')}</option>
          {districts.map((d) => <option key={d.id as number} value={d.id as number}>{d.name_en as string}</option>)}</select>
        <button className="btn btn-outline">{t('office.apply')}</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table-std">
          <thead><tr><th>{t('admin.lbName')}</th><th>{t('admin.lbType')}</th><th>{t('reg.district')} / {t('reg.taluk')}</th><th>{t('admin.controllingAuthority')}</th><th>{t('reg.ward')}</th><th>{t('nav.users')}</th><th>{t('nav.complaints')}</th><th>{t('users.status')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <ClickableRow key={r.id as number} href={`/admin/local-bodies/${r.id}`}>
              <td><Link className="font-semibold text-navy-700 hover:underline" href={`/admin/local-bodies/${r.id}`}>{L(r.name_en, r.name_ta)}</Link><div className="font-mono text-[10px] text-slate-400">{r.code as string}</div></td>
              <td className="text-xs">{r.type_en as string}<div className="text-slate-400">{r.category === 'URBAN' ? t('admin.urban') : t('admin.rural')}</div></td>
              <td className="text-xs">{r.district_en as string}<div className="text-slate-400">{(r.taluk_en as string) ?? '—'}</div></td>
              <td className="text-xs">{(r.controlling_authority as string) ?? '—'}<div className="text-slate-500">{(r.officer as string) ?? ''}</div></td>
              <td>{r.wards as number}</td><td>{r.staff as number}</td><td>{r.complaints as number}</td>
              <td><span className={`badge ${r.status === 'ACTIVE' ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-200 text-slate-600'}`}>{t(`users.${r.status}` as never)}</span></td>
            </ClickableRow>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
