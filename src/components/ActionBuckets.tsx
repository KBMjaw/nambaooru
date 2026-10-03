import type { MessageKey } from '@/i18n';
import type { AuthUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { bucketCounts } from '@/lib/office-queries';
import { Section, Stat } from './ui';

/** Workflow action board: every card is a filtered complaint list inside the viewer's jurisdiction. */
export const ACTION_BUCKETS: [bucket: string, label: MessageKey, tone: string, icon: string][] = [
  ['mine', 'wf.bucket.mine', 'pin', '🎯'],
  ['new', 'wf.bucket.new', 'navy', '🆕'],
  ['unassigned', 'wf.bucket.unassigned', 'violet', '📭'],
  ['progress', 'wf.bucket.progress', 'sun', '🛠️'],
  ['hold', 'wf.bucket.hold', 'slate', '⏸️'],
  ['verification', 'wf.bucket.verification', 'sun', '🔎'],
  ['rework', 'wf.bucket.rework', 'pin', '↩️'],
  ['overdue', 'wf.bucket.overdue', 'pin', '⏰'],
  ['escalated', 'wf.bucket.escalated', 'pin', '⬆️'],
  ['closed', 'wf.bucket.closed', 'leaf', '✅'],
  ['noissue', 'wf.bucket.noissue', 'slate', '🚫'],
];

export async function ActionBuckets({ u, base }: { u: AuthUser; base: '/office' | '/admin' }) {
  const { t } = await getT();
  const counts = await bucketCounts(u);
  return (
    <Section title={`⚡ ${t('wf.actionBoard')}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {ACTION_BUCKETS.map(([b, label, tone, icon]) => (
          <Stat key={b} label={`${icon} ${t(label)}`} value={counts[b] ?? 0} tone={(counts[b] ?? 0) > 0 ? tone : 'slate'} href={`${base}/complaints?bucket=${b}`} />
        ))}
      </div>
    </Section>
  );
}
