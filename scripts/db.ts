/**
 * Database CLI.
 *   node --experimental-strip-types scripts/db.ts migrate        # apply db/schema.sql + db/migrations/*.sql (idempotent)
 *   node --experimental-strip-types scripts/db.ts seed           # reference data + postal dataset + pilot mappings
 *   node --experimental-strip-types scripts/db.ts bootstrap      # create Super Admin + demo officials (prints generated passwords once)
 *   PASSWORDS_FILE=path.json node ... scripts/db.ts set-passwords  # set passwords from a local JSON {username: password} (never committed)
 * Requires DATABASE_URL (and DATABASE_SSL=disable for local Postgres).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { importPostal } from '../src/lib/postal-import.ts';

const sql = postgres(process.env.DATABASE_URL!, { ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require', prepare: false, max: 1, onnotice: () => {} });

async function migrate() {
  await sql.unsafe(readFileSync('db/schema.sql', 'utf8'));
  console.log('✔ schema applied');
  for (const f of readdirSync('db/migrations').filter((x) => x.endsWith('.sql')).sort()) {
    await sql.unsafe(readFileSync(`db/migrations/${f}`, 'utf8'));
    console.log(`✔ migration ${f}`);
  }
}

/** Set account passwords from a local, git-ignored JSON file. Only bcrypt hashes are stored. */
async function setPasswords() {
  const file = process.env.PASSWORDS_FILE;
  if (!file) throw new Error('PASSWORDS_FILE is required');
  const map = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  for (const [username, pw] of Object.entries(map)) {
    const r = await sql`UPDATE users SET password_hash = ${bcrypt.hashSync(pw, 12)}, password_changed_at = now(), must_change_password = false,
                          token_version = token_version + 1, failed_logins = 0, locked_until = NULL WHERE lower(username) = ${username.toLowerCase()} RETURNING id`;
    if (!r.length) { console.log(`✘ ${username}: not found`); continue; }
    await sql`INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, target_user_id, new_value)
              VALUES (NULL, 'SYSTEM', 'PASSWORD_CHANGED', 'user', ${r[0].id}, ${r[0].id}, ${sql.json({ source: 'SYSTEM_BOOTSTRAP' })})`;
    console.log(`✔ ${username}`);
  }
}

export async function pilotMappings() {
  // Map the Chennimalai postal place to the Chennimalai Town Panchayat (PROBABLE). Other places on 638051
  // (Sivamalai, Nathakadaiyur) are separate villages and intentionally NOT mapped.
  await sql`
    INSERT INTO postal_location_jurisdictions (postal_location_id, local_body_id, confidence)
    SELECT p.id, lb.id, 'PROBABLE' FROM postal_locations p, local_bodies lb
    WHERE p.place_name = 'Chennimalai' AND p.pincode = '638051' AND lb.code = 'TP-ERD-CHENNIMALAI'
    ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO postal_location_jurisdictions (postal_location_id, local_body_id, confidence)
    SELECT p.id, lb.id, 'PROBABLE' FROM postal_locations p, local_bodies lb
    WHERE p.place_name = 'Perundurai' AND p.pincode = '638052' AND lb.code = 'MUN-ERD-PERUNDURAI'
    ON CONFLICT DO NOTHING`;
  await sql`UPDATE postal_locations p SET taluk_id = t.id FROM taluks t JOIN districts d ON d.id = t.district_id
            WHERE p.place_name IN ('Chennimalai','Perundurai') AND p.district_name = 'Erode' AND d.code = 'ERD' AND t.name_en = 'Perundurai'`;
}

async function seed() {
  await sql.unsafe(readFileSync('db/seed.sql', 'utf8'));
  console.log('✔ reference data seeded');
  const existing = await sql`SELECT 1 FROM data_sources WHERE file_name = 'tn_postal_locations.csv' LIMIT 1`;
  if (!existing.length) {
    const r = await importPostal(sql, readFileSync('data/tn_postal_locations.csv', 'utf8'), {
      name: 'Tamil Nadu postal locations (initial)',
      description: 'Place / Pincode / District list supplied by the project owner as initial postal master data. Pincodes are lookup aids only, not jurisdiction identifiers.',
      fileName: 'tn_postal_locations.csv',
    });
    console.log('✔ postal import', r);
  }
  await sql`INSERT INTO data_sources (name, description, file_name)
            SELECT 'Pilot local-body wards & streets (demo)', 'Chennimalai TP wards 1–15 with sample streets; Perundurai wards 1–6. Replace with official ward data.', 'db/seed.sql'
            WHERE NOT EXISTS (SELECT 1 FROM data_sources WHERE file_name = 'db/seed.sql')`;
  await pilotMappings();
  console.log('✔ pilot mappings');
}

function genPassword() {
  const a = randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 10);
  return `${a}9x`;
}

