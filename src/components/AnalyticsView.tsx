import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  CartesianGrid,
  Legend
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { RecruitmentAnalytics } from '../types';

interface AnalyticsViewProps {
  analytics: RecruitmentAnalytics;
}

const COLORS = ['#6366f1', '#3b82f6', '#8b5cf6', '#a855f7', '#f59e0b', '#10b981', '#f43f5e'];

const TOOLTIP_STYLE = {
  backgroundColor: '#0f172a',
  borderRadius: '8px',
  border: 'none',
  color: '#fff',
  fontSize: '12px'
};

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ analytics }) => {
  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            Recruitment Analytics
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Computed live from the applications sheet — no cached or sample figures.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-lg text-center">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Applicants</span>
            <p className="text-lg font-extrabold text-indigo-700">{analytics.totalApplicants}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-lg text-center">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Hired</span>
            <p className="text-lg font-extrabold text-emerald-700">{analytics.hiredCount}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Pipeline Stage Distribution" subtitle="Current counts">
          <BarChart data={analytics.stageDistribution} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="stage" tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} />
          </BarChart>
        </Panel>

        <Panel title="Applications vs Hires" subtitle="Last 6 months">
          <AreaChart data={analytics.monthlyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorApps" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorHired" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Area type="monotone" dataKey="applications" stroke="#6366f1" fill="url(#colorApps)" strokeWidth={2} />
            <Area type="monotone" dataKey="hired" stroke="#10b981" fill="url(#colorHired)" strokeWidth={2} />
          </AreaChart>
        </Panel>

        <Panel title="Applicants by Branch" subtitle="Top 12 outlets">
          <BarChart
            layout="vertical"
            data={analytics.branchBreakdown}
            margin={{ top: 5, right: 20, left: 40, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="branch"
              tick={{ fontSize: 9, fill: '#64748b' }}
              width={140}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="count" fill="#3b82f6" radius={[0, 6, 6, 0]} />
          </BarChart>
        </Panel>

        <Panel title="Positions Applied" subtitle="Top 10">
          <PieChart>
            <Pie
              data={analytics.positionBreakdown}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={4}
              dataKey="count"
              nameKey="position"
            >
              {analytics.positionBreakdown.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend
              formatter={(value) => <span className="text-[11px] text-slate-700 font-medium">{value}</span>}
            />
          </PieChart>
        </Panel>
      </div>
    </div>
  );
};

const Panel: React.FC<{ title: string; subtitle: string; children: React.ReactElement }> = ({
  title,
  subtitle,
  children
}) => (
  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
    <div className="flex items-center justify-between mb-4">
      <h3 className="font-bold text-sm text-slate-900">{title}</h3>
      <span className="text-xs text-slate-400">{subtitle}</span>
    </div>
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  </div>
);
