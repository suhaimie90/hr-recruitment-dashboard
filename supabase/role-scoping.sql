-- Run once in Supabase Dashboard -> SQL Editor before deploying the
-- role-scoping code. Edit the example assignments to match your staff.

alter table public.users
  add column if not exists allowed_positions text[];

-- Optional final-deny list. An empty list excludes nothing. A branch in
-- this list is hidden even when allowed_branches contains 'ALL'.
alter table public.users
  add column if not exists excluded_branches text[] not null default '{}';

-- Admin keeps unrestricted access.
update public.users
set allowed_positions = array['ALL']
where lower(role) = 'admin';

-- Current assignments mirrored from migration-data/users.csv.
update public.users
set role = 'Area Manager',
    allowed_branches = array[
      'SETIAHUB (KOTA BHARU)',
      'SETIAHUB (MACHANG)',
      'SETIAHUB (TUMPAT)'
    ],
    allowed_positions = array['ALL']
where lower(email) = 'tester1@gmail.com';

update public.users
set role = 'Supervisor',
    allowed_branches = array['SETIAHUB (KOTA BHARU)'],
    allowed_positions = array['Cashier', 'Sales assistant']
where lower(email) = 'tester2@gmail.com';

-- A Senior Manager is global. Replace this example email with the real
-- account before running it, or execute the statement separately later:
-- update public.users
-- set role = 'Senior Manager',
--     allowed_branches = array['ALL'],
--     allowed_positions = array['ALL']
-- where lower(email) = 'senior.manager@company.com';

-- Example: a Manager can access every outlet except HQ. Dashboard
-- statistics use the same server-scoped applications, so HQ is also
-- excluded from that manager's metric cards and analytics charts.
-- update public.users
-- set role = 'Manager',
--     allowed_branches = array['ALL'],
--     excluded_branches = array['HQ - Jenjarom'],
--     allowed_positions = array['ALL']
-- where lower(email) = 'manager@company.com';

-- An Area Manager or Supervisor with NULL/empty allowed_positions sees no
-- applications until positions are explicitly assigned. Example:
-- update public.users
-- set allowed_positions = array['Cashier', 'Sales assistant']
-- where lower(email) = 'manager@company.com';

-- Existing Viewer sample retains its previous ALL access, but remains
-- read-only. Remove this assignment if that viewer should be scoped.
update public.users
set allowed_branches = array['ALL'],
    allowed_positions = array['ALL']
where lower(email) = 'tester3@gmail.com';
