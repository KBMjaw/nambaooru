'use client';
import { useI18n } from '@/i18n/client';

export function LogoutButton({ portal, className = 'btn btn-ghost btn-sm' }: { portal: 'PUBLIC' | 'OFFICE' | 'ADMIN'; className?: string }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const r = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portal }) });
        const d = await r.json().catch(() => ({}));
        window.location.href = d.redirect ?? '/';
      }}
    >
      {t('nav.logout')}
    </button>
  );
}
