import { requirePageUser } from '@/lib/auth';
import type { Filters } from '@/lib/office-queries';
import { ReportsPage } from '@/components/ReportsPage';

export default async function OfficeReports({ searchParams }: { searchParams: Promise<Filters> }) {
  const u = await requirePageUser('OFFICE', 'report.export');
  return <ReportsPage u={u} f={await searchParams} portal="OFFICE" />;
}
