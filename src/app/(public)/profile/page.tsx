import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { decrypt, maskMobile } from '@/lib/crypto';
import { getT } from '@/i18n/server';
import { fmtDate } from '@/lib/format';
import { Section } from '@/components/ui';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { LogoutButton } from '@/components/LogoutButton';
import { PasswordForm } from '@/components/PasswordForm';

export const metadata = { title: 'Profile' };

export default async function Profile() {
  const user = await requirePageUser('PUBLIC');
  const { t, lang } = await getT();
  const [p] = await sql`
    SELECT u.created_at, c.*, d.name_en AS d_en, d.name_ta AS d_ta, lb.name_en AS lb_en, lb.name_ta AS lb_ta, w.ward_number,
           s.name_en AS s_en, s.name_ta AS s_ta, pl.place_name
    FROM users u JOIN citizens c ON c.user_id = u.id
    LEFT JOIN districts d ON d.id = c.district_id LEFT JOIN local_bodies lb ON lb.id = c.local_body_id
    LEFT JOIN wards w ON w.id = c.ward_id LEFT JOIN streets s ON s.id = c.street_id LEFT JOIN postal_locations pl ON pl.id = c.postal_location_id
    WHERE u.id = ${user.id}`;
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const address = p ? [decrypt(p.address_enc as string), L(p.s_en, p.s_ta) || p.street_text, p.ward_number ? `${t('complaint.ward')} ${p.ward_number}` : null, L(p.lb_en, p.lb_ta), p.place_name, L(p.d_en, p.d_ta), p.pincode].filter(Boolean).join(', ') : '—';
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-extrabold text-navy-800">👤 {t('profile.title')}</h1>
      <Section>
        <dl className="divide-y divide-slate-100 text-sm">
          <div className="flex justify-between py-2"><dt className="text-slate-500">{t('reg.fullName')}</dt><dd className="font-semibold">{user.fullName}</dd></div>
          <div className="flex justify-between py-2"><dt className="text-slate-500">{t('auth.mobile')}</dt><dd className="font-semibold">{maskMobile(user.mobile)}</dd></div>
          {user.email && <div className="flex justify-between py-2"><dt className="text-slate-500">{t('reg.email')}</dt><dd className="font-semibold">{user.email}</dd></div>}
          <div className="flex justify-between gap-4 py-2"><dt className="text-slate-500">{t('profile.address')}</dt><dd className="text-right font-semibold">{address}</dd></div>
          <div className="flex justify-between py-2"><dt className="text-slate-500">{t('profile.identity')}</dt><dd className="font-semibold text-slate-500">{p?.identity_verified ? '✅' : t('profile.identityNot')}</dd></div>
          <div className="flex justify-between py-2"><dt className="text-slate-500">{t('profile.memberSince')}</dt><dd className="font-semibold">{fmtDate(p?.created_at as string, lang)}</dd></div>
        </dl>
      </Section>
      <Section title={t('profile.language')}><LanguageSwitcher /></Section>
      <Section title={t('profile.changePassword')}><PasswordForm portal="PUBLIC" /></Section>
      <LogoutButton portal="PUBLIC" className="btn btn-outline w-full" />
    </div>
  );
}
