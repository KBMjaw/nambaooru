import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { fmtDateTime } from '@/lib/format';
import { BulkUpload } from '@/components/admin/BulkUpload';
import { Section } from '@/components/ui';

export const metadata = { title: 'Bulk upload users' };

export default async function BulkUsers() {
  await requirePageUser('ADMIN', 'user.bulk_upload');
  const { t, lang } = await getT();
  const history = await sql`SELECT b.id, b.file_name, b.file_format, b.mode, b.total_rows, b.created_count, b.failed_count, b.created_at, u.full_name
                            FROM bulk_imports b JOIN users u ON u.id = b.created_by ORDER BY b.created_at DESC LIMIT 20`;
  return (
    <div className="space-y-4">
      <Link href="/admin/users" className="text-sm font-semibold text-navy-600">← {t('users.title')}</Link>
      <h1 className="text-xl font-extrabold text-slate-800">📥 {t('admin.bulkUpload')}</h1>
      <BulkUpload />
      <Section title={`🧾 ${t('admin.importHistory')}`}>
        {history.length === 0 ? <p className="text-sm text-slate-500">—</p> : (
          <div className="overflow-x-auto"><table className="table-std text-sm">
            <thead><tr><th>#</th><th>{t('admin.file')}</th><th>{t('admin.mode')}</th><th>{t('admin.rows')}</th><th>{t('admin.createdRows')}</th><th>{t('admin.failedRows')}</th><th>{t('admin.by')}</th><th>{t('admin.when')}</th></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id as number}><td>{h.id as number}</td><td>{h.file_name as string} <span className="text-xs text-slate-400">{h.file_format as string}</span></td><td className="text-xs">{h.mode as string}</td>
                <td>{h.total_rows as number}</td><td>{h.created_count as number}</td><td>{h.failed_count as number}</td><td className="text-xs">{h.full_name as string}</td><td className="text-xs">{fmtDateTime(h.created_at as string, lang)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
    </div>
  );
}
