import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { listUsers, manageableRoles } from '@/lib/users';
import { maskMobile } from '@/lib/crypto';
import { fmtDate } from '@/lib/format';
import { UserManager } from '@/components/UserManager';
import { Section } from '@/components/ui';

export const metadata = { title: 'Users' };

export default async function OfficeUsers() {
  const u = await requirePageUser('OFFICE', ['user.view', 'user.manage']);
  const { t, lang } = await getT();
  const items = await listUsers(u, {});
  const [lb] = u.localBodyId ? await sql`SELECT id, name_en, name_ta FROM local_bodies WHERE id = ${u.localBodyId}` : [];
  // EO can view citizen accounts of their jurisdiction where operationally necessary (contact masked unless permitted)
  const citizens = has(u, 'user.manage') && u.localBodyId ? await sql`
    SELECT usr.full_name, usr.mobile, usr.status, usr.created_at, w.ward_number,
           (SELECT count(*) FROM complaints c WHERE c.citizen_id = usr.id)::int AS complaints
    FROM users usr JOIN citizens ct ON ct.user_id = usr.id LEFT JOIN wards w ON w.id = ct.ward_id
    WHERE ct.local_body_id = ${u.localBodyId} ORDER BY usr.created_at DESC LIMIT 200` : [];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-navy-800">👥 {t('users.title')}</h1>
      <UserManager apiBase="/api/office/users" items={JSON.parse(JSON.stringify(items))} manageable={manageableRoles(u)} meId={u.id}
        fixedLocalBody={lb ? { id: lb.id as number, name: String(lang === 'ta' ? lb.name_ta ?? lb.name_en : lb.name_en) } : null} />
      {citizens.length > 0 && (
        <Section title={`${t('role.CITIZEN')} (${citizens.length})`}>
          <div className="overflow-x-auto"><table className="table-std">
            <thead><tr><th>{t('reg.fullName')}</th><th>{t('auth.mobile')}</th><th>{t('complaint.ward')}</th><th>{t('nav.complaints')}</th><th>{t('users.createdAt')}</th></tr></thead>
            <tbody>{citizens.map((c, i) => (
              <tr key={i}><td>{c.full_name as string}</td><td className="font-mono text-xs">{has(u, 'citizen.pii.view') ? c.mobile as string : maskMobile(c.mobile as string)}</td>
                <td>{(c.ward_number as number) ?? '—'}</td><td>{c.complaints as number}</td><td className="text-xs">{fmtDate(c.created_at as string, lang)}</td></tr>
            ))}</tbody>
          </table></div>
        </Section>
      )}
    </div>
  );
}
