-- =============================================================================
-- PEOPLE, OUTCOMES AND FUNDER PORTALS
--
-- Run after 009_fundraising_goals.sql.
--
-- What this does:
--   1. Adds people: the people an organization serves (participants or
--      clients), each with a private access_token for personal form links.
--   2. Links form responses to people. A personal link carries the person's
--      token (/forms/<id>/submit?p=<token>); a trigger swaps it for the
--      person's id and never stores the token. Nobody can attach a response
--      to someone without their link.
--   3. Outcomes: number and dropdown questions marked as outcomes in the
--      form builder are compared between each person's first and latest
--      check-in. outcome_summary() does the math once, for both the Reports
--      page and funder portals.
--   4. Funder portals: funder_shares holds private share links. Anyone with
--      a link sees a live, read-only report through get_funder_report(),
--      which returns totals and outcomes only: never names, contact details
--      or individual answers. Owners and admins create and turn off links.
--
-- Dates in outcome and funder figures use UTC days, so a response submitted
-- late in the evening (US time) can count toward the next day.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- 64 random hex characters (two random UUIDs), for links that can't be guessed.
create or replace function public.random_token()
returns text
language sql volatile
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

-- -----------------------------------------------------------------------------
-- 1. People
-- -----------------------------------------------------------------------------

create table if not exists public.people (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name       text not null check (length(trim(full_name)) between 1 and 150),
  email           text,
  phone           text,
  program         text,
  status          text not null default 'active' check (status in ('active', 'completed', 'inactive')),
  start_date      date not null default current_date,
  notes           text,
  -- Secret part of the person's form links. Changing it turns old links off.
  access_token    text not null unique default public.random_token(),
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists people_organization_id_idx on public.people (organization_id);

drop trigger if exists set_organization_id on public.people;
create trigger set_organization_id before insert on public.people
  for each row execute function public.set_organization_id();

alter table public.people enable row level security;

drop policy if exists "Members can view" on public.people;
create policy "Members can view" on public.people for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists "Editors can add" on public.people;
create policy "Editors can add" on public.people for insert to authenticated
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

drop policy if exists "Editors can change" on public.people;
create policy "Editors can change" on public.people for update to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data())
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

drop policy if exists "Editors can delete" on public.people;
create policy "Editors can delete" on public.people for delete to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data());

-- -----------------------------------------------------------------------------
-- 2. Responses linked to people
--
-- person_token is write-only: the trigger reads it, sets person_id, and
-- clears it before the row is saved. person_id itself can only be set this
-- way, so a tampered request can't attach a response to someone else.
-- -----------------------------------------------------------------------------

alter table public.form_submissions add column if not exists person_id uuid references public.people(id) on delete set null;
alter table public.form_submissions add column if not exists person_token text;
create index if not exists form_submissions_person_id_idx on public.form_submissions (person_id) where person_id is not null;

create or replace function public.link_submission_to_person()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.person_id := null;
  if new.person_token is not null and length(new.person_token) between 32 and 128 then
    select p.id into new.person_id
    from people p
    join forms f on f.id = new.form_id and f.organization_id = p.organization_id
    where p.access_token = new.person_token;
  end if;
  new.person_token := null;
  return new;
end
$$;

drop trigger if exists link_submission_to_person on public.form_submissions;
create trigger link_submission_to_person before insert on public.form_submissions
  for each row execute function public.link_submission_to_person();

-- -----------------------------------------------------------------------------
-- 3. Outcomes
--
-- An outcome question is a form field with an "outcome" key, set in the
-- form builder: {"betterWhen": "higher" | "lower"}.
--   number fields:   the answer itself is the score
--   dropdown fields: the option's position is the score (first option = 1)
--
-- For each outcome question it reports, for people with a check-in between
-- p_from and p_to (null = open-ended): how many were measured, how many
-- more than once, the average first and latest scores (first check-in ever
-- vs. latest one up to p_to), how many improved, stayed the same or got
-- worse, and the average score per month.
-- -----------------------------------------------------------------------------

