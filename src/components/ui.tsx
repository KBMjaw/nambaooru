import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Section({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-bold text-slate-800">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const cls = {
    info: 'bg-navy-50 text-navy-800 border-navy-100',
    warn: 'bg-amber-50 text-amber-900 border-amber-200',
    error: 'bg-red-50 text-red-800 border-red-200',
    success: 'bg-leaf-50 text-leaf-800 border-leaf-100',
  }[tone];
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3.5 py-2.5 text-sm ${cls}`}>{children}</div>;
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Empty({ children, icon = '📭' }: { children: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-slate-500">
      <span className="text-4xl" aria-hidden>{icon}</span>
      <p>{children}</p>
    </div>
  );
}

export function Stat({ label, value, tone = 'slate', href }: { label: ReactNode; value: ReactNode; tone?: string; href?: string }) {
  const tones: Record<string, string> = {
    slate: 'text-slate-800', leaf: 'text-leaf-700', navy: 'text-navy-700', pin: 'text-pin-600', sun: 'text-amber-600', violet: 'text-violet-700',
  };
  const inner = (
    <>
      <div className={`text-2xl font-extrabold sm:text-3xl ${tones[tone] ?? tones.slate}`}>{value}</div>
      <div className="mt-0.5 text-xs font-semibold leading-tight text-slate-500 sm:text-sm">{label}</div>
    </>
  );
  return href ? (
    <a href={href} className="card block p-3.5 transition hover:border-navy-500/40 hover:shadow-md sm:p-4">{inner}</a>
  ) : (
    <div className="card p-3.5 sm:p-4">{inner}</div>
  );
}

export function Field({ label, error, hint, children, htmlFor }: { label: ReactNode; error?: string | null; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}
