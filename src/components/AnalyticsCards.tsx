import React from 'react';
import { Users, Activity, CheckCircle2, Star } from 'lucide-react';
import { RecruitmentAnalytics } from '../types';

interface AnalyticsCardsProps {
  analytics: RecruitmentAnalytics;
}

export const AnalyticsCards: React.FC<AnalyticsCardsProps> = ({ analytics }) => {
  const cards = [
    {
      title: 'Total Applications',
      value: analytics.totalApplicants,
      icon: Users,
      iconBg: 'bg-blue-50 text-blue-600'
    },
    {
      title: 'In Progress',
      value: analytics.activeStages,
      icon: Activity,
      iconBg: 'bg-indigo-50 text-indigo-600'
    },
    {
      title: 'Hired',
      value: analytics.hiredCount,
      icon: CheckCircle2,
      iconBg: 'bg-emerald-50 text-emerald-600'
    },
    {
      title: 'Average Rating',
      value: analytics.avgRating ? `${analytics.avgRating}/5` : '—',
      icon: Star,
      iconBg: 'bg-amber-50 text-amber-600'
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.title}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-start justify-between gap-3"
          >
            <div className="overflow-hidden">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide truncate">
                {card.title}
              </p>
              <p className="text-2xl font-extrabold text-slate-900 mt-1">{card.value}</p>
            </div>
            <div className={`p-2.5 rounded-xl shrink-0 ${card.iconBg}`}>
              <Icon className="w-5 h-5" />
            </div>
          </div>
        );
      })}
    </div>
  );
};
