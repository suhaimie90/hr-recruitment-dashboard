import React from 'react';
import { Calendar, Video, User } from 'lucide-react';
import { Application, Interview } from '../types';
import { initials } from '../lib/derive';

interface InterviewsViewProps {
  interviews: Interview[];
  applications: Application[];
}

export const InterviewsView: React.FC<InterviewsViewProps> = ({ interviews, applications }) => {
  const now = Date.now();

  // Named lookup so rows still show a candidate even when the
  // Interviews sheet only stored an Application ID.
  const nameById = new Map(applications.map((app) => [app.applicationId, app.fullName]));

  const sorted = [...interviews].sort(
    (a, b) => parseTime(a.scheduledAt) - parseTime(b.scheduledAt)
  );

  const upcoming = sorted.filter((i) => parseTime(i.scheduledAt) >= now);
  const past = sorted.filter((i) => parseTime(i.scheduledAt) < now).reverse();

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Interview Schedule</h2>
          <p className="text-xs text-slate-500">
            Every round booked from the applicant drawer, newest first.
          </p>
        </div>
        <div className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 flex items-center gap-1.5">
          <Calendar className="w-4 h-4" />
          <span>{upcoming.length} upcoming</span>
        </div>
      </div>

      <Section title="Upcoming" rows={upcoming} nameById={nameById} emptyText="No upcoming interviews scheduled." />

      {past.length > 0 && (
        <Section title="Past" rows={past} nameById={nameById} emptyText="" muted />
      )}
    </div>
  );
};

const Section: React.FC<{
  title: string;
  rows: Interview[];
  nameById: Map<string, string>;
  emptyText: string;
  muted?: boolean;
}> = ({ title, rows, nameById, emptyText, muted }) => (
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

          return (
            <div
              key={i}
              className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                muted ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
                  {initials(candidate)}
                </div>
                <div>
                  <p className="font-bold text-sm text-slate-900">{interview.title}</p>
                  <p className="text-xs text-indigo-600 font-semibold">{candidate}</p>
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {interview.interviewer}
                    {interview.type ? ` · ${interview.type}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 text-slate-700">
                  {interview.scheduledAt}
                </span>
                {interview.meetingLink && (
                  <a
                    href={interview.meetingLink}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Video className="w-3.5 h-3.5" />
                    Join
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

/** Sheet timestamps arrive as "2026-08-05 14:00" — Safari needs the T. */
function parseTime(value: string): number {
  const parsed = Date.parse(String(value).replace(' ', 'T'));
  return Number.isNaN(parsed) ? 0 : parsed;
}
