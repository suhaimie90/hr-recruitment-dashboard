-- Run once in Supabase Dashboard -> SQL Editor before or with the
-- deployment that changes email lookups from ILIKE to exact equality.
-- The transaction aborts instead of merging users if two existing
-- accounts differ only by case or surrounding whitespace.

begin;

do $$
begin
  if exists (
    select 1
    from public.users
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'Cannot normalize users.email: duplicate addresses differ only by case or whitespace';
  end if;
end
$$;

update public.users
set email = lower(btrim(email))
where email is distinct from lower(btrim(email));

update public.applications
set email = lower(btrim(email))
where email is distinct from lower(btrim(email));

alter table public.users
  drop constraint if exists users_email_normalized;
alter table public.users
  add constraint users_email_normalized
  check (email = lower(btrim(email)));

alter table public.applications
  drop constraint if exists applications_email_normalized;
alter table public.applications
  add constraint applications_email_normalized
  check (email = lower(btrim(email)));

-- Exact email equality can use a normal column index. The previous
-- lower(email) expression index supported the old ILIKE lookup.
drop index if exists public.idx_applications_email;
create index idx_applications_email on public.applications (email);

commit;
