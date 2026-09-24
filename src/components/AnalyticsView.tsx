import { makeT, type Lang, type MessageKey } from '@/i18n';
import type { analytics } from '@/lib/analytics';
import { Section, Stat } from './ui';
import { BarList, Meter, MonthlyColumns } from './charts';

export function AnalyticsView({ a, lang, linkBase, showLocalBodies = false }: { a: Awaited<ReturnType<typeof analytics>>; lang: Lang; linkBase?: string; showLocalBodies?: boolean }) {
  const t = makeT(lang);
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const s = a.s as Record<string, number>;
  const tiles: [MessageKey, number | string, string, string?][] = [
    ['office.total', s.total, 'navy'],
    ['office.pending', s.pending, 'sun', 'pending'],
    ['office.underInspection', s.inspection, 'violet', 'inspection'],
    ['office.inProgress', s.in_progress, 'navy', 'progress'],
    ['office.completed', s.completed, 'leaf', 'completed'],
    ['office.overdue', s.overdue, 'pin', 'overdue'],
    ['office.rejected', s.rejected, 'slate', 'rejected'],
    ['office.duplicate', s.duplicate, 'slate', 'duplicate'],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
        {tiles.map(([k, v, tone, bucket]) => <Stat key={k} label={t(k)} value={v} tone={tone} href={linkBase && bucket ? `${linkBase}?bucket=${bucket}` : undefined} />)}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Section><Meter value={a.resolutionRate} label={t('office.resolutionRate')} /></Section>
        <Section><Meter value={a.slaCompliance} label={t('office.slaCompliance')} /></Section>
        <Section>
          <div className="flex items-baseline justify-between"><span className="text-sm text-slate-600">{t('office.avgResolution')}</span>
            <span className="text-2xl font-extrabold text-slate-800">{s.avg_hours != null ? `${s.avg_hours} ${t('office.hours')}` : '—'}</span></div>
          <p className="mt-1 text-xs text-slate-500">{t('office.total30')}: <b>{s.last30}</b> · {t('office.slaViolations')}: <b>{s.overdue + s.closed_late}</b></p>
        </Section>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title={t('office.monthlyTrend')}>
          <MonthlyColumns data={a.monthly.map((m) => ({ month: m.month as string, a: m.a as number, b: m.b as number }))}
            labels={{ a: t('status.SUBMITTED'), b: t('status.CLOSED'), table: 'Table view', month: 'Month' }} />
        </Section>
        <Section title={t('office.byCategory')}>
          <BarList items={a.byCategory.map((c) => ({ label: `${c.icon} ${L(c.name_en, c.name_ta)}`, value: c.n as number, href: linkBase ? `${linkBase}?category=${c.code}` : undefined }))} />
        </Section>
        <Section title={t('office.byWard')}>
          <BarList items={a.byWard.map((w) => ({ label: `${t('complaint.ward')} ${w.ward_number}`, value: w.n as number, href: linkBase ? `${linkBase}?ward=${w.id}` : undefined }))} />
        </Section>
        <Section title={t('office.pendingByOfficer')}>
          <BarList items={a.byOfficer.map((o) => ({ label: `${o.full_name}${(o.overdue as number) > 0 ? ` (⏰${o.overdue})` : ''}`, value: o.n as number }))} />
        </Section>
        <Section title={`${t('office.avgResolution')} (${t('office.hours')})`}>
          <BarList items={a.byCategory.filter((c) => c.avg_hours != null).map((c) => ({ label: `${c.icon} ${L(c.name_en, c.name_ta)}`, value: c.avg_hours as number }))} />
        </Section>
        <Section title={t('office.repeat')}>
          {a.repeat.length ? (
            <table className="table-std"><tbody>
              {a.repeat.map((r, i) => <tr key={i}><td>{r.street as string}{r.ward_number != null ? ` · W${r.ward_number}` : ''}</td><td>{L(r.name_en, r.name_ta)}</td><td className="text-right font-bold">{r.n as number}</td></tr>)}
            </tbody></table>
          ) : <p className="py-4 text-center text-sm text-slate-400">—</p>}
        </Section>
        {showLocalBodies && (
          <Section title={t('users.localBody')}>
            <BarList items={a.byLocalBody.map((l) => ({ label: L(l.name_en, l.name_ta), value: l.n as number }))} />
          </Section>
        )}
      </div>
    </div>
  );
}
