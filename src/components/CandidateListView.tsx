import React from 'react';
import { Star, FileText, ChevronRight } from 'lucide-react';
import { Application, ApplicationStage } from '../types';
import { initials, stageStyle } from '../lib/derive';

interface CandidateListViewProps {
  applications: Application[];
  stages: string[];
  canEdit: boolean;
  onSelectApplication: (app: Application) => void;
  onSelectResume: (app: Application) => void;
  onUpdateStage: (applicationId: string, stage: ApplicationStage) => void;
}

export const CandidateListView: React.FC<CandidateListViewProps> = ({
  applications,
  stages,
  canEdit,
  onSelectApplication,
  onSelectResume,
  onUpdateStage
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 uppercase text-[11px] font-bold tracking-wider">
              <th className="py-3 px-4">Applicant</th>
              <th className="py-3 px-4">Position</th>
              <th className="py-3 px-4">Branch</th>
              <th className="py-3 px-4">Stage</th>
              <th className="py-3 px-4">Exp.</th>
              <th className="py-3 px-4">Expected</th>
              <th className="py-3 px-4">Rating</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {applications.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400">
                  No applications match the current filters.
                </td>
              </tr>
            ) : (
              applications.map((app) => (
                <tr
                  key={app.applicationId}
                  className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                  onClick={() => onSelectApplication(app)}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[11px] font-bold text-indigo-700 shrink-0">
                        {initials(app.fullName)}
                      </div>
                      <div className="overflow-hidden">
                        <p className="font-semibold text-slate-900 truncate">{app.fullName}</p>
                        <p className="text-xs text-slate-400 truncate">{app.email}</p>
                      </div>
                    </div>
                  </td>

                  <td className="py-3 px-4 text-slate-700">{app.position || '—'}</td>

                  <td className="py-3 px-4 text-xs text-slate-600 max-w-[200px] truncate">
                    {app.preferredBranch || '—'}
                  </td>

                  <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={app.stage}
                      disabled={!canEdit}
                      onChange={(e) => onUpdateStage(app.applicationId, e.target.value)}
                      className={`text-[11px] font-bold px-2 py-1 rounded-lg border outline-none cursor-pointer disabled:cursor-not-allowed ${stageStyle(
                        app.stage
                      )}`}
                    >
                      {stages.map((stage) => (
                        <option key={stage} value={stage}>
                          {stage}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="py-3 px-4 text-slate-600 text-xs">{app.experience || '—'} yrs</td>

                  <td className="py-3 px-4 text-slate-700 text-xs font-semibold">
                    RM {app.expectedSalary || '—'}
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center gap-0.5 text-amber-400">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3 h-3 ${
                            i < app.rating ? 'fill-amber-400' : 'text-slate-200 fill-slate-100'
                          }`}
                        />
                      ))}
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {app.resumeUrl && (
                        <button
                          onClick={() => onSelectResume(app)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                          title="Preview resume"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => onSelectApplication(app)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                        title="Open profile"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
