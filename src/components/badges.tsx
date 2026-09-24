'use client';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n';

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  SUBMITTED: 'bg-slate-100 text-slate-700',
  AI_CLASSIFIED: 'bg-sky-100 text-sky-800',
  INITIAL_REVIEW: 'bg-indigo-100 text-indigo-800',
  SITE_INSPECTION: 'bg-violet-100 text-violet-800',
  VERIFIED: 'bg-teal-100 text-teal-800',
  REJECTED: 'bg-red-100 text-red-800',
  DUPLICATE: 'bg-orange-100 text-orange-800',
  ASSIGNED: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  WORK_COMPLETED: 'bg-lime-100 text-lime-800',
  COMPLETION_VERIFIED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-leaf-100 text-leaf-800',
  REOPENED: 'bg-fuchsia-100 text-fuchsia-800',
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`badge ${STATUS_TONE[status] ?? 'bg-slate-100'}`}>{t(`status.${status}` as MessageKey)}</span>;
}

const PR_TONE: Record<string, string> = {
  LOW: 'bg-slate-100 text-slate-700',
  MEDIUM: 'bg-sky-100 text-sky-800',
  HIGH: 'bg-orange-100 text-orange-800',
  CRITICAL: 'bg-red-600 text-white',
};

export function PriorityBadge({ priority }: { priority: string }) {
  const { t } = useI18n();
  return <span className={`badge ${PR_TONE[priority] ?? ''}`}>{t(`priority.${priority}` as MessageKey)}</span>;
}

export const STATUS_COLOR: Record<string, string> = {
  SUBMITTED: '#64748b', AI_CLASSIFIED: '#0284c7', INITIAL_REVIEW: '#4f46e5', SITE_INSPECTION: '#7c3aed', VERIFIED: '#0d9488',
  REJECTED: '#dc2626', DUPLICATE: '#ea580c', ASSIGNED: '#2563eb', IN_PROGRESS: '#d97706', WORK_COMPLETED: '#65a30d',
  COMPLETION_VERIFIED: '#059669', CLOSED: '#1f7a3a', REOPENED: '#c026d3',
};
