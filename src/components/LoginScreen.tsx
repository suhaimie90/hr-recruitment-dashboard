import React from 'react';
import { Building2, AlertCircle } from 'lucide-react';

interface LoginScreenProps {
  error: string | null;
}

/** Google's four-color "G", inline so this needs no external asset. */
const GoogleIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v2.98h3.86c2.26-2.08 3.56-5.14 3.56-8.8z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.92l-3.86-2.98c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29A11.96 11.96 0 000 12c0 1.93.46 3.76 1.29 5.38l3.98-3.09z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
    />
  </svg>
);

export const LoginScreen: React.FC<LoginScreenProps> = ({ error }) => {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-slate-900 px-7 py-8 text-center">
            <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-3">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-lg font-bold text-white tracking-tight">SetiaHub</h1>
            <p className="text-xs text-slate-400 mt-0.5">SetiaHub Recruitment System</p>
          </div>

          <div className="p-7 space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <span>{error}</span>
              </div>
            )}

            <a
              href="/api/auth/login"
              className="w-full flex items-center justify-center gap-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold text-sm py-2.5 rounded-lg transition-all shadow-2xs cursor-pointer"
            >
              <GoogleIcon />
              <span>Sign in with Google</span>
            </a>

            <p className="text-[11px] text-slate-400 text-center">
              Contact MIS to be registered for first-time access.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
