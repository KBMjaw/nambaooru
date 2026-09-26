'use client';
import { useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';

/**
 * The prominent "TAKE ACTION" call to action on a complaint. Shows the recommended next step and,
 * when opened, every action this user may take at this stage (computed on the server from role,
 * permissions, jurisdiction and status; the API re-checks all of it).
 */
export function TakeAction({ nextStep, count, children, startOpen = false }: { nextStep: string; count: number; children: ReactNode; startOpen?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(startOpen);
  if (!count) {
    return (
      <div id="take-action" className="card border-slate-200 p-4">
        <p className="text-sm font-bold text-slate-500">{t('wf.nextStep')}</p>
        <p className="text-slate-700">{nextStep}</p>
        <p className="mt-1 text-sm text-slate-500">{t('office.noAction')}</p>
      </div>
    );
  }
  return (
    <div id="take-action" className="card border-2 border-leaf-500/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-wide text-leaf-700">{t('wf.nextStep')}</p>
          <p className="font-semibold text-slate-800">{nextStep}</p>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="btn btn-primary min-h-14 w-full shrink-0 px-6 text-lg font-extrabold tracking-wide sm:w-auto">
          ⚡ {t('wf.takeAction')} ({count}) {open ? '▲' : '▼'}
        </button>
      </div>
      {open && <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4 md:grid-cols-2">{children}</div>}
    </div>
  );
}
