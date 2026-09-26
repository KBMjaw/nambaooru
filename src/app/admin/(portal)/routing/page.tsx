import { requirePageUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { MasterTable } from '@/components/admin/MasterTable';

export default async function Page() {
  await requirePageUser('ADMIN', 'masterdata.manage');
  const { t } = await getT();
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-extrabold text-slate-800">🔀 {t('nav.routing')}</h1>
      <MasterTable entity="routing_rules" />
    </div>
  );
}
