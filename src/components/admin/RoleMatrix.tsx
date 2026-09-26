'use client';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { Alert } from '@/components/ui';

export function RoleMatrix({ roles, perms, grants }: { roles: { code: string; name: string }[]; perms: { code: string; label: string | null; description: string; is_security: boolean }[]; grants: string[] }) {
  const { t } = useI18n();
  const [g, setG] = useState(new Set(grants));
  const [err, setErr] = useState<string | null>(null);
  async function toggle(role: string, perm: string) {
    const key = `${role}|${perm}`;
    const granted = !g.has(key);
    setErr(null);
    try {
      await api('/api/admin/roles', { method: 'PUT', body: { role, permission: perm, granted } });
      setG((s) => { const n = new Set(s); if (granted) n.add(key); else n.delete(key); return n; });
    } catch (e) { setErr(trMsg(t, (e as Error).message)); }
  }
  return (
    <div className="space-y-2">
      {err && <Alert tone="error">{err}</Alert>}
      <div className="card overflow-x-auto">
        <table className="table-std">
          <thead><tr><th>Permission</th>{roles.map((r) => <th key={r.code} className="text-center text-xs">{r.name}</th>)}</tr></thead>
          <tbody>
            {perms.map((p) => (
              <tr key={p.code}>
                <td><b className="text-xs">{p.label ?? p.code}</b> <code className="text-[10px] text-slate-400">{p.code}</code>{p.is_security && <span className="ml-1 badge bg-red-100 text-red-700">security</span>}<div className="text-xs text-slate-500">{p.description}</div></td>
                {roles.map((r) => {
                  const locked = r.code === 'SUPER_ADMIN' || (p.is_security && r.code !== 'SUPER_ADMIN');
                  return (
                    <td key={r.code} className="text-center">
                      <input type="checkbox" className="h-4 w-4" aria-label={`${r.code} ${p.code}`} checked={g.has(`${r.code}|${p.code}`)} disabled={locked} onChange={() => toggle(r.code, p.code)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
