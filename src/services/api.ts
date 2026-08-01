import {
  Application,
  ActivityBundle,
  AppUser,
  Interview,
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

/**
 * Every application in one call. Filtering and sorting happen in the
 * browser — the dataset is small and this keeps search instant instead
 * of hitting Apps Script on every keystroke.
 */
export async function fetchApplications(): Promise<Application[]> {
  const json = await get<{ data: Application[] }>('applications');
  return json.data;
}

export async function fetchActivity(applicationId: string): Promise<ActivityBundle> {
  const json = await get<ActivityBundle>('activity', { applicationId });
  return { auditLog: json.auditLog || [], interviews: json.interviews || [] };
}

export async function fetchInterviews(): Promise<Interview[]> {
  const json = await get<{ data: Interview[] }>('interviews');
  return json.data;
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