create or replace function public.outcome_summary(p_org uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with outcome_fields as (
    select f.id as form_id, f.title as form_title,
           fld ->> 'id' as field_id,
           coalesce(nullif(fld ->> 'label', ''), 'Untitled question') as label,
           fld ->> 'type' as field_type,
           coalesce(fld -> 'outcome' ->> 'betterWhen', 'higher') as better_when,
           coalesce(fld -> 'options', '[]'::jsonb) as options,
           ord
    from forms f, jsonb_array_elements(f.fields) with ordinality as e(fld, ord)
    where f.organization_id = p_org
      and not f.is_sample
      and jsonb_typeof(fld -> 'outcome') = 'object'
      and fld ->> 'type' in ('number', 'select')
  ),
  scores as (
    select o.form_id, o.field_id, s.person_id, s.submitted_at,
           case
             when o.field_type = 'number' and (s.data ->> o.field_id) ~ '^-?[0-9]+(\.[0-9]+)?$'
               then (s.data ->> o.field_id)::numeric
             when o.field_type = 'select'
               then (select opt.n::numeric
                     from jsonb_array_elements_text(o.options) with ordinality as opt(v, n)
                     where opt.v = s.data ->> o.field_id
                     limit 1)
           end as score
    from outcome_fields o
    join form_submissions s on s.form_id = o.form_id
    where s.person_id is not null
      and (p_to is null or s.submitted_at::date <= p_to)
  ),
  valid as (
    select * from scores where score is not null
  ),
  per_person as (
    select form_id, field_id, person_id,
           count(*) as checkins,
           (array_agg(score order by submitted_at))[1] as first_score,
           (array_agg(score order by submitted_at desc))[1] as latest_score,
           max(submitted_at)::date as latest_date
    from valid
    group by form_id, field_id, person_id
  ),
  in_period as (
    select * from per_person where p_from is null or latest_date >= p_from
  ),
  trend as (
    select form_id, field_id,
           jsonb_agg(jsonb_build_object('month', month, 'average', round(avg_score, 2)) order by month) as points
    from (
      select form_id, field_id, to_char(submitted_at, 'YYYY-MM') as month, avg(score) as avg_score
      from valid
      where p_from is null or submitted_at::date >= p_from
      group by form_id, field_id, to_char(submitted_at, 'YYYY-MM')
    ) m
    group by form_id, field_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'form_id', o.form_id,
           'form_title', o.form_title,
           'field_id', o.field_id,
           'label', o.label,
           'kind', case when o.field_type = 'number' then 'number' else 'scale' end,
           'better_when', o.better_when,
           'options', case when o.field_type = 'select' then o.options else '[]'::jsonb end,
           'people_measured', coalesce(st.measured, 0),
           'people_with_followup', coalesce(st.followup, 0),
           'average_first', st.avg_first,
           'average_latest', st.avg_latest,
           'improved', coalesce(st.improved, 0),
           'same', coalesce(st.same, 0),
           'worse', coalesce(st.worse, 0),
           'trend', coalesce(t.points, '[]'::jsonb)
         ) order by o.form_title, o.ord), '[]'::jsonb)
  from outcome_fields o
  left join lateral (
    select count(*) as measured,
           count(*) filter (where p.checkins > 1) as followup,
           round(avg(p.first_score) filter (where p.checkins > 1), 2) as avg_first,
           round(avg(p.latest_score) filter (where p.checkins > 1), 2) as avg_latest,
           count(*) filter (where p.checkins > 1 and case when o.better_when = 'lower' then p.latest_score < p.first_score else p.latest_score > p.first_score end) as improved,
           count(*) filter (where p.checkins > 1 and p.latest_score = p.first_score) as same,
           count(*) filter (where p.checkins > 1 and case when o.better_when = 'lower' then p.latest_score > p.first_score else p.latest_score < p.first_score end) as worse
    from in_period p
    where p.form_id = o.form_id and p.field_id = o.field_id
  ) st on true
  left join trend t on t.form_id = o.form_id and t.field_id = o.field_id
$$;

-- Internal: only get_outcome_summary and get_funder_report call it.
revoke execute on function public.outcome_summary(uuid, date, date) from public, anon, authenticated;

