import { requirePageUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { listComplaints, type Filters } from '@/lib/office-queries';
import { mapComplaints } from '@/lib/map-data';
import { ComplaintsTable } from '@/components/office/ComplaintsTable';
import { ComplaintsMap } from '@/components/office/ComplaintsMap';
import { Section } from '@/components/ui';

/** Read-only oversight: Super/System Admin cannot modify official complaint records. */
export default async function AdminComplaints({ searchParams }: { searchParams: Promise<Filters> }) {
  const u = await requirePageUser('ADMIN', 'complaint.view.all');
  const { t } = await getT();
  const f = await searchParams;
  const [list, markers] = await Promise.all([listComplaints(u, f, 100), mapComplaints(u, f)]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-slate-800">📋 {t('nav.complaints')} <span className="text-sm font-normal text-slate-500">(read-only · {list.total})</span></h1>
      <Section title={`🗺️ ${t('nav.map')}`}><ComplaintsMap items={markers} height={380} linkBase="/admin/complaints" /></Section>
      <Section><ComplaintsTable rows={list.rows as never} base="/admin/complaints" /></Section>
    </div>
  );
}
