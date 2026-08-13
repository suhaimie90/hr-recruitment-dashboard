import React, { useState, useEffect } from 'react';
import {
  X,
  Star,
  Mail,
  Phone,
  MapPin,
  Briefcase,
  Calendar,
  FileText,
  Send,
  Clock,
  MessageSquare,
  CalendarPlus,
  Loader2,
  CreditCard,
  Home,
  Banknote,
  Plane,
  Printer,
  UserCheck,
  UserX
} from 'lucide-react';
import {
  Application,
  ApplicationDetail,
  ApplicationStage,
  AppUser,
  AssessmentCriterion,
  AuditEntry,
  Interview,
  Scorecard,
  Settings
} from '../types';
import {
  fetchActivity,
  fetchApplication,
  fetchAssessments,
  saveAssessment,
  scheduleInterview
} from '../services/api';
import { AssessmentPanel } from './AssessmentPanel';
import {
  initials,
  stageStyle,
  isTerminalStage,
  isHiredStage,
  isRejectedStage,
  isDecidedStage,
  canMoveToStage
} from '../lib/derive';

interface ApplicantModalProps {
  application: Application | null;
  settings: Settings;
  stages: string[];
  canEdit: boolean;
  currentUser: AppUser;
  onClose: () => void;
  onUpdateStage: (id: string, stage: ApplicationStage, remarks?: string) => Promise<void>;
  onAddNote: (id: string, content: string, rating?: number, tag?: string) => Promise<void>;
  onScheduleInterview: (
    id: string,
    data: Parameters<typeof scheduleInterview>[1]
  ) => Promise<void>;
  onOpenResumeModal: (app: Application) => void;
}

type Tab = 'profile' | 'notes' | 'timeline';

