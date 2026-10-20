-- =============================================================================
-- FUNDER PORTAL OPTIONS
--
-- Run after 019_media_bucket.sql.
--
-- What this does:
--   1. Funder links can be edited after they're made (all plans; the
--      "Admins can change" rule from 010 already allows it).
--   2. Mission and Enterprise can also:
--        - filter what's counted: campaigns, volunteer activities, programs,
--          forms, fundraising goals and outcome questions (filters)
--        - order the sections (the order of sections) and add a note under
--          each one (section_notes)
--        - choose whether the report shows the organization's logo and
--          color (show_branding; the plan must include branding)
--        - set an expiry date (expires_at) and a password
--      plan_has_feature(..., 'funder_advanced') decides, and a trigger
--      refuses these settings on Starter.
--   3. Passwords are kept in funder_share_secrets, which nobody can read;
--      only a bcrypt hash is stored. set_funder_share_password() sets or
--      clears one. 10 wrong tries lock the link for 15 minutes.
--   4. Replaces get_funder_report (010, wrapped by 012) with one function
--      that applies all of this. Funders still only ever see totals.
--
-- Keep filter keys in step with client/src/components/reports/funder-shares-dialog.tsx.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. New settings
-- -----------------------------------------------------------------------------

alter table public.funder_shares
  add column if not exists filters            jsonb not null default '{}'::jsonb,
  add column if not exists section_notes      jsonb not null default '{}'::jsonb,
  add column if not exists show_branding      boolean not null default true,
  add column if not exists expires_at         timestamptz,
  -- Kept in step by set_funder_share_password(), so the app can show it.
  add column if not exists password_protected boolean not null default false;

alter table public.funder_shares drop constraint if exists funder_shares_filters_check;
alter table public.funder_shares add constraint funder_shares_filters_check
  check (jsonb_typeof(filters) = 'object' and length(filters::text) <= 20000);
alter table public.funder_shares drop constraint if exists funder_shares_section_notes_check;
alter table public.funder_shares add constraint funder_shares_section_notes_check
  check (jsonb_typeof(section_notes) = 'object' and length(section_notes::text) <= 10000);

-- No policies: only the functions below read or write it.
create table if not exists public.funder_share_secrets (
  share_id        uuid primary key references public.funder_shares(id) on delete cascade,
  password_hash   text not null,
  failed_attempts integer not null default 0,
  locked_until    timestamptz
);

alter table public.funder_share_secrets enable row level security;

-- -----------------------------------------------------------------------------
-- 2. Plan feature
--
-- Replaces the version from 016, adding 'funder_advanced'.
-- -----------------------------------------------------------------------------

create or replace function public.plan_has_feature(p_plan text, p_feature text)
returns boolean
language sql immutable
as $$
  select p_plan in ('mission', 'enterprise') and p_feature in ('import_export', 'branding', 'funder_advanced')
$$;

-- Starter can make and edit links, but not use the advanced settings. On an
-- edit, only settings that change are checked, so an organization that moved
-- down to Starter can still rename, pause or edit its existing links.
create or replace function public.enforce_funder_share_plan()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_uses boolean;
begin
  if plan_has_feature(org_plan(new.organization_id), 'funder_advanced') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    v_uses := new.filters <> '{}'::jsonb or new.section_notes <> '{}'::jsonb or new.expires_at is not null;
  else
    v_uses := (new.filters is distinct from old.filters and new.filters <> '{}'::jsonb)
           or (new.section_notes is distinct from old.section_notes and new.section_notes <> '{}'::jsonb)
           or (new.expires_at is distinct from old.expires_at and new.expires_at is not null);
  end if;
  if v_uses then
    raise exception 'Filters, section notes and expiry dates are included with the Mission and Enterprise plans.'
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end
$$;

drop trigger if exists zz_funder_share_plan on public.funder_shares;
create trigger zz_funder_share_plan before insert or update on public.funder_shares
  for each row execute function public.enforce_funder_share_plan();

