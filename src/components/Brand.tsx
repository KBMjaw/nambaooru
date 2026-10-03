import Image from 'next/image';
import Link from 'next/link';

export function Brand({ href = '/', title, subtitle, dark = false }: { href?: string; title: string; subtitle?: string; dark?: boolean }) {
  return (
    <Link href={href} className="flex min-w-0 items-center gap-2.5">
      <Image src="/logo-sm.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-full bg-white object-cover ring-2 ring-white/70" priority />
      <span className="min-w-0 leading-tight">
        <span className={`block whitespace-nowrap text-lg font-extrabold ${dark ? 'text-white' : 'text-leaf-700'}`}>{title}</span>
        {subtitle && <span className={`hidden truncate text-[11px] font-semibold sm:block ${dark ? 'text-white/75' : 'text-navy-700'}`}>{subtitle}</span>}
      </span>
    </Link>
  );
}
