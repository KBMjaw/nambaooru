import { requirePageUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { analytics } from '@/lib/analytics';
import { AnalyticsView } from '@/components/AnalyticsView';

export const metadata = { title: 'Analytics' };

export default async function OfficeAnalytics() {
  const u = await requirePageUser('OFFICE', 'analytics.view');
  const { t, lang } = await getT();
  const a = await analytics(u);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-navy-800">📈 {t('nav.analytics')}</h1>
      <AnalyticsView a={a} lang={lang} linkBase="/office/complaints" />
    </div>
  );
}
