/**
 * Cloudflare Pages Function — the dashboard API, backed by Supabase.
 *
 * Serves /api/data as the authenticated Supabase data boundary.
 *
 * Talks to PostgREST over plain fetch rather than @supabase/supabase-js.
 * The Workers runtime has no raw TCP sockets, and the REST interface is
 * HTTP, so this needs no driver and no bundling special cases.
 *
 * Environment variables (Pages -> Settings -> Variables and secrets),
 * both as **Secret**, never with a VITE_ prefix:
 *   SUPABASE_URL               https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  service_role key
 *
 * The service_role key bypasses row level security, which is why it
 * lives here and never reaches the browser — same perimeter the
 * GAS_TOKEN had. Authorisation is enforced below, in requireUser and
 * requireWriteAccess. requireUser trusts the JWT session cookie set by
 * functions/api/auth/login.ts, not an identity claimed by the client.
 *
 * `forward` is exported so vite.config.ts can serve an identical
 * /api/data locally without a second copy of the logic.
 */

import { Env, SessionUser as User, lookupUser, verifySession } from '../../lib/auth';

const READ_ACTIONS = [
  'bootstrap',
  'applications',
  'notifications',
  'application',
  'activity',
  'interviews',
  'assessments'
];

const WRITE_ACTIONS = [
  'updateStage',
  'addNote',
  'updateTags',
  'scheduleInterview',
  'saveAssessment',
  'cancelInterview',
  'removeInterview',
  'archiveApplication'
];

export interface ForwardResult {
  status: number;
  body: unknown;
}

type Settings = Record<string, string[]>;

// Malaysia. Postgres stores UTC; the dashboard has always been shown
// local wall-clock strings, so that is what goes back over the wire.
const TZ_MINUTES = 8 * 60;

// ── postgrest ───────────────────────────────────────────

async function sb<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY as string,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  const text = await res.text();

  if (!res.ok) {
    // PostgREST returns {message, details, hint, code}. Surface the
    // message; the rest is noise in a UI toast.
    let msg = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      msg = parsed.message || msg;
    } catch {
      /* keep the raw text */
    }
    throw new Error(msg);
  }

  return (text ? JSON.parse(text) : null) as T;
}

const enc = encodeURIComponent;

const select = <T>(env: Env, table: string, query: string) =>
  sb<T[]>(env, `${table}?${query}`);

const insert = <T>(env: Env, table: string, rows: unknown) =>
  sb<T[]>(env, table, {
    method: 'POST',
    body: JSON.stringify(rows),
    headers: { Prefer: 'return=representation' }
  });

