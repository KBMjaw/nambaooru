import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { fmtDateTime } from '@/lib/format';
import { MasterTable } from '@/components/admin/MasterTable';
import { PostalImport } from '@/components/admin/PostalImport';
import { Tabs } from '@/components/admin/Tabs';
import { Section } from '@/components/ui';

const TABS: [string, string][] = [['postal_locations', 'Postal locations'], ['postal_location_jurisdictions', 'Postal → Local body mappings'], ['pincodes', 'Pincodes'], ['post_offices', 'Post offices'], ['sources', 'Import / Export & Sources']];

export default async function Postal({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePageUser('ADMIN', 'location.manage');
  const { t, lang } = await getT();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'postal_locations';
  const sources = tab === 'sources' ? await sql`SELECT s.*, u.username FROM data_sources s LEFT JOIN users u ON u.id = s.imported_by ORDER BY s.imported_at DESC` : [];
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-extrabold text-slate-800">📮 {t('nav.postal')}</h1>
      <p className="text-sm text-slate-500">Postal data is a lookup aid only: one pincode can cover several post offices, villages and local bodies. Final jurisdiction = pincode + place + district + local body + ward + GPS. Map postal places to local bodies/wards with explicit confidence.</p>
      <Tabs tabs={TABS} active={tab} base="/admin/postal" />
      {tab === 'sources' ? (
        <div className="space-y-4">
          <Section title="Import dataset"><PostalImport /></Section>
          <Section title="Export" action={<a className="btn btn-navy btn-sm" href="/api/admin/postal/export">⬇️ {t('common.export')}</a>}>
            <p className="text-sm text-slate-500">Exports every postal location with its normalised district, taluk, source and mapped local bodies.</p>
          </Section>
          <Section title="Data sources (provenance)">
            <div className="overflow-x-auto"><table className="table-std">
              <thead><tr><th>#</th><th>Name</th><th>File</th><th>Rows</th><th>Inserted</th><th>By</th><th>When</th><th>Description</th></tr></thead>
              <tbody>{sources.map((s) => <tr key={s.id as number}><td>{s.id as number}</td><td>{s.name as string}</td><td className="text-xs">{s.file_name as string}</td><td>{s.row_count as number}</td><td>{s.inserted_count as number}</td><td>{(s.username as string) ?? 'system'}</td><td className="whitespace-nowrap text-xs">{fmtDateTime(s.imported_at as string, lang)}</td><td className="text-xs">{s.description as string}</td></tr>)}</tbody>
            </table></div>
          </Section>
        </div>
      ) : <MasterTable key={tab} entity={tab} />}
    </div>
  );
}