revoke execute on function public.enforce_funder_share_plan() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Passwords
-- -----------------------------------------------------------------------------

-- Sets (or, with null or '', removes) a funder link's password.
-- Owners and admins of the link's organization, on Mission or Enterprise.
create or replace function public.set_funder_share_password(p_share_id uuid, p_password text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from funder_shares where id = p_share_id;
  if v_org is null or v_org <> current_org_id() or not is_org_admin() then
    raise exception 'Only owners and admins can change this link.';
  end if;

  if coalesce(p_password, '') = '' then
    delete from funder_share_secrets where share_id = p_share_id;
    update funder_shares set password_protected = false where id = p_share_id;
    return;
  end if;

  if not plan_has_feature(org_plan(v_org), 'funder_advanced') then
    raise exception 'Passwords are included with the Mission and Enterprise plans.'
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  if length(p_password) < 6 or length(p_password) > 100 then
    raise exception 'Use a password between 6 and 100 characters.';
  end if;

  insert into funder_share_secrets (share_id, password_hash)
  values (p_share_id, extensions.crypt(p_password, extensions.gen_salt('bf')))
  on conflict (share_id) do update
    set password_hash = excluded.password_hash, failed_attempts = 0, locked_until = null;
  update funder_shares set password_protected = true where id = p_share_id;
end
$$;

revoke execute on function public.set_funder_share_password(uuid, text) from public, anon;
grant execute on function public.set_funder_share_password(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Filters
-- -----------------------------------------------------------------------------

-- One filter as a lowercased, trimmed text array, or null for "everything".
create or replace function public.funder_filter(p_filters jsonb, p_key text)
returns text[]
language sql immutable
as $$
  select case
    when jsonb_typeof(p_filters -> p_key) = 'array' and jsonb_array_length(p_filters -> p_key) > 0
      then array(select lower(trim(x)) from jsonb_array_elements_text(p_filters -> p_key) x)
  end
$$;

-- Outcome results (outcome_summary) for people in the given programs only.
-- A copy of outcome_summary from 010 with one added condition.
create or replace function public.outcome_summary_for_programs(p_org uuid, p_from date, p_to date, p_programs text[])
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
      and (p_programs is null or exists (
            select 1 from people pe
            where pe.id = s.person_id and lower(trim(coalesce(pe.program, ''))) = any (p_programs)))
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

revoke execute on function public.outcome_summary_for_programs(uuid, date, date, text[]) from public, anon, authenticated;

-- Headline totals for one period with a link's filters (null from = open).
create or replace function public.funder_totals(p_org uuid, p_from date, p_to date, p_filters jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_campaigns  text[] := funder_filter(p_filters, 'campaigns');
  v_activities text[] := funder_filter(p_filters, 'activities');
  v_programs   text[] := funder_filter(p_filters, 'programs');
  v_forms      text[] := funder_filter(p_filters, 'form_ids');
begin
  return jsonb_build_object(
    'raised', coalesce((select sum(amount) from donations
                        where organization_id = p_org and not is_sample and (p_from is null or date >= p_from) and date <= p_to
                          and (v_campaigns is null or lower(trim(coalesce(campaign, ''))) = any (v_campaigns))), 0),
    'gifts', (select count(*) from donations
              where organization_id = p_org and not is_sample and (p_from is null or date >= p_from) and date <= p_to
                and (v_campaigns is null or lower(trim(coalesce(campaign, ''))) = any (v_campaigns))),
    'donors', (select count(distinct lower(trim(donor_name))) from donations
               where organization_id = p_org and not is_sample and (p_from is null or date >= p_from) and date <= p_to
                 and (v_campaigns is null or lower(trim(coalesce(campaign, ''))) = any (v_campaigns))),
    'hours', coalesce((select sum(hours) from volunteer_hours
                       where organization_id = p_org and not is_sample and (p_from is null or date >= p_from) and date <= p_to
                         and (v_activities is null or lower(trim(coalesce(activity, ''))) = any (v_activities))), 0),
    'volunteers', (select count(distinct lower(trim(volunteer_name))) from volunteer_hours
                   where organization_id = p_org and not is_sample and (p_from is null or date >= p_from) and date <= p_to
                     and (v_activities is null or lower(trim(coalesce(activity, ''))) = any (v_activities))),
    'sessions', (select count(*) from volunteer_hours
                 where organization_id = p_org and not is_sample and (p_from is null or date >= p_from) and date <= p_to
                   and (v_activities is null or lower(trim(coalesce(activity, ''))) = any (v_activities))),
    'responses', (select count(*) from form_submissions fs join forms f on f.id = fs.form_id
                  where f.organization_id = p_org and not f.is_sample
                    and (p_from is null or fs.submitted_at::date >= p_from) and fs.submitted_at::date <= p_to
                    and (v_forms is null or f.id::text = any (v_forms))),
    'people_served', (select count(distinct fs.person_id) from form_submissions fs
                      join forms f on f.id = fs.form_id
                      join people pe on pe.id = fs.person_id
                      where f.organization_id = p_org and not f.is_sample
                        and (p_from is null or fs.submitted_at::date >= p_from) and fs.submitted_at::date <= p_to
                        and (v_forms is null or f.id::text = any (v_forms))
                        and (v_programs is null or lower(trim(coalesce(pe.program, ''))) = any (v_programs))),
    'services_count', (select count(*) from services sv join people pe on pe.id = sv.person_id
                       where sv.organization_id = p_org and (p_from is null or sv.date >= p_from) and sv.date <= p_to
                         and (v_programs is null or lower(trim(coalesce(pe.program, ''))) = any (v_programs))),
    'people_helped', (select count(distinct sv.person_id) from services sv join people pe on pe.id = sv.person_id
                      where sv.organization_id = p_org and (p_from is null or sv.date >= p_from) and sv.date <= p_to
                        and (v_programs is null or lower(trim(coalesce(pe.program, ''))) = any (v_programs))),
    'services_value', coalesce((select sum(sv.value) from services sv join people pe on pe.id = sv.person_id
                                where sv.organization_id = p_org and (p_from is null or sv.date >= p_from) and sv.date <= p_to
                                  and (v_programs is null or lower(trim(coalesce(pe.program, ''))) = any (v_programs))), 0)
  );
end
$$;

revoke execute on function public.funder_totals(uuid, date, date, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. The report
-- -----------------------------------------------------------------------------

-- The 010 and 012 versions go; this one replaces both.
drop function if exists public.get_funder_report(text);
drop function if exists public.get_funder_report_base(text);

/**
 * The live report behind a funder link. Returns:
 *   null                                  unknown or paused link
 *   { status: 'expired', ... }            past its expiry date
 *   { status: 'password_required', ... }  needs (or got a wrong) password
 *   { status: 'locked', ... }             too many wrong passwords
 *   { status: 'ok', ...report }           totals, trends, goals, outcomes
 * Only the organization's name and the link's name come back before the
 * password is right.
 *
 * Periods are as in 010: this_year, last_year, last_12_months and custom are
 * compared with the period before; all has no comparison.
 */
create function public.get_funder_report(p_token text, p_password text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  s          funder_shares;
  org        organizations;
  brand      organization_settings;
  secret     funder_share_secrets;
  v_from     date;
  v_to       date;
  p_from     date;
  p_to       date;
  totals     jsonb;
  prev       jsonb;
  result     jsonb;
  v_branded  boolean;
  v_campaigns  text[];
  v_activities text[];
  v_programs   text[];
  v_forms      text[];
  v_goals      text[];
  v_outcomes   text[];
  header     jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  select * into s from funder_shares where token = p_token and revoked_at is null;
  if not found then
    return null;
  end if;
  select * into org from organizations where id = s.organization_id;
  header := jsonb_build_object('name', s.name, 'organization', jsonb_build_object('name', org.name));

  -- ----- Access -----
  if s.expires_at is not null and s.expires_at < now() then
    return header || jsonb_build_object('status', 'expired');
  end if;

  select * into secret from funder_share_secrets where share_id = s.id;
  if found then
    if secret.locked_until is not null and secret.locked_until > now() then
      return header || jsonb_build_object('status', 'locked');
    end if;
    if p_password is null then
      return header || jsonb_build_object('status', 'password_required');
    end if;
    if extensions.crypt(p_password, secret.password_hash) <> secret.password_hash then
      update funder_share_secrets
      set failed_attempts = failed_attempts + 1,
          locked_until = case when failed_attempts + 1 >= 10 then now() + interval '15 minutes' end
      where share_id = s.id;
      return header || jsonb_build_object('status', 'password_required', 'wrong_password', true);
    end if;
    update funder_share_secrets set failed_attempts = 0, locked_until = null where share_id = s.id and failed_attempts > 0;
  end if;

  -- ----- Period -----
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

  v_campaigns  := funder_filter(s.filters, 'campaigns');
  v_activities := funder_filter(s.filters, 'activities');
  v_programs   := funder_filter(s.filters, 'programs');
  v_forms      := funder_filter(s.filters, 'form_ids');
  v_goals      := funder_filter(s.filters, 'goal_ids');
  v_outcomes   := funder_filter(s.filters, 'outcomes');

  totals := funder_totals(s.organization_id, v_from, v_to, s.filters);
  if p_from is not null then
    prev := funder_totals(s.organization_id, p_from, p_to, s.filters);
  end if;

  -- Logo and color only when the link wants them and the plan includes branding.
  v_branded := s.show_branding and plan_has_feature(org_plan(s.organization_id), 'branding');
  if v_branded then
    select * into brand from organization_settings where organization_id = s.organization_id;
  end if;

  result := jsonb_build_object(
    'status', 'ok',
    'name', s.name,
    'message', s.message,
    'sections', to_jsonb(s.sections),
    'section_notes', s.section_notes,
    'filtered', exists (select 1 from jsonb_each(s.filters) e
                        where jsonb_typeof(e.value) = 'array' and jsonb_array_length(e.value) > 0),
    'period', jsonb_build_object('preset', s.period, 'from', v_from, 'to', v_to, 'previous_from', p_from, 'previous_to', p_to),
    'organization', jsonb_build_object(
      'name', org.name,
      'logo_url', case when v_branded then brand.logo_url end,
      'primary_color', case when v_branded then brand.primary_color end),
    'totals', totals - array['services_count', 'people_helped', 'services_value'],
    'previous_totals', case when prev is not null then prev - array['services_count', 'people_helped', 'services_value'] end,
    'generated_at', now()
  );

  if 'donations' = any (s.sections) then
    result := result || jsonb_build_object(
      'donations_by_month', coalesce((
        select jsonb_agg(jsonb_build_object('month', m, 'value', v) order by m)
        from (select to_char(date, 'YYYY-MM') m, sum(amount) v from donations
              where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to
                and (v_campaigns is null or lower(trim(coalesce(campaign, ''))) = any (v_campaigns))
              group by 1) x), '[]'::jsonb),
      'donations_by_campaign', coalesce((
        select jsonb_agg(jsonb_build_object('name', n, 'value', v) order by v desc)
        from (select coalesce(nullif(trim(campaign), ''), 'General') n, sum(amount) v from donations
              where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to
                and (v_campaigns is null or lower(trim(coalesce(campaign, ''))) = any (v_campaigns))
              group by 1) x), '[]'::jsonb)
    );
  end if;

  if 'volunteers' = any (s.sections) then
    result := result || jsonb_build_object(
      'hours_by_month', coalesce((
        select jsonb_agg(jsonb_build_object('month', m, 'value', v) order by m)
        from (select to_char(date, 'YYYY-MM') m, sum(hours) v from volunteer_hours
              where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to
                and (v_activities is null or lower(trim(coalesce(activity, ''))) = any (v_activities))
              group by 1) x), '[]'::jsonb),
      'hours_by_activity', coalesce((
        select jsonb_agg(jsonb_build_object('name', n, 'value', v) order by v desc)
        from (select coalesce(nullif(trim(activity), ''), 'Other') n, sum(hours) v from volunteer_hours
              where organization_id = s.organization_id and not is_sample and (v_from is null or date >= v_from) and date <= v_to
                and (v_activities is null or lower(trim(coalesce(activity, ''))) = any (v_activities))
              group by 1) x), '[]'::jsonb)
    );
  end if;

  if 'forms' = any (s.sections) then
    result := result || jsonb_build_object(
      'responses_by_form', coalesce((
        select jsonb_agg(jsonb_build_object('name', f.title, 'value', c) order by c desc)
        from (select fs.form_id, count(*) c from form_submissions fs join forms f2 on f2.id = fs.form_id
              where f2.organization_id = s.organization_id and not f2.is_sample
                and (v_from is null or fs.submitted_at::date >= v_from) and fs.submitted_at::date <= v_to
                and (v_forms is null or f2.id::text = any (v_forms))
              group by fs.form_id) x
        join forms f on f.id = x.form_id), '[]'::jsonb)
    );
  end if;

  if 'goals' = any (s.sections) then
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
          and (v_from is null or g.end_date >= v_from) and g.start_date <= v_to
          and (v_goals is null or g.id::text = any (v_goals))), '[]'::jsonb)
    );
  end if;

  if 'outcomes' = any (s.sections) then
    result := result || jsonb_build_object('outcomes', coalesce((
      select jsonb_agg(o)
      from jsonb_array_elements(outcome_summary_for_programs(s.organization_id, v_from, v_to, v_programs)) o
      where (v_forms is null or o ->> 'form_id' = any (v_forms))
        and (v_outcomes is null or lower(o ->> 'form_id' || ':' || (o ->> 'field_id')) = any (v_outcomes))), '[]'::jsonb));
  end if;

  if 'services' = any (s.sections) then
    result := result || jsonb_build_object(
      'services', jsonb_build_object(
        'count', totals -> 'services_count',
        'people_helped', totals -> 'people_helped',
        'value', totals -> 'services_value',
        'previous', case when prev is null then null else jsonb_build_object(
          'count', prev -> 'services_count', 'people_helped', prev -> 'people_helped', 'value', prev -> 'services_value') end,
        'by_type', coalesce((
          select jsonb_agg(jsonb_build_object('name', n, 'count', c, 'value', v) order by c desc)
          from (select trim(sv.service_type) n, count(*) c, coalesce(sum(sv.value), 0) v
                from services sv join people pe on pe.id = sv.person_id
                where sv.organization_id = s.organization_id and (v_from is null or sv.date >= v_from) and sv.date <= v_to
                  and (v_programs is null or lower(trim(coalesce(pe.program, ''))) = any (v_programs))
                group by 1) x), '[]'::jsonb),
        'by_month', coalesce((
          select jsonb_agg(jsonb_build_object('month', m, 'value', c) order by m)
          from (select to_char(sv.date, 'YYYY-MM') m, count(*) c
                from services sv join people pe on pe.id = sv.person_id
                where sv.organization_id = s.organization_id and (v_from is null or sv.date >= v_from) and sv.date <= v_to
                  and (v_programs is null or lower(trim(coalesce(pe.program, ''))) = any (v_programs))
                group by 1) x), '[]'::jsonb)
      )
    );
  end if;

  return result;
end
$$;

revoke execute on function public.get_funder_report(text, text) from public;
grant execute on function public.get_funder_report(text, text) to anon, authenticated;

commit;
