import { requirePageUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { StaffProfile } from '@/components/StaffProfile';

export default async function AdminProfile() {
  const u = await requirePageUser('ADMIN');
  const { lang } = await getT();
  return <StaffProfile u={u} lang={lang} portal="ADMIN" />;
}
