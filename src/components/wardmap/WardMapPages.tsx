import Link from 'next/link';
import { has, type AuthUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { localBodyScope, wardScope } from '@/lib/scope';
import { wardMapData } from '@/lib/ward-maps';
import { Section, Stat, Empty } from '@/components/ui';
import { WardMapEditor, type Feature, type ComplaintPin } from './WardMapEditor';
import { StreetsEditor } from './StreetsEditor';

/** Ward picker: local bodies in jurisdiction → wards (with feature and complaint counts). */
export async function WardMapIndex({ u, portal, lb }: { u: AuthUser; portal: 'ADMIN' | 'OFFICE'; lb?: string }) {
  const { t, lang } = await getT();
  const base = portal === 'ADMIN' ? '/admin/ward-maps' : '/office/ward-maps';
  const lbs = await sql`SELECT lb.id, lb.name_en, lb.name_ta FROM local_bodies lb WHERE lb.status = 'ACTIVE' AND (${localBodyScope(u)}) ORDER BY lb.name_en LIMIT 1000`;
  const sel = Number(lb) || (lbs.length ? (lbs[0].id as number) : 0);
  const wards = sel ? await sql`
    SELECT w.id, w.ward_number, w.name_en, w.population,
           (SELECT count(*) FROM ward_maps m WHERE m.ward_id = w.id AND m.status = 'ACTIVE')::int AS features,
           (SELECT count(*) FROM complaints c WHERE c.ward_id = w.id AND c.status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS open
    FROM wards w WHERE w.local_body_id = ${sel} AND (${wardScope(u)}) ORDER BY w.ward_number` : [];
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-extrabold text-slate-800">🗺️ {t('admin.wardMaps')}</h1>
      {lbs.length > 1 && (
        <form className="card flex flex-wrap gap-2 p-3">
          <select name="lb" defaultValue={String(sel)} className="input max-w-md">{lbs.map((l) => <option key={l.id as number} value={l.id as number}>{L(l.name_en, l.name_ta)}</option>)}</select>
          <button className="btn btn-outline">{t('office.apply')}</button>
        </form>
      )}
      {wards.length === 0 ? <Empty icon="🗺️">{t('admin.noWards')}</Empty> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {wards.map((w) => (
            <Link key={w.id as number} href={`${base}/${w.id}`} className="card block p-3 hover:border-navy-500/40 hover:shadow-md">
              <div className="text-lg font-extrabold text-navy-800">{t('complaint.ward')} {w.ward_number as number}</div>
              <div className="truncate text-xs text-slate-500">{(w.name_en as string) ?? ''}</div>
              <div className="mt-1 text-xs">🗂️ {w.features as number} · 📋 {w.open as number}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ward details + map editor + streets + complaints on the map. */
export async function WardMapPage({ u, portal, wardId }: { u: AuthUser; portal: 'ADMIN' | 'OFFICE'; wardId: number }) {
  const { t, lang } = await getT();
  const d = await wardMapData(u, wardId);
  const w = d.ward;
  const base = portal === 'ADMIN' ? '/admin' : '/office';
  const [stats] = await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS open,
                                   count(*) FILTER (WHERE sla_due_at < now() AND status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS overdue,
                                   (SELECT count(*) FROM citizens ct WHERE ct.ward_id = ${wardId})::int AS citizens
                            FROM complaints WHERE ward_id = ${wardId}`;
  const center: [number, number] = [(w.center_lat as number) ?? (w.lb_lat as number) ?? 11.1646, (w.center_lng as number) ?? (w.lb_lng as number) ?? 77.6035];
  const canEditMap = has(u, 'wardmap.edit');
  const canEditWard = has(u, 'ward.manage') || has(u, 'location.manage');
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  return (
    <div className="space-y-4">
      <Link href={`${base}/ward-maps?lb=${w.lb_id}`} className="text-sm font-semibold text-navy-600">← {t('admin.wardMaps')}</Link>
      <div className="card p-4">
        <h1 className="text-xl font-extrabold text-slate-800">🏘️ {t('complaint.ward')} {w.ward_number as number}{w.name_en && w.name_en !== `Ward ${w.ward_number}` ? ` — ${L(w.name_en, w.name_ta)}` : ''}</h1>
        <p className="text-sm text-slate-500">{L(w.lb_en, w.lb_ta)} · {w.taluk_en ? `${w.taluk_en} · ` : ''}{w.district_en as string}</p>
        {w.description && <p className="mt-1 text-sm text-slate-700">{w.description as string}</p>}
        <p className="mt-1 text-sm text-slate-600">👥 {t('admin.population')}: <b>{(w.population as number)?.toLocaleString('en-IN') ?? '—'}</b> · 🛣️ {t('admin.streetCount')}: <b>{(w.street_count as number) ?? '—'}</b> ({d.streets.length} {t('admin.defined')})</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('nav.complaints')} value={stats.total as number} href={`${base}/complaints?ward=${wardId}`} />
        <Stat label={t('office.pending')} value={stats.open as number} tone="sun" href={`${base}/complaints?ward=${wardId}&bucket=open`} />
        <Stat label={t('office.overdue')} value={stats.overdue as number} tone="pin" href={`${base}/complaints?ward=${wardId}&bucket=overdue`} />
        <Stat label={t('admin.citizens')} value={stats.citizens as number} href={has(u, 'citizen.view') ? `${base}/citizens?ward=${wardId}` : undefined} />
      </div>
      <WardMapEditor wardId={wardId} portal={portal} canEdit={canEditMap} center={center} complaintBase={`${base}/complaints`}
        initialFeatures={JSON.parse(JSON.stringify(d.features)) as Feature[]} complaints={JSON.parse(JSON.stringify(d.complaints)) as ComplaintPin[]} />
      <Section title={`🛣️ ${t('admin.streets')} (${d.streets.length})`}>
        <StreetsEditor wardId={wardId} portal={portal} canEdit={canEditWard} streets={JSON.parse(JSON.stringify(d.streets))} />
      </Section>
    </div>
  );
}
