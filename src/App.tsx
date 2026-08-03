import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { Kanban, Table, Loader2, AlertCircle } from 'lucide-react';

import { Sidebar, ActiveTab } from './components/Sidebar';
import { Header } from './components/Header';
import { AnalyticsCards } from './components/AnalyticsCards';
import { KanbanBoard } from './components/KanbanBoard';
import { CandidateListView } from './components/CandidateListView';
import { ApplicantModal } from './components/ApplicantModal';
import { ResumeViewerModal } from './components/ResumeViewerModal';
import { InterviewsView } from './components/InterviewsView';
import { LoginScreen } from './components/LoginScreen';

// Recharts is ~400 kB and only used on the Analytics tab, so it loads
// on demand rather than blocking the pipeline board on first paint.
const AnalyticsView = lazy(() =>
  import('./components/AnalyticsView').then((m) => ({ default: m.AnalyticsView }))
);

import {
  login,
  setCurrentUser,
  fetchApplications,
  fetchInterviews,
  updateStage,
  addNote,
  scheduleInterview
} from './services/api';

import {
  Application,
  ApplicationStage,
  AppUser,
  FilterState,
  Interview,
  Settings,
  DEFAULT_STAGES
} from './types';

import { computeAnalytics, filterApplications } from './lib/derive';

const SESSION_KEY = 'talentflow.user';

