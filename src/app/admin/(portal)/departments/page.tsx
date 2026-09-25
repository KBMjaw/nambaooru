import { requirePageUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { MasterTable } from '@/components/admin/MasterTable';

export default async function Page({ searchParams }: { searchParams: Promise<{ parent?: string; new?: string }> }) {
  await requirePageUser('ADMIN', ['department.manage', 'masterdata.manage']);
  const { t } = await getT();
  const sp = await searchParams;
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-extrabold text-slate-800">🏛️ {t('nav.departments')}</h1>
      <MasterTable entity="departments" parent={sp.parent && /^\d+$/.test(sp.parent) ? sp.parent : undefined} autoNew={sp.new === '1'} />
    </div>
  );
}
