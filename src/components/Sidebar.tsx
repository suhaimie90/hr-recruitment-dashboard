import React from 'react';
import { Kanban, Users, BarChart3, Calendar, Building2, LogOut, ShieldCheck, Eye } from 'lucide-react';
import { AppUser } from '../types';
import { initials } from '../lib/derive';

export type ActiveTab = 'pipeline' | 'candidates' | 'analytics' | 'interviews';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  user: AppUser;
  onLogout: () => void;
  totalApplicants: number;
  interviewCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  user,
  onLogout,
  totalApplicants,
  interviewCount
}) => {
  const canViewAnalytics = user.canViewAnalytics ?? /admin|manager/i.test(user.role);
  const navItems = [
    { id: 'pipeline', label: 'Pipeline Board', icon: Kanban, badge: totalApplicants },
    { id: 'candidates', label: 'All Applicants', icon: Users, badge: null },
    { id: 'interviews', label: 'Interview Schedule', icon: Calendar, badge: interviewCount || null },
    { id: 'analytics', label: 'Recruitment Analytics', icon: BarChart3, badge: null }
  ].filter((item) => item.id !== 'analytics' || canViewAnalytics);

  const isViewer = user.role.toLowerCase() === 'viewer';

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col h-screen border-r border-slate-800 shrink-0 select-none">
      <div className="p-5 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight text-white">SetiaHub</h1>
            <p className="text-xs text-slate-400">Talent Recruitment System </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Main Workspace
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as ActiveTab)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer ${
                isActive
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge != null && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    isActive ? 'bg-indigo-500/30 text-indigo-200' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}

        <div className="px-3 pt-5 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Data Source
        </div>
        <div className="px-3 py-2 text-[11px] text-slate-500 leading-relaxed">
          Applications sync live from the Google Sheet fed by the public careers form.
        </div>
      </nav>

      <div className="p-3 m-3 bg-slate-800/50 border border-slate-700/50 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-xs font-bold text-indigo-200 shrink-0">
            {initials(user.name)}
          </div>
          <div className="overflow-hidden flex-1">
            <p className="text-xs font-semibold text-slate-200 truncate">{user.name}</p>
            <p className="text-[11px] text-slate-400 truncate flex items-center gap-1">
              {isViewer ? <Eye className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
              {user.role}
            </p>
          </div>
          <button
            onClick={onLogout}
            title="Sign out"
            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {isViewer && (
          <p className="mt-2.5 pt-2.5 border-t border-slate-700/50 text-[10px] text-amber-300/80 leading-relaxed">
            Read-only access — stage changes and notes are disabled.
          </p>
        )}
      </div>
    </aside>
  );
};