export default function App() {
  // Session
  const [user, setUser] = useState<AppUser | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  // Data
  const [applications, setApplications] = useState<Application[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI
  const [activeTab, setActiveTab] = useState<ActiveTab>('pipeline');
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [selectedResumeApp, setSelectedResumeApp] = useState<Application | null>(null);

  const [filters, setFilters] = useState<FilterState>({
    searchQuery: '',
    branch: 'ALL',
    position: 'ALL',
    stage: 'ALL',
    state: 'ALL',
    minRating: 0,
    dateFrom: '',
    dateTo: '',
    sortBy: 'timestamp',
    sortOrder: 'desc'
  });

  /**
   * Pipeline columns come from the Settings sheet. Either vocabulary
   * works — Category "Stage" or Category "Status" — so an existing
   * sheet doesn't have to be renamed. The constant is a last resort.
   */
  const stages = settings['Stage']?.length
    ? settings['Stage']
    : settings['Status']?.length
      ? settings['Status']
      : DEFAULT_STAGES;

  // Prefer what the server resolved. Fall back to the role name only
  // when an older Apps Script deployment doesn't send these fields.
  const canEdit = user?.canEdit ?? (user?.role ?? '').toLowerCase() !== 'viewer';
  const canViewStats = user?.canViewStats !== false;

  // ── Session restore ─────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY);

    if (!saved) {
      setIsRestoringSession(false);
      return;
    }

    try {
      const parsed = JSON.parse(saved) as AppUser;
      setCurrentUser(parsed.email);
      // Re-validate against the Users sheet — the account may have been
      // deactivated since the session was stored.
      login(parsed.email)
        .then(({ user: verified, settings: fetched }) => {
          setUser(verified);
          setSettings(fetched);
        })
        .catch(() => localStorage.removeItem(SESSION_KEY))
        .finally(() => setIsRestoringSession(false));
    } catch {
      localStorage.removeItem(SESSION_KEY);
      setIsRestoringSession(false);
    }
  }, []);

  const handleLogin = async (email: string) => {
    setLoginError(null);
    try {
      const { user: verified, settings: fetched } = await login(email);
      setUser(verified);
      setSettings(fetched);
      localStorage.setItem(SESSION_KEY, JSON.stringify(verified));
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Sign in failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(SESSION_KEY);
    setCurrentUser('');
    setUser(null);
    setApplications([]);
  };

  // ── Data loading ────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const [apps, ints] = await Promise.all([
        fetchApplications(),
        fetchInterviews().catch(() => [] as Interview[])
      ]);
      setApplications(apps);
      setInterviews(ints);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data from Google Sheets.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filtering is local, so it re-runs instantly without a network call.
  const visibleApplications = useMemo(
    () => filterApplications(applications, filters),
    [applications, filters]
  );

  // Computed from the FILTERED list so the metric cards and charts track
  // whatever branch/position/date filter is applied. Using the full list
  // made "Total Applications" read 412 even when one branch was selected.
  const analytics = useMemo(
    () => computeAnalytics(visibleApplications, stages),
    [visibleApplications, stages]
  );

  // ── Write handlers ──────────────────────────────────────
  // Each writes to the sheet, then patches local state so the board
  // updates without refetching every row.

  const handleUpdateStage = async (
    applicationId: string,
    stage: ApplicationStage,
    remarks?: string
  ) => {
    const previous = applications;

    setApplications((prev) =>
      prev.map((app) => (app.applicationId === applicationId ? { ...app, stage } : app))
    );
    setSelectedApplication((prev) =>
      prev && prev.applicationId === applicationId ? { ...prev, stage } : prev
    );

    try {
      await updateStage(applicationId, stage, remarks);
    } catch (err) {
      setApplications(previous); // roll back the optimistic update
      alert(`Could not update stage: ${err instanceof Error ? err.message : err}`);
    }
  };

  /**
   * Opening an applicant IS the screening step — reading the profile
   * takes under a minute, so making the recruiter also set the stage is
   * busywork. Only fires on the very first stage, and never for Viewers,
   * so it can't skip a candidate past a real review step.
   */
  const handleSelectApplication = (app: Application) => {
    setSelectedApplication(app);

    const firstStage = stages[0];
    const screeningStage = stages[1];

    if (canEdit && screeningStage && app.stage === firstStage) {
      handleUpdateStage(app.applicationId, screeningStage, 'Auto-advanced on first open');
    }
  };

  const handleAddNote = async (
    applicationId: string,
    content: string,
    rating?: number,
    tag?: string
  ) => {
    await addNote(applicationId, content, rating, tag);

    if (rating) {
      setApplications((prev) =>
        prev.map((app) => (app.applicationId === applicationId ? { ...app, rating } : app))
      );
      setSelectedApplication((prev) =>
        prev && prev.applicationId === applicationId ? { ...prev, rating } : prev
      );
    }
  };

  const handleScheduleInterview = async (
    applicationId: string,
    data: Parameters<typeof scheduleInterview>[1]
  ) => {
    await scheduleInterview(applicationId, data);
    setInterviews(await fetchInterviews().catch(() => interviews));
  };

  // ── Render ──────────────────────────────────────────────

  if (isRestoringSession) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} error={loginError} />;
  }

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-800 antialiased overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        canViewStats={canViewStats}
        onLogout={handleLogout}
        totalApplicants={applications.length}
        interviewCount={interviews.length}
      />

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <Header
          filters={filters}
          setFilters={setFilters}
          applications={applications}
          onRefresh={loadData}
          isLoading={isLoading}
          totalFilteredCount={visibleApplications.length}
        />

        <main className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
              <button onClick={loadData} className="font-semibold underline cursor-pointer">
                Retry
              </button>
            </div>
          )}

          {(activeTab === 'pipeline' || activeTab === 'candidates') && (
            <div>
              <AnalyticsCards analytics={analytics} />

              <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
                <div className="flex items-center gap-2 bg-slate-200/70 p-1 rounded-lg">
                  <button
                    onClick={() => setActiveTab('pipeline')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                      activeTab === 'pipeline'
                        ? 'bg-white text-indigo-600 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Kanban className="w-3.5 h-3.5" />
                    <span>Pipeline Board</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('candidates')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                      activeTab === 'candidates'
                        ? 'bg-white text-indigo-600 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Table className="w-3.5 h-3.5" />
                    <span>Table View</span>
                  </button>
                </div>

                <div className="hidden lg:flex items-center gap-1 flex-wrap">
                  <span className="text-xs text-slate-400 font-semibold mr-1">Stage:</span>
                  {['ALL', ...stages].map((stage) => (
                    <button
                      key={stage}
                      onClick={() => setFilters((prev) => ({ ...prev, stage }))}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                        filters.stage === stage
                          ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                          : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'
                      }`}
                    >
                      {stage}
                    </button>
                  ))}
                </div>
              </div>

              {isLoading && applications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mb-2" />
                  <p className="text-xs font-semibold">Loading applications from Google Sheets…</p>
                </div>
              ) : activeTab === 'pipeline' ? (
                <KanbanBoard
                  applications={visibleApplications}
                  stages={stages}
                  canEdit={canEdit}
                  onSelectApplication={handleSelectApplication}
                  onSelectResume={setSelectedResumeApp}
                  onUpdateStage={handleUpdateStage}
                />
              ) : (
                <CandidateListView
                  applications={visibleApplications}
                  stages={stages}
                  canEdit={canEdit}
                  onSelectApplication={handleSelectApplication}
                  onSelectResume={setSelectedResumeApp}
                  onUpdateStage={handleUpdateStage}
                />
              )}
            </div>
          )}

          {activeTab === 'analytics' && canViewStats && (
            <Suspense
              fallback={
                <div className="flex justify-center py-20">
                  <Loader2 className="w-7 h-7 animate-spin text-indigo-600" />
                </div>
              }
            >
              <AnalyticsView analytics={analytics} applications={visibleApplications} />
            </Suspense>
          )}

          {activeTab === 'interviews' && (
            <InterviewsView interviews={interviews} applications={applications} />
          )}
        </main>
      </div>

      <ApplicantModal
        application={selectedApplication}
        settings={settings}
        stages={stages}
        canEdit={canEdit}
        currentUser={user}
        onClose={() => setSelectedApplication(null)}
        onUpdateStage={handleUpdateStage}
        onAddNote={handleAddNote}
        onScheduleInterview={handleScheduleInterview}
        onOpenResumeModal={setSelectedResumeApp}
      />

      <ResumeViewerModal
        application={selectedResumeApp}
        onClose={() => setSelectedResumeApp(null)}
      />
    </div>
  );
}
