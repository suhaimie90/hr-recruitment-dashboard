import React, { useEffect, useRef, useState } from 'react';
import { Bell, BriefcaseBusiness, MapPin } from 'lucide-react';
import { ApplicationNotification } from '../types';

interface NotificationCenterProps {
  notifications: ApplicationNotification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onOpenApplication: (notification: ApplicationNotification) => void;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  unreadCount,
  onMarkAllRead,
  onOpenApplication
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (next) onMarkAllRead();
      return next;
    });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        className={`relative p-2 rounded-lg border transition-colors cursor-pointer ${
          open
            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
            : 'bg-white border-slate-200 text-slate-500 hover:text-indigo-600 hover:bg-slate-50'
        }`}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] leading-4 font-bold text-center ring-2 ring-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[min(24rem,calc(100vw-2rem))] bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-900">Notifications</p>
              <p className="text-[11px] text-slate-500">New applications for your assigned scope</p>
            </div>
            <span className="text-[10px] font-semibold text-slate-400">Updated every minute</span>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length ? (
              notifications.map((notification) => (
                <button
                  key={notification.applicationId}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenApplication(notification);
                  }}
                  className="w-full px-4 py-3 text-left border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {notification.fullName}
                    </p>
                    <time className="text-[10px] text-slate-400 shrink-0">
                      {formatTime(notification.submittedAt)}
                    </time>
                  </div>
                  <div className="mt-1.5 flex flex-col gap-1 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <BriefcaseBusiness className="w-3 h-3 text-indigo-500" />
                      {notification.position || 'Position not specified'}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      {notification.preferredBranch || 'Branch not specified'}
                    </span>
                  </div>
                </button>
              ))
            ) : (
              <div className="px-6 py-10 text-center">
                <Bell className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-600">No new applications</p>
                <p className="text-[11px] text-slate-400 mt-1">You are all caught up.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
