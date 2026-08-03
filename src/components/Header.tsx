import React, { useMemo } from 'react';
import { Search, MapPin, Briefcase, RefreshCw, SlidersHorizontal, CalendarDays, X } from 'lucide-react';
import { Application, FilterState } from '../types';
import { uniqueValues } from '../lib/derive';

interface HeaderProps {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  applications: Application[];
  onRefresh: () => void;
  isLoading: boolean;
  totalFilteredCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  filters,
  setFilters,
  applications,
  onRefresh,
  isLoading,
  totalFilteredCount
}) => {
  // Filter options come from the data itself, so a new branch or a
  // typed-in position appears here without a code change.
  const branches = useMemo(() => uniqueValues(applications, 'preferredBranch'), [applications]);
  const positions = useMemo(() => uniqueValues(applications, 'position'), [applications]);

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20 shadow-xs">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Compact search — still matches name, email, phone, IC and ID */}
          <div className="relative w-52">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search"
              title="Search name, email, phone, IC or application ID"
              value={filters.searchQuery}
              onChange={(e) => setFilters((prev) => ({ ...prev, searchQuery: e.target.value }))}
              className="w-full pl-9 pr-7 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
            {filters.searchQuery && (
              <button
                onClick={() => setFilters((prev) => ({ ...prev, searchQuery: '' }))}
                title="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Applied-date range */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700">
            <CalendarDays className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              type="date"
              value={filters.dateFrom}
              max={filters.dateTo || undefined}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
              title="Applied from"
              className="bg-transparent font-semibold text-slate-800 outline-none cursor-pointer"
            />
            <span className="text-slate-400">–</span>
            <input
              type="date"
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
              title="Applied to"
              className="bg-transparent font-semibold text-slate-800 outline-none cursor-pointer"
            />
            {(filters.dateFrom || filters.dateTo) && (
              <button
                onClick={() => setFilters((prev) => ({ ...prev, dateFrom: '', dateTo: '' }))}
                title="Clear dates"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700">
            <MapPin className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-medium text-slate-500 hidden sm:inline">Branch:</span>
            <select
              value={filters.branch}
              onChange={(e) => setFilters((prev) => ({ ...prev, branch: e.target.value }))}
              className="bg-transparent font-semibold text-slate-800 outline-none cursor-pointer pr-1 max-w-[190px]"
            >
              <option value="ALL">All Branches ({branches.length})</option>
              {branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700">
            <Briefcase className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-medium text-slate-500 hidden sm:inline">Position:</span>
            <select
              value={filters.position}
              onChange={(e) => setFilters((prev) => ({ ...prev, position: e.target.value }))}
              className="bg-transparent font-semibold text-slate-800 outline-none cursor-pointer pr-1 max-w-[160px]"
            >
              <option value="ALL">All Positions</option>
              {positions.map((position) => (
                <option key={position} value={position}>
                  {position}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-medium text-slate-500 hidden sm:inline">Sort:</span>
            <select
              value={filters.sortBy}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, sortBy: e.target.value as FilterState['sortBy'] }))
              }
              className="bg-transparent font-semibold text-slate-800 outline-none cursor-pointer pr-1"
            >
              <option value="timestamp">Date Applied</option>
              <option value="fullName">Name</option>
              <option value="rating">Rating</option>
              <option value="experience">Experience</option>
              <option value="expectedSalary">Expected Salary</option>
            </select>
          </div>

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors cursor-pointer"
            title="Reload from Google Sheets"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-600' : ''}`} />
          </button>

          <div className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <span>{totalFilteredCount} Applicants</span>
          </div>
        </div>
      </div>
    </header>
  );
};
