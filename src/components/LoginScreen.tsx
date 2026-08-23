import React, { useState } from 'react';
import { Building2, AlertCircle, Loader2, LogIn } from 'lucide-react';

interface LoginScreenProps {
  error: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
}

const DEFAULT_DEMO_EMAIL = 'demo@talentflow.app';
const DEFAULT_DEMO_PASSWORD = 'TalentFlowDemo!';

export const LoginScreen: React.FC<LoginScreenProps> = ({ error, onLogin }) => {
  const [email, setEmail] = useState(DEFAULT_DEMO_EMAIL);
  const [password, setPassword] = useState(DEFAULT_DEMO_PASSWORD);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await onLogin(email, password);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Demo sign-in failed');
    } finally {
      setIsSubmitting(false);
    }
  };

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

          <form onSubmit={handleSubmit} className="p-7 space-y-4">
            {(error || submitError) && (
              <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <span>{submitError || error}</span>
              </div>
            )}

            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-800">
              Public portfolio demo — the credentials are prefilled and all records are synthetic.
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-600">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-600">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-sm py-2.5 rounded-lg transition-all shadow-2xs cursor-pointer"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              <span>{isSubmitting ? 'Signing in…' : 'Enter demo'}</span>
            </button>

            <p className="text-[11px] text-slate-400 text-center">
              Changes affect demo data only and may be reset at any time.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};
