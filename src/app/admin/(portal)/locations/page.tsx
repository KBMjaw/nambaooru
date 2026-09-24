import { requirePageUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { MasterTable } from '@/components/admin/MasterTable';
import { Tabs } from '@/components/admin/Tabs';

export const metadata = { title: 'Locations' };
const TABS: [string, string][] = [['districts', 'Districts'], ['taluks', 'Taluks'], ['blocks', 'Blocks'], ['local_body_types', 'Local body types'], ['local_bodies', 'Local bodies'], ['wards', 'Wards'], ['streets', 'Streets / Areas'], ['states', 'States']];

export default async function Locations({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePageUser('ADMIN', 'location.manage');
  const { t } = await getT();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'local_bodies';
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-extrabold text-slate-800">🗺️ {t('nav.locations')} — Tamil Nadu</h1>
      <p className="text-sm text-slate-500">State → District → Taluk / Block → Local body (Corporation / Municipality / Town Panchayat / Village Panchayat) → Ward → Street. Records are deactivated, never deleted, so historical complaints keep their original location.</p>
      <Tabs tabs={TABS} active={tab} base="/admin/locations" />
      <MasterTable key={tab} entity={tab} />
    </div>
  );
}
