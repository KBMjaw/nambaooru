import { Section, Stat } from '@/components/ui';
import type { SiteAnalyticsSummary } from '@/lib/site-analytics';
import type { TFn } from '@/i18n';

/** Aggregate public website traffic. Rendered only for holders of site_analytics.view (Admin / Super Admin). */
export function WebsiteVisitorsCard({ s, t }: { s: SiteAnalyticsSummary; t: TFn }) {
  return (
    <Section
      title={`🌐 ${t('site.title')}`}
      action={<a className="text-sm font-semibold text-navy-700 underline" href="https://vercel.com/kmb-jaw/nambaooru/analytics" target="_blank" rel="noopener noreferrer">{t('site.vercel')} ↗</a>}
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label={`${t('site.visitors')}: ${t('site.today')}`} value={s.visitors.today} tone="leaf" />
        <Stat label={`${t('site.visitors')}: ${t('site.week')}`} value={s.visitors.week} tone="navy" />
        <Stat label={`${t('site.visitors')}: ${t('site.month')}`} value={s.visitors.month} tone="violet" />
        <Stat label={t('site.totalPageViews')} value={s.pageViews.total} />
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="table-std text-sm">
          <thead><tr><th></th><th>{t('site.today')}</th><th>{t('site.week')}</th><th>{t('site.month')}</th><th>{t('site.total')}</th></tr></thead>
          <tbody>
            <tr><th className="text-left">{t('site.visitors')}</th><td>{s.visitors.today}</td><td>{s.visitors.week}</td><td>{s.visitors.month}</td><td>{s.visitors.total}</td></tr>
            <tr><th className="text-left">{t('site.pageViews')}</th><td>{s.pageViews.today}</td><td>{s.pageViews.week}</td><td>{s.pageViews.month}</td><td>{s.pageViews.total}</td></tr>
          </tbody>
        </table>
      </div>
      <h3 className="mb-1.5 mt-4 text-sm font-bold text-slate-700">{t('site.topPages')}</h3>
      {s.topPages.length ? (
        <ul className="space-y-1 text-sm">
          {s.topPages.map((p) => (
            <li key={p.path} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-2.5 py-1.5">
              <code className="min-w-0 truncate">{p.path}</code>
              <span className="shrink-0 tabular-nums text-slate-600">{p.views} · {p.visitors} {t('site.visitors').toLowerCase()}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-500">{t('site.none')}</p>}
      <p className="mt-3 text-xs text-slate-500">{t('site.note')}{s.since ? ` ${t('site.since', { date: s.since })}` : ''}</p>
    </Section>
  );
}
