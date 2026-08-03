import {
  Application,
  ApplicationDetail,
  ActivityBundle,
  AppUser,
  AssessmentCriterion,
  Interview,
  Scorecard,
  Settings,
  ApplicationStage
} from '../types';

/**
 * All traffic goes through /api/gas, the Vercel serverless proxy that
 * injects the Apps Script token. Nothing here knows the token, and
 * nothing here talks to script.google.com directly.
 */
const ENDPOINT = '/api/gas';

/** The signed-in user's email travels with every call for the audit trail. */
let currentUserEmail = '';

export function setCurrentUser(email: string) {
  currentUserEmail = email;
}

async function get<T>(action: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ action, user: currentUserEmail, ...params });

  const res = await fetch(`${ENDPOINT}?${query.toString()}`);
  const json = await res.json();

  if (json.result !== 'success') {
    throw new Error(json.message || `Request failed: ${action}`);
  }

  return json as T;
}

async function post<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, user: currentUserEmail, ...payload })
  });

  const json = await res.json();

  if (json.result !== 'success') {
    throw new Error(json.message || `Request failed: ${action}`);
  }

  return json as T;
}

/**
 * Validates an email against the Users sheet and returns the account's
 * name and role. Rejects unknown or inactive users.
 */
export async function login(email: string): Promise<{ user: AppUser; settings: Settings }> {
  setCurrentUser(email);

  try {
    return await post<{ user: AppUser; settings: Settings }>('login');
  } catch (err) {
    setCurrentUser('');
    throw err;
  }
}

export async function fetchBootstrap(): Promise<{ user: AppUser; settings: Settings }> {
  return get<{ user: AppUser; settings: Settings }>('bootstrap');
}

export interface ApplicationsResult {
  data: Application[];
  /** Rows the server withheld — archived, or concluded and past the cutoff. */
  archivedCount: number;
  archiveAfterDays: number;
}

/**
 * The active applications in one call. Search, filters and sorting
 * happen in the browser, so they stay instant.
 *
 * Archived rows are excluded BY THE SERVER, which is the point — hiding
 * them client-side would still ship every row over the wire.
 */
export async function fetchApplications(includeArchived = false): Promise<ApplicationsResult> {
  const json = await get<ApplicationsResult>(
    'applications',
    includeArchived ? { includeArchived: '1' } : {}
  );

  return {
    data: json.data || [],
    archivedCount: json.archivedCount || 0,
    archiveAfterDays: json.archiveAfterDays || 30
  };
}

/**
 * One candidate in full. The list response omits IC number, address,
 * postcode and cover message, so the drawer fetches them for just the
 * person being opened.
 */
export async function fetchApplication(applicationId: string): Promise<ApplicationDetail> {
  const json = await get<{ data: ApplicationDetail }>('application', { applicationId });
  return json.data;
}

/** Removes a candidate from the board, or puts one back. */
export async function archiveApplication(
  applicationId: string,
  options: { restore?: boolean; reason?: string } = {}
): Promise<void> {
  await post('archiveApplication', { applicationId, ...options });
}

export async function fetchActivity(applicationId: string): Promise<ActivityBundle> {
  const json = await get<ActivityBundle>('activity', { applicationId });
  return { auditLog: json.auditLog || [], interviews: json.interviews || [] };
}

export async function fetchInterviews(): Promise<Interview[]> {
  const json = await get<{ data: Interview[] }>('interviews');
  return json.data;
}

/** Every scorecard recorded against one candidate, newest first. */
export async function fetchAssessments(applicationId: string): Promise<Scorecard[]> {
  const json = await get<{ scorecards: Scorecard[] }>('assessments', { applicationId });
  return json.scorecards || [];
}

export async function saveAssessment(
  applicationId: string,
  criteria: AssessmentCriterion[]
): Promise<void> {
  await post('saveAssessment', { applicationId, criteria });
}

/**
 * Marks an interview cancelled. `rowNumber` comes straight from the
 * fetched interview — the server re-checks it against applicationId
 * before writing, so a stale list can't cancel the wrong row.
 */
export async function cancelInterview(
  applicationId: string,
  rowNumber: number,
  reason?: string
): Promise<void> {
  await post('cancelInterview', { applicationId, rowNumber, reason });
}

export async function updateStage(
  applicationId: string,
  stage: ApplicationStage,
  remarks?: string
): Promise<void> {
  await post('updateStage', { applicationId, stage, remarks });
}

export async function addNote(
  applicationId: string,
  content: string,
  rating?: number,
  tag?: string
): Promise<void> {
  await post('addNote', { applicationId, content, rating, tag });
}

export async function updateTags(applicationId: string, tags: string[]): Promise<void> {
  await post('updateTags', { applicationId, tags });
}

export async function scheduleInterview(
  applicationId: string,
  data: {
    candidateName: string;
    title: string;
    interviewer: string;
    interviewerRole?: string;
    scheduledAt: string;
    durationMinutes?: number;
    type?: string;
    meetingLink?: string;
  }
): Promise<void> {
  await post('scheduleInterview', { applicationId, ...data });
}
