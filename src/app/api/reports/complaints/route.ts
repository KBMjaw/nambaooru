import { route } from '@/lib/api';
import { requireApiStaffFor } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { badRequest } from '@/lib/errors';
import { reportRows, reportSummary, toCsv, toPdf } from '@/lib/reports';
import type { Filters } from '@/lib/office-queries';

const KEYS = ['bucket', 'status', 'priority', 'category', 'dept', 'lb', 'ward', 'district', 'taluk', 'staff', 'from', 'to', 'q'] as const;

/**
 * Complaint report export (CSV or PDF). Requires report.export; rows are always limited to the exporter's
 * jurisdiction. Every export is audited with its filters and row count.
 */
export const GET = route(async (req) => {
  const sp = req.nextUrl.searchParams;
  const u = await requireApiStaffFor(sp.get('portal'), 'report.export');
  await rateLimit(`export:${u.id}`, 30, 3600);
  const format = sp.get('format') ?? 'csv';
  if (!['csv', 'pdf'].includes(format)) throw badRequest('format must be csv or pdf');
  const f: Filters = {};
  for (const k of KEYS) { const v = sp.get(k); if (v) f[k] = v.slice(0, 80); }
  const rows = [...(await reportRows(u, f))] as Record<string, unknown>[];
  await audit(u, { action: 'REPORT_EXPORTED', entityType: 'report', entityId: 'complaints', newValue: { format, filters: f, rows: rows.length } });
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    return new Response(toCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="namma-ooru-complaints-${stamp}.csv"`, 'Cache-Control': 'no-store' } });
  }
  const summary = await reportSummary(u, f);
  const filtersText = Object.entries(f).map(([k, v]) => `${k}=${v}`).join(', ') || 'no filters';
  const pdf = await toPdf('Namma Ooru — Complaint report', filtersText, summary, rows);
  return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="namma-ooru-complaints-${stamp}.pdf"`, 'Cache-Control': 'no-store' } });
});
