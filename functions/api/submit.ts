/**
 * Cloudflare Pages Function — public job application submission.
 *
 * Serves /api/submit. Unlike /api/data, this is deliberately
 * unauthenticated — it's the same trust boundary the Apps Script
 * /exec endpoint had (called by anyone with the URL, no token). It
 * replaces handleApplicationSubmission_ in Code.gs.
 *
 * CORS: the public form lives on a different origin
 * (setiamalaysia.com) than this Pages project. Apps Script's web app
 * responses carry permissive CORS headers automatically; a Cloudflare
 * Function does not unless it says so explicitly. Skipping this would
 * mean the row writes successfully but the browser silently blocks
 * the form's JS from reading the response — the exact "invisible
 * failure" shape this session already spent real effort fixing on the
 * Apps Script side. * is safe here specifically because the endpoint
 * takes no credentials/cookies and is meant to be publicly callable.
 *
 * No outbound email notification — HR sees new applications by
 * opening the dashboard, which already lists everything newest-first.
 * (Apps Script's MailApp had no equivalent-cost alternative, which is
 * why that system needed one; this one doesn't.)
 *
 * Environment variables (Pages -> Settings -> Variables and secrets),
 * both as **Secret**:
 *   SUPABASE_URL               same as functions/api/data.ts
 *   SUPABASE_SERVICE_ROLE_KEY  same as functions/api/data.ts
 */

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB — matches Config.gs
const DUPLICATE_LIMIT_HOURS = 24 * 7; // matches Config.gs

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const enc = encodeURIComponent;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

function ok(body: Record<string, unknown>) {
  return json(200, { result: 'success', ...body });
}

function fail(message: string) {
  return json(200, { result: 'error', message });
}

// Same rule as Code.gs's sanitize() — strips a leading formula
// character so a cell can't execute when the sheet/export is opened
// in Excel.
function sanitize(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/^[=+\-@|]/, "'").trim();
}

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
    let msg = text.slice(0, 300);
    try {
      msg = JSON.parse(text).message || msg;
    } catch {
      /* keep raw text */
    }
    throw new Error(msg);
  }
  return (text ? JSON.parse(text) : null) as T;
}