-- The Reports page's version, for the signed-in member's own organization.
create or replace function public.get_outcome_summary(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.current_org_id() is null then
    raise exception 'You need to belong to an organization to see outcomes.';
  end if;
  return public.outcome_summary(public.current_org_id(), p_from, p_to);
end
$$;

revoke execute on function public.get_outcome_summary(date, date) from public, anon;
grant execute on function public.get_outcome_summary(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Funder portals
-- -----------------------------------------------------------------------------

create table if not exists public.funder_shares (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Shown to the funder, e.g. "United Way 2026 grant report".
  name            text not null check (length(trim(name)) between 1 and 150),
  -- Optional note shown at the top of the report.
  message         text check (message is null or length(message) <= 2000),
  sections        text[] not null default array['impact', 'donations', 'volunteers', 'forms', 'goals', 'outcomes'],
  period          text not null default 'this_year' check (period in ('this_year', 'last_year', 'last_12_months', 'all', 'custom')),
  date_from       date,
  date_to         date,
  token           text not null unique default public.random_token(),
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  last_viewed_at  timestamptz,
  view_count      integer not null default 0,
  check (sections <@ array['impact', 'donations', 'volunteers', 'forms', 'goals', 'outcomes']),
  check (period <> 'custom' or (date_from is not null and date_to is not null and date_to >= date_from))
);

create index if not exists funder_shares_organization_id_idx on public.funder_shares (organization_id);

drop trigger if exists set_organization_id on public.funder_shares;
create trigger set_organization_id before insert on public.funder_shares
  for each row execute function public.set_organization_id();

alter table public.funder_shares enable row level security;

drop policy if exists "Members can view" on public.funder_shares;
create policy "Members can view" on public.funder_shares for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists "Admins can add" on public.funder_shares;
create policy "Admins can add" on public.funder_shares for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_org_admin());

drop policy if exists "Admins can change" on public.funder_shares;
create policy "Admins can change" on public.funder_shares for update to authenticated
  using (organization_id = public.current_org_id() and public.is_org_admin())
  with check (organization_id = public.current_org_id() and public.is_org_admin());

drop policy if exists "Admins can delete" on public.funder_shares;
create policy "Admins can delete" on public.funder_shares for delete to authenticated
  using (organization_id = public.current_org_id() and public.is_org_admin());

/**
 * The live report behind a funder link, or null if the link is unknown or
 * turned off. Totals, trends and outcomes only. Sample records are left out.
 *
 * Period and the one it's compared with:
 *   this_year       Jan 1 to today, vs. the same dates last year
 *   last_year       all of last year, vs. the year before
 *   last_12_months  the last 12 months, vs. the 12 before
 *   custom          the share's dates, vs. the same number of days before
 *   all             everything, no comparison
 */
create or replace function public.get_funder_report(p_token text)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  s         funder_shares;
  org       organizations;
  brand     organization_settings;
  v_from    date;
  v_to      date;
  p_from    date;
  p_to      date;
  totals    jsonb;
  prev      jsonb;
  result    jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  select * into s from funder_shares where token = p_token and revoked_at is null;
  if not found then
    return null;
  end if;
  select * into org from organizations where id = s.organization_id;
  select * into brand from organization_settings where organization_id = s.organization_id;

  case s.period
    when 'this_year' then
      v_from := date_trunc('year', current_date)::date; v_to := current_date;
      p_from := (v_from - interval '1 year')::date;     p_to := (v_to - interval '1 year')::date;
    when 'last_year' then
      v_from := (date_trunc('year', current_date) - interval '1 year')::date; v_to := (date_trunc('year', current_date) - interval '1 day')::date;
      p_from := (v_from - interval '1 year')::date; p_to := (v_to - interval '1 year')::date;
    when 'last_12_months' then
      v_from := (current_date - interval '12 months' + interval '1 day')::date; v_to := current_date;
      p_from := (v_from - interval '12 months')::date; p_to := v_from - 1;
    when 'custom' then
      v_from := s.date_from; v_to := s.date_to;
      p_to := v_from - 1; p_from := p_to - (v_to - v_from);
    else
      v_from := null; v_to := current_date; p_from := null; p_to := null;
  end case;

  update funder_shares set last_viewed_at = now(), view_count = view_count + 1 where id = s.id;

  -- Headline numbers for a period (null bounds = open).
  select jsonb_build_object(
           'raised',     coalesce((select sum(amount) from donations where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to), 0),
           'gifts',      (select count(*) from donations where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to),
           'donors',     (select count(distinct lower(trim(donor_name))) from donations where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to),
           'hours',      coalesce((select sum(hours) from volunteer_hours where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to), 0),
           'volunteers', (select count(distinct lower(trim(volunteer_name))) from volunteer_hours where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to),
           'sessions',   (select count(*) from volunteer_hours where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to),
           'responses',  (select count(*) from form_submissions fs join forms f on f.id = fs.form_id where f.organization_id = s.organization_id and not f.is_sample and (v_from is null or fs.submitted_at::date >= v_from) and fs.submitted_at::date <= v_to),
           'people_served', (select count(distinct fs.person_id) from form_submissions fs join forms f on f.id = fs.form_id where f.organization_id = s.organization_id and fs.person_id is not null and (v_from is null or fs.submitted_at::date >= v_from) and fs.submitted_at::date <= v_to)
         ) into totals;

  if p_from is not null then
    select jsonb_build_object(
             'raised',     coalesce((select sum(amount) from donations where organization_id = s.organization_id and not is_sample and date between p_from and p_to), 0),
             'gifts',      (select count(*) from donations where organization_id = s.organization_id and not is_sample and date between p_from and p_to),
             'donors',     (select count(distinct lower(trim(donor_name))) from donations where organization_id = s.organization_id and not is_sample and date between p_from and p_to),
             'hours',      coalesce((select sum(hours) from volunteer_hours where organization_id = s.organization_id and not is_sample and date between p_from and p_to), 0),
             'volunteers', (select count(distinct lower(trim(volunteer_name))) from volunteer_hours where organization_id = s.organization_id and not is_sample and date between p_from and p_to),
             'sessions',   (select count(*) from volunteer_hours where organization_id = s.organization_id and not is_sample and date between p_from and p_to),
             'responses',  (select count(*) from form_submissions fs join forms f on f.id = fs.form_id where f.organization_id = s.organization_id and not f.is_sample and fs.submitted_at::date between p_from and p_to),
             'people_served', (select count(distinct fs.person_id) from form_submissions fs join forms f on f.id = fs.form_id where f.organization_id = s.organization_id and fs.person_id is not null and fs.submitted_at::date between p_from and p_to)
           ) into prev;
  end if;

  result := jsonb_build_object(
    'name', s.name,
    'message', s.message,
    'sections', to_jsonb(s.sections),
    'period', jsonb_build_object('preset', s.period, 'from', v_from, 'to', v_to, 'previous_from', p_from, 'previous_to', p_to),
    'organization', jsonb_build_object('name', org.name, 'logo_url', brand.logo_url, 'primary_color', brand.primary_color),
    'totals', totals,
    'previous_totals', prev,
    'generated_at', now()
  );

  if 'donations' = any(s.sections) then
    result := result || jsonb_build_object(
      'donations_by_month', coalesce((
        select jsonb_agg(jsonb_build_object('month', m, 'value', v) order by m)
        from (select to_char(date, 'YYYY-MM') m, sum(amount) v from donations
              where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to
              group by 1) x), '[]'::jsonb),
      'donations_by_campaign', coalesce((
        select jsonb_agg(jsonb_build_object('name', n, 'value', v) order by v desc)
        from (select coalesce(nullif(trim(campaign), ''), 'General') n, sum(amount) v from donations
              where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to
              group by 1) x), '[]'::jsonb)
    );
  end if;

  if 'volunteers' = any(s.sections) then
    result := result || jsonb_build_object(
      'hours_by_month', coalesce((
        select jsonb_agg(jsonb_build_object('month', m, 'value', v) order by m)
        from (select to_char(date, 'YYYY-MM') m, sum(hours) v from volunteer_hours
              where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to
              group by 1) x), '[]'::jsonb),
      'hours_by_activity', coalesce((
        select jsonb_agg(jsonb_build_object('name', n, 'value', v) order by v desc)
        from (select coalesce(nullif(trim(activity), ''), 'Other') n, sum(hours) v from volunteer_hours
              where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to
              group by 1) x), '[]'::jsonb)
    );
  end if;

  if 'forms' = any(s.sections) then
    result := result || jsonb_build_object(
      'responses_by_form', coalesce((
        select jsonb_agg(jsonb_build_object('name', f.title, 'value', c) order by c desc)
        from (select fs.form_id, count(*) c from form_submissions fs join forms f2 on f2.id = fs.form_id
              where f2.organization_id = s.organization_id and not f2.is_sample
                and (v_from is null or fs.submitted_at::date >= v_from) and fs.submitted_at::date <= v_to
              group by fs.form_id) x
        join forms f on f.id = x.form_id), '[]'::jsonb)
    );
  end if;

  if 'goals' = any(s.sections) then
    result := result || jsonb_build_object(
      'goals', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'name', g.name, 'campaign', g.campaign, 'target', g.target_amount,
                 'start_date', g.start_date, 'end_date', g.end_date,
                 'raised', coalesce((select sum(d.amount) from donations d
                                     where d.organization_id = g.organization_id and not d.is_sample
                                       and d.date between g.start_date and g.end_date
                                       and (g.campaign is null or lower(trim(coalesce(d.campaign, ''))) = lower(trim(g.campaign)))), 0)
               ) order by g.end_date desc)
        from fundraising_goals g
        where g.organization_id = s.organization_id
          and (v_from is null or g.end_date >= v_from) and g.start_date <= v_to), '[]'::jsonb)
    );
  end if;

  if 'outcomes' = any(s.sections) then
    result := result || jsonb_build_object('outcomes', public.outcome_summary(s.organization_id, v_from, v_to));
  end if;

  return result;
end
$$;

revoke execute on function public.get_funder_report(text) from public;
grant execute on function public.get_funder_report(text) to anon, authenticated;

commit;
