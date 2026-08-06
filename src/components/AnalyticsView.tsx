import React, { useRef, useState } from 'react';
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
import { BarChart3, Download, ImageDown, Loader2 } from 'lucide-react';
import { Application, RecruitmentAnalytics } from '../types';
import { downloadCsv, downloadDashboardAsPng, today } from '../lib/export';

interface AnalyticsViewProps {
  analytics: RecruitmentAnalytics;
  /** The filtered rows behind these charts, for the raw-data export. */
  applications: Application[];
}

const COLORS = ['#6366f1', '#3b82f6', '#8b5cf6', '#a855f7', '#f59e0b', '#10b981', '#f43f5e'];

const TOOLTIP_STYLE = {
  backgroundColor: '#0f172a',
  borderRadius: '8px',
  border: 'none',
  color: '#fff',
  fontSize: '12px'
};

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ analytics, applications }) => {
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [isExportingImage, setIsExportingImage] = useState(false);

  const exportDashboardImage = async () => {
    if (!dashboardRef.current) return;
    setIsExportingImage(true);
    try {
      await downloadDashboardAsPng(
        dashboardRef.current,
        `recruitment-dashboard-${today()}.png`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not export the dashboard');
    } finally {
      setIsExportingImage(false);
    }
  };
  /**
   * Exports every chart's numbers as one CSV. Sections are separated by
   * blank rows so Excel shows four readable tables in a single sheet.
   */
  const exportSummary = () => {
    const rows: (string | number)[][] = [
      ['SETIAHUB Recruitment Analytics'],
      ['Generated', new Date().toLocaleString()],
      ['Applications included', analytics.totalApplicants],
      ['Note', 'Reflects the filters active when exported'],
      [],
      ['Summary'],
      ['Total applications', analytics.totalApplicants],
      ['In progress', analytics.activeStages],
      ['Hired', analytics.hiredCount],
      ['Average rating', analytics.avgRating || ''],
      [],
      ['Pipeline stage distribution'],
      ['Stage', 'Count'],
      ...analytics.stageDistribution.map((s) => [s.stage, s.count]),
      [],
      ['Applications vs hires by month'],
      ['Month', 'Applications', 'Hired'],
      ...analytics.monthlyTrend.map((m) => [m.month, m.applications, m.hired]),
      [],
      ['Applicants by branch'],
      ['Branch', 'Count'],
      ...analytics.branchBreakdown.map((b) => [b.branch, b.count]),
      [],
      ['Positions applied'],
      ['Position', 'Count'],
      ...analytics.positionBreakdown.map((p) => [p.position, p.count]),
      [],
      ['Willingness to relocate'],
      ['Answer', 'Count'],
      ...analytics.relocationSplit.map((r) => [r.answer, r.count])
    ];

    downloadCsv(`recruitment-analytics-${today()}.csv`, rows);
  };

  /** The underlying applicant rows, minus IC numbers. */
  const exportApplicants = () => {
    const header = [
      'Application ID',
      'Applied On',
      'Full Name',
      'Email',
      'Phone',
      'City',
      'State',
      'Position',
      'Preferred Branch',
      'Preferred State',
      'Experience',
      'Expected Salary',
      'Available From',
      'Relocation',
      'Stage',
      'Rating',
      'Resume Link'
    ];

    const rows = applications.map((a) => [
      a.applicationId,
      a.timestamp,
      a.fullName,
      a.email,
      a.phone,
      a.city,
      a.state,
      a.position,
      a.preferredBranch,
      a.preferredState,
      a.experience,
      a.expectedSalary,
      a.availableDate,
      a.relocation,
      a.stage,
      a.rating || '',
      a.resumeUrl
    ]);

    downloadCsv(`applicants-${today()}.csv`, [header, ...rows]);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            Recruitment Analytics
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Computed live from the applications sheet — reflects the filters you have applied.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={exportDashboardImage}
            disabled={isExportingImage}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold px-3 py-2 rounded-lg cursor-pointer transition-colors"
            title="Download all charts together as one PNG"
          >
            {isExportingImage ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ImageDown className="w-3.5 h-3.5" />
            )}
            Dashboard (PNG)
          </button>
          <button
            onClick={exportSummary}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-2 rounded-lg cursor-pointer transition-colors"
            title="Download every chart's numbers as a CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Statistics (CSV)
          </button>
          <button
            onClick={exportApplicants}
            className="flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg cursor-pointer transition-colors"
            title="Download the applicant rows behind these charts"
          >
            <Download className="w-3.5 h-3.5" />
            Applicants ({applications.length})
          </button>
        </div>
      </div>

      <div ref={dashboardRef} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
            <YAxis type="category" dataKey="branch" tick={{ fontSize: 9, fill: '#64748b' }} width={140} />
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

const Panel: React.FC<{
  title: string;
  subtitle: string;
  children: React.ReactElement;
}> = ({ title, subtitle, children }) => {
  return (
    <div
      data-chart-panel
      data-title={title}
      data-subtitle={subtitle}
      className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs"
    >
      <div className="flex items-center justify-between mb-4 gap-3">
        <h3 className="font-bold text-sm text-slate-900">{title}</h3>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-400 hidden sm:inline">{subtitle}</span>
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
