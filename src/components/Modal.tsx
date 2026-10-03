'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { Spinner } from './ui';

/** Accessible modal dialog (native <dialog>). */
export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? 'max-w-3xl' : 'max-w-md'} rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/40`}>
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-800">{title}</h2>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}>✕</button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/**
 * Confirmation for dangerous actions (deactivate, reset password, change role / permissions / jurisdiction).
 * When `reasonRequired`, the confirm button stays disabled until a reason of 3+ characters is entered.
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, danger = false, reasonRequired = false, children }: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> | void; title: ReactNode; message?: ReactNode;
  confirmLabel?: string; danger?: boolean; reasonRequired?: boolean; children?: ReactNode;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(''); }, [open]);
  const ok = !reasonRequired || reason.trim().length >= 3;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-3">
        {message && <div className="text-sm text-slate-600">{message}</div>}
        {children}
        {reasonRequired && (
          <label className="block">
            <span className="label">{t('admin.reason')} *</span>
            <textarea className="input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('admin.reasonPh')} maxLength={500} autoFocus />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-outline" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!ok || busy}
            onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); } finally { setBusy(false); } }}>
            {busy && <Spinner className="h-4 w-4" />}{confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
