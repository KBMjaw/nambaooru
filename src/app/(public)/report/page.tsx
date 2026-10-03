import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { ReportWizard, type Category, type Me } from './ReportWizard';

export const metadata = { title: 'Report a Problem' };

export default async function ReportPage() {
  const user = await requirePageUser('PUBLIC', 'complaint.create');
  const { t } = await getT();
  const [me] = await sql`
    SELECT c.local_body_id, c.ward_id, w.ward_number, c.street_id, s.name_en AS street_en, s.name_ta AS street_ta, c.street_text,
           lb.name_en AS lb_en, lb.name_ta AS lb_ta, c.district_id
    FROM citizens c LEFT JOIN wards w ON w.id = c.ward_id LEFT JOIN streets s ON s.id = c.street_id LEFT JOIN local_bodies lb ON lb.id = c.local_body_id
    WHERE c.user_id = ${user.id}`;
  const categories = await sql<Category[]>`
    SELECT code, name_en, name_ta, icon, evidence_required, evidence_types FROM complaint_categories WHERE status = 'ACTIVE' ORDER BY sort_order`;
  // Local bodies that are onboarded (have wards) — the citizen's district first
  const localBodies = await sql`
    SELECT lb.id, lb.name_en, lb.name_ta FROM local_bodies lb
    WHERE lb.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM wards w WHERE w.local_body_id = lb.id)
    ORDER BY (lb.district_id = ${me?.district_id ?? 0}) DESC, lb.name_en`;
  const meProps: Me = {
    localBodyId: (me?.local_body_id as number) ?? null, wardId: (me?.ward_id as number) ?? null, wardNumber: (me?.ward_number as number) ?? null,
    streetId: (me?.street_id as number) ?? null, street_en: (me?.street_en as string) ?? null, street_ta: (me?.street_ta as string) ?? null,
    streetText: (me?.street_text as string) ?? null, lb_en: (me?.lb_en as string) ?? null, lb_ta: (me?.lb_ta as string) ?? null,
  };
  return (
    <div>
      <h1 className="mb-1 text-center text-2xl font-extrabold text-navy-800">{t('report.title')}</h1>
      <p className="mb-4 text-center text-sm text-slate-600">{t('report.intro')}</p>
      <ReportWizard me={meProps} categories={[...categories]} localBodies={localBodies.map((b) => ({ id: b.id as number, name_en: b.name_en as string, name_ta: b.name_ta as string }))} />
    </div>
  );
}
