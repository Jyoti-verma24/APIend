import { createClient } from '@supabase/supabase-js';

/**
 * Tidies up the Supabase URL.
 *
 * Supabase's dashboard shows the project URL in a few places, and the one on
 * the API page is the full REST address ending in /rest/v1/. The client adds
 * that part itself, so a URL that already has it produces a doubled path and
 * every request fails. Trailing spaces and slashes cause the same thing.
 *
 * Accepting all of these spellings is kinder than failing on a copy-paste.
 */
export function cleanSupabaseUrl(raw) {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/, '');
}

/**
 * One Supabase client shared by every endpoint.
 *
 * Uses the service_role key, which ignores Row Level Security. That is only
 * safe because this file runs on the server - it is never sent to the browser.
 */
export const supabase = createClient(
  cleanSupabaseUrl(process.env.SUPABASE_URL),
  String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
);

/** The order stages, in the only order they are allowed to happen. */
export const STAGES = ['RECEIVED', 'CUTTING', 'STITCHING', 'TRIAL', 'READY', 'DELIVERED'];

/** Words for the customer, one per stage. */
const STAGE_LABELS = {
  RECEIVED: 'Order Received',
  CUTTING: 'Cutting',
  STITCHING: 'Stitching',
  TRIAL: 'Trial Fitting',
  READY: 'Ready for Pickup',
  DELIVERED: 'Delivered',
};

const STAGE_ICONS = {
  RECEIVED: '📥',
  CUTTING: '✂️',
  STITCHING: '🧵',
  TRIAL: '👔',
  READY: '✅',
  DELIVERED: '📦',
};

/** Which step out of 6 a status is. RECEIVED is 1. */
export function stepOf(status) {
  return STAGES.indexOf(status) + 1;
}

/** The one stage an order may move to next, or null if it is delivered. */
export function nextStage(status) {
  const index = STAGES.indexOf(status);
  if (index === -1 || index === STAGES.length - 1) return null;
  return STAGES[index + 1];
}

/** The six stages, each marked done, current or upcoming, for the tracking page. */
export function timelineFor(status) {
  const current = stepOf(status);
  const finished = status === 'DELIVERED';
  return STAGES.map((stage, index) => {
    const step = index + 1;
    let state = 'upcoming';
    if (finished || step < current) state = 'completed';
    else if (step === current) state = 'current';
    return { step, label: STAGE_LABELS[stage], icon: STAGE_ICONS[stage], status: state };
  });
}

/** Today's date as YYYY-MM-DD, so it compares directly against a date column. */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from one YYYY-MM-DD to another. Negative means it has passed. */
export function daysBetween(from, to) {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/**
 * Checks the tailor's passcode on a request.
 *
 * Returns true when the request may proceed. If TAILOR_PASSCODE is not set the
 * check is skipped, so a fresh deployment works before you configure anything.
 */
export function tailorIsAllowed(request) {
  const expected = process.env.TAILOR_PASSCODE;
  if (!expected) return true;
  return request.headers['x-tailor-passcode'] === expected;
}

/**
 * Money from Supabase arrives as a string like "1500.00".
 * This turns it into a number the page can add up and display.
 */
export function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
