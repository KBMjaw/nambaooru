import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { localBodyScope } from '@/lib/scope';
import { wardRows } from '@/lib/lb-options';
import { WardsEditor, type WardRow } from '@/components/admin/WardsEditor';
import { Section } from '@/components/ui';

export const metadata = { title: 'Wards' };

/** EO: manage the wards of their own local body (ward.manage, jurisdiction-checked by the API). */
export default async function OfficeWards() {
  const u = await requirePageUser('OFFICE', ['ward.manage', 'wardmap.view']);
  const { t, lang } = await getT();
  const lbs = await sql`SELECT lb.id, lb.name_en, lb.name_ta FROM local_bodies lb WHERE lb.status = 'ACTIVE' AND (${localBodyScope(u)}) ORDER BY lb.name_en`;
  const sections = await Promise.all(lbs.map(async (lb) => ({ lb, wards: await wardRows(lb.id as number) })));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-navy-800">🏘️ {t('admin.wards')}</h1>
      {sections.map(({ lb, wards }) => (
        <Section key={lb.id as number} title={String(lang === 'ta' ? lb.name_ta ?? lb.name_en : lb.name_en)}>
          <WardsEditor localBodyId={lb.id as number} wards={JSON.parse(JSON.stringify(wards)) as WardRow[]} portal="OFFICE" canEdit={has(u, 'ward.manage')} mapBase="/office/ward-maps" />
        </Section>
      ))}
    </div>
  );
}
