import Link from 'next/link';
import { StatusBadge, PriorityBadge } from './badges';
import { fmtDate } from '@/lib/format';

export interface ComplaintRow {
  code: string;
  status: string;
  priority: string;
  icon: string | null;
  category_en: string | null;
  category_ta: string | null;
  title_en: string | null;
  title_ta: string | null;
  ward_number: number | null;
  street: string | null;
  street_ta: string | null;
  created_at: string | Date;
  sla_due_at?: string | Date | null;
}

export function ComplaintCard({ c, lang, href, overdueLabel }: { c: ComplaintRow; lang: string; href: string; overdueLabel?: string }) {
  const overdue = c.sla_due_at && new Date(c.sla_due_at) < new Date() && !['CLOSED', 'REJECTED', 'DUPLICATE'].includes(c.status);
  return (
    <Link href={href} className="card flex items-start gap-3 p-3.5 transition hover:border-navy-500/40 hover:shadow-md">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-leaf-50 text-2xl" aria-hidden>{c.icon ?? '📌'}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs font-bold text-navy-700">{c.code}</span>
          <StatusBadge status={c.status} />
          {c.priority && ['HIGH', 'CRITICAL'].includes(c.priority) && <PriorityBadge priority={c.priority} />}
          {overdue && overdueLabel && <span className="badge bg-red-100 text-red-700">⏰ {overdueLabel}</span>}
        </span>
        <span className="mt-1 block truncate font-semibold text-slate-800">{(lang === 'ta' ? c.title_ta : c.title_en) ?? (lang === 'ta' ? c.category_ta : c.category_en)}</span>
        <span className="block truncate text-xs text-slate-500">
          📍 {[lang === 'ta' ? c.street_ta ?? c.street : c.street, c.ward_number != null ? `${lang === 'ta' ? 'வார்டு' : 'Ward'} ${c.ward_number}` : null].filter(Boolean).join(', ') || '—'} · {fmtDate(c.created_at, lang)}
        </span>
      </span>
    </Link>
  );
}

export const COMPLAINT_LIST_COLUMNS = `
  c.code, c.status, c.priority, cat.icon, cat.name_en AS category_en, cat.name_ta AS category_ta, c.title_en, c.title_ta,
  w.ward_number, COALESCE(s.name_en, c.street_text) AS street, COALESCE(s.name_ta, c.street_text) AS street_ta, c.created_at, c.sla_due_at`;
