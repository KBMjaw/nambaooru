import { notFound } from 'next/navigation';
import { requirePageUser } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { CitizenDetailPage } from '@/components/citizens/CitizenPages';

export const metadata = { title: 'Citizen' };

export default async function Citizen({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePageUser('OFFICE', ['citizen.view', 'citizen.manage']);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    return await CitizenDetailPage({ u, portal: 'OFFICE', id });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
}
