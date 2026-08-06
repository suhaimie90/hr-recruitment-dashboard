import React, { useEffect, useState } from 'react';
import { X, ExternalLink, FileText, Download, Loader2 } from 'lucide-react';
import { Application } from '../types';
import { fetchApplication } from '../services/api';

interface ResumeViewerModalProps {
  application: Application | null;
  onClose: () => void;
}

export const ResumeViewerModal: React.FC<ResumeViewerModalProps> = ({ application, onClose }) => {
  // The list/board/drawer only ever hold the unresolved resume value —
  // a raw storage path, not a link (see toListRow in functions/api/data.ts).
  // Only apiApplication mints a signed URL, and only for one candidate at
  // a time, so it is fetched fresh here rather than trusted from the caller.
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const applicationId = application?.applicationId;

  useEffect(() => {
    if (!applicationId) {
      setResumeUrl(null);
      return;
    }

    let cancelled = false;
    setResumeUrl(null);
    setIsLoading(true);

    fetchApplication(applicationId)
      .then((detail) => {
        if (!cancelled) setResumeUrl(detail.resumeUrl || '');
      })
      .catch(() => {
        if (!cancelled) setResumeUrl('');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (!application) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-4xl w-full h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <FileText className="w-5 h-5 text-indigo-400 shrink-0" />
            <div className="overflow-hidden">
              <p className="font-bold text-sm truncate">{application.fullName}</p>
              <p className="text-xs text-slate-400 truncate">Resume</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {resumeUrl && (
              <a
                href={resumeUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Open Resume</span>
              </a>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 bg-slate-100">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-sm">Fetching resume link…</p>
            </div>
          ) : resumeUrl ? (
            <iframe
              src={resumeUrl}
              title={`${application.fullName} resume`}
              className="w-full h-full border-0"
              allow="autoplay"
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 p-8 text-center">
              <Download className="w-8 h-8" />
              <p className="text-sm">This resume can't be previewed inline.</p>
            </div>
          )}
        </div>

        <div className="px-6 py-2.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 shrink-0">
          Preview requires a valid resume link. If it stays blank, confirm the file exists in storage.
        </div>
      </div>
    </div>
  );
};
