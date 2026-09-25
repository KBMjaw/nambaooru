import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { lbOptions } from '@/lib/lb-options';
import { LocalBodyForm } from '@/components/admin/LocalBodyForm';

export const metadata = { title: 'Add local body' };

export default async function NewLocalBody() {
  await requirePageUser('ADMIN', 'location.manage');
  const { t } = await getT();
  return (
    <div className="space-y-3">
      <Link href="/admin/local-bodies" className="text-sm font-semibold text-navy-600">← {t('admin.localBodies')}</Link>
      <h1 className="text-xl font-extrabold text-slate-800">+ {t('admin.addLocalBody')}</h1>
      <div className="card p-4"><LocalBodyForm opts={JSON.parse(JSON.stringify(await lbOptions()))} /></div>
    </div>
  );
}
