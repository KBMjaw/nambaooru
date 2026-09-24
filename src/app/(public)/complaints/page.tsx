import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { ComplaintCard, type ComplaintRow } from '@/components/ComplaintCard';
import { Empty } from '@/components/ui';

export const metadata = { title: 'My Complaints' };

export default async function MyComplaints() {
  const user = await requirePageUser('PUBLIC', 'complaint.view.own');
  const { t, lang } = await getT();
  const rows = await sql<(ComplaintRow & { supported: boolean })[]>`
    SELECT c.code, c.status, c.priority, cat.icon, cat.name_en AS category_en, cat.name_ta AS category_ta, c.title_en, c.title_ta,
           w.ward_number, COALESCE(s.name_en, c.street_text) AS street, COALESCE(s.name_ta, c.street_text) AS street_ta, c.created_at, c.sla_due_at,
           (c.citizen_id <> ${user.id}) AS supported
    FROM complaints c LEFT JOIN complaint_categories cat ON cat.id = c.category_id LEFT JOIN wards w ON w.id = c.ward_id LEFT JOIN streets s ON s.id = c.street_id
    WHERE c.citizen_id = ${user.id} OR c.id IN (SELECT complaint_id FROM complaint_supporters WHERE user_id = ${user.id})
    ORDER BY c.created_at DESC LIMIT 200`;
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-navy-800">{t('nav.myComplaints')}</h1>
        <Link href="/report" className="btn btn-primary btn-sm">+ {t('nav.report')}</Link>
      </div>
      {rows.length ? rows.map((c) => <ComplaintCard key={c.code} c={c} lang={lang} href={`/complaints/${c.code}`} overdueLabel={t('complaint.overdue')} />) : <Empty>{t('home.noComplaints')}</Empty>}
    </div>
  );
}