async function bootstrap() {
  const [lb] = await sql`SELECT id FROM local_bodies WHERE code = 'TP-ERD-CHENNIMALAI'`;
  const [lb2] = await sql`SELECT id FROM local_bodies WHERE code = 'MUN-ERD-PERUNDURAI'`;
  const dept = async (code: string, lbId = lb.id) => (await sql`SELECT id FROM departments WHERE code = ${code} AND local_body_id = ${lbId}`)[0].id;
  const ward = async (n: number, lbId = lb.id) => (await sql`SELECT id FROM wards WHERE ward_number = ${n} AND local_body_id = ${lbId}`)[0].id;
  const accounts = [
    { username: 'superadmin', name: 'Super Administrator', role: 'SUPER_ADMIN', mobile: '9000000001', o: { designation: 'Platform Owner' } },
    { username: 'sysadmin', name: 'System Administrator', role: 'SYSTEM_ADMIN', mobile: '9000000002', o: { designation: 'Technology Admin' } },
    { username: 'eo.chennimalai', name: 'R. Senthil Kumar', role: 'EO', mobile: '9000000010', o: { designation: 'Executive Officer', employee_id: 'CTP-EO-01', local_body_id: lb.id, jurisdiction: 'Chennimalai Town Panchayat' } },
    { username: 'sup.electrical', name: 'K. Murugesan', role: 'SUPERVISOR', mobile: '9000000011', o: { designation: 'Electrical Supervisor', employee_id: 'CTP-SUP-01', local_body_id: lb.id, department_id: await dept('ELECTRICAL') } },
    { username: 'officer.sanitation', name: 'S. Lakshmi', role: 'DEPT_OFFICER', mobile: '9000000012', o: { designation: 'Sanitary Inspector', employee_id: 'CTP-SI-01', local_body_id: lb.id, department_id: await dept('SANITATION') } },
    { username: 'field.ravi', name: 'Ravi (Electrician)', role: 'FIELD_STAFF', mobile: '9000000013', o: { designation: 'Electrician', employee_id: 'CTP-FS-01', local_body_id: lb.id, department_id: await dept('ELECTRICAL'), ward_id: await ward(10), supervisor: 'sup.electrical' } },
    { username: 'field.muthu', name: 'Muthu (Sanitation)', role: 'FIELD_STAFF', mobile: '9000000014', o: { designation: 'Sanitary Worker', employee_id: 'CTP-FS-02', local_body_id: lb.id, department_id: await dept('SANITATION'), supervisor: 'officer.sanitation' } },
    { username: 'ward10.member', name: 'P. Kavitha', role: 'WARD_MEMBER', mobile: '9000000015', o: { designation: 'Ward Councillor', local_body_id: lb.id, ward_id: await ward(10), jurisdiction: 'Ward 10' } },
    { username: 'eo.perundurai', name: 'M. Anand', role: 'EO', mobile: '9000000020', o: { designation: 'Commissioner', employee_id: 'PMC-EO-01', local_body_id: lb2.id, jurisdiction: 'Perundurai Municipality' } },
  ];
  const creds: Record<string, string> = {};
  for (const a of accounts) {
    const exists = await sql`SELECT id FROM users WHERE username = ${a.username}`;
    if (exists.length) continue;
    const pw = genPassword();
    const [u] = await sql`INSERT INTO users (username, password_hash, full_name, mobile, email, role_id, preferred_language)
      VALUES (${a.username}, ${bcrypt.hashSync(pw, 12)}, ${a.name}, ${a.mobile}, ${null}, (SELECT id FROM roles WHERE code = ${a.role}), 'ta') RETURNING id`;
    const { supervisor, ...o } = a.o as Record<string, unknown>;
    const supId = supervisor ? (await sql`SELECT id FROM users WHERE username = ${supervisor as string}`)[0]?.id : null;
    await sql`INSERT INTO officials ${sql({ user_id: u.id, designation: null, employee_id: null, department_id: null, local_body_id: null, ward_id: null, jurisdiction: null, ...o, supervisor_id: supId ?? null } as Record<string, unknown>)}`;
    await sql`INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, target_user_id, new_value)
              VALUES (NULL, 'SYSTEM', 'USER_CREATED', 'user', ${u.id}, ${u.id}, ${sql.json({ username: a.username, role: a.role })})`;
    creds[a.username] = pw;
  }
  if (Object.keys(creds).length) {
    const out = process.env.CREDENTIALS_OUT ?? 'scripts/.credentials.json';
    writeFileSync(out, JSON.stringify(creds, null, 2));
    console.log(`✔ created ${Object.keys(creds).length} accounts — passwords written to ${out} (git-ignored). Change them after first login.`);
  } else console.log('✔ accounts already exist');
}

const cmd = process.argv[2];
try {
  if (cmd === 'migrate') await migrate();
  else if (cmd === 'seed') await seed();
  else if (cmd === 'bootstrap') { await bootstrap(); await migrate(); /* backfills role history + jurisdictions */ }
  else if (cmd === 'set-passwords') await setPasswords();
  else if (cmd === 'all') { await migrate(); await seed(); await bootstrap(); await migrate(); }
  else console.log('usage: migrate | seed | bootstrap | set-passwords | all');
} finally {
  await sql.end();
}