export const ApplicantModal: React.FC<ApplicantModalProps> = ({
  application,
  settings,
  stages,
  canEdit,
  currentUser,
  onClose,
  onUpdateStage,
  onAddNote,
  onScheduleInterview,
  onOpenResumeModal
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [scorecards, setScorecards] = useState<Scorecard[]>([]);
  // IC number, address, postcode and cover message are not in the list
  // payload — fetched here for just this candidate.
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);

  const [noteContent, setNoteContent] = useState('');
  const [noteRating, setNoteRating] = useState(0);
  const [noteTag, setNoteTag] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showInterviewForm, setShowInterviewForm] = useState(false);
  const [interviewTitle, setInterviewTitle] = useState('');
  const [interviewAt, setInterviewAt] = useState('');
  const [interviewType, setInterviewType] = useState('');
  const [interviewLink, setInterviewLink] = useState('');

  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const applicationId = application?.applicationId;

  // Activity is fetched lazily per candidate rather than bundled into
  // the applications list, which keeps the initial load small.
  const loadActivity = React.useCallback(async () => {
    if (!applicationId) return;

    setIsLoadingActivity(true);
    try {
      // Assessments live in their own sheet, which may not exist yet —
      // fail soft so the rest of the drawer still loads.
      const [bundle, cards, full] = await Promise.all([
        fetchActivity(applicationId),
        fetchAssessments(applicationId).catch(() => [] as Scorecard[]),
        fetchApplication(applicationId).catch(() => null)
      ]);
      setAuditLog(bundle.auditLog);
      setInterviews(bundle.interviews);
      setScorecards(cards);
      setDetail(full);
    } catch {
      setAuditLog([]);
      setInterviews([]);
      setScorecards([]);
      setDetail(null);
    } finally {
      setIsLoadingActivity(false);
    }
  }, [applicationId]);

  useEffect(() => {
    if (!applicationId) return;
    setActiveTab('profile');
    setNoteContent('');
    setNoteRating(0);
    setShowInterviewForm(false);
    setShowRejectForm(false);
    setRejectReason('');
    setDetail(null);
    loadActivity();
  }, [applicationId, loadActivity]);

  if (!application) return null;

  const notes = auditLog.filter((entry) => entry.action === 'NOTE');
  const noteTags = settings['NoteTag'] || [];
  const interviewTypes = settings['InterviewType'] || ['Screening', 'Technical', 'Final'];
  const rejectionReasons = settings['RejectionReason'] || [
    'Did not show up',
    'Declined offer',
    'Failed assessment',
    'Position filled',
    'Not a fit'
  ];

  // Offer / Hired / Rejected all live in one board column, so the
  // outcome is recorded here instead of by dragging between stages.
  const hiredStage = stages.find(isHiredStage);
  const rejectedStage = stages.find(isRejectedStage);
  const inOutcome = isTerminalStage(application.stage);
  const isDecided = isHiredStage(application.stage) || isRejectedStage(application.stage);

  // Stage-aware panels: the drawer should show the work due *now*,
  // not the same three read-only tabs at every stage.
  const assessmentCriteria = settings['AssessmentCriteria'] || [
    'Role-specific Skills',
    'Behavioural Skills',
    'Communication',
    'Attitude & Motivation'
  ];

  const atInterview = /interview/i.test(application.stage);
  const atAssessment = /assessment/i.test(application.stage);

  const handleSaveAssessment = async (criteria: AssessmentCriterion[]) => {
    await saveAssessment(application.applicationId, criteria);
    await loadActivity();
  };

  const recordOutcome = async (stage: string, remarks?: string) => {
    setIsSubmitting(true);
    try {
      await onUpdateStage(application.applicationId, stage, remarks);
      setShowRejectForm(false);
      setRejectReason('');
      await loadActivity();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;

    setIsSubmitting(true);
    try {
      await onAddNote(application.applicationId, noteContent, noteRating || undefined, noteTag);
      setNoteContent('');
      setNoteRating(0);
      setNoteTag('');
      await loadActivity();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInterviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interviewAt.trim()) return;

    setIsSubmitting(true);
    try {
      await onScheduleInterview(application.applicationId, {
        candidateName: application.fullName,
        title: interviewTitle || `${interviewType || 'Interview'} — ${application.position}`,
        interviewer: currentUser.name,
        interviewerRole: currentUser.role,
        scheduledAt: interviewAt,
        type: interviewType,
        meetingLink: interviewLink
      });
      setShowInterviewForm(false);
      setInterviewTitle('');
      setInterviewAt('');
      setInterviewLink('');
      await loadActivity();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not schedule interview');
    } finally {
      setIsSubmitting(false);
    }
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'notes', label: 'Notes', count: notes.length },
    { id: 'timeline', label: 'Timeline & Interviews', count: auditLog.length }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-3xl bg-white h-full shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white p-6 relative border-b border-slate-800">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-4 pr-10">
            <div className="w-16 h-16 rounded-full bg-indigo-600/30 border-2 border-indigo-500/40 flex items-center justify-center text-lg font-bold text-indigo-200 shrink-0">
              {initials(application.fullName)}
            </div>
            <div className="overflow-hidden">
              <h2 className="text-xl font-bold text-white truncate">{application.fullName}</h2>
              <p className="text-sm text-slate-300 font-medium truncate">
                {application.position} · {application.preferredBranch}
              </p>
              <p className="text-xs text-slate-500 font-mono mt-0.5">{application.applicationId}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 mt-5 pt-4 border-t border-slate-800 text-xs text-slate-300">
            <a href={`mailto:${application.email}`} className="flex items-center gap-1.5 hover:text-indigo-300">
              <Mail className="w-3.5 h-3.5 text-indigo-400" />
              {application.email}
            </a>
            <a href={`tel:${application.phone}`} className="flex items-center gap-1.5 hover:text-indigo-300">
              <Phone className="w-3.5 h-3.5 text-indigo-400" />
              {application.phone}
            </a>
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-indigo-400" />
              {application.city}, {application.state}
            </span>
            {application.resumeUrl && (
              <button
                onClick={() => onOpenResumeModal(application)}
                className="ml-auto bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>View Resume</span>
              </button>
            )}
          </div>
        </div>

        {/* Stage bar — working stages only. Hired/Rejected are set in
            the Outcome panel below, not by clicking through stages. */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-500">Stage:</span>
          {stages
            .filter((stage) => !isHiredStage(stage) && !isRejectedStage(stage))
            .map((stage) => {
              const isCurrent = stage === application.stage;
              const allowed = canMoveToStage(stages, application.stage, stage);

              return (
                <button
                  key={stage}
                  disabled={!canEdit || isCurrent || !allowed}
                  onClick={() => onUpdateStage(application.applicationId, stage)}
                  title={
                    isCurrent
                      ? 'Current stage'
                      : allowed
                        ? `Move forward to ${stage}`
                        : 'Stages only move forward'
                  }
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer disabled:cursor-not-allowed ${
                    isCurrent
                      ? `${stageStyle(stage)} ring-2 ring-offset-1 ring-slate-300`
                      : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40'
                  }`}
                >
                  {stage}
                </button>
              );
            })}

          {isDecided && (
            <span
              className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ring-2 ring-offset-1 ring-slate-300 ${stageStyle(
                application.stage
              )}`}
            >
              {application.stage}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6 bg-white">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          {activeTab === 'profile' && (
            <div className="space-y-5">
              {/* Outcome — only once the candidate reaches the offer step.
                  Offer is made by phone or email outside this system, so
                  all that's recorded here is what happened next. */}
              {inOutcome && (
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                      Outcome
                    </h4>
                    <button
                      onClick={() => window.print()}
                      className="text-xs font-semibold text-slate-500 hover:text-indigo-600 flex items-center gap-1 cursor-pointer"
                      title="Print this candidate's details"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print
                    </button>
                  </div>

                  {isDecided ? (
                    <div className="space-y-1">
                      <p className="text-sm text-slate-700">
                        Recorded as <span className="font-bold">{application.stage}</span>.
                      </p>
                      <p className="text-[11px] text-slate-400">
                        This is final. To change it, edit the Stage column in the
                        spreadsheet.
                      </p>
                    </div>
                  ) : !canEdit ? (
                    <p className="text-xs text-slate-500">
                      Offer extended — awaiting outcome. Your role is read-only.
                    </p>
                  ) : showRejectForm ? (
                    <div className="space-y-2.5">
                      <label className="text-xs font-semibold text-slate-600">
                        Reason for rejection
                      </label>
                      <select
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none cursor-pointer"
                      >
                        <option value="">Select a reason…</option>
                        {rejectionReasons.map((reason) => (
                          <option key={reason} value={reason}>
                            {reason}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            if (!window.confirm(`Reject ${application.fullName} — "${rejectReason}"? This cannot be undone in the dashboard.`)) return;
                            if (rejectedStage) recordOutcome(rejectedStage, rejectReason);
                          }}
                          disabled={isSubmitting || !rejectReason}
                          className="flex-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg cursor-pointer"
                        >
                          {isSubmitting ? 'Saving…' : 'Confirm Rejection'}
                        </button>
                        <button
                          onClick={() => setShowRejectForm(false)}
                          className="px-4 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-slate-500 mb-3">
                        Offer extended. Did the candidate show up?{' '}
                        <span className="text-slate-400">This cannot be undone here.</span>
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            // Irreversible once set — worth one confirmation
                            // given the whole flow is single clicks.
                            if (!window.confirm(`Mark ${application.fullName} as hired? This cannot be undone in the dashboard.`)) return;
                            if (hiredStage) recordOutcome(hiredStage, 'Showed up — hired');
                          }}
                          disabled={isSubmitting || !hiredStage}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold py-2.5 rounded-lg cursor-pointer"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          Showed up — Hire
                        </button>
                        <button
                          onClick={() => setShowRejectForm(true)}
                          disabled={isSubmitting || !rejectedStage}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 disabled:opacity-50 text-xs font-semibold py-2.5 rounded-lg cursor-pointer"
                        >
                          <UserX className="w-3.5 h-3.5" />
                          No show — Reject
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Interview stage — surface the booking here rather than
                  burying it in a tab the recruiter has to go looking for. */}
              {atInterview && (
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      Interview
                    </h4>
                    {canEdit && (
                      <button
                        onClick={() => {
                          setActiveTab('timeline');
                          setShowInterviewForm(true);
                        }}
                        className="text-xs font-semibold text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <CalendarPlus className="w-3.5 h-3.5" />
                        Schedule
                      </button>
                    )}
                  </div>

                  {isLoadingActivity ? (
                    <Loading />
                  ) : interviews.length === 0 ? (
                    <p className="text-xs text-slate-400 py-1">
                      No interview scheduled yet for this candidate.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {interviews.map((interview, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100"
                        >
                          <div className="overflow-hidden">
                            <p className="text-xs font-bold text-slate-800 truncate">
                              {interview.title}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {interview.interviewer} · {interview.scheduledAt}
                            </p>
                            {/* Usually a physical location — rounds are face to face. */}
                            {interview.meetingLink && (
                              <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3 shrink-0" />
                                {interview.meetingLink}
                              </p>
                            )}
                          </div>
                          {/cancel/i.test(interview.status || '') && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                              Cancelled
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Assessment stage — the scorecard is the work here. */}
              {atAssessment && (
                <AssessmentPanel
                  criteria={assessmentCriteria}
                  scorecards={scorecards}
                  canEdit={canEdit}
                  isLoading={isLoadingActivity}
                  onSubmit={handleSaveAssessment}
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  icon={CreditCard}
                  label="IC / Passport"
                  value={detail ? detail.icNumber : ""}
                  loading={!detail}
                />
                <Field icon={Briefcase} label="Position Applied" value={application.position} />
                <Field icon={MapPin} label="Preferred Branch" value={application.preferredBranch} />
                <Field icon={MapPin} label="Preferred State" value={application.preferredState} />
                <Field icon={Calendar} label="Available From" value={application.availableDate} />
                <Field icon={Clock} label="Experience" value={`${application.experience || '0'} years`} />
                <Field icon={Banknote} label="Expected Salary" value={`RM ${application.expectedSalary}`} />
                <Field icon={Plane} label="Willing to Relocate" value={application.relocation} />
                <Field
                  icon={Home}
                  label="Address"
                  value={
                    detail
                      ? [detail.address, detail.city, detail.postcode, detail.state]
                          .filter(Boolean)
                          .join(', ')
                      : ''
                  }
                  loading={!detail}
                />
                <Field icon={Calendar} label="Applied On" value={application.timestamp} />
              </div>

              {detail?.coverMessage && (
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                    About the Applicant
                  </h4>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {detail.coverMessage}
                  </p>
                </div>
              )}

              <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Rating</h4>
                  <div className="flex items-center gap-1 text-amber-400 mt-1.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`w-4 h-4 ${
                          i < application.rating ? 'fill-amber-400' : 'text-slate-200 fill-slate-100'
                        }`}
                      />
                    ))}
                    <span className="text-xs text-slate-500 font-semibold ml-1">
                      {application.rating || '—'}/5
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('notes')}
                  className="text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
                >
                  Rate in Notes →
                </button>
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="space-y-5">
              {canEdit ? (
                <form onSubmit={handleNoteSubmit} className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                  <textarea
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="Screening feedback, interview impressions, follow-up actions…"
                    className="w-full min-h-24 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm resize-y focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-500 font-semibold mr-1">Rating:</span>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setNoteRating(i + 1 === noteRating ? 0 : i + 1)}
                          className="cursor-pointer"
                        >
                          <Star
                            className={`w-4 h-4 ${
                              i < noteRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                            }`}
                          />
                        </button>
                      ))}
                    </div>

                    {noteTags.length > 0 && (
                      <select
                        value={noteTag}
                        onChange={(e) => setNoteTag(e.target.value)}
                        className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 outline-none cursor-pointer"
                      >
                        <option value="">No tag</option>
                        {noteTags.map((tag) => (
                          <option key={tag} value={tag}>
                            {tag}
                          </option>
                        ))}
                      </select>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting || !noteContent.trim()}
                      className="ml-auto bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      {isSubmitting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>Save Note</span>
                    </button>
                  </div>
                </form>
              ) : (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded-lg">
                  Your role is read-only. Notes are visible but cannot be added.
                </div>
              )}

              {isLoadingActivity ? (
                <Loading />
              ) : notes.length === 0 ? (
                <Empty icon={MessageSquare} text="No notes recorded for this applicant yet." />
              ) : (
                <div className="space-y-3">
                  {notes.map((note, i) => (
                    <div key={i} className="bg-white p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-slate-800">{note.user}</span>
                        <span className="text-[11px] text-slate-400">{note.timestamp}</span>
                      </div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.remarks}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="space-y-5">
              <div className="bg-white p-4 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Scheduled Interviews
                  </h4>
                  {canEdit && (
                    <button
                      onClick={() => setShowInterviewForm((v) => !v)}
                      className="text-xs font-semibold text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      {showInterviewForm ? 'Cancel' : 'Schedule'}
                    </button>
                  )}
                </div>

                {showInterviewForm && (
                  <form onSubmit={handleInterviewSubmit} className="space-y-2.5 mb-4 pb-4 border-b border-slate-100">
                    <input
                      value={interviewTitle}
                      onChange={(e) => setInterviewTitle(e.target.value)}
                      placeholder="Title (optional)"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500"
                    />
                    <div className="grid grid-cols-2 gap-2.5">
                      <input
                        type="datetime-local"
                        required
                        value={interviewAt}
                        onChange={(e) => setInterviewAt(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500"
                      />
                      <select
                        value={interviewType}
                        onChange={(e) => setInterviewType(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none cursor-pointer"
                      >
                        <option value="">Type…</option>
                        {interviewTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      value={interviewLink}
                      onChange={(e) => setInterviewLink(e.target.value)}
                      placeholder="Location (e.g. SETIAHUB Kota Bharu, meeting room)"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg cursor-pointer"
                    >
                      {isSubmitting ? 'Saving…' : 'Confirm Interview'}
                    </button>
                  </form>
                )}

                {interviews.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">No interviews scheduled.</p>
                ) : (
                  <div className="space-y-2.5">
                    {interviews.map((interview, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="overflow-hidden">
                          <p className="text-xs font-bold text-slate-800 truncate">{interview.title}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {interview.interviewer} · {interview.scheduledAt}
                          </p>
                          {interview.meetingLink && (
                            <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3 shrink-0" />
                              {interview.meetingLink}
                            </p>
                          )}
                          {interview.calendarEventUrl && interview.calendarSyncStatus === 'Synced' && (
                            <a
                              href={interview.calendarEventUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-indigo-600 hover:underline mt-0.5 inline-block"
                            >
                              Open in Google Calendar
                            </a>
                          )}
                          {interview.calendarSyncStatus === 'Failed' && (
                            <p
                              className="text-[11px] text-amber-700 mt-0.5"
                              title={interview.calendarSyncError || 'Calendar sync failed'}
                            >
                              Saved · Calendar sync failed
                            </p>
                          )}
                        </div>
                        {/cancel/i.test(interview.status || '') && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                            Cancelled
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
                  Audit Trail
                </h4>

                {isLoadingActivity ? (
                  <Loading />
                ) : auditLog.length === 0 ? (
                  <Empty icon={Clock} text="No activity recorded yet." />
                ) : (
                  <div className="space-y-0">
                    {auditLog.map((entry, i) => (
                      <div key={i} className="flex gap-3 pb-4 relative">
                        <div className="flex flex-col items-center shrink-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 ring-4 ring-indigo-100 mt-1" />
                          {i < auditLog.length - 1 && <span className="w-px flex-1 bg-slate-200 mt-1" />}
                        </div>
                        <div className="flex-1 -mt-0.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-bold text-slate-800">
                              {formatAction(entry.action)}
                            </span>
                            <span className="text-[11px] text-slate-400 shrink-0">{entry.timestamp}</span>
                          </div>
                          {entry.remarks && (
                            <p className="text-xs text-slate-600 mt-0.5 whitespace-pre-wrap">
                              {entry.remarks}
                            </p>
                          )}
                          <p className="text-[11px] text-slate-400 mt-0.5">{entry.user}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  /** True while the per-candidate detail request is still in flight. */
  loading?: boolean;
}> = ({ icon: Icon, label, value, loading }) => (
  <div className="bg-white p-3 rounded-lg border border-slate-200">
    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
      <Icon className="w-3 h-3" />
      {label}
    </div>
    <p className="text-sm text-slate-800 font-medium break-words">
      {loading ? <span className="text-slate-300">Loading…</span> : value || '—'}
    </p>
  </div>
);

const Loading = () => (
  <div className="flex justify-center py-8">
    <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
  </div>
);

const Empty: React.FC<{ icon: React.ElementType; text: string }> = ({ icon: Icon, text }) => (
  <div className="flex flex-col items-center py-10 text-slate-400">
    <Icon className="w-7 h-7 mb-2" />
    <p className="text-xs">{text}</p>
  </div>
);

/** STAGE_CHANGE -> "Stage Change" */
function formatAction(action: string): string {
  return action
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}
