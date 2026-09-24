import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { fmtDate, navigateLink } from '@/lib/format';
import { StatusBadge, PriorityBadge } from '@/components/badges';
import { ActionForm } from '@/components/office/ActionForm';
import { Empty } from '@/components/ui';

/** Field staff mobile view — action-oriented, no admin dashboards. */
export async function FieldHome() {
  const u = await requirePageUser('OFFICE', 'complaint.work');
  const { t, lang } = await getT();
  const works = await sql`
    SELECT a.id AS assignment_id, a.status AS a_status, a.purpose, a.due_at, a.priority AS a_priority, a.note, a.created_at AS assigned_at,
           b.full_name AS assigned_by, c.code, c.status, c.priority, c.summary_en, c.summary_ta, c.latitude, c.longitude, c.landmark,
           cat.icon, cat.name_en, cat.name_ta, w.ward_number, w.center_lat, w.center_lng,
           COALESCE(s.name_en, c.street_text) AS street, COALESCE(s.name_ta, c.street_text) AS street_ta,
           (SELECT e.id FROM complaint_evidence e WHERE e.complaint_id = c.id AND e.kind = 'CITIZEN' AND e.media_type = 'PHOTO' ORDER BY e.id LIMIT 1) AS photo_id
    FROM assignments a JOIN complaints c ON c.id = a.complaint_id JOIN users b ON b.id = a.assigned_by
    LEFT JOIN complaint_categories cat ON cat.id = c.category_id LEFT JOIN wards w ON w.id = c.ward_id LEFT JOIN streets s ON s.id = c.street_id
    WHERE a.assigned_to = ${u.id} AND a.status IN ('PENDING','ACCEPTED','IN_PROGRESS')
      AND ((a.purpose = 'WORK' AND c.status IN ('ASSIGNED','IN_PROGRESS')) OR (a.purpose = 'INSPECTION' AND c.status = 'SITE_INSPECTION'))
    ORDER BY CASE c.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, a.due_at NULLS LAST, a.created_at`;
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const inspections = works.filter((w) => w.purpose === 'INSPECTION');
  const jobs = works.filter((w) => w.purpose === 'WORK');

  const card = (w: (typeof works)[number]) => {
    const lat = (w.latitude ?? w.center_lat) as number | null;
    const lng = (w.longitude ?? w.center_lng) as number | null;
    const overdue = w.due_at && new Date(w.due_at as string) < new Date();
    return (
      <li key={w.assignment_id as number} className={`card overflow-hidden ${w.a_status === 'PENDING' ? 'ring-2 ring-amber-300' : ''}`}>
        {w.a_status === 'PENDING' && <div className="bg-amber-100 px-4 py-1.5 text-sm font-bold text-amber-900">🆕 {t('field.newWork')}</div>}
        <div className="flex gap-3 p-4">
          {w.photo_id ? <img src={`/api/evidence/${w.photo_id}`} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" /> : <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-leaf-50 text-4xl">{w.icon as string}</span>}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link href={`/office/complaints/${w.code}`} className="font-mono text-sm font-bold text-navy-700 underline">{w.code as string}</Link>
              <PriorityBadge priority={w.priority as string} />
              <StatusBadge status={w.status as string} />
            </div>
            <p className="font-bold text-slate-800">{w.icon as string} {L(w.name_en, w.name_ta)}</p>
            <p className="text-sm text-slate-600">📍 {[L(w.street, w.street_ta), w.ward_number != null ? `${t('complaint.ward')} ${w.ward_number}` : null, w.landmark].filter(Boolean).join(', ')}</p>
            <p className={`text-sm ${overdue ? 'font-bold text-red-600' : 'text-slate-600'}`}>🗓️ {t('office.dueToday')}: {fmtDate(w.due_at as string, lang)} · {t('field.assignedBy')}: {w.assigned_by as string}</p>
            <p className="line-clamp-2 text-sm text-slate-500">{L(w.summary_en, w.summary_ta)}</p>
            {w.note && <p className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">📝 {w.note as string}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3 sm:flex sm:flex-wrap">
          {lat != null && lng != null && <a href={navigateLink(lat, lng)} target="_blank" rel="noopener noreferrer" className="btn btn-outline">🧭 {t('complaint.navigate')}</a>}
          {w.purpose === 'INSPECTION' ? (
            <div className="col-span-2 w-full sm:w-auto"><ActionForm code={w.code as string} action="inspect" label={t('field.inspect')} icon="🔍" tone="btn-primary" fields={['outcome', 'notes', 'photoRequired', 'gpsRequired']} block /></div>
          ) : (
            <>
              {w.a_status === 'PENDING' && <ActionForm code={w.code as string} action="accept" label={t('field.accept')} icon="👍" tone="btn-navy" />}
              {w.status === 'ASSIGNED' && <ActionForm code={w.code as string} action="start" label={t('field.start')} icon="▶️" tone="btn-primary" />}
              {w.status === 'IN_PROGRESS' && (
                <>
                  <div className="col-span-2 w-full sm:w-auto"><ActionForm code={w.code as string} action="progress" label={t('field.progress')} icon="📤" tone="btn-outline" fields={['progress', 'notes', 'photo', 'gps']} block /></div>
                  <div className="col-span-2 w-full sm:w-auto"><ActionForm code={w.code as string} action="complete" label={t('field.complete')} icon="✅" tone="btn-primary" fields={['notes', 'photoRequired', 'gpsRequired']} block /></div>
                </>
              )}
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-extrabold text-navy-800">🧰 {t('field.title')}</h1>
      {!works.length && <Empty icon="✅">{t('field.none')}</Empty>}
      {inspections.length > 0 && (
        <section><h2 className="mb-2 font-bold text-violet-800">🔍 {t('field.inspections')} ({inspections.length})</h2><ul className="space-y-3">{inspections.map(card)}</ul></section>
      )}
      {jobs.length > 0 && (
        <section><h2 className="mb-2 font-bold text-navy-800">🛠️ {t('office.worksToDo')} ({jobs.length})</h2><ul className="space-y-3">{jobs.map(card)}</ul></section>
      )}
    </div>
  );
}
