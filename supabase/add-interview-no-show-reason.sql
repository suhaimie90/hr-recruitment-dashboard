-- Add or reactivate the interview no-show rejection reason.
-- Safe to run more than once.

with reactivated as (
  update public.settings
  set
    value = 'Did Not Attend Scheduled Interview',
    active = true
  where lower(category) = lower('RejectionReason')
    and lower(value) = lower('Did Not Attend Scheduled Interview')
  returning id, category, value, active, sort_order
), inserted as (
  insert into public.settings (category, value, active, sort_order)
  select
    'RejectionReason',
    'Did Not Attend Scheduled Interview',
    true,
    coalesce((
      select max(sort_order)
      from public.settings
      where lower(category) = lower('RejectionReason')
    ), 0) + 1
  where not exists (select 1 from reactivated)
  returning id, category, value, active, sort_order
)
select * from reactivated
union all
select * from inserted;
