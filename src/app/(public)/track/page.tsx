import { redirect } from 'next/navigation';
import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { Alert } from '@/components/ui';

export const metadata = { title: 'Track Complaint' };

export default async function Track({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await requirePageUser('PUBLIC', 'complaint.view.own');
  const { t } = await getT();
  const { id } = await searchParams;
  let notFoundMsg = false;
  if (id) {
    const code = id.trim().toUpperCase();
    const r = await sql`SELECT code FROM complaints c WHERE upper(c.code) = ${code}
                        AND (c.citizen_id = ${user.id} OR EXISTS (SELECT 1 FROM complaint_supporters s WHERE s.complaint_id = c.id AND s.user_id = ${user.id}))`;
    if (r.length) redirect(`/complaints/${r[0].code}`);
    notFoundMsg = true;
  }
  return (
    <div className="mx-auto max-w-md">
      <div className="card space-y-4 p-6">
        <h1 className="text-xl font-extrabold text-navy-800">🔎 {t('track.title')}</h1>
        {notFoundMsg && <Alert tone="warn">{t('complaint.notFound')}</Alert>}
        <form className="space-y-3">
          <label className="label" htmlFor="cid">{t('track.enterId')}</label>
          <input id="cid" name="id" className="input font-mono text-lg uppercase" placeholder="NU-2026-001001" defaultValue={id ?? ''} required maxLength={32} />
          <button className="btn btn-primary btn-lg w-full">{t('track.btn')}</button>
        </form>
        <p className="text-xs text-slate-500">{t('track.hint')}</p>
      </div>
    </div>
  );
}
