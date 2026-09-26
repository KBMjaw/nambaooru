import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { Section, Alert } from '@/components/ui';
import { SettingRow, NlpTester } from '@/components/admin/SettingsForm';
import { MasterTable } from '@/components/admin/MasterTable';

export default async function Settings() {
  const u = await requirePageUser('ADMIN', ['settings.manage', 'masterdata.manage', 'language.manage']);
  const { t } = await getT();
  const rows = await sql`SELECT key, value, is_security FROM system_settings ORDER BY key`;
  const llm = !!process.env.ANTHROPIC_API_KEY;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-slate-800">⚙️ {t('nav.settings')}</h1>
      <Section title="🤖 AI / NLP configuration">
        <Alert tone={llm ? 'success' : 'info'}>
          Built-in Tamil / Tanglish / English engine: <b>active</b>. Claude LLM refinement: <b>{llm ? 'API key configured' : 'not configured (set ANTHROPIC_API_KEY to enable)'}</b>.
          AI only suggests category, location, severity and duplicates — officials make all decisions.
        </Alert>
        <div className="mt-3"><NlpTester /></div>
      </Section>
      <Section title="System settings">
        <div className="overflow-x-auto"><table className="table-std"><tbody>
          {rows.map((r) => (
            <SettingRow key={r.key as string} k={r.key as string} value={r.value} security={r.is_security as boolean}
              canEdit={r.is_security ? has(u, 'settings.manage') : has(u, 'masterdata.manage') || has(u, 'settings.manage')}
              options={r.key === 'ai.engine' ? ['auto', 'rules', 'llm'] : undefined} />
          ))}
        </tbody></table></div>
      </Section>
      {has(u, 'language.manage') && (
        <Section title="🌐 Languages">
          <p className="mb-2 text-sm text-slate-500">UI languages are served from message files (src/i18n). To add another Indian language, add its message file and enable it here.</p>
          <MasterTable entity="languages" />
        </Section>
      )}
    </div>
  );
}
