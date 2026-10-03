import Link from 'next/link';
import { requirePageUser, has } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { listComplaints, filterOptions, type Filters } from '@/lib/office-queries';
import { mapComplaints } from '@/lib/map-data';
import { FilterBar } from '@/components/office/FilterBar';
import { ComplaintsTable } from '@/components/office/ComplaintsTable';
import { ComplaintsMap } from '@/components/office/ComplaintsMap';
import type { MessageKey } from '@/i18n';
import { ACTION_BUCKETS } from '@/components/ActionBuckets';

export const metadata = { title: 'Complaints' };

const BUCKET_LABEL: Record<string, MessageKey> = {
  new: 'office.new', review: 'office.pendingReview', inspection: 'office.inspectionPending', verified: 'office.readyToAssign', assigned: 'office.assigned',
  progress: 'office.inProgress', verification: 'office.awaitingVerification', completed: 'office.completed', rejected: 'office.rejected',
  duplicate: 'office.duplicate', overdue: 'office.overdue',
  ...Object.fromEntries(ACTION_BUCKETS.map(([b, l]) => [b, l])),
};

export default async function OfficeComplaints({ searchParams }: { searchParams: Promise<Filters & { view?: string }> }) {
  const u = await requirePageUser('OFFICE');
  const { t, lang } = await getT();
  const f = await searchParams;
  const [list, opts] = await Promise.all([listComplaints(u, f, 50), filterOptions(u)]);
  const view = f.view === 'map' && has(u, 'map.view') ? 'map' : 'list';
  const markers = view === 'map' ? await mapComplaints(u, f) : [];
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, String(v));
    return `?${p.toString()}`;
  };
  const pages = Math.ceil(list.total / list.limit);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-navy-800">📋 {t('nav.complaints')}{f.bucket && BUCKET_LABEL[f.bucket] ? ` — ${t(BUCKET_LABEL[f.bucket])}` : ''}</h1>
        {has(u, 'map.view') && (
          <div className="inline-flex rounded-xl border border-slate-300 bg-white p-0.5 text-sm font-semibold">
            <Link href={qs({ view: undefined, page: undefined })} className={`rounded-lg px-3 py-1.5 ${view === 'list' ? 'bg-navy-700 text-white' : ''}`}>☰ {t('office.list')}</Link>
            <Link href={qs({ view: 'map', page: undefined })} className={`rounded-lg px-3 py-1.5 ${view === 'map' ? 'bg-navy-700 text-white' : ''}`}>🗺️ {t('office.mapView')}</Link>
          </div>
        )}
      </div>
      <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 text-sm">
        <Link href="/office/complaints" className={`shrink-0 rounded-full border px-3 py-1 font-semibold ${!f.bucket ? 'border-navy-700 bg-navy-700 text-white' : 'border-slate-300 bg-white'}`}>{t('common.all')}</Link>
        {ACTION_BUCKETS.map(([b, l, , icon]) => (
          <Link key={b} href={`/office/complaints?bucket=${b}`} className={`shrink-0 rounded-full border px-3 py-1 font-semibold ${f.bucket === b ? 'border-navy-700 bg-navy-700 text-white' : 'border-slate-300 bg-white'}`}>{icon} {t(l)}</Link>
        ))}
      </nav>
      <FilterBar f={f} opts={opts as never} lang={lang} action="/office/complaints" />
      <div className="card p-3">
        {view === 'map' ? <ComplaintsMap items={markers} height={520} /> : (
          <>
            <p className="mb-2 text-xs text-slate-500">{t('office.showing', { n: list.rows.length, total: list.total })}</p>
            <ComplaintsTable rows={list.rows as never} />
            {pages > 1 && (
              <div className="mt-3 flex items-center justify-center gap-3 text-sm">
                {list.page > 1 && <Link className="btn btn-outline btn-sm" href={qs({ page: String(list.page - 1) })}>← {t('common.prev')}</Link>}
                <span>{t('common.page', { n: list.page })} / {pages}</span>
                {list.page < pages && <Link className="btn btn-outline btn-sm" href={qs({ page: String(list.page + 1) })}>{t('common.next')} →</Link>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
