import { notFound } from 'next/navigation';
import { requirePageUser } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { WardMapPage } from '@/components/wardmap/WardMapPages';

export const metadata = { title: 'Ward' };

export default async function Ward({ params }: { params: Promise<{ wardId: string }> }) {
  const u = await requirePageUser('ADMIN', ['wardmap.view', 'wardmap.edit']);
  const id = Number((await params).wardId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  try {
    return await WardMapPage({ u, portal: 'ADMIN', wardId: id });
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}