const update = <T>(env: Env, table: string, query: string, patch: unknown) =>
  sb<T[]>(env, `${table}?${query}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    headers: { Prefer: 'return=representation' }
  });

const remove = (env: Env, table: string, query: string) =>
  sb<null>(env, `${table}?${query}`, { method: 'DELETE' });

type CalendarBridgeResult = {
  result: string;
  message?: string;
  eventId?: string;
  eventUrl?: string;
};

/**
 * Apps Script ContentService answers through a Google-hosted redirect.
 * Cloudflare's automatic redirect handling can occasionally re-request
 * the /exec URL as GET and stall. Follow only Google's redirect target
 * explicitly, with a small bounded redirect count.
 */
async function fetchAppsScriptResponse(
  url: string,
  init: RequestInit,
  signal: AbortSignal
): Promise<Response> {
  let currentUrl = url;
  let currentInit: RequestInit = { ...init, redirect: 'manual', signal };

  for (let redirects = 0; redirects <= 3; redirects++) {
    const res = await fetch(currentUrl, currentInit);
    if (![301, 302, 303, 307, 308].includes(res.status)) return res;

    const location = res.headers.get('Location');
    if (!location) throw new Error('Calendar bridge redirect had no destination');

    const next = new URL(location, currentUrl);
    const googleHost =
      next.protocol === 'https:' &&
      (next.hostname === 'script.google.com' || next.hostname.endsWith('.googleusercontent.com'));
    if (!googleHost) throw new Error('Calendar bridge returned an unexpected redirect');

    currentUrl = next.toString();
    const preservePost = res.status === 307 || res.status === 308;
    currentInit = preservePost
      ? { ...init, redirect: 'manual', signal }
      : { method: 'GET', redirect: 'manual', signal };
  }

  throw new Error('Calendar bridge returned too many redirects');
}

/**
 * Calls Apps Script from Cloudflare only. GAS_TOKEN never reaches the
 * browser, and a short timeout prevents a Calendar outage from holding
 * the dashboard request open indefinitely.
 */
async function callCalendarBridge(
  env: Env,
  payload: Record<string, unknown>
): Promise<CalendarBridgeResult> {
  if (!env.GAS_URL || !env.GAS_TOKEN) {
    throw new Error('Google Calendar bridge is not configured');
  }

  const controller = new AbortController();
  // Calendar creation with sendInvites can take longer than a normal
  // Apps Script call because Google also prepares guest invitations.
  // The GAS side is idempotent by interviewId, so a retry is safe.
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const res = await fetchAppsScriptResponse(env.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'calendarInterview',
        token: env.GAS_TOKEN,
        ...payload
      }),
    }, controller.signal);

    const text = await res.text();
    if (!res.ok) throw new Error(`Calendar bridge returned HTTP ${res.status}`);

    let result: CalendarBridgeResult;
    try {
      result = JSON.parse(text) as CalendarBridgeResult;
    } catch {
      throw new Error('Calendar bridge returned an invalid response');
    }

    if (result.result !== 'success') {
      throw new Error(result.message || 'Google Calendar sync failed');
    }
    return result;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Google Calendar sync timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resumes uploaded through functions/api/submit.ts are stored in a
 * private bucket by object path, not a public URL — a stored signed
 * URL would go dead when it expires, so a fresh one is minted here,
 * on the one read that actually needs it (the applicant drawer).
 *
 * New submissions and rows migrated from Google Sheets hold a Drive
 * URL, so those pass through unchanged. Older Supabase Storage object
 * paths still receive a fresh signed URL for backward compatibility.
 */
async function resolveResumeUrl(env: Env, stored: string | null | undefined): Promise<string> {
  if (!stored) return '';
  if (/^https?:\/\//i.test(stored)) return stored;

  try {
    // Storage lives under /storage/v1/, not /rest/v1/ — a separate
    // call from sb() above, which is hardcoded to the PostgREST path.
    const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/resumes/${enc(stored)}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY as string,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expiresIn: 3600 })
    });

    if (!res.ok) {
      console.error('resolveResumeUrl: sign failed', res.status, (await res.text()).slice(0, 200));
      return '';
    }

    const signed = (await res.json()) as { signedURL?: string };
    return signed.signedURL ? `${env.SUPABASE_URL}/storage/v1${signed.signedURL}` : '';
  } catch (err) {
    console.error('resolveResumeUrl failed:', err);
    return '';
  }
}

// ── helpers ─────────────────────────────────────────────

/**
 * Strips a leading formula character. Postgres needs no escaping, but
 * the dashboard exports CSV client-side (src/lib/export.ts) and a cell
 * beginning "=" or "+" executes on open in Excel.
 */
function sanitize(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/^[=+\-@|]/, "'").trim();
}

/** ISO/UTC -> "yyyy-MM-dd HH:mm:ss" in Malaysian local time. */
function stamp(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);

  const local = new Date(d.getTime() + TZ_MINUTES * 60_000);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}

/** Treat a datetime-local value as Malaysian time, not Worker/UTC time. */
function malaysiaDateTimeIso(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('scheduledAt is required');

  // datetime-local sends no offset. Appending +08:00 preserves the wall
  // clock time selected by HR when the request runs on Cloudflare UTC.
  const explicit = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(raw)
    ? `${raw}+08:00`
    : raw;
  const parsed = new Date(explicit);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid interview date and time');
  return parsed.toISOString();
}

const nowIso = () => new Date().toISOString();
const isDemoMode = (env: Env) => /^(1|true|yes)$/i.test(String(env.DEMO_MODE || ''));

const isDecidedStage = (stage: unknown) => /hired|rejected/i.test(String(stage ?? ''));

const APPLICATION_ID_PATTERN = /^APP-\d{8}-[A-F0-9]{8}$/;

function requireApplicationId(value: unknown): string {
  const applicationId = String(value ?? '').trim();
  if (!APPLICATION_ID_PATTERN.test(applicationId)) {
    throw new Error('Invalid applicationId');
  }
  return applicationId;
}

function requirePositiveSafeInteger(value: unknown, field: string): number {
  const raw = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${field} must be a positive integer`);

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

// ── auth ────────────────────────────────────────────────

/**
 * Identifies the caller from the signed JWT cookie set by demo login.
 * The client cannot claim an email in the request body/query; lookupUser
 * enforces the Supabase `users` authorization allowlist on every call.
 */
async function requireUser(env: Env, cookieHeader: string | null): Promise<User> {
  const email = await verifySession(cookieHeader, env);
  if (!email) throw new Error('Not signed in');

  const user = await lookupUser(env, email);
  if (!user) throw new Error(`User not registered or inactive: ${email}`);

  return user;
}

/** Viewers can read their assigned scope but cannot change anything. */
function requireWriteAccess(user: User): User {
  if (!user.canEdit) throw new Error(`Your role (${user.role}) is read-only`);
  return user;
}

// ── settings ────────────────────────────────────────────

