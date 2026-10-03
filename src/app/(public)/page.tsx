import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { ComplaintCard, type ComplaintRow } from '@/components/ComplaintCard';

export default async function Home() {
  const { t, lang } = await getT();
  const user = await getUser('PUBLIC');
  if (user?.mustChangePassword) redirect('/password');

  if (!user) {
    return (
      <div className="space-y-8">
        <section className="card overflow-hidden">
          <div className="grid items-center gap-6 p-6 sm:p-8 md:grid-cols-2">
            <div className="order-2 md:order-1">
              <p className="text-sm font-bold uppercase tracking-wide text-leaf-600">{t('app.subtitle')}</p>
              <h1 className="mt-2 text-2xl font-extrabold leading-snug text-navy-800 sm:text-3xl">{t('home.heroTitle')}</h1>
              <p className="mt-3 text-slate-600">{t('home.heroText')}</p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href="/login?next=/report" className="btn btn-primary btn-lg">🎙️ {t('home.reportCta')}</Link>
                <Link href="/login?next=/track" className="btn btn-outline btn-lg">🔎 {t('nav.track')}</Link>
              </div>
            </div>
            <div className="order-1 flex justify-center md:order-2">
              <Image src="/logo.jpg" alt={t('app.name')} width={360} height={360} className="h-56 w-56 rounded-full object-cover sm:h-72 sm:w-72" priority />
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold text-slate-800">{t('home.howTitle')}</h2>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([['home.how1', '🎙️'], ['home.how2', '📷'], ['home.how3', '📍'], ['home.how4', '🔎']] as const).map(([k, icon], i) => (
              <li key={k} className="card flex items-start gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-700 font-bold text-white">{i + 1}</span>
                <span className="font-semibold text-slate-700"><span aria-hidden>{icon} </span>{t(k)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-sm text-slate-500">{t('home.howNote')}</p>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-lg font-bold text-slate-800">✅ {t('home.transparencyTitle')}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(['home.tr1', 'home.tr2', 'home.tr3', 'home.tr4'] as const).map((k) => (
              <li key={k} className="flex items-start gap-2 text-slate-700"><span className="text-leaf-600" aria-hidden>✔</span>{t(k)}</li>
            ))}
          </ul>
        </section>

        <section className="card flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
          <span className="font-semibold text-slate-700">{t('home.trackText')}</span>
          <div className="flex gap-2">
            <Link href="/login?next=/track" className="btn btn-navy">🔎 {t('nav.track')}</Link>
            <Link href="/register" className="btn btn-outline">{t('nav.register')}</Link>
          </div>
        </section>
      </div>
    );
  }

  const [stats] = await sql`
    SELECT count(*) FILTER (WHERE status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS open,
           count(*) FILTER (WHERE status = 'CLOSED')::int AS closed
    FROM complaints WHERE citizen_id = ${user.id}`;
  const recent = await sql<ComplaintRow[]>`
    SELECT c.code, c.status, c.priority, cat.icon, cat.name_en AS category_en, cat.name_ta AS category_ta, c.title_en, c.title_ta,
           w.ward_number, COALESCE(s.name_en, c.street_text) AS street, COALESCE(s.name_ta, c.street_text) AS street_ta, c.created_at, c.sla_due_at
    FROM complaints c LEFT JOIN complaint_categories cat ON cat.id = c.category_id LEFT JOIN wards w ON w.id = c.ward_id LEFT JOIN streets s ON s.id = c.street_id
    WHERE c.citizen_id = ${user.id} ORDER BY c.created_at DESC LIMIT 3`;
  const [unread] = await sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${user.id} AND read_at IS NULL AND channel = 'IN_APP'`;

  const tiles = [
    { href: '/complaints', icon: '📋', label: t('nav.myComplaints') },
    { href: '/track', icon: '🔎', label: t('nav.track') },
    { href: '/notifications', icon: '🔔', label: t('nav.notifications'), badge: unread.n as number },
    { href: '/profile', icon: '👤', label: t('nav.profile') },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-xl font-extrabold text-navy-800">{t('home.hello', { name: user.fullName.split(' ')[0] })} 🙏</h1>

      <Link
        href="/report"
        className="group relative flex items-center gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-leaf-600 to-leaf-800 p-6 text-white shadow-lg transition hover:shadow-xl"
      >
        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-pin-500 text-4xl shadow-md ring-4 ring-white/30 transition group-hover:scale-105">🎙️</span>
        <span>
          <span className="block text-2xl font-extrabold">{t('home.reportCta')}</span>
          <span className="mt-1 block text-sm text-white/85">{t('home.speakHint')} · {t('home.heroText').split('.')[0]}</span>
        </span>
      </Link>

      <div className="grid grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <Link key={tile.href} href={tile.href} className="card relative flex flex-col items-center gap-2 p-5 text-center transition hover:border-navy-500/40 hover:shadow-md">
            <span className="text-3xl" aria-hidden>{tile.icon}</span>
            <span className="font-bold text-slate-700">{tile.label}</span>
            {!!tile.badge && <span className="absolute right-3 top-3 rounded-full bg-pin-500 px-2 py-0.5 text-xs font-bold text-white">{tile.badge}</span>}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4 text-center"><div className="text-3xl font-extrabold text-amber-600">{stats.open as number}</div><div className="text-sm font-semibold text-slate-500">{t('home.stats.open')}</div></div>
        <div className="card p-4 text-center"><div className="text-3xl font-extrabold text-leaf-700">{stats.closed as number}</div><div className="text-sm font-semibold text-slate-500">{t('home.stats.closed')}</div></div>
      </div>

      <section>
        <h2 className="mb-2 font-bold text-slate-700">{t('home.recent')}</h2>
        {recent.length ? (
          <div className="space-y-2">{recent.map((c) => <ComplaintCard key={c.code} c={c} lang={lang} href={`/complaints/${c.code}`} overdueLabel={t('complaint.overdue')} />)}</div>
        ) : (
          <p className="card p-5 text-center text-slate-500">{t('home.noComplaints')}</p>
        )}
      </section>
    </div>
  );
}
