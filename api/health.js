import { createClient } from '@supabase/supabase-js';
import { cleanSupabaseUrl } from '../lib/tailortrack.js';

/**
 * GET /api/health - a setup check.
 *
 * Reports whether the two Supabase environment variables are present, sane,
 * and actually able to read the tables, and shows the real database error
 * when they cannot. The other endpoints deliberately hide that error from
 * visitors, which is right for them but unhelpful while setting things up.
 *
 * Never prints the key itself. It reports the key's *role*, which is read
 * from the public part of the token, so the secret is not exposed.
 */
export default async function handler(request, response) {
  const raw = process.env.SUPABASE_URL || '';
  const url = cleanSupabaseUrl(raw);
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  const report = {
    SUPABASE_URL: {
      present: url.length > 0,
      asYouEnteredIt: raw ? maskUrl(raw) : null,
      afterCleaning: url ? maskUrl(url) : null,
      wasCleanedUp: raw !== url,
      looksRight: /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url),
      problem: urlProblem(url),
    },
    SUPABASE_SERVICE_ROLE_KEY: {
      present: key.length > 0,
      length: key.length,
      role: keyRole(key),
      problem: keyProblem(key),
    },
    database: { reachable: false, tables: {}, error: null },
  };

  if (!report.SUPABASE_URL.present || !report.SUPABASE_SERVICE_ROLE_KEY.present) {
    report.database.error = 'Cannot test the database until both variables are set.';
    return response.status(200).json(report);
  }

  try {
    const supabase = createClient(url, key);

    // Each table is tried on its own, so one failure does not hide the rest.
    for (const table of ['shop', 'customers', 'orders', 'payments', 'reminders']) {
      const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' });
      report.database.tables[table] = error ? describe(error) : 'ok';
    }

    // The exact query the dashboard uses, including the join that needs the
    // foreign key. This is the one most likely to fail.
    const joined = await supabase
      .from('orders')
      .select('id, customers(name, phone), payments(amount)')
      .limit(1);
    report.database.tables['orders + customers join'] = joined.error
      ? describe(joined.error)
      : 'ok';

    report.database.reachable = Object.values(report.database.tables).every((r) => r === 'ok');
  } catch (error) {
    report.database.error = error instanceof Error ? error.message : String(error);
  }

  return response.status(200).json(report);
}

/** Shows the project host but hides most of the project id. */
function maskUrl(url) {
  return url.replace(/\/\/([a-z0-9]{4})[a-z0-9-]*/i, '//$1...');
}

/** Names the common ways this URL is written wrong. */
function urlProblem(url) {
  if (!url) return 'Not set at all.';
  if (url.endsWith('/')) return 'Remove the trailing slash - it breaks every request.';
  if (!url.startsWith('https://')) return 'Must start with https://';
  if (url.includes('supabase.com')) {
    return 'This is the dashboard address. You need the Project URL, which ends in .supabase.co';
  }
  if (!url.endsWith('.supabase.co')) return 'Should end with .supabase.co';
  return null;
}

/**
 * Reads the role out of a Supabase key without revealing the key.
 *
 * The older keys are JSON Web Tokens whose middle section is public and
 * states the role. The newer ones say what they are in their prefix.
 */
function keyRole(key) {
  if (!key) return 'not set';
  if (key.startsWith('sb_secret_')) return 'service_role (new style secret key)';
  if (key.startsWith('sb_publishable_')) return 'publishable';
  try {
    const middle = key.split('.')[1];
    const claims = JSON.parse(Buffer.from(middle, 'base64').toString('utf8'));
    return claims.role || 'unknown';
  } catch {
    return 'unrecognised - this may not be a Supabase key';
  }
}

/** Flags the wrong-key mistake, which is the easiest one to make. */
function keyProblem(key) {
  const role = keyRole(key);
  if (role === 'anon' || role === 'publishable') {
    return 'This is the PUBLIC key. Row Level Security blocks it. Use the service_role or secret key.';
  }
  if (role.startsWith('unrecognised') || role === 'unknown') {
    return 'Could not read a role from this key. Check it was copied whole, with no spaces.';
  }
  if (role === 'not set') return 'Not set at all.';
  return null;
}

/** Turns a Supabase error into the useful parts, in plain words. */
function describe(error) {
  return {
    message: error.message,
    code: error.code || null,
    hint: error.hint || null,
    meaning: error.message.includes('does not exist')
      ? 'That table is missing from this project - check SUPABASE_URL points at the right project.'
      : error.message.includes('relationship')
        ? 'The join between orders and customers could not be found.'
        : error.code === '42501' || error.message.includes('permission')
          ? 'Permission denied - this is what the public anon key looks like.'
          : error.message.includes('JWT') || error.message.includes('Invalid API key')
            ? 'The key is not valid for this project - the URL and key may be from different projects.'
            : null,
  };
}
