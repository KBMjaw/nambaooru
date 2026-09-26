import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { listComplaints, type Filters } from '@/lib/office-queries';
import { mapComplaints } from '@/lib/map-data';
import { ComplaintsTable } from '@/components/office/ComplaintsTable';
import { ComplaintsMap } from '@/components/office/ComplaintsMap';
import { Section } from '@/components/ui';

/** State-wide complaint oversight. Admins can assign / reassign and manage actions from the detail page; field decisions stay with officials. */
export default async function AdminComplaints({ searchParams }: { searchParams: Promise<Filters> }) {
  const u = await requirePageUser('ADMIN', 'complaint.view.all');
  const { t, lang } = await getT();
  const f = await searchParams;
  const [list, markers, lbs, cats] = await Promise.all([
    listComplaints(u, f, 100), mapComplaints(u, f),
    sql`SELECT id, name_en, name_ta FROM local_bodies WHERE status = 'ACTIVE' ORDER BY name_en`,
    sql`SELECT code, name_en, name_ta, icon FROM complaint_categories WHERE status = 'ACTIVE' ORDER BY sort_order`,
  ]);
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const page = Math.max(1, Number(f.page ?? 1) || 1);
  const pages = Math.max(1, Math.ceil(list.total / 100));
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...f, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-slate-800">📋 {t('nav.complaints')} <span className="text-sm font-normal text-slate-500">({list.total})</span></h1>
      <form className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-6">
        <input name="q" defaultValue={f.q} placeholder={t('common.search')} className="input col-span-2" />
        <select name="lb" defaultValue={f.lb ?? ''} className="input"><option value="">{t('users.localBody')}: {t('common.all')}</option>
          {lbs.map((l) => <option key={l.id as number} value={l.id as number}>{L(l.name_en, l.name_ta)}</option>)}</select>
        <select name="bucket" defaultValue={f.bucket ?? ''} className="input"><option value="">{t('users.status')}: {t('common.all')}</option>
          {[['open', t('office.pending')], ['active', t('office.inProgress')], ['completed', t('office.completed')], ['overdue', t('office.overdue')], ['high', t('admin.highPriority')], ['new', t('office.new')], ['inspection', t('office.inspectionPending')], ['rejected', t('office.rejected')]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select name="category" defaultValue={f.category ?? ''} className="input"><option value="">{t('office.byCategory')}: {t('common.all')}</option>
          {cats.map((c) => <option key={c.code as string} value={c.code as string}>{c.icon as string} {L(c.name_en, c.name_ta)}</option>)}</select>
        <button className="btn btn-outline">{t('office.apply')}</button>
        {f.ward && <input type="hidden" name="ward" value={f.ward} />}{f.dept && <input type="hidden" name="dept" value={f.dept} />}{f.staff && <input type="hidden" name="staff" value={f.staff} />}
      </form>
      <Section title={`🗺️ ${t('nav.map')}`}><ComplaintsMap items={markers} height={360} linkBase="/admin/complaints" /></Section>
      <Section><ComplaintsTable rows={list.rows as never} base="/admin/complaints" /></Section>
      {pages > 1 && <div className="flex items-center justify-center gap-3 text-sm">
        {page > 1 && <Link className="btn btn-outline btn-sm" href={qs(page - 1)}>←</Link>}<span>{page} / {pages}</span>{page < pages && <Link className="btn btn-outline btn-sm" href={qs(page + 1)}>→</Link>}</div>}
    </div>
  );
}
