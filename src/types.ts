/**
 * Shapes returned by the Apps Script API.
 *
 * Field names mirror the Google Sheet columns — when a column is added
 * to the sheet, add it here and in apiApplications_() in DashboardApi.gs.
 */

/** Free-form: the pipeline stages come from Settings (Category = "Stage"). */
export type ApplicationStage = string;

export interface Application {
  applicationId: string;
  timestamp: string;
  fullName: string;
  icNumber: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postcode: string;
  position: string;
  availableDate: string;
  expectedSalary: string;
  experience: string;
  coverMessage: string;
  resumeFileName: string;
  resumeUrl: string;
  preferredState: string;
  preferredBranch: string;
  relocation: string;

  // Pipeline columns (U-X) — written by the dashboard, not the form
  stage: ApplicationStage;
  rating: number;
  tags: string[];
  lastActivity: string;

  /** Sheet row, useful when debugging against the spreadsheet. */
  rowNumber: number;
}

/** One row of the AuditLog sheet. Doubles as note and timeline entry. */
export interface AuditEntry {
  timestamp: string;
  user: string;
  action: string;
  remarks: string;
}

export interface Interview {
  applicationId?: string;
  candidateName?: string;
  title: string;
  interviewer: string;
  interviewerRole: string;
  scheduledAt: string;
  durationMinutes: number;
  type: string;
  status: string;
  meetingLink: string;
}

/**
 * A row of the Users sheet, plus the permissions Apps Script resolved
 * from it. These flags are advisory for the UI only — the server
 * enforces the same rules independently, so hiding a control here is
 * convenience, not security.
 */
export interface AppUser {
  email: string;
  name: string;
  role: string;
  /** Branches this user may see. Empty or absent = every branch. */
  locations?: string[];
  canEdit?: boolean;
  canViewStats?: boolean;
}

/** Settings sheet grouped by Category, ordered by Sort, inactive dropped. */
export type Settings = Record<string, string[]>;

export interface ActivityBundle {
  auditLog: AuditEntry[];
  interviews: Interview[];
}

/** One criterion within a scorecard. */
export interface AssessmentCriterion {
  criterion: string;
  /** 1–5, or 0 when not scored. */
  score: number;
  comment: string;
}

/** One interviewer's assessment of one candidate, at one point in time. */
export interface Scorecard {
  assessor: string;
  assessedAt: string;
  average: number;
  criteria: AssessmentCriterion[];
}

/** Computed in the browser from the applications array. */
export interface RecruitmentAnalytics {
  totalApplicants: number;
  activeStages: number;
  hiredCount: number;
  avgRating: number;
  stageDistribution: { stage: string; count: number }[];
  branchBreakdown: { branch: string; count: number }[];
  positionBreakdown: { position: string; count: number }[];
  monthlyTrend: { month: string; applications: number; hired: number }[];
  relocationSplit: { answer: string; count: number }[];
}

export interface FilterState {
  searchQuery: string;
  branch: string;
  position: string;
  stage: string;
  state: string;
  minRating: number;
  /** Applied-date range, inclusive. Empty string means unbounded. */
  dateFrom: string;
  dateTo: string;
  sortBy: 'timestamp' | 'fullName' | 'rating' | 'expectedSalary' | 'experience';
  sortOrder: 'asc' | 'desc';
}

export const DEFAULT_STAGES = [
  'Applied',
  'Screening',
  'Interview',
  'Assessment',
  'Offer',
  'Hired',
  'Rejected'
];
