import { requirePageUser } from '@/lib/auth';
import { CitizensListPage } from '@/components/citizens/CitizenPages';
import type { CitizenQuery } from '@/lib/citizens';

export const metadata = { title: 'Citizens' };

export default async function Citizens({ searchParams }: { searchParams: Promise<CitizenQuery> }) {
  const u = await requirePageUser('OFFICE', ['citizen.view', 'citizen.manage']);
  return <CitizensListPage u={u} portal="OFFICE" sp={await searchParams} />;
}
