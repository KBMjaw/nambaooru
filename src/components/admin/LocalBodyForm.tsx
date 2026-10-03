'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api, ApiError } from '@/lib/client-api';
import { Alert, Spinner } from '@/components/ui';

export interface LbOptions {
  districts: { id: number; name_en: string }[];
  taluks: { id: number; district_id: number; name_en: string }[];
  types: { id: number; code: string; category: string; name_en: string; name_ta: string }[];
  departments: { code: string; name_en: string }[];
  officers: { id: string; full_name: string; role_en: string; local_body_id: number | null }[];
  authorities: string[];
}
export interface LbValues {
  id?: number; code?: string; districtId: number | null; talukId: number | null; nameEn: string; nameTa: string; typeId: number | null; pincode: string;
  controllingAuthority: string; responsibleOfficerId: string; status: string; centerLat: string; centerLng: string;
}

/** Add / edit a local body. On create, the requested number of wards and the chosen departments are generated. */
export function LocalBodyForm({ opts, initial }: { opts: LbOptions; initial?: LbValues }) {
  const { t } = useI18n();
  const router = useRouter();
  const editing = !!initial?.id;
  const [f, setF] = useState<Record<string, string>>({
    districtId: initial?.districtId ? String(initial.districtId) : '', talukId: initial?.talukId ? String(initial.talukId) : '', nameEn: initial?.nameEn ?? '',
    nameTa: initial?.nameTa ?? '', code: initial?.code ?? '', typeId: initial?.typeId ? String(initial.typeId) : '', pincode: initial?.pincode ?? '',
    controllingAuthority: initial?.controllingAuthority ?? 'Executive Officer', responsibleOfficerId: initial?.responsibleOfficerId ?? '', status: initial?.status ?? 'ACTIVE',
    centerLat: initial?.centerLat ?? '', centerLng: initial?.centerLng ?? '', wardCount: '15', reason: '',
  });
  const [depts, setDepts] = useState<Set<string>>(new Set(opts.departments.map((d) => d.code)));
  const [errs, setErrs] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const type = opts.types.find((x) => String(x.id) === f.typeId);
  const taluks = useMemo(() => opts.taluks.filter((x) => String(x.district_id) === f.districtId), [opts.taluks, f.districtId]);
  const officers = opts.officers.filter((o) => !initial?.id || !o.local_body_id || o.local_body_id === initial.id);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErrs({}); setMsg(null);
    const body: Record<string, unknown> = {
      talukId: f.talukId || null, nameEn: f.nameEn, nameTa: f.nameTa || null, typeId: Number(f.typeId), pincode: f.pincode || null,
      controllingAuthority: f.controllingAuthority, responsibleOfficerId: f.responsibleOfficerId || null, status: f.status,
      centerLat: f.centerLat || null, centerLng: f.centerLng || null, code: f.code || null,
    };
    try {
      if (editing) {
        await api(`/api/admin/local-bodies/${initial!.id}`, { method: 'PATCH', body: { ...body, reason: f.reason || null } });
        setMsg({ tone: 'success', text: t('profile.saved') }); router.refresh();
      } else {
        const r = await api<{ id: number }>('/api/admin/local-bodies', { body: { ...body, districtId: Number(f.districtId), wardCount: Number(f.wardCount || 0), departments: [...depts] } });
        router.push(`/admin/local-bodies/${r.id}`);
      }
    } catch (x) { const err = x as ApiError; setErrs((err.details as Record<string, string[]>) ?? {}); setMsg({ tone: 'error', text: trMsg(t, err.message) }); }
    finally { setBusy(false); }
  }
  const E = (k: string) => errs[k] && <span className="text-xs text-red-600">{errs[k].map((x) => trMsg(t, x)).join(', ')}</span>;
  return (
    <form onSubmit={save} className="space-y-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block"><span className="label">{t('reg.district')} *</span>
          <select className="input" value={f.districtId} disabled={editing} onChange={(e) => setF((s) => ({ ...s, districtId: e.target.value, talukId: '' }))} required>
            <option value="">{t('common.select')}</option>{opts.districts.map((d) => <option key={d.id} value={d.id}>{d.name_en}</option>)}
          </select>{E('districtId')}</label>
        <label className="block"><span className="label">{t('reg.taluk')}</span>
          <select className="input" value={f.talukId} onChange={(e) => set('talukId', e.target.value)}>
            <option value="">—</option>{taluks.map((d) => <option key={d.id} value={d.id}>{d.name_en}</option>)}
          </select>{E('talukId')}</label>
        <label className="block"><span className="label">{t('admin.lbType')} *</span>
          <select className="input" value={f.typeId} onChange={(e) => set('typeId', e.target.value)} required>
            <option value="">{t('common.select')}</option>
            {['URBAN', 'RURAL'].map((cat) => <optgroup key={cat} label={cat === 'URBAN' ? t('admin.urban') : t('admin.rural')}>{opts.types.filter((x) => x.category === cat).map((x) => <option key={x.id} value={x.id}>{x.name_en} / {x.name_ta}</option>)}</optgroup>)}
          </select>{E('typeId')}</label>
        <label className="block"><span className="label">{t('admin.lbName')} (EN) *</span><input className="input" value={f.nameEn} onChange={(e) => set('nameEn', e.target.value)} required placeholder="Chennimalai Town Panchayat" />{E('nameEn')}</label>
        <label className="block"><span className="label">{t('admin.lbName')} (த)</span><input className="input" value={f.nameTa} onChange={(e) => set('nameTa', e.target.value)} placeholder="சென்னிமலை பேரூராட்சி" /></label>
        <label className="block"><span className="label">{t('admin.urbanRural')}</span><input className="input" disabled value={type ? (type.category === 'URBAN' ? t('admin.urban') : t('admin.rural')) : '—'} /></label>
        <label className="block"><span className="label">{t('reg.pincode')}</span><input className="input" inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => set('pincode', e.target.value)} />{E('pincode')}</label>
        <label className="block"><span className="label">{t('admin.controllingAuthority')} *</span>
          <input className="input" list="authorities" value={f.controllingAuthority} onChange={(e) => set('controllingAuthority', e.target.value)} required />
          <datalist id="authorities">{opts.authorities.map((a) => <option key={a} value={a} />)}</datalist></label>
        <label className="block"><span className="label">{t('admin.responsibleOfficer')}</span>
          <select className="input" value={f.responsibleOfficerId} onChange={(e) => set('responsibleOfficerId', e.target.value)}>
            <option value="">— {t('admin.assignLater')}</option>{officers.map((o) => <option key={o.id} value={o.id}>{o.full_name} ({o.role_en})</option>)}
          </select>{E('responsibleOfficerId')}</label>
        <label className="block"><span className="label">{t('users.status')}</span>
          <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="ACTIVE">{t('users.ACTIVE')}</option><option value="INACTIVE">{t('users.INACTIVE')}</option></select></label>
        <label className="block"><span className="label">{t('admin.code')}</span><input className="input font-mono" value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder={t('admin.autoCode')} />{E('code')}</label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="label">{t('admin.centreLat')}</span><input className="input" inputMode="decimal" value={f.centerLat} onChange={(e) => set('centerLat', e.target.value)} /></label>
          <label className="block"><span className="label">{t('admin.centreLng')}</span><input className="input" inputMode="decimal" value={f.centerLng} onChange={(e) => set('centerLng', e.target.value)} /></label>
        </div>
      </div>
      {!editing && (
        <>
          <div className="card space-y-2 border-navy-100 bg-navy-50/40 p-3">
            <label className="block max-w-xs"><span className="label">🏘️ {t('admin.wardCount')} *</span>
              <input className="input" type="number" min={0} max={300} value={f.wardCount} onChange={(e) => set('wardCount', e.target.value)} /></label>
            <p className="text-xs text-slate-500">{t('admin.wardCountNote')}</p>
          </div>
          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm font-bold">🏛️ {t('admin.departmentMapping')}</legend>
            <div className="grid gap-1 sm:grid-cols-3">
              {opts.departments.map((d) => (
                <label key={d.code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={depts.has(d.code)}
                  onChange={(e) => setDepts((s) => { const n = new Set(s); if (e.target.checked) n.add(d.code); else n.delete(d.code); return n; })} />{d.name_en} <code className="text-[10px] text-slate-400">{d.code}</code></label>
              ))}
            </div>
          </fieldset>
        </>
      )}
      {editing && <label className="block max-w-xl"><span className="label">{t('admin.reason')}</span><input className="input" value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder={t('admin.reasonPh')} /></label>}
      <button className="btn btn-primary" disabled={busy}>{busy && <Spinner className="h-4 w-4" />}{editing ? t('common.save') : `+ ${t('admin.addLocalBody')}`}</button>
    </form>
  );
}
