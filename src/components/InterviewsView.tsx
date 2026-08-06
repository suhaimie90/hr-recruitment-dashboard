import React, { useState } from 'react';
import { Calendar, User, MapPin, XCircle, Loader2, Trash2 } from 'lucide-react';
import { Application, Interview } from '../types';
import { initials } from '../lib/derive';

interface InterviewsViewProps {
  interviews: Interview[];
  applications: Application[];
  canEdit: boolean;
  onCancel: (interview: Interview) => Promise<void>;
  onRemove: (interview: Interview) => Promise<void>;
}

function isCancelled(interview: Interview): boolean {
  return /cancel/i.test(interview.status || '');
}

export const InterviewsView: React.FC<InterviewsViewProps> = ({
  interviews,
  applications,
  canEdit,
  onCancel,
  onRemove
}) => {
  const now = Date.now();

  // Named lookup so rows still show a candidate even when the
  // Interviews sheet only stored an Application ID.
  const nameById = new Map(applications.map((app) => [app.applicationId, app.fullName]));

  const sorted = [...interviews].sort(
    (a, b) => parseTime(a.scheduledAt) - parseTime(b.scheduledAt)
  );

  // Cancelled rounds drop out of "upcoming" — they are not work any more.
  const upcoming = sorted.filter((i) => parseTime(i.scheduledAt) >= now && !isCancelled(i));
  const past = sorted.filter((i) => parseTime(i.scheduledAt) < now || isCancelled(i)).reverse();

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Interview Schedule</h2>
          <p className="text-xs text-slate-500">
            Every round booked from the applicant drawer.
          </p>
        </div>
        <div className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 flex items-center gap-1.5">
          <Calendar className="w-4 h-4" />
          <span>{upcoming.length} upcoming</span>
        </div>
      </div>

      <Section
        title="Upcoming"
        rows={upcoming}
        nameById={nameById}
        canEdit={canEdit}
        onCancel={onCancel}
        onRemove={onRemove}
        emptyText="No upcoming interviews scheduled."
      />

      {past.length > 0 && (
        <Section
          title="Past & Cancelled"
          rows={past}
          nameById={nameById}
          canEdit={canEdit}
          onCancel={onCancel}
          onRemove={onRemove}
          emptyText=""
          muted
          allowRemove
        />
      )}
    </div>
  );
};

const Section: React.FC<{
  title: string;
  rows: Interview[];
  nameById: Map<string, string>;
  canEdit: boolean;
  onCancel: (interview: Interview) => Promise<void>;
  onRemove: (interview: Interview) => Promise<void>;
  emptyText: string;
  muted?: boolean;
  allowRemove?: boolean;
}> = ({ title, rows, nameById, canEdit, onCancel, onRemove, emptyText, muted, allowRemove }) => {
  const [cancellingRow, setCancellingRow] = useState<number | null>(null);
  const [removingRow, setRemovingRow] = useState<number | null>(null);

  const handleCancel = async (interview: Interview) => {
    const candidate =
      interview.candidateName || nameById.get(interview.applicationId || '') || 'this candidate';

    if (!window.confirm(`Cancel the interview with ${candidate}?`)) return;

    setCancellingRow(interview.rowNumber ?? null);
    try {
      await onCancel(interview);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not cancel the interview');
    } finally {
      setCancellingRow(null);
    }
  };

  const handleRemove = async (interview: Interview) => {
    const candidate =
      interview.candidateName || nameById.get(interview.applicationId || '') || 'this candidate';
    if (!window.confirm(`Permanently remove this interview with ${candidate}? This cannot be undone.`)) return;

    setRemovingRow(interview.rowNumber ?? null);
    try {
      await onRemove(interview);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not remove the interview');
    } finally {
      setRemovingRow(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">{title}</h3>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-slate-400">{emptyText}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((interview, i) => {
            const candidate =
              interview.candidateName || nameById.get(interview.applicationId || '') || 'Unknown';
            const cancelled = isCancelled(interview);

            return (
              <div
                key={interview.rowNumber ?? i}
                className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  muted ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
                    {initials(candidate)}
                  </div>
                  <div>
                    <p
                      className={`font-bold text-sm text-slate-900 ${
                        cancelled ? 'line-through text-slate-400' : ''
                      }`}
                    >
                      {interview.title}
                    </p>
                    <p className="text-xs text-indigo-600 font-semibold">{candidate}</p>
                    <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1 flex-wrap">
                      <User className="w-3 h-3" />
                      {interview.interviewer}
                      {interview.type ? ` · ${interview.type}` : ''}
                    </p>
                    {/* Usually a physical location for face-to-face rounds. */}
                    {interview.meetingLink && (
                      <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate max-w-[280px]">{interview.meetingLink}</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {cancelled ? (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200">
                      Cancelled
                    </span>
                  ) : (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 text-slate-700">
                      {interview.scheduledAt}
                    </span>
                  )}

                  {canEdit && !cancelled && (
                    <button
                      onClick={() => handleCancel(interview)}
                      disabled={cancellingRow === interview.rowNumber}
                      title="Cancel this interview"
                      className="flex items-center gap-1.5 bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 disabled:opacity-50 font-semibold text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                    >
                      {cancellingRow === interview.rowNumber ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5" />
                      )}
                      Cancel
                    </button>
                  )}

                  {canEdit && allowRemove && (
                    <button
                      onClick={() => handleRemove(interview)}
                      disabled={removingRow === interview.rowNumber}
                      title="Permanently remove this interview"
                      className="flex items-center gap-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-600 disabled:opacity-50 font-semibold text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                    >
                      {removingRow === interview.rowNumber ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Sheet timestamps arrive as "2026-08-05 14:00" — Safari needs the T. */
function parseTime(value: string): number {
  const parsed = Date.parse(String(value).replace(' ', 'T'));
  return Number.isNaN(parsed) ? 0 : parsed;
}
