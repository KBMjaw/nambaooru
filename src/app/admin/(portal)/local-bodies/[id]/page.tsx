import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { lbOptions, wardRows } from '@/lib/lb-options';
import { LocalBodyForm } from '@/components/admin/LocalBodyForm';
import { WardsEditor, type WardRow } from '@/components/admin/WardsEditor';
import { Section, Stat } from '@/components/ui';

export const metadata = { title: 'Local body' };

export default async function LocalBodyDetail({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePageUser('ADMIN', ['location.manage', 'ward.manage', 'wardmap.view']);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { t, lang } = await getT();
  const [lb] = await sql`
    SELECT lb.*, lt.name_en AS type_en, lt.name_ta AS type_ta, lt.category, d.name_en AS district_en, tk.name_en AS taluk_en, ro.full_name AS officer, ro.id AS officer_id
    FROM local_bodies lb JOIN local_body_types lt ON lt.id = lb.type_id JOIN districts d ON d.id = lb.district_id
    LEFT JOIN taluks tk ON tk.id = lb.taluk_id LEFT JOIN users ro ON ro.id = lb.responsible_officer_id WHERE lb.id = ${id}`;
  if (!lb) notFound();
  const [wards, depts, [stats]] = await Promise.all([
    wardRows(id),
    sql`SELECT id, code, name_en, name_ta, status FROM departments WHERE local_body_id = ${id} ORDER BY name_en`,
    sql`SELECT (SELECT count(*) FROM complaints c WHERE c.local_body_id = ${id})::int AS complaints,
               (SELECT count(*) FROM complaints c WHERE c.local_body_id = ${id} AND c.status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS open,
               (SELECT count(*) FROM citizens ct WHERE ct.local_body_id = ${id})::int AS citizens,
               (SELECT count(*) FROM officials o JOIN users x ON x.id = o.user_id WHERE o.local_body_id = ${id} AND x.status = 'ACTIVE')::int AS staff`,
  ]);
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const canLb = has(u, 'location.manage');
  return (
    <div className="space-y-4">
      <Link href="/admin/local-bodies" className="text-sm font-semibold text-navy-600">← {t('admin.localBodies')}</Link>
      <div className="card p-4">
        <h1 className="text-xl font-extrabold text-slate-800">🏛️ {L(lb.name_en, lb.name_ta)}</h1>
        <p className="text-sm text-slate-500">{L(lb.type_en, lb.type_ta)} · {lb.category === 'URBAN' ? t('admin.urban') : t('admin.rural')} · {lb.district_en as string}{lb.taluk_en ? ` › ${lb.taluk_en}` : ''} · <span className="font-mono">{lb.code as string}</span></p>
        <p className="mt-1 text-sm">👔 {t('admin.controllingAuthority')}: <b>{(lb.controlling_authority as string) ?? '—'}</b> · {t('admin.responsibleOfficer')}: {lb.officer_id ? <Link className="font-semibold text-navy-700 underline" href={`/admin/users/${lb.officer_id}`}>{lb.officer as string}</Link> : '—'}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label={t('reg.ward')} value={wards.length} />
        <Stat label={t('admin.citizens')} value={stats.citizens as number} href={`/admin/citizens?lb=${id}`} />
        <Stat label={t('nav.users')} value={stats.staff as number} href={`/admin/users?lb=${id}`} />
        <Stat label={t('nav.complaints')} value={stats.complaints as number} href={`/admin/complaints?lb=${id}`} />
        <Stat label={t('office.pending')} value={stats.open as number} tone="sun" href={`/admin/complaints?lb=${id}&bucket=open`} />
      </div>
      {canLb && (
        <details className="card p-4">
          <summary className="cursor-pointer font-bold text-slate-800">✏️ {t('admin.editLocalBody')}</summary>
          <div className="mt-3"><LocalBodyForm opts={JSON.parse(JSON.stringify(await lbOptions()))} initial={{
            id, code: lb.code as string, districtId: lb.district_id as number, talukId: (lb.taluk_id as number) ?? null, nameEn: lb.name_en as string, nameTa: (lb.name_ta as string) ?? '',
            typeId: lb.type_id as number, pincode: (lb.pincode as string) ?? '', controllingAuthority: (lb.controlling_authority as string) ?? '', responsibleOfficerId: (lb.responsible_officer_id as string) ?? '',
            status: lb.status as string, centerLat: lb.center_lat != null ? String(lb.center_lat) : '', centerLng: lb.center_lng != null ? String(lb.center_lng) : '',
          }} /></div>
        </details>
      )}
      <Section title={`🏘️ ${t('admin.wards')} (${wards.length})`}>
        <WardsEditor localBodyId={id} wards={JSON.parse(JSON.stringify(wards)) as WardRow[]} portal="ADMIN" canEdit={has(u, 'location.manage') || has(u, 'ward.manage')} mapBase="/admin/ward-maps" />
      </Section>
      <Section title={`🏛️ ${t('nav.departments')} (${depts.length})`} action={has(u, 'department.manage') ? <Link className="btn btn-outline btn-sm" href={`/admin/departments?parent=${id}&new=1`}>+ {t('admin.addDepartment')}</Link> : undefined}>
        <div className="flex flex-wrap gap-2">{depts.map((d) => <span key={d.id as number} className={`badge ${d.status === 'ACTIVE' ? 'bg-navy-50 text-navy-800' : 'bg-slate-100 text-slate-400'}`}>{L(d.name_en, d.name_ta)} <code className="ml-1 text-[10px]">{d.code as string}</code></span>)}</div>
      </Section>
    </div>
  );
}
