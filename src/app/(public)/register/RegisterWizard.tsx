'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { pick, trMsg } from '@/i18n';
import { api, ApiError } from '@/lib/client-api';
import { Alert, Field, Spinner } from '@/components/ui';

interface Place { id: number; place_name: string; district_name: string; district_id: number | null; district_en: string | null; district_ta: string | null; taluk_id: number | null }
interface LB { id: number; name_en: string; name_ta: string | null; district_id: number; taluk_id: number | null; type_en: string; type_ta: string; mapped: boolean; postal_ids: number[] | null }
interface Opt { id: number; name_en: string; name_ta: string | null; ward_number?: number }

export function RegisterWizard() {
  const { t, lang } = useI18n();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});

  const [f, setF] = useState({
    fullName: '', dob: '', mobile: '', email: '',
    pincode: '', postalLocationId: 0, districtId: 0, localBodyId: 0, wardId: 0, streetId: 0, streetText: '', address: '', landmark: '',
    password: '', password2: '', consent: false,
  });
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const [places, setPlaces] = useState<Place[] | null>(null);
  const [lbs, setLbs] = useState<LB[]>([]);
  const [districts, setDistricts] = useState<Opt[]>([]);
  const [wards, setWards] = useState<Opt[]>([]);
  const [streets, setStreets] = useState<Opt[]>([]);
  const [lbNone, setLbNone] = useState(false);
  const [streetOther, setStreetOther] = useState(false);
  const [lookup, setLookup] = useState(false);

  useEffect(() => {
    api<{ items: Opt[] }>('/api/locations?type=districts').then((r) => setDistricts(r.items)).catch(() => {});
  }, []);

  // Pincode lookup (progressive narrowing)
  useEffect(() => {
    if (!/^[1-9]\d{5}$/.test(f.pincode)) { setPlaces(null); return; }
    setLookup(true);
    api<{ places: Place[]; localBodies: LB[] }>(`/api/locations/pincode/${f.pincode}`)
      .then((r) => {
        setPlaces(r.places);
        setLbs(r.localBodies);
        const first = r.places[0];
        setF((p) => ({ ...p, postalLocationId: r.places.length === 1 ? first.id : 0, districtId: first?.district_id ?? p.districtId, localBodyId: 0, wardId: 0, streetId: 0 }));
      })
      .catch(() => setPlaces([]))
      .finally(() => setLookup(false));
  }, [f.pincode]);

  // When the district changes without a pincode match, load its local bodies
  useEffect(() => {
    if (!f.districtId) return;
    if (places && places.length && lbs.some((l) => l.district_id === f.districtId)) return;
    api<{ items: LB[] }>(`/api/locations?type=local_bodies&parent=${f.districtId}`).then((r) => setLbs(r.items.map((x) => ({ ...x, district_id: f.districtId, mapped: false, postal_ids: null, taluk_id: null })))).catch(() => {});
  }, [f.districtId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setWards([]); setStreets([]);
    if (!f.localBodyId) return;
    api<{ items: Opt[] }>(`/api/locations?type=wards&parent=${f.localBodyId}`).then((r) => setWards(r.items)).catch(() => {});
  }, [f.localBodyId]);

  useEffect(() => {
    setStreets([]);
    if (!f.wardId) return;
    api<{ items: Opt[] }>(`/api/locations?type=streets&parent=${f.wardId}`).then((r) => setStreets(r.items)).catch(() => {});
  }, [f.wardId]);

  const districtLbs = lbs
    .filter((l) => !f.districtId || l.district_id === f.districtId)
    .sort((a, b) => Number(b.postal_ids?.includes(f.postalLocationId) ?? false) - Number(a.postal_ids?.includes(f.postalLocationId) ?? false) || Number(b.mapped) - Number(a.mapped));

  function validate(s: number) {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (f.fullName.trim().length < 2) e.fullName = t('err.name');
      if (!f.dob) e.dob = t('err.dob');
      if (!/^[6-9]\d{9}$/.test(f.mobile)) e.mobile = t('err.mobile');
    }
    if (s === 2) {
      if (!/^[1-9]\d{5}$/.test(f.pincode)) e.pincode = t('err.pincode');
      if (!f.districtId) e.districtId = t('common.required');
      if (!lbNone && !f.localBodyId) e.localBodyId = t('common.required');
      if (!lbNone && wards.length && !f.wardId) e.wardId = t('common.required');
      if (!f.address.trim()) e.address = t('common.required');
    }
    if (s === 3) {
      if (!(f.password.length >= 8 && /[A-Za-z]/.test(f.password) && /\d/.test(f.password))) e.password = t('err.password');
      if (f.password !== f.password2) e.password2 = t('err.passwordMatch');
      if (!f.consent) e.consent = t('common.required');
    }
    setErrs(e);
    return !Object.keys(e).length;
  }

  async function submit() {
    if (!validate(3)) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ redirect: string }>('/api/auth/register', {
        body: {
          fullName: f.fullName, dob: f.dob, mobile: f.mobile, email: f.email, pincode: f.pincode,
          postalLocationId: f.postalLocationId || null, districtId: f.districtId,
          localBodyId: lbNone ? null : f.localBodyId || null, wardId: lbNone ? null : f.wardId || null,
          streetId: streetOther || lbNone ? null : f.streetId || null, streetText: streetOther || lbNone ? f.streetText : '',
          address: f.address, landmark: f.landmark, password: f.password, consent: true, lang,
        },
      });
      window.location.href = r.redirect;
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'MOBILE_TAKEN') { setStep(1); setErrs({ mobile: t('reg.mobileTaken') }); }
      setError(err.status === 429 ? t('err.rateLimited') : trMsg(t, err.message));
      setBusy(false);
    }
  }

  const steps = [t('reg.step1'), t('reg.step2'), t('reg.step3')];
  return (
    <div className="space-y-5">
      <ol className="flex gap-2">
        {steps.map((s, i) => (
          <li key={s} className={`flex-1 rounded-full px-2 py-1.5 text-center text-xs font-bold ${step === i + 1 ? 'bg-navy-700 text-white' : step > i + 1 ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-100 text-slate-500'}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {error && <Alert tone="error">{error}</Alert>}

      {step === 1 && (
        <div className="space-y-4">
          <Field label={t('reg.fullName')} error={errs.fullName} htmlFor="fn">
            <input id="fn" className="input" autoComplete="name" value={f.fullName} onChange={(e) => set('fullName', e.target.value)} />
          </Field>
          <Field label={t('reg.dob')} error={errs.dob} htmlFor="dob">
            <input id="dob" type="date" className="input" max={new Date().toISOString().slice(0, 10)} value={f.dob} onChange={(e) => set('dob', e.target.value)} />
          </Field>
          <Field label={t('auth.mobile')} error={errs.mobile} htmlFor="mob">
            <input id="mob" className="input" inputMode="numeric" autoComplete="tel" maxLength={10} value={f.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label={t('reg.email')} htmlFor="em">
            <input id="em" type="email" className="input" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">🪪 {t('reg.aadhaarNote')}</p>
          <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => validate(1) && setStep(2)}>{t('reg.next')}</button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Field label={t('reg.pincode')} error={errs.pincode} hint={t('reg.pincodeHint')} htmlFor="pin">
            <div className="relative">
              <input id="pin" className="input text-lg tracking-widest" inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))} placeholder="638051" />
              {lookup && <span className="absolute right-3 top-3 text-slate-400"><Spinner /></span>}
            </div>
          </Field>

          {places && places.length > 0 && (
            <div>
              <p className="label">{t('reg.place')}</p>
              <p className="mb-2 text-xs text-slate-500">{t('reg.pincodeNote')}</p>
              <div className="flex flex-wrap gap-2">
                {places.map((p) => (
                  <button key={p.id} type="button" onClick={() => setF((s) => ({ ...s, postalLocationId: p.id, districtId: p.district_id ?? s.districtId, localBodyId: 0, wardId: 0 }))}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${f.postalLocationId === p.id ? 'border-leaf-600 bg-leaf-50 text-leaf-800' : 'border-slate-300 bg-white text-slate-700'}`}>
                    📮 {p.place_name} <span className="text-xs text-slate-500">· {lang === 'ta' ? p.district_ta ?? p.district_name : p.district_en ?? p.district_name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {places && places.length === 0 && <Alert tone="warn">{t('reg.noPincode')}</Alert>}

          <Field label={t('reg.district')} error={errs.districtId} htmlFor="dist">
            <select id="dist" className="input" value={f.districtId || ''} onChange={(e) => setF((s) => ({ ...s, districtId: Number(e.target.value), localBodyId: 0, wardId: 0 }))}>
              <option value="">{t('common.select')}</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{pick(d as never, 'name', lang)}</option>)}
            </select>
          </Field>

          {!lbNone && (
            <Field label={t('reg.localBody')} error={errs.localBodyId} htmlFor="lb">
              <select id="lb" className="input" value={f.localBodyId || ''} onChange={(e) => setF((s) => ({ ...s, localBodyId: Number(e.target.value), wardId: 0, streetId: 0 }))}>
                <option value="">{t('common.select')}</option>
                {districtLbs.map((l) => (
                  <option key={l.id} value={l.id}>{l.mapped ? '📮 ' : ''}{pick(l as never, 'name', lang)} — {lang === 'ta' ? l.type_ta : l.type_en}</option>
                ))}
              </select>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={lbNone} onChange={(e) => { setLbNone(e.target.checked); set('localBodyId', 0); }} /> {t('reg.localBodyNone')}
          </label>

          {!lbNone && wards.length > 0 && (
            <Field label={t('reg.ward')} error={errs.wardId} htmlFor="ward">
              <select id="ward" className="input" value={f.wardId || ''} onChange={(e) => setF((s) => ({ ...s, wardId: Number(e.target.value), streetId: 0 }))}>
                <option value="">{t('common.select')}</option>
                {wards.map((w) => <option key={w.id} value={w.id}>{t('complaint.ward')} {w.ward_number}{w.name_en && !/^Ward \d+$/.test(w.name_en) ? ` — ${pick(w as never, 'name', lang)}` : ''}</option>)}
              </select>
            </Field>
          )}

          {!lbNone && f.wardId > 0 && !streetOther && streets.length > 0 && (
            <Field label={t('reg.street')} htmlFor="street">
              <select id="street" className="input" value={f.streetId || ''} onChange={(e) => set('streetId', Number(e.target.value))}>
                <option value="">{t('common.select')}</option>
                {streets.map((s) => <option key={s.id} value={s.id}>{pick(s as never, 'name', lang)}</option>)}
              </select>
            </Field>
          )}
          {(!lbNone && f.wardId > 0) && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={streetOther} onChange={(e) => { setStreetOther(e.target.checked); set('streetId', 0); }} /> {t('reg.streetOther')}
            </label>
          )}
          {(streetOther || lbNone || (f.wardId > 0 && streets.length === 0)) && (
            <Field label={t('reg.streetText')} htmlFor="st">
              <input id="st" className="input" value={f.streetText} onChange={(e) => set('streetText', e.target.value)} />
            </Field>
          )}

          <Field label={t('reg.door')} error={errs.address} htmlFor="addr">
            <input id="addr" className="input" autoComplete="street-address" value={f.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label={t('reg.landmark')} htmlFor="lm">
            <input id="lm" className="input" value={f.landmark} onChange={(e) => set('landmark', e.target.value)} />
          </Field>
          <div className="flex gap-3">
            <button type="button" className="btn btn-outline btn-lg flex-1" onClick={() => setStep(1)}>{t('reg.back')}</button>
            <button type="button" className="btn btn-primary btn-lg flex-1" onClick={() => validate(2) && setStep(3)}>{t('reg.next')}</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Field label={t('auth.password')} error={errs.password} hint={t('auth.passwordHint')} htmlFor="pw">
            <input id="pw" type="password" className="input" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} />
          </Field>
          <Field label={t('auth.confirmPassword')} error={errs.password2} htmlFor="pw2">
            <input id="pw2" type="password" className="input" autoComplete="new-password" value={f.password2} onChange={(e) => set('password2', e.target.value)} />
          </Field>
          <label className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${errs.consent ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
            <input type="checkbox" className="mt-1" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} />
            <span>{t('reg.consent')}</span>
          </label>
          <div className="flex gap-3">
            <button type="button" className="btn btn-outline btn-lg flex-1" onClick={() => setStep(2)}>{t('reg.back')}</button>
            <button type="button" className="btn btn-primary btn-lg flex-1" disabled={busy} onClick={submit}>{busy && <Spinner />}{t('reg.submit')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
