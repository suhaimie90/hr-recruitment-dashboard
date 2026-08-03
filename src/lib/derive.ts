import { Application, FilterState, RecruitmentAnalytics } from '../types';

/**
 * Filtering, sorting and analytics all run in the browser against the
 * full applications array. The sheet holds hundreds of rows, not
 * millions, so this is both faster and simpler than round-tripping to
 * Apps Script for every keystroke.
 */

export function filterApplications(apps: Application[], filters: FilterState): Application[] {
  const query = filters.searchQuery.trim().toLowerCase();

  const filtered = apps.filter((app) => {
    if (query) {
      const haystack = [
        app.fullName,
        app.email,
        app.phone,
        app.position,
        app.preferredBranch,
        app.city,
        app.icNumber,
        app.applicationId,
        ...app.tags
      ]
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(query)) return false;
    }

    if (filters.stage !== 'ALL' && app.stage !== filters.stage) return false;
    if (filters.branch !== 'ALL' && app.preferredBranch !== filters.branch) return false;
    if (filters.position !== 'ALL' && app.position !== filters.position) return false;
    if (filters.state !== 'ALL' && app.preferredState !== filters.state) return false;
    if (filters.minRating > 0 && app.rating < filters.minRating) return false;

    // Sheet timestamps are "YYYY-MM-DD HH:mm:ss"; the date inputs give
    // "YYYY-MM-DD". Comparing the first 10 chars as strings is correct
    // for ISO-ordered dates and avoids timezone drift from Date parsing.
    const appliedOn = String(app.timestamp).slice(0, 10);
    if (filters.dateFrom && appliedOn < filters.dateFrom) return false;
    if (filters.dateTo && appliedOn > filters.dateTo) return false;

    return true;
  });

  const direction = filters.sortOrder === 'asc' ? 1 : -1;

  return filtered.sort((a, b) => {
    const field = filters.sortBy;

    if (field === 'rating') return (a.rating - b.rating) * direction;

    if (field === 'expectedSalary' || field === 'experience') {
      return (parseNumber(a[field]) - parseNumber(b[field])) * direction;
    }

    if (field === 'timestamp') {
      return (Date.parse(a.timestamp) - Date.parse(b.timestamp)) * direction || 0;
    }

    return a.fullName.localeCompare(b.fullName) * direction;
  });
}

/** "RM 3,000" / "3000" / "" all become a comparable number. */
function parseNumber(value: string): number {
  const digits = String(value).replace(/[^0-9.]/g, '');
  const parsed = Number.parseFloat(digits);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function uniqueValues(apps: Application[], key: keyof Application): string[] {
  const set = new Set<string>();

  apps.forEach((app) => {
    const value = String(app[key] ?? '').trim();
    if (value) set.add(value);
  });

  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function computeAnalytics(
  apps: Application[],
  stages: string[]
): RecruitmentAnalytics {
  const stageDistribution = stages.map((stage) => ({
    stage,
    count: apps.filter((a) => a.stage === stage).length
  }));

  const hiredCount = apps.filter((a) => /hired/i.test(a.stage)).length;

  const rated = apps.filter((a) => a.rating > 0);
  const avgRating = rated.length
    ? Math.round((rated.reduce((sum, a) => sum + a.rating, 0) / rated.length) * 10) / 10
    : 0;

  return {
    totalApplicants: apps.length,
    activeStages: apps.filter((a) => !/hired|rejected/i.test(a.stage)).length,
    hiredCount,
    avgRating,
    stageDistribution,
    branchBreakdown: countBy(apps, 'preferredBranch', 'branch').slice(0, 12),
    positionBreakdown: countBy(apps, 'position', 'position').slice(0, 10),
    monthlyTrend: buildMonthlyTrend(apps),
    relocationSplit: countBy(apps, 'relocation', 'answer')
  };
}

function countBy<K extends string>(
  apps: Application[],
  field: keyof Application,
  label: K
): ({ count: number } & Record<K, string>)[] {
  const tally: Record<string, number> = {};

  apps.forEach((app) => {
    const key = String(app[field] ?? '').trim() || 'Unspecified';
    tally[key] = (tally[key] || 0) + 1;
  });

  return Object.entries(tally)
    .map(([value, count]) => ({ [label]: value, count } as { count: number } & Record<K, string>))
    .sort((a, b) => b.count - a.count);
}

/**
 * Real month-by-month counts from the submission timestamps, covering
 * the last six months including empty ones so the chart never has gaps.
 */
function buildMonthlyTrend(apps: Application[]) {
  const months: { key: string; month: string; applications: number; hired: number }[] = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      month: date.toLocaleString('en-US', { month: 'short' }),
      applications: 0,
      hired: 0
    });
  }

  apps.forEach((app) => {
    const key = String(app.timestamp).slice(0, 7);
    const bucket = months.find((m) => m.key === key);
    if (!bucket) return;

    bucket.applications += 1;
    if (/hired/i.test(app.stage)) bucket.hired += 1;
  });

  return months.map(({ month, applications, hired }) => ({ month, applications, hired }));
}

