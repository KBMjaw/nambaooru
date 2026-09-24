import { requirePageUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { mapComplaints } from '@/lib/map-data';
import { filterOptions, type Filters } from '@/lib/office-queries';
import { ComplaintsMap } from '@/components/office/ComplaintsMap';
import { FilterBar } from '@/components/office/FilterBar';

export const metadata = { title: 'Map' };

export default async function OfficeMap({ searchParams }: { searchParams: Promise<Filters> }) {
  const u = await requirePageUser('OFFICE', 'map.view');
  const { t, lang } = await getT();
  const f = await searchParams;
  const [items, opts] = await Promise.all([mapComplaints(u, f), filterOptions(u)]);
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-extrabold text-navy-800">🗺️ {t('office.wardMap')} <span className="text-sm font-normal text-slate-500">({items.length})</span></h1>
      <FilterBar f={f} opts={opts as never} lang={lang} action="/office/map" />
      <div className="card p-3"><ComplaintsMap items={items} height={600} /></div>
    </div>
  );
}
