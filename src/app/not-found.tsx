import Link from 'next/link';
import { getT } from '@/i18n/server';

export default async function NotFound() {
  const { t } = await getT();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-6xl">🧭</div>
      <h1 className="text-xl font-extrabold text-navy-800">404 — {t('complaint.notFound')}</h1>
      <Link href="/" className="btn btn-primary">{t('nav.home')}</Link>
    </div>
  );
}