/**
 * Offer / Hired / Rejected are outcomes of one conversation, not three
 * pieces of work — a recruiter offers, then the candidate either shows
 * up or doesn't. Three separate board columns made two of them dead
 * space, so they collapse into a single "Offer & Outcome" column with
 * the result shown as a badge on the card.
 */
export function isTerminalStage(stage: string): boolean {
  return /offer|hired|rejected/i.test(stage);
}

export function isHiredStage(stage: string): boolean {
  return /hired/i.test(stage);
}

export function isRejectedStage(stage: string): boolean {
  return /rejected/i.test(stage);
}

/**
 * Hired and Rejected are conclusions. The dashboard won't move a
 * candidate out of them — an admin corrects the Stage column in the
 * spreadsheet if one was recorded by mistake.
 */
export function isDecidedStage(stage: string): boolean {
  return isHiredStage(stage) || isRejectedStage(stage);
}

/**
 * Stages move forward only. Backwards is nearly always a misclick, and
 * allowing it fills the audit trail with churn that means nothing.
 * Mirrors the rule Apps Script enforces — this just greys out the
 * controls so nobody discovers it via an error message.
 */
export function canMoveToStage(
  stages: string[],
  current: string,
  target: string
): boolean {
  if (current === target) return false;
  if (isDecidedStage(current)) return false;

  const from = stages.indexOf(current);
  const to = stages.indexOf(target);

  if (from === -1 || to === -1) return true;

  return to > from;
}

export interface BoardColumn {
  /** Stable key for React. */
  key: string;
  title: string;
  /** Stage values that belong in this column. */
  stages: string[];
}

/** Working stages stay one-per-column; terminal stages merge into one. */
export function buildBoardColumns(stages: string[]): BoardColumn[] {
  const columns: BoardColumn[] = [];
  const terminal = stages.filter(isTerminalStage);

  stages.forEach((stage) => {
    if (isTerminalStage(stage)) return;
    columns.push({ key: stage, title: stage, stages: [stage] });
  });

  if (terminal.length) {
    columns.push({
      key: '__outcome__',
      title: terminal.length > 1 ? 'Offer & Outcome' : terminal[0],
      stages: terminal
    });
  }

  return columns;
}

/** Tailwind classes per stage, with a neutral fallback for custom stages. */
export function stageStyle(stage: string) {
  const key = stage.toLowerCase();

  if (key.includes('reject')) return 'bg-rose-50 text-rose-700 border-rose-200';
  if (key.includes('hired')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (key.includes('offer')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (key.includes('assessment')) return 'bg-purple-50 text-purple-700 border-purple-200';
  if (key.includes('interview')) return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (key.includes('screen')) return 'bg-blue-50 text-blue-700 border-blue-200';

  return 'bg-slate-100 text-slate-700 border-slate-300';
}

/** Initials avatar — the sheet has no photos and never will. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
