import { sql } from '@/lib/db';
import type { AuthUser } from '@/lib/auth';
import { makeT, type Lang, type MessageKey } from '@/i18n';
import { fmtDate } from '@/lib/format';
import { Section } from './ui';
import { PasswordForm } from './PasswordForm';
import { LanguageSwitcher } from './LanguageSwitcher';

export async function StaffProfile({ u, lang, portal }: { u: AuthUser; lang: Lang; portal: 'OFFICE' | 'ADMIN' }) {
  const t = makeT(lang);
  const [p] = await sql`
    SELECT u.created_at, o.designation, o.employee_id, o.jurisdiction, d.name_en AS d_en, d.name_ta AS d_ta, lb.name_en AS lb_en, lb.name_ta AS lb_ta,
           w.ward_number, s.full_name AS sup
    FROM users u LEFT JOIN officials o ON o.user_id = u.id LEFT JOIN departments d ON d.id = o.department_id
    LEFT JOIN local_bodies lb ON lb.id = o.local_body_id LEFT JOIN wards w ON w.id = o.ward_id LEFT JOIN users s ON s.id = o.supervisor_id
    WHERE u.id = ${u.id}`;
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '') || '—';
  const rows: [string, string][] = [
    [t('reg.fullName'), u.fullName], [t('auth.username'), u.username], [t('profile.role'), t(`role.${u.role}` as MessageKey)],
    [t('users.designation'), (p?.designation as string) ?? '—'], [t('users.employeeId'), (p?.employee_id as string) ?? '—'],
    [t('users.localBody'), L(p?.lb_en, p?.lb_ta)], [t('users.department'), L(p?.d_en, p?.d_ta)],
    [t('users.ward'), p?.ward_number != null ? String(p.ward_number) : '—'], [t('users.supervisor'), (p?.sup as string) ?? '—'],
    [t('auth.mobile'), u.mobile], [t('users.createdAt'), fmtDate(p?.created_at as string, lang)],
  ];
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-extrabold text-navy-800">👤 {t('profile.title')}</h1>
      <Section><dl className="divide-y divide-slate-100 text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-slate-500">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>)}</dl></Section>
      <Section title={t('profile.language')}><LanguageSwitcher /></Section>
      <Section title={t('profile.changePassword')}><PasswordForm portal={portal} /></Section>
    </div>
  );
}
