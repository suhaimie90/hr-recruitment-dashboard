-- Run once in Supabase SQL Editor before deploying the Calendar-sync code.
-- Safe to re-run: IF NOT EXISTS leaves existing columns and data unchanged.

alter table public.interviews
  add column if not exists calendar_event_id text,
  add column if not exists calendar_event_url text,
  add column if not exists calendar_sync_status text not null default 'Pending',
  add column if not exists calendar_sync_error text;

comment on column public.interviews.calendar_sync_status is
  'Pending, Synced, Failed, or Cancelled. Supabase remains the source of truth.';
