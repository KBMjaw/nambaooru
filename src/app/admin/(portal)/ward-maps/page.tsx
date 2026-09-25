import { requirePageUser } from '@/lib/auth';
import { WardMapIndex } from '@/components/wardmap/WardMapPages';

export const metadata = { title: 'Ward maps' };

export default async function WardMaps({ searchParams }: { searchParams: Promise<{ lb?: string }> }) {
  const u = await requirePageUser('ADMIN', ['wardmap.view', 'wardmap.edit']);
  return <WardMapIndex u={u} portal="ADMIN" lb={(await searchParams).lb} />;
}
