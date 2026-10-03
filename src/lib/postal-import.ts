/**
 * Postal master-data importer (Place, Pincode, District CSV).
 * - Preserves original Place / Pincode / District values verbatim.
 * - Removes exact duplicate rows only; different places sharing a pincode stay separate.
 * - Links to normalised districts by name/alias where possible (district_id nullable).
 * - Records the data source for provenance.
 * Pure module (no framework imports) so it is shared by the admin API and CLI scripts.
 */
import type postgres from 'postgres';

export interface PostalRow { place: string; pincode: string; district: string }

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export function parsePostalCsv(text: string): { rows: PostalRow[]; errors: string[]; total: number } {
  const all = parseCsv(text.replace(/^﻿/, ''));
  if (!all.length) return { rows: [], errors: ['Empty file'], total: 0 };
  const header = all[0].map((h) => h.trim().toLowerCase());
  const pi = header.findIndex((h) => ['place', 'place name', 'placename', 'office', 'officename', 'post office', 'locality'].includes(h));
  const ci = header.findIndex((h) => ['pincode', 'pin', 'pin code', 'postal code'].includes(h));
  const di = header.findIndex((h) => ['district', 'districtname', 'district name'].includes(h));
  if (pi < 0 || ci < 0 || di < 0) return { rows: [], errors: ['Header must contain Place, Pincode and District columns'], total: all.length - 1 };
  const rows: PostalRow[] = [];
  const errors: string[] = [];
  all.slice(1).forEach((r, i) => {
    const place = (r[pi] ?? '').replace(/\s+/g, ' ').trim();
    const pincode = (r[ci] ?? '').replace(/\s/g, '');
    const district = (r[di] ?? '').replace(/\s+/g, ' ').trim();
    if (!place || !district || !/^[1-9]\d{5}$/.test(pincode)) { errors.push(`Row ${i + 2}: invalid (${place || '?'}, ${pincode || '?'}, ${district || '?'})`); return; }
    rows.push({ place, pincode, district });
  });
  return { rows, errors, total: all.length - 1 };
}

export function dedupeExact(rows: PostalRow[]): PostalRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.place}\u0000${r.pincode}\u0000${r.district}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function importPostal(
  sql: postgres.Sql<Record<string, unknown>>,
  text: string,
  source: { name: string; description?: string; referenceUrl?: string; fileName?: string; importedBy?: string | null },
) {
  const parsed = parsePostalCsv(text);
  const unique = dedupeExact(parsed.rows);
  const districts = await sql`SELECT id, lower(name_en) AS n, aliases FROM districts`;
  const lookup = new Map<string, number>();
  for (const d of districts) {
    lookup.set(d.n as string, d.id as number);
    for (const a of (d.aliases as string[]) ?? []) lookup.set(a.toLowerCase(), d.id as number);
  }
  const districtId = (name: string) => {
    const n = name.toLowerCase();
    if (lookup.has(n)) return lookup.get(n)!;
    for (const part of n.split(/[\s/,-]+/)) if (lookup.has(part)) return lookup.get(part)!;
    return null;
  };
  return sql.begin(async (tx) => {
    const [src] = await tx`
      INSERT INTO data_sources (name, description, reference_url, file_name, row_count, imported_by)
      VALUES (${source.name}, ${source.description ?? null}, ${source.referenceUrl ?? null}, ${source.fileName ?? null}, ${parsed.total}, ${source.importedBy ?? null})
      RETURNING id`;
    const pins = [...new Set(unique.map((r) => r.pincode))];
    if (pins.length) {
      await tx`INSERT INTO pincodes (pincode, state_id) SELECT p, (SELECT id FROM states WHERE code = 'TN') FROM unnest(${pins}::text[]) AS p ON CONFLICT DO NOTHING`;
    }
    let inserted = 0;
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500).map((r) => ({
        place_name: r.place, pincode: r.pincode, district_name: r.district, district_id: districtId(r.district), source_id: src.id,
      }));
      const res = await tx`INSERT INTO postal_locations ${tx(chunk, 'place_name', 'pincode', 'district_name', 'district_id', 'source_id')}
                           ON CONFLICT (place_name, pincode, district_name) DO NOTHING RETURNING id`;
      inserted += res.length;
    }
    await tx`UPDATE data_sources SET inserted_count = ${inserted} WHERE id = ${src.id}`;
    return {
      sourceId: src.id as number,
      totalRows: parsed.total,
      validRows: parsed.rows.length,
      exactDuplicatesRemoved: parsed.rows.length - unique.length,
      inserted,
      alreadyPresent: unique.length - inserted,
      unmappedDistricts: [...new Set(unique.filter((r) => districtId(r.district) == null).map((r) => r.district))],
      errors: parsed.errors.slice(0, 50),
    };
  });
}