function newApplicationId(): string {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, '0');
  const d = String(today.getUTCDate()).padStart(2, '0');
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `APP-${y}${m}${d}-${suffix}`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function uploadResume(
  env: Env,
  path: string,
  bytes: Uint8Array,
  mimeType: string
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/resumes/${enc(path)}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY as string,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': mimeType
    },
    body: bytes
  });

  if (!res.ok) {
    throw new Error(`Resume upload failed: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
  }
}

async function handleSubmit(request: Request, env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail('Server is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).');
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('Invalid request body');
  }

  // ── required fields ──────────────────────────────────
  if (!raw.fullName || !raw.email || !raw.phone || !raw.position || !raw.preferredState || !raw.preferredBranch) {
    return fail('Missing required fields');
  }

  // ── sanitize ──────────────────────────────────────────
  const data = {
    fullName: sanitize(raw.fullName),
    icNumber: sanitize(raw.icNumber),
    email: sanitize(raw.email),
    phone: sanitize(raw.phone),
    address: sanitize(raw.address),
    city: sanitize(raw.city),
    state: sanitize(raw.state),
    postcode: sanitize(raw.postcode),
    preferredState: sanitize(raw.preferredState),
    preferredBranch: sanitize(raw.preferredBranch),
    position: sanitize(raw.position),
    availableDate: sanitize(raw.availableDate),
    expectedSalary: sanitize(raw.expectedSalary),
    experience: sanitize(raw.experience),
    relocation: sanitize(raw.relocation),
    coverMessage: sanitize(raw.coverMessage)
  };

  // ── email format ──────────────────────────────────────
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return fail('Invalid email address');
  }

  // ── resume validation ─────────────────────────────────
  const resumeFileName = String(raw.resumeFileName || '');
  const resumeMimeType = String(raw.resumeMimeType || '');
  const resumeBase64 = String(raw.resumeBase64 || '');

  const extension = resumeFileName.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return fail('Invalid resume file extension');
  }
  if (!ALLOWED_MIME_TYPES.includes(resumeMimeType)) {
    return fail('Only PDF and Word files are allowed');
  }

  let resumeBytes: Uint8Array;
  try {
    resumeBytes = base64ToBytes(resumeBase64);
  } catch {
    return fail('Resume file could not be read');
  }
  if (resumeBytes.length > MAX_FILE_SIZE) {
    return fail('Resume must be below 5MB');
  }

  // ── duplicate check (7 days) ──────────────────────────
  const cutoff = new Date(Date.now() - DUPLICATE_LIMIT_HOURS * 60 * 60 * 1000).toISOString();
  const recent = await sb<Array<{ application_id: string }>>(
    env,
    `applications?select=application_id&email=ilike.${enc(data.email)}&submitted_at=gte.${enc(cutoff)}&limit=1`
  );
  if (recent.length) {
    return fail('You have already submitted an application within the last 7 days.');
  }

  // ── build the record ──────────────────────────────────
  const applicationId = newApplicationId();

  const cleanName = data.fullName.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, '_') || 'Applicant';
  const resumePath = `${applicationId}_${cleanName}_Resume.${extension}`;

  // ── resume to Storage ──────────────────────────────────
  try {
    await uploadResume(env, resumePath, resumeBytes, resumeMimeType);
  } catch (err) {
    console.error('Resume upload failed:', err);
    return fail('Could not save your resume — please try again.');
  }

  // ── row insert ──────────────────────────────────────────
  const nowIso = new Date().toISOString();
  try {
    await sb(env, 'applications', {
      method: 'POST',
      body: JSON.stringify({
        application_id: applicationId,
        submitted_at: nowIso,
        full_name: data.fullName,
        ic_number: data.icNumber || null,
        email: data.email,
        phone: data.phone || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        postcode: data.postcode || null,
        position: data.position,
        available_date: data.availableDate || null,
        expected_salary: data.expectedSalary || null,
        experience: data.experience || null,
        cover_message: data.coverMessage || null,
        resume_file_name: resumeFileName || null,
        // Stored as a bare object path, not a URL — apiApplication in
        // data.ts generates a fresh signed URL on read instead, since
        // a stored signed URL would go dead when it expires.
        resume_url: resumePath,
        preferred_state: data.preferredState || null,
        preferred_branch: data.preferredBranch,
        relocation: data.relocation || null,
        stage: 'Applied',
        rating: 0,
        tags: [],
        last_activity: nowIso,
        archived_at: null
      }),
      headers: { Prefer: 'return=minimal' }
    });
  } catch (err) {
    // The resume already uploaded at this point. Left in Storage
    // rather than attempting a rollback delete — an orphan file costs
    // nothing and a failed best-effort cleanup would just obscure the
    // real error.
    console.error('Application insert failed:', err);
    return fail('Could not save your application — please try again.');
  }

  // ── audit log ─────────────────────────────────────────
  try {
    await sb(env, 'audit_log', {
      method: 'POST',
      body: JSON.stringify({
        created_at: nowIso,
        user_name: data.fullName,
        user_email: data.email,
        action: 'APPLIED',
        application_id: applicationId,
        remarks: `${data.position} @ ${data.preferredBranch}`
      }),
      headers: { Prefer: 'return=minimal' }
    });
  } catch (err) {
    // Matches Code.gs: an audit failure must never fail a submission
    // that already saved.
    console.error('Audit log write failed:', err);
  }

  return ok({ applicationID: applicationId });
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return json(405, { result: 'error', message: 'Method not allowed' });
  }

  try {
    return await handleSubmit(request, env);
  } catch (err) {
    console.error('submit.ts crashed:', err);
    return fail(err instanceof Error ? err.message : String(err));
  }
}
