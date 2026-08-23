import React from 'react';
import { Star, Clock, MapPin, FileText, Briefcase, X, Undo2 } from 'lucide-react';
import { Application, ApplicationStage } from '../types';
import { initials, stageStyle, buildBoardColumns, canMoveToStage, isDecidedStage } from '../lib/derive';

interface KanbanBoardProps {
  applications: Application[];
  stages: string[];
  canEdit: boolean;
  /** True when the board is showing archived rows, so the action restores. */
  showingArchived: boolean;
  onSelectApplication: (app: Application) => void;
  onSelectResume: (app: Application) => void;
  onUpdateStage: (applicationId: string, stage: ApplicationStage) => void;
  onArchive: (app: Application) => void;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  applications,
  stages,
  canEdit,
  showingArchived,
  onSelectApplication,
  onSelectResume,
  onUpdateStage,
  onArchive
}) => {
  const columns = buildBoardColumns(stages);

  return (
    <div className="flex gap-4 overflow-x-auto pb-6 pt-2 items-start min-h-[calc(100vh-220px)]">
      {columns.map((column) => {
        const stageApps = applications.filter((app) => column.stages.includes(app.stage));
        const isMerged = column.stages.length > 1;

        return (
          <div
            key={column.key}
            className="w-72 sm:w-80 shrink-0 bg-slate-100/80 rounded-xl border border-slate-200 p-3 flex flex-col max-h-[calc(100vh-210px)]"
          >
            <div className="flex items-center justify-between pb-3 px-1 border-b border-slate-200/80 mb-3">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full border-2 ${stageStyle(column.stages[0])}`} />
                <h3 className="font-bold text-sm tracking-tight text-slate-700">{column.title}</h3>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600 shadow-2xs">
                {stageApps.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {stageApps.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
                  No applicants in {column.title}
                </div>
              ) : (
                stageApps.map((app) => (
                  <div
                    key={app.applicationId}
                    className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs hover:shadow-md hover:border-indigo-300 transition-all duration-200 cursor-pointer group"
                    onClick={() => onSelectApplication(app)}
                  >
                    <div className="flex items-start gap-2.5 mb-2.5">
                      <div className="w-9 h-9 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
                        {initials(app.fullName)}
                      </div>
                      <div className="overflow-hidden flex-1">
                        <h4 className="font-bold text-sm text-slate-900 truncate group-hover:text-indigo-600 transition-colors">
                          {app.fullName}
                        </h4>
                        <p className="text-[11px] text-slate-400 truncate font-mono">
                          {app.applicationId}
                        </p>
                      </div>

                      {/* In the merged column the stage IS the outcome, so
                          show it — otherwise the column header says it. */}
                      {isMerged && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${stageStyle(
                            app.stage
                          )}`}
                        >
                          {app.stage}
                        </span>
                      )}

                      {canEdit && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onArchive(app);
                          }}
                          title={
                            showingArchived
                              ? 'Put back on the board'
                              : 'Remove from the board (demo record retained)'
                          }
                          className="p-1 -mt-1 -mr-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer shrink-0"
                        >
                          {showingArchived ? (
                            <Undo2 className="w-3.5 h-3.5" />
                          ) : (
                            <X className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>

                    <div className="space-y-1 mb-3 text-xs text-slate-600">
                      <div className="flex items-center gap-1 text-slate-700 font-medium truncate">
                        <Briefcase className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{app.position || '—'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-500 truncate">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{app.preferredBranch || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400 text-[11px] pt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {app.experience || '0'} yrs exp
                        </span>
                        <span className="font-semibold text-slate-500">
                          RM {app.expectedSalary || '—'}
                        </span>
                      </div>
                    </div>

                    {app.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {app.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] font-medium bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
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

                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {app.resumeUrl && (
                          <button
                            onClick={() => onSelectResume(app)}
                            className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            title="Preview resume"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <select
                          value={app.stage}
                          disabled={!canEdit || isDecidedStage(app.stage)}
                          onChange={(e) => onUpdateStage(app.applicationId, e.target.value)}
                          className="text-[10px] font-bold bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200 outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          title={
                            !canEdit
                              ? 'Read-only access'
                              : isDecidedStage(app.stage)
                                ? `${app.stage} is final — correct it in the demo database`
                                : 'Move forward to another stage'
                          }
                        >
                          {stages.map((s) => (
                            <option
                              key={s}
                              value={s}
                              disabled={s !== app.stage && !canMoveToStage(stages, app.stage, s)}
                            >
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
