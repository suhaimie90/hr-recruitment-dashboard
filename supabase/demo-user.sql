-- Public portfolio demo user. Safe to re-run.
-- Authentication credentials live in Cloudflare environment variables;
-- this row supplies authorization, role, and branch scope only.

insert into public.users (
  email,
  name,
  role,
  allowed_branches,
  excluded_branches,
  allowed_positions,
  active
)
values (
  'demo@talentflow.app',
  'Demo Recruiter',
  'Admin',
  array['ALL'],
  array[]::text[],
  array['ALL'],
  true
)
on conflict (email) do update set
  name = excluded.name,
  role = excluded.role,
  allowed_branches = excluded.allowed_branches,
  excluded_branches = excluded.excluded_branches,
  allowed_positions = excluded.allowed_positions,
  active = true;
