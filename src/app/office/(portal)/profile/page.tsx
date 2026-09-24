import { requirePageUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { StaffProfile } from '@/components/StaffProfile';

export default async function OfficeProfile() {
  const u = await requirePageUser('OFFICE');
  const { lang } = await getT();
  return <StaffProfile u={u} lang={lang} portal="OFFICE" />;
}
