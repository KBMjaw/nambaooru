'use client';
import { useState } from 'react';
import { api } from '@/lib/client-api';
import { Alert, Spinner } from '@/components/ui';

export function SettingRow({ k, value, security, canEdit, options }: { k: string; value: unknown; security: boolean; canEdit: boolean; options?: string[] }) {
  const [v, setV] = useState(typeof value === 'string' ? value : JSON.stringify(value));
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setMsg(null);
    let parsed: unknown = v;
    if (typeof value === 'number') parsed = Number(v);
    try { await api('/api/admin/settings', { body: { key: k, value: parsed } }); setMsg('✓'); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <tr>
      <td><code className="text-xs font-bold">{k}</code>{security && <span className="ml-1 badge bg-red-100 text-red-700">security</span>}</td>
      <td>{options ? (
        <select className="input" disabled={!canEdit} value={v} onChange={(e) => setV(e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select>
      ) : <input className="input" disabled={!canEdit} value={v} onChange={(e) => setV(e.target.value)} />}</td>
      <td className="whitespace-nowrap">{canEdit && <button className="btn btn-outline btn-sm" onClick={save}>Save</button>} <span className="text-xs">{msg}</span></td>
    </tr>
  );
}

export function NlpTester() {
  const [text, setText] = useState('Enga street light rendu naala eriyala');
  const [out, setOut] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <textarea className="input min-h-20" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn btn-navy btn-sm" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try { setOut((await api<{ analysis: unknown }>('/api/admin/nlp-test', { body: { text } })).analysis); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      }}>{busy && <Spinner className="h-4 w-4" />} Analyse</button>
      {err && <Alert tone="error">{err}</Alert>}
      {out != null && <pre className="max-h-96 overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-green-200">{JSON.stringify(out, null, 2)}</pre>}
    </div>
  );
}
