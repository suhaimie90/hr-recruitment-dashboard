import React, { useState } from 'react';
import { Star, ClipboardCheck, Loader2, Send, ChevronDown } from 'lucide-react';
import { AssessmentCriterion, Scorecard } from '../types';

interface AssessmentPanelProps {
  /** Criteria to score, from Settings "AssessmentCriteria". */
  criteria: string[];
  scorecards: Scorecard[];
  canEdit: boolean;
  isLoading: boolean;
  onSubmit: (criteria: AssessmentCriterion[]) => Promise<void>;
}

/**
 * Structured scorecard shown while a candidate sits at the Assessment
 * stage. Append-only: each interviewer submits their own, so two people
 * can score the same candidate independently and neither overwrites the
 * other.
 */
export const AssessmentPanel: React.FC<AssessmentPanelProps> = ({
  criteria,
  scorecards,
  canEdit,
  isLoading,
  onSubmit
}) => {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(0);

  const scoredCount = criteria.filter((c) => scores[c] > 0).length;

  const handleSubmit = async () => {
    if (!scoredCount) return;

    setIsSubmitting(true);
    try {
      await onSubmit(
        criteria.map((criterion) => ({
          criterion,
          score: scores[criterion] || 0,
          comment: comments[criterion] || ''
        }))
      );
      setScores({});
      setComments({});
      setShowForm(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save assessment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
          <ClipboardCheck className="w-3.5 h-3.5" />
          Assessment
        </h4>
        {canEdit && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
          >
            + Add scorecard
          </button>
        )}
      </div>

      {/* Entry form */}
      {showForm && canEdit && (
        <div className="space-y-3 mb-4 pb-4 border-b border-slate-100">
          {criteria.map((criterion) => (
            <div key={criterion} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-xs font-semibold text-slate-700">{criterion}</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        setScores((prev) => ({
                          ...prev,
                          [criterion]: prev[criterion] === i + 1 ? 0 : i + 1
                        }))
                      }
                      className="cursor-pointer"
                      title={`${i + 1} of 5`}
                    >
                      <Star
                        className={`w-4 h-4 ${
                          i < (scores[criterion] || 0)
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-slate-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                value={comments[criterion] || ''}
                onChange={(e) =>
                  setComments((prev) => ({ ...prev, [criterion]: e.target.value }))
                }
                placeholder="Comment (optional)"
                rows={2}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded text-xs resize-y outline-none focus:border-indigo-500"
              />
            </div>
          ))}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !scoredCount}
              className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg cursor-pointer"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Submit scorecard
              {scoredCount > 0 && ` (${scoredCount}/${criteria.length})`}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Submitted scorecards */}
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
        </div>
      ) : scorecards.length === 0 ? (
        <p className="text-xs text-slate-400 py-2">
          {canEdit
            ? 'No assessment recorded yet.'
            : 'No assessment recorded yet. Your role is read-only.'}
        </p>
      ) : (
        <div className="space-y-2">
          {scorecards.map((card, i) => (
            <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === i ? null : i)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-left"
              >
                <div className="overflow-hidden">
                  <p className="text-xs font-bold text-slate-800 truncate">{card.assessor}</p>
                  <p className="text-[11px] text-slate-400">{card.assessedAt}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                    {card.average}/5
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      expanded === i ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </button>

              {expanded === i && (
                <div className="divide-y divide-slate-100">
                  {card.criteria.map((c, j) => (
                    <div key={j} className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-slate-700">{c.criterion}</span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {Array.from({ length: 5 }).map((_, k) => (
                            <Star
                              key={k}
                              className={`w-3 h-3 ${
                                k < c.score ? 'fill-amber-400 text-amber-400' : 'text-slate-200'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                      {c.comment && (
                        <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">
                          {c.comment}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
