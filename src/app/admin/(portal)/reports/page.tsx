import { requirePageUser } from '@/lib/auth';
import type { Filters } from '@/lib/office-queries';
import { ReportsPage } from '@/components/ReportsPage';

export default async function AdminReports({ searchParams }: { searchParams: Promise<Filters> }) {
  const u = await requirePageUser('ADMIN', 'report.export');
  return <ReportsPage u={u} f={await searchParams} portal="ADMIN" />;
}
