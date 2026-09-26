'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { Alert, Spinner } from '@/components/ui';

export function PostalImport() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setErr(null); setRes(null);
      try { setRes(await api('/api/admin/postal/import', { form: new FormData(e.currentTarget) })); router.refresh(); }
      catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="label">CSV file (Place, Pincode, District) *</span><input name="file" type="file" accept=".csv,text/csv" required className="input" /></label>
        <label className="block"><span className="label">Source name *</span><input name="name" required className="input" placeholder="India Post pincode directory 2026" /></label>
        <label className="block"><span className="label">Reference URL</span><input name="referenceUrl" className="input" placeholder="https://data.gov.in/…" /></label>
      </div>
      <label className="block"><span className="label">Description</span><input name="description" className="input" /></label>
      <button className="btn btn-primary" disabled={busy}>{busy && <Spinner className="h-4 w-4" />} ⬆️ Import</button>
      {err && <Alert tone="error">{err}</Alert>}
      {res && <Alert tone="success"><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(res, null, 2)}</pre></Alert>}
    </form>
  );
}
