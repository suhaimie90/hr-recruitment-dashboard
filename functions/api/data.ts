/**
 * Cloudflare Pages Function — the dashboard API, backed by Supabase.
 *
 * Serves /api/data. This is the replacement for /api/gas: same actions,
 * same request and response shapes, so src/services/api.ts only has to
 * change which URL it points at. /api/gas is left in place until the
 * cutover is proven, which is what makes rolling back a one-line edit.
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
 * requireWriteAccess.
 *
 * `forward` is exported so vite.config.ts can serve an identical
 * /api/data locally without a second copy of the logic.
 */

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const READ_ACTIONS = [
  'bootstrap',
  'applications',
  'application',
  'activity',
  'interviews',
  'assessments'
];

const WRITE_ACTIONS = [
  'login',
  'updateStage',
  'addNote',
  'updateTags',
  'scheduleInterview',
  'saveAssessment',
  'cancelInterview',
  'archiveApplication'
];

export interface ForwardResult {
  status: number;
  body: unknown;
}

interface User {
  email: string;
  name: string;
  role: string;
  canEdit: boolean;
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

const nowIso = () => new Date().toISOString();

const isDecidedStage = (stage: unknown) => /hired|rejected/i.test(String(stage ?? ''));

// ── auth ────────────────────────────────────────────────

async function requireUser(env: Env, email: unknown): Promise<User> {
  if (!email) throw new Error('Missing user email');

  // ilike with no wildcards is an exact, case-insensitive match.
  const rows = await select<Record<string, unknown>>(
    env,
    'users',
    `select=email,name,role,active&email=ilike.${enc(String(email))}&limit=1`
  );

  const match = rows[0];
  if (!match) throw new Error(`User not registered: ${email}`);
  if (!match.active) throw new Error(`User account is inactive: ${email}`);

  const role = String(match.role || 'Viewer');

  return {
    email: String(match.email),
    name: String(match.name || match.email),
    role,
    canEdit: role.trim().toLowerCase() !== 'viewer'
  };
}

/**
 * Viewers read everything and change nothing. Branch-level scoping is
 * deliberately not enforced here — users.allowed_branches exists in the
 * schema but nothing reads it yet, and quietly half-applying it would
 * be worse than not applying it at all.
 */
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
  if (!applicationId) throw new Error('applicationId is required');

  const rows = await select<Row>(
    env,
    'applications',
    `select=${columns}&application_id=eq.${enc(String(applicationId))}&limit=1`
  );

  if (!rows.length) throw new Error(`Application not found: ${applicationId}`);
  return rows[0];
}

const touch = () => ({ last_activity: nowIso() });

// ── read actions ────────────────────────────────────────

async function apiApplications(env: Env, includeArchived: boolean) {
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

  let rows = all;
  let archivedCount = 0;

  // Filtering HERE is what shrinks the response. Hiding these in the
  // browser would still ship every archived row over the wire.
  if (!includeArchived) {
    rows = all.filter((r) => {
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

async function apiApplication(env: Env, applicationId: unknown) {
  const r = await getApplication(env, applicationId);

  return {
    result: 'success',
    data: {
      ...toListRow(r),
      icNumber: r.ic_number || '',
      address: r.address || '',
      postcode: r.postcode || '',
      coverMessage: r.cover_message || '',
      resumeFileName: r.resume_file_name || '',
      archived: Boolean(r.archived_at)
    }
  };
}

async function apiActivity(env: Env, applicationId: unknown) {
  if (!applicationId) throw new Error('Missing applicationId');
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

async function apiInterviews(env: Env) {
  const rows = await select<Row>(env, 'interviews', 'select=*&order=scheduled_at.desc&limit=2000');
  return { result: 'success', data: rows.map(toInterview) };
}

async function apiAssessments(env: Env, applicationId: unknown) {
  if (!applicationId) throw new Error('Missing applicationId');

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

  const row = await getApplication(env, applicationId, 'application_id,stage');
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
  await getApplication(env, applicationId, 'application_id');

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

  await getApplication(env, applicationId, 'application_id');

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

  const row = await getApplication(env, applicationId, 'application_id,archived_at');
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

  await getApplication(env, applicationId, 'application_id');

  await insert(env, 'interviews', {
    application_id: applicationId,
    candidate_name: sanitize(payload.candidateName),
    title: sanitize(payload.title) || 'Interview',
    interviewer: sanitize(payload.interviewer) || user.name,
    interviewer_role: sanitize(payload.interviewerRole) || user.role,
    scheduled_at: new Date(payload.scheduledAt).toISOString(),
    duration_minutes: Number(payload.durationMinutes || 45),
    type: sanitize(payload.type) || 'Interview',
    status: 'Scheduled',
    meeting_link: sanitize(payload.meetingLink),
    created_by: user.email,
    created_at: nowIso()
  });

  await update(env, 'applications', `application_id=eq.${enc(String(applicationId))}`, touch());

  await writeAudit(
    env,
    user,
    'INTERVIEW_SCHEDULED',
    String(applicationId),
    `${sanitize(payload.title) || 'Interview'} — ${sanitize(payload.scheduledAt)}`
  );

  return { result: 'success', applicationId };
}

async function apiCancelInterview(env: Env, user: User, payload: Row) {
  requireWriteAccess(user);

  const applicationId = payload.applicationId;
  const rowNumber = Number(payload.rowNumber);

  if (!applicationId || !rowNumber) throw new Error('applicationId and rowNumber are required');

  const rows = await select<Row>(
    env,
    'interviews',
    `select=id,application_id,status,title&id=eq.${rowNumber}&limit=1`
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
  await update(env, 'applications', `application_id=eq.${enc(String(applicationId))}`, touch());

  await writeAudit(
    env,
    user,
    'INTERVIEW_CANCELLED',
    String(applicationId),
    `${interview.title || 'Interview'}${payload.reason ? ` | ${sanitize(payload.reason)}` : ''}`
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

  await getApplication(env, applicationId, 'application_id');

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

      const user = await requireUser(env, one(query.user));

      switch (action) {
        case 'bootstrap':
          return { status: 200, body: { result: 'success', user, settings: await loadSettings(env) } };
        case 'applications': {
          const raw = String(one(query.includeArchived) || '');
          const include = /^(1|true|yes)$/i.test(raw);
          return { status: 200, body: await apiApplications(env, include) };
        }
        case 'application':
          return { status: 200, body: await apiApplication(env, one(query.applicationId)) };
        case 'activity':
          return { status: 200, body: await apiActivity(env, one(query.applicationId)) };
        case 'interviews':
          return { status: 200, body: await apiInterviews(env) };
        case 'assessments':
          return { status: 200, body: await apiAssessments(env, one(query.applicationId)) };
      }
    }

    if (method === 'POST') {
      const payload = (body || {}) as Row;
      const action = String(payload.action || '');

      if (!WRITE_ACTIONS.includes(action)) {
        return { status: 400, body: { result: 'error', message: `Unsupported action: ${action}` } };
      }

      const user = await requireUser(env, payload.user);

      switch (action) {
        case 'login':
          return { status: 200, body: { result: 'success', user, settings: await loadSettings(env) } };
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

  const { status, body: payload } = await forward(request.method, query, body, env);

  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
