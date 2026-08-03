import React from 'react';
import { X, ExternalLink, FileText, Download } from 'lucide-react';
import { Application } from '../types';

interface ResumeViewerModalProps {
  application: Application | null;
  onClose: () => void;
}

/** Google Drive file URLs -> the embeddable preview endpoint. */
function toPreviewUrl(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? `https://drive.google.com/file/d/${match[1]}/preview` : null;
}

export const ResumeViewerModal: React.FC<ResumeViewerModalProps> = ({ application, onClose }) => {
  if (!application) return null;

  const previewUrl = toPreviewUrl(application.resumeUrl);

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-4xl w-full h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <FileText className="w-5 h-5 text-indigo-400 shrink-0" />
            <div className="overflow-hidden">
              <p className="font-bold text-sm truncate">{application.fullName}</p>
              {/* resumeFileName is detail-only now; the URL is enough here. */}
              <p className="text-xs text-slate-400 truncate">Resume</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={application.resumeUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Open in Drive</span>
            </a>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 bg-slate-100">
          {previewUrl ? (
            <iframe
              src={previewUrl}
              title={`${application.fullName} resume`}
              className="w-full h-full border-0"
              allow="autoplay"
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 p-8 text-center">
              <Download className="w-8 h-8" />
              <p className="text-sm">This resume can't be previewed inline.</p>
              <a
                href={application.resumeUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                Open it in Google Drive instead →
              </a>
            </div>
          )}
        </div>

        <div className="px-6 py-2.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 shrink-0">
          Preview requires Drive access. If it stays blank, confirm the file's sharing permissions.
        </div>
      </div>
    </div>
  );
};