async function loadSettings(env: Env): Promise<Settings> {
  const rows = await select<Record<string, unknown>>(
    env,
    'settings',
    'select=category,value,active,sort_order&active=is.true&order=sort_order.asc&limit=1000'
  );

  const grouped: Settings = {};

  for (const r of rows) {
    const category = String(r.category || '').trim();
    if (!category) continue;
    (grouped[category] ||= []).push(String(r.value));
  }

  return grouped;
}

const stageList = (settings: Settings) => settings.Stage || settings.Status || [];

function settingNumber(settings: Settings, key: string, fallback: number): number {
  const raw = (settings[key] || [])[0];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ── row shapes ──────────────────────────────────────────

type Row = Record<string, any>;

/**
 * What the board, table, filters and analytics need — and nothing else.
 *
 * IC number, address, postcode, cover message and resume filename are
 * omitted on purpose. They appear only in the applicant drawer, so they
 * are fetched one candidate at a time. That keeps the bulk response
 * small and means hundreds of IC numbers never reach a browser.
 */
function toListRow(r: Row) {
  return {
    applicationId: r.application_id || '',
    timestamp: stamp(r.submitted_at),
    fullName: r.full_name || '',
    email: r.email || '',
    phone: r.phone || '',
    city: r.city || '',
    state: r.state || '',
    position: r.position || '',
    availableDate: r.available_date || '',
    expectedSalary: r.expected_salary || '',
    experience: r.experience || '',
    // Unresolved here on purpose — see resolveResumeUrl. Migrated rows
    // still hold a working Drive link, so this is fine as-is for them.
    // Storage-backed legacy resumes only get a signed link when one
    // applicant is opened. Drive-backed values are already URLs.
    resumeUrl: r.resume_url || '',
    preferredState: r.preferred_state || '',
    preferredBranch: r.preferred_branch || '',
    relocation: r.relocation || '',
    stage: r.stage || 'Applied',
    rating: Number(r.rating || 0),
    tags: Array.isArray(r.tags) ? r.tags : [],
    lastActivity: stamp(r.last_activity || r.submitted_at),
    // Was the spreadsheet row, kept for shape compatibility. Nothing in
    // the UI reads it; Interview.rowNumber is the one that matters.
    rowNumber: 0
  };
}

const LIST_COLUMNS =
  'application_id,submitted_at,full_name,email,phone,city,state,position,' +
  'available_date,expected_salary,experience,resume_url,preferred_state,' +
  'preferred_branch,relocation,stage,rating,tags,last_activity,archived_at';

function toInterview(r: Row) {
  return {
    applicationId: r.application_id || '',
    candidateName: r.candidate_name || '',
    title: r.title || '',
    interviewer: r.interviewer || '',
    interviewerRole: r.interviewer_role || '',
    scheduledAt: stamp(r.scheduled_at),
    durationMinutes: Number(r.duration_minutes || 45),
    type: r.type || '',
    status: r.status || 'Scheduled',
    meetingLink: r.meeting_link || '',
    calendarEventId: r.calendar_event_id || '',
    calendarEventUrl: r.calendar_event_url || '',
    calendarSyncStatus: r.calendar_sync_status || 'Pending',
    calendarSyncError: r.calendar_sync_error || '',
    // The frontend cancels by rowNumber; the primary key stands in for
    // it, so cancelInterview keeps working unchanged.
    rowNumber: Number(r.id)
  };
}

/**
 * Archived means: explicitly archived, or concluded and past the
 * cutoff, or simply untouched for too long.
 *
 * Only the first writes anything. The two age rules are computed, so
 * rows reappear if the thresholds change.
 */
function isArchived(r: Row, decidedCutoff: number, staleCutoff: number | null): boolean {
  if (r.archived_at) return true;

  const ms = Date.parse(r.last_activity || r.submitted_at);
  if (isNaN(ms)) return false;

  if (isDecidedStage(r.stage)) return ms < decidedCutoff;

  return staleCutoff !== null && ms < staleCutoff;
}

// ── audit ───────────────────────────────────────────────

async function writeAudit(
  env: Env,
  user: User,
  action: string,
  applicationId: string | null,
  remarks: string
) {
  try {
    await insert(env, 'audit_log', {
      created_at: nowIso(),
      user_email: user.email,
      user_name: user.name,
      action,
      application_id: applicationId,
      remarks: remarks || ''
    });
  } catch (err) {
    // An audit failure must not lose the write it describes — the old
    // Apps Script swallowed this too.
    console.error('audit write failed:', err);
  }
}

/** Throws unless the application exists. Also gives callers its row. */
async function getApplication(env: Env, applicationId: unknown, columns = '*'): Promise<Row> {
  const validatedApplicationId = requireApplicationId(applicationId);

  const rows = await select<Row>(
    env,
    'applications',
    `select=${columns}&application_id=eq.${enc(validatedApplicationId)}&limit=1`
  );

  if (!rows.length) throw new Error(`Application not found: ${validatedApplicationId}`);
  return rows[0];
}

const scopeValue = (value: unknown) => String(value ?? '').trim().toLowerCase();

function hasAssignment(value: unknown, assignments: string[], partial = false): boolean {
  const normalized = scopeValue(value);
  const rules = assignments.map(scopeValue).filter(Boolean);
  if (rules.includes('all')) return true;
  if (!normalized || !rules.length) return false;
  return rules.some((rule) => (partial ? normalized.includes(rule) : normalized === rule));
}

function positionWithinRoleLevel(role: string, position: unknown): boolean {
  const normalizedRole = scopeValue(role);
  const normalizedPosition = scopeValue(position);
  if (normalizedRole === 'supervisor') return !/supervisor|manager/.test(normalizedPosition);
  if (normalizedRole === 'area manager' || normalizedRole === 'manager') {
    return !/manager/.test(normalizedPosition);
  }
  return true;
}

/**
 * Branch exclusions are a final deny rule for every role. This supports,
 * for example, allowedBranches=['ALL'] with excludedBranches=['HQ - Jenjarom'].
 * Senior Manager and Admin are otherwise global; other roles must match both
 * their branch and position assignments.
 */
function canAccessApplication(user: User, row: Row): boolean {
  const role = scopeValue(user.role);
  if (hasAssignment(row.preferred_branch, user.excludedBranches)) return false;
  if (role === 'admin' || role === 'senior manager') return true;
  return (
    positionWithinRoleLevel(user.role, row.position) &&
    hasAssignment(row.preferred_branch, user.allowedBranches) &&
    hasAssignment(row.position, user.allowedPositions, true)
  );
}

function requireApplicationAccess(user: User, row: Row): Row {
  if (!canAccessApplication(user, row)) {
    throw new Error('You do not have access to this application');
  }
  return row;
}

async function getScopedApplication(
  env: Env,
  user: User,
  applicationId: unknown,
  columns = '*'
): Promise<Row> {
  // Scope fields are always fetched for authorization, even when the
  // caller only needs one write-related column.
  const requested = columns === '*' ? '*' : `${columns},preferred_branch,position`;
  return requireApplicationAccess(user, await getApplication(env, applicationId, requested));
}

const touch = () => ({ last_activity: nowIso() });

// ── read actions ────────────────────────────────────────

async function apiApplications(env: Env, user: User, includeArchived: boolean) {
  const settings = await loadSettings(env);

  const all = await select<Row>(
    env,
    'applications',
    `select=${LIST_COLUMNS}&order=submitted_at.desc&limit=5000`
  );

  const archiveAfterDays = settingNumber(settings, 'ArchiveAfterDays', 30);
  const staleAfterDays = settingNumber(settings, 'StaleAfterDays', 90);

  const day = 24 * 60 * 60 * 1000;
  const decidedCutoff = Date.now() - archiveAfterDays * day;
  const staleCutoff = staleAfterDays > 0 ? Date.now() - staleAfterDays * day : null;

  // Scope before every other filter so out-of-scope rows never reach
  // the browser and do not affect archived counts.
  const scoped = all.filter((row) => canAccessApplication(user, row));
  let rows = scoped;
  let archivedCount = 0;

  // Filtering HERE is what shrinks the response. Hiding these in the
  // browser would still ship every archived row over the wire.
  if (!includeArchived) {
    rows = scoped.filter((r) => {
      const hide = isArchived(r, decidedCutoff, staleCutoff);
      if (hide) archivedCount++;
      return !hide;
    });
  }

  return {
    result: 'success',
    data: rows.map(toListRow),
    archivedCount,
    archiveAfterDays
  };
}

/**
 * Lightweight polling feed for the in-app notification bell. Only the
 * fields needed by the notification UI are selected, and the same role
 * scope as the main applications endpoint is applied before responding.
 * With no cursor, return a server-time baseline instead of old records.
 */
async function apiNotifications(env: Env, user: User, since: unknown) {
  const checkedAt = nowIso();
  const rawSince = String(since ?? '').trim();
  if (!rawSince) return { result: 'success', data: [], checkedAt };

  const parsedSince = new Date(rawSince);
  if (Number.isNaN(parsedSince.getTime())) throw new Error('Invalid notification cursor');

  const rows = await select<Row>(
    env,
    'applications',
    'select=application_id,submitted_at,full_name,position,preferred_branch' +
      `&submitted_at=gt.${enc(parsedSince.toISOString())}` +
      '&order=submitted_at.desc&limit=50'
  );

  return {
    result: 'success',
    checkedAt,
    data: rows.filter((row) => canAccessApplication(user, row)).map((row) => ({
      applicationId: String(row.application_id || ''),
      submittedAt: String(row.submitted_at || ''),
      fullName: String(row.full_name || 'New applicant'),
      position: String(row.position || ''),
      preferredBranch: String(row.preferred_branch || '')
    }))
  };
}

async function apiApplication(env: Env, user: User, applicationId: unknown) {
  const r = await getScopedApplication(env, user, applicationId);
  const resumeUrl = await resolveResumeUrl(env, r.resume_url);

  return {
    result: 'success',
    data: {
      ...toListRow(r),
      resumeUrl,
      icNumber: r.ic_number || '',
      address: r.address || '',
      postcode: r.postcode || '',
      coverMessage: r.cover_message || '',
      resumeFileName: r.resume_file_name || '',
      archived: Boolean(r.archived_at)
    }
  };
}

async function apiActivity(env: Env, user: User, applicationId: unknown) {
  if (!applicationId) throw new Error('Missing applicationId');
  await getScopedApplication(env, user, applicationId, 'application_id');
  const id = enc(String(applicationId));

  const [audit, interviews] = await Promise.all([
    select<Row>(
      env,
      'audit_log',
      `select=created_at,user_name,user_email,action,remarks&application_id=eq.${id}` +
        '&order=created_at.asc&limit=1000'
    ),
    select<Row>(env, 'interviews', `select=*&application_id=eq.${id}&order=scheduled_at.asc&limit=200`)
  ]);

  return {
    result: 'success',
    auditLog: audit.map((a) => ({
      timestamp: stamp(a.created_at),
      // The sheet stored one string; recombine so the timeline reads
      // the same as it always has.
      user: a.user_name ? `${a.user_name}${a.user_email ? ` (${a.user_email})` : ''}` : a.user_email || '',
      action: a.action || '',
      remarks: a.remarks || ''
    })),
    interviews: interviews.map(toInterview)
  };
}

async function apiInterviews(env: Env, user: User) {
  const [rows, applications] = await Promise.all([
    select<Row>(env, 'interviews', 'select=*&order=scheduled_at.desc&limit=2000'),
    select<Row>(env, 'applications', 'select=application_id,preferred_branch,position&limit=5000')
  ]);
  const accessibleIds = new Set(
    applications.filter((row) => canAccessApplication(user, row)).map((row) => String(row.application_id))
  );
  return {
    result: 'success',
    data: rows.filter((row) => accessibleIds.has(String(row.application_id))).map(toInterview)
  };
}

async function apiAssessments(env: Env, user: User, applicationId: unknown) {
  if (!applicationId) throw new Error('Missing applicationId');
  await getScopedApplication(env, user, applicationId, 'application_id');

  const rows = await select<Row>(
    env,
    'assessments',
    `select=*&application_id=eq.${enc(String(applicationId))}&order=assessed_at.desc&limit=1000`
  );

  // Criterion rows regroup into scorecards, one per assessor per sitting.
  const grouped = new Map<string, { assessor: string; assessedAt: string; criteria: any[] }>();

  for (const r of rows) {
    const key = `${r.assessor_email || r.assessor || ''}|${r.assessed_at || ''}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        assessor: r.assessor || r.assessor_email || 'Unknown',
        assessedAt: stamp(r.assessed_at),
        criteria: []
      });
    }

    grouped.get(key)!.criteria.push({
      criterion: r.criterion || '',
      score: Number(r.score || 0),
      comment: r.comment || ''
    });
  }

  const scorecards = [...grouped.values()].map((card) => {
    const scored = card.criteria.filter((c) => c.score > 0);
    const average = scored.length
      ? scored.reduce((sum, c) => sum + c.score, 0) / scored.length
      : 0;
    return { ...card, average: Math.round(average * 10) / 10 };
  });

  return { result: 'success', scorecards };
}

// ── write actions ───────────────────────────────────────

async function apiUpdateStage(env: Env, user: User, payload: Row) {
  requireWriteAccess(user);

  const applicationId = payload.applicationId;
  const stage = sanitize(payload.stage);

  if (!applicationId || !stage) throw new Error('applicationId and stage are required');

  const settings = await loadSettings(env);
  const valid = stageList(settings);

  if (valid.length && !valid.includes(stage)) throw new Error(`Unknown stage: ${stage}`);

  const row = await getScopedApplication(env, user, applicationId, 'application_id,stage');
  const previous = row.stage || 'Applied';

  // Returning early keeps a retried request — after a response was lost
  // in transit — from writing a duplicate audit row.
  if (previous === stage) {
    return { result: 'success', applicationId, stage, unchanged: true };
  }

  // Working stages move both ways; a recruiter may legitimately send
  // someone back for another interview. Only outcomes are final.
  if (isDecidedStage(previous)) {
    throw new Error(`"${previous}" is final. Ask an administrator to change it directly.`);
  }

  await update(env, 'applications', `application_id=eq.${enc(String(applicationId))}`, {
    stage,
    ...touch()
  });

  await writeAudit(
    env,
    user,
    'STAGE_CHANGE',
    String(applicationId),
    `${previous} → ${stage}${payload.remarks ? ` | ${sanitize(payload.remarks)}` : ''}`
  );

  return { result: 'success', applicationId, stage };
}

async function apiAddNote(env: Env, user: User, payload: Row) {
  requireWriteAccess(user);

  const applicationId = payload.applicationId;
  const content = sanitize(payload.content);

  if (!applicationId || !content) throw new Error('applicationId and content are required');

  // Checked up front: audit_log.application_id is a real foreign key
  // now, so writing the note first would fail on a bad id anyway.
  await getScopedApplication(env, user, applicationId, 'application_id');

  const remarks = payload.tag ? `[${sanitize(payload.tag)}] ${content}` : content;
  await writeAudit(env, user, 'NOTE', String(applicationId), remarks);

  // An optional star rating rides along with the note.
  if (payload.rating) {
    await update(env, 'applications', `application_id=eq.${enc(String(applicationId))}`, {
      rating: Number(payload.rating),
      ...touch()
    });
    await writeAudit(env, user, 'RATING', String(applicationId), `Rated ${payload.rating}/5`);
  }

  return { result: 'success', applicationId };
}

async function apiUpdateTags(env: Env, user: User, payload: Row) {
  requireWriteAccess(user);

  const applicationId = payload.applicationId;
  if (!applicationId) throw new Error('applicationId is required');

  const tags = (Array.isArray(payload.tags) ? payload.tags : [payload.tags])
    .map(sanitize)
    .filter(Boolean);

  await getScopedApplication(env, user, applicationId, 'application_id');

  await update(env, 'applications', `application_id=eq.${enc(String(applicationId))}`, {
    tags,
    ...touch()
  });

  await writeAudit(env, user, 'TAGS', String(applicationId), tags.join(', ') || '(cleared)');

  return { result: 'success', applicationId, tags };
}

async function apiArchiveApplication(env: Env, user: User, payload: Row) {
  requireWriteAccess(user);

  const applicationId = payload.applicationId;
  if (!applicationId) throw new Error('applicationId is required');

  const row = await getScopedApplication(env, user, applicationId, 'application_id,archived_at');
  const restore = payload.restore === true;
  const currentlyArchived = Boolean(row.archived_at);

  if (restore === !currentlyArchived) {
    return { result: 'success', applicationId, unchanged: true };
  }

  await update(env, 'applications', `application_id=eq.${enc(String(applicationId))}`, {
    archived_at: restore ? null : nowIso()
  });

  await writeAudit(
    env,
    user,
    restore ? 'RESTORED' : 'ARCHIVED',
    String(applicationId),
    restore ? 'Returned to the board' : sanitize(payload.reason) || 'Removed from the board'
  );

  return { result: 'success', applicationId, restored: restore };
}

async function apiScheduleInterview(env: Env, user: User, payload: Row) {
  requireWriteAccess(user);

  const applicationId = payload.applicationId;
  if (!applicationId || !payload.scheduledAt) {
    throw new Error('applicationId and scheduledAt are required');
  }

  const application = await getScopedApplication(
    env,
    user,
    applicationId,
    'application_id,full_name,email,position,preferred_branch'
  );
  const scheduledAt = malaysiaDateTimeIso(payload.scheduledAt);
  const title = sanitize(payload.title) || 'Interview';
  const durationMinutes = Number(payload.durationMinutes || 45);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
    throw new Error('Interview duration must be between 5 and 480 minutes');
  }

  // Supabase is the source of truth. Save there first, then sync. A
  // Calendar outage cannot lose the interview or invite a duplicate.
  const inserted = await insert<Row>(env, 'interviews', {
    application_id: applicationId,
    candidate_name: sanitize(payload.candidateName) || sanitize(application.full_name),
    title,
    interviewer: sanitize(payload.interviewer) || user.name,
    interviewer_role: sanitize(payload.interviewerRole) || user.role,
    scheduled_at: scheduledAt,
    duration_minutes: durationMinutes,
    type: sanitize(payload.type) || 'Interview',
    status: 'Scheduled',
    meeting_link: sanitize(payload.meetingLink),
    calendar_sync_status: 'Pending',
    calendar_sync_error: null,
    created_by: user.email,
    created_at: nowIso()
  });

  const interview = inserted[0];
  if (!interview?.id) throw new Error('Interview was not returned after saving');

  let warning = '';
  let calendarSynced = false;
  if (isDemoMode(env)) {
    await update(env, 'interviews', `id=eq.${interview.id}`, {
      calendar_sync_status: 'Demo',
      calendar_sync_error: null
    });
  } else {
    try {
      const calendar = await callCalendarBridge(env, {
      operation: 'create',
      interviewId: interview.id,
      applicationId,
      candidateName: sanitize(payload.candidateName) || sanitize(application.full_name),
      candidateEmail: sanitize(application.email),
      position: sanitize(application.position),
      branch: sanitize(application.preferred_branch),
      title,
      interviewerName: sanitize(payload.interviewer) || user.name,
      interviewerEmail: user.email,
      scheduledAt,
      durationMinutes,
      type: sanitize(payload.type) || 'Interview',
      location: sanitize(payload.meetingLink)
    });

      await update(env, 'interviews', `id=eq.${interview.id}`, {
        calendar_event_id: calendar.eventId || null,
        calendar_event_url: calendar.eventUrl || null,
        calendar_sync_status: 'Synced',
        calendar_sync_error: null
      });
      calendarSynced = true;
    } catch (err) {
      warning = err instanceof Error ? err.message : String(err);
      await update(env, 'interviews', `id=eq.${interview.id}`, {
        calendar_sync_status: 'Failed',
        calendar_sync_error: warning.slice(0, 500)
      });
    }
  }

  await update(env, 'applications', `application_id=eq.${enc(String(applicationId))}`, touch());

  await writeAudit(
    env,
    user,
    'INTERVIEW_SCHEDULED',
    String(applicationId),
    `${title} — ${stamp(scheduledAt)}${warning ? ` | Calendar sync failed: ${warning}` : ''}`
  );

  return {
    result: 'success',
    applicationId,
    calendarSynced,
    warning: warning ? `Interview saved, but Google Calendar was not updated: ${warning}` : undefined
  };
}

async function apiCancelInterview(env: Env, user: User, payload: Row) {
  requireWriteAccess(user);

  const applicationId = payload.applicationId;
  if (!applicationId) throw new Error('applicationId is required');
  const rowNumber = requirePositiveSafeInteger(payload.rowNumber, 'rowNumber');
  await getScopedApplication(env, user, applicationId, 'application_id');

  const rows = await select<Row>(
    env,
    'interviews',
    `select=id,application_id,status,title,calendar_event_id&id=eq.${rowNumber}&limit=1`
  );

  const interview = rows[0];
  if (!interview) throw new Error('That interview no longer exists — refresh and try again');

  // The id is checked against applicationId so a stale list cannot
  // cancel someone else's interview.
  if (String(interview.application_id) !== String(applicationId)) {
    throw new Error('The interview list is out of date — refresh the page and try again');
  }

  if (/cancelled|canceled/i.test(String(interview.status))) {
    return { result: 'success', applicationId, unchanged: true };
  }

  await update(env, 'interviews', `id=eq.${rowNumber}`, { status: 'Cancelled' });

  let warning = '';
  if (interview.calendar_event_id && !isDemoMode(env)) {
    try {
      await callCalendarBridge(env, {
        operation: 'delete',
        calendarEventId: interview.calendar_event_id
      });
      await update(env, 'interviews', `id=eq.${rowNumber}`, {
        calendar_sync_status: 'Cancelled',
        calendar_sync_error: null
      });
    } catch (err) {
      warning = err instanceof Error ? err.message : String(err);
      await update(env, 'interviews', `id=eq.${rowNumber}`, {
        calendar_sync_status: 'Failed',
        calendar_sync_error: warning.slice(0, 500)
      });
    }
  }
  await update(env, 'applications', `application_id=eq.${enc(String(applicationId))}`, touch());

  await writeAudit(
    env,
    user,
    'INTERVIEW_CANCELLED',
    String(applicationId),
    `${interview.title || 'Interview'}${payload.reason ? ` | ${sanitize(payload.reason)}` : ''}`
  );

  return {
    result: 'success',
    applicationId,
    calendarSynced: !warning,
    warning: warning ? `Interview cancelled, but its Calendar event could not be removed: ${warning}` : undefined
  };
}

async function apiRemoveInterview(env: Env, user: User, payload: Row) {
  requireWriteAccess(user);

  const applicationId = payload.applicationId;
  if (!applicationId) throw new Error('applicationId is required');
  const rowNumber = requirePositiveSafeInteger(payload.rowNumber, 'rowNumber');
  await getScopedApplication(env, user, applicationId, 'application_id');

  const rows = await select<Row>(
    env,
    'interviews',
    `select=id,application_id,title,calendar_event_id&id=eq.${rowNumber}&limit=1`
  );
  const interview = rows[0];
  if (!interview) throw new Error('That interview no longer exists — refresh and try again');
  if (String(interview.application_id) !== String(applicationId)) {
    throw new Error('The interview list is out of date — refresh the page and try again');
  }

  // Delete the external event first. If Calendar is unavailable, keep
  // the Supabase row so HR can retry instead of leaving an orphan event.
  if (interview.calendar_event_id && !isDemoMode(env)) {
    await callCalendarBridge(env, {
      operation: 'delete',
      calendarEventId: interview.calendar_event_id
    });
  }

  await remove(env, 'interviews', `id=eq.${rowNumber}`);
  await update(env, 'applications', `application_id=eq.${enc(String(applicationId))}`, touch());
  await writeAudit(
    env,
    user,
    'INTERVIEW_REMOVED',
    String(applicationId),
    String(interview.title || 'Interview')
  );

  return { result: 'success', applicationId };
}

async function apiSaveAssessment(env: Env, user: User, payload: Row) {
  requireWriteAccess(user);

  const applicationId = payload.applicationId;
  const criteria = payload.criteria;

  if (!applicationId || !Array.isArray(criteria) || !criteria.length) {
    throw new Error('applicationId and at least one criterion are required');
  }

  await getScopedApplication(env, user, applicationId, 'application_id');

  // One timestamp for the whole scorecard — it is what groups these
  // rows back together on read.
  const assessedAt = nowIso();

  await insert(
    env,
    'assessments',
    criteria.map((c: Row) => ({
      application_id: applicationId,
      criterion: sanitize(c.criterion),
      score: Number(c.score || 0),
      comment: sanitize(c.comment),
      assessor: user.name,
      assessor_email: user.email,
      assessed_at: assessedAt
    }))
  );

  await update(env, 'applications', `application_id=eq.${enc(String(applicationId))}`, touch());

  await writeAudit(
    env,
    user,
    'ASSESSMENT',
    String(applicationId),
    `${criteria.length} criteria scored`
  );

  return { result: 'success', applicationId };
}

// ── routing ─────────────────────────────────────────────

export async function forward(
  method: string,
  query: Record<string, string | string[] | undefined>,
  body: Record<string, unknown> | null,
  cookieHeader: string | null,
  env: Env
): Promise<ForwardResult> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      status: 500,
      body: {
        result: 'error',
        message:
          'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set. Add them to .env.local ' +
          'for local dev, or as Secrets on the Cloudflare Pages project for deployments.'
      }
    };
  }

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  try {
    if (method === 'GET') {
      const action = String(one(query.action) || '');
      if (!READ_ACTIONS.includes(action)) {
        return { status: 400, body: { result: 'error', message: `Unsupported action: ${action}` } };
      }

      const user = await requireUser(env, cookieHeader);

      switch (action) {
        case 'bootstrap':
          return { status: 200, body: { result: 'success', user, settings: await loadSettings(env) } };
        case 'applications': {
          const raw = String(one(query.includeArchived) || '');
          const include = /^(1|true|yes)$/i.test(raw);
          return { status: 200, body: await apiApplications(env, user, include) };
        }
        case 'notifications':
          return { status: 200, body: await apiNotifications(env, user, one(query.since)) };
        case 'application':
          return { status: 200, body: await apiApplication(env, user, one(query.applicationId)) };
        case 'activity':
          return { status: 200, body: await apiActivity(env, user, one(query.applicationId)) };
        case 'interviews':
          return { status: 200, body: await apiInterviews(env, user) };
        case 'assessments':
          return { status: 200, body: await apiAssessments(env, user, one(query.applicationId)) };
      }
    }

    if (method === 'POST') {
      const payload = (body || {}) as Row;
      const action = String(payload.action || '');

      if (!WRITE_ACTIONS.includes(action)) {
        return { status: 400, body: { result: 'error', message: `Unsupported action: ${action}` } };
      }

      const user = await requireUser(env, cookieHeader);

      switch (action) {
        case 'updateStage':
          return { status: 200, body: await apiUpdateStage(env, user, payload) };
        case 'addNote':
          return { status: 200, body: await apiAddNote(env, user, payload) };
        case 'updateTags':
          return { status: 200, body: await apiUpdateTags(env, user, payload) };
        case 'scheduleInterview':
          return { status: 200, body: await apiScheduleInterview(env, user, payload) };
        case 'saveAssessment':
          return { status: 200, body: await apiSaveAssessment(env, user, payload) };
        case 'cancelInterview':
          return { status: 200, body: await apiCancelInterview(env, user, payload) };
        case 'removeInterview':
          return { status: 200, body: await apiRemoveInterview(env, user, payload) };
        case 'archiveApplication':
          return { status: 200, body: await apiArchiveApplication(env, user, payload) };
      }
    }

    return { status: 405, body: { result: 'error', message: 'Method not allowed' } };
  } catch (err) {
    // Business errors ("User not registered", "read-only") reach the UI
    // as result:"error" with status 200, which is the shape
    // src/services/api.ts already checks.
    return {
      status: 200,
      body: {
        result: 'error',
        message: err instanceof Error ? err.message : String(err)
      }
    };
  }
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());

  let body: Record<string, unknown> | null = null;

  if (request.method === 'POST') {
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  const { status, body: payload } = await forward(
    request.method,
    query,
    body,
    request.headers.get('Cookie'),
    env
  );

  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
