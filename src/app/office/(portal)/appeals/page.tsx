import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { complaintScope } from '@/lib/scope';
import { fmtDateTime } from '@/lib/format';
import { StatusBadge } from '@/components/badges';
import { Empty } from '@/components/ui';

export const metadata = { title: 'Reconsiderations' };

export default async function Appeals() {
  const u = await requirePageUser('OFFICE', 'appeal.review');
  const { t, lang } = await getT();
  const rows = await sql`
    SELECT a.id, a.reason_text, a.status, a.status_at_appeal, a.created_at, a.decision_notes, c.code, c.status AS c_status, cat.icon, cat.name_en, cat.name_ta
    FROM appeals a JOIN complaints c ON c.id = a.complaint_id LEFT JOIN complaint_categories cat ON cat.id = c.category_id
    WHERE (${complaintScope(u)}) ORDER BY (a.status = 'PENDING') DESC, a.created_at DESC LIMIT 200`;
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <h1 className="text-xl font-extrabold text-navy-800">🔁 {t('nav.appeals')}</h1>
      {!rows.length && <Empty>{t('complaint.none')}</Empty>}
      {rows.map((r) => (
        <Link key={r.id as number} href={`/office/complaints/${r.code}`} className={`card block p-4 hover:shadow-md ${r.status === 'PENDING' ? 'border-l-4 border-l-navy-500' : 'opacity-80'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-bold text-navy-700">{r.code as string}</span><StatusBadge status={r.c_status as string} />
            <span className="badge bg-slate-100">{r.status === 'PENDING' ? `⏳ ${t('appeal.pending')}` : r.status === 'ACCEPTED' ? `✅ ${t('appeal.accepted')}` : `❌ ${t('appeal.rejected')}`}</span>
          </div>
          <p className="mt-1 text-sm">{r.icon as string} {(lang === 'ta' ? r.name_ta : r.name_en) as string}</p>
          <p className="mt-1 text-sm italic text-slate-700">“{r.reason_text as string}”</p>
          <p className="mt-1 text-xs text-slate-500">{fmtDateTime(r.created_at as string, lang)}{r.decision_notes ? ` · ${t('appeal.decision')}: ${r.decision_notes}` : ''}</p>
        </Link>
      ))}
    </div>
  );
}
