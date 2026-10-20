-- =============================================================================
-- JOINING A TEAM WHEN YOU ALREADY HAVE YOUR OWN ORGANIZATION
--
-- Run after 017_feedback_and_staff_inbox.sql.
--
-- Everyone creates an organization when they sign up, and a person can only
-- belong to one. Before this, someone who had started on their own (and
-- added records) couldn't accept an invitation to another team: joining
-- said "leave first", and leaving said "you're the only member".
--
-- Now, if they're the ONLY member of their current organization, the invite
-- page lets them choose:
--   move     Bring their records into the new team, then remove the old,
--            now-empty organization. Sample records stay behind and are
--            deleted. Refused if it would put the new team over its plan
--            limits (active forms, client profiles).
--   discard  Delete the old organization and everything in it, then join.
-- In both cases any subscription on the old organization is canceled first
-- (by the join-organization function, which holds the Stripe key).
--
-- Organizations with other members work as before: make someone else an
-- owner and leave on the Team page, then accept the invitation.
--
-- What moves: every table with an organization_id column except the ones
-- that describe the organization itself (members, invitations, billing,
-- branding settings, report counts). Custom field definitions are merged
-- into the new team's, so moved records keep showing their custom fields.
-- Files stay where they are; they're stored by uploader and by form, which
-- both still work after the move.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Don't log "changed" history for every record that moves
--
-- Replaces log_activity() from 015 with one addition: it does nothing while
-- join_organization() is moving records (app.moving_org is set).
-- -----------------------------------------------------------------------------

create or replace function public.log_activity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  rec       jsonb := to_jsonb(coalesce(new, old));
  before    jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  kind      text := case tg_table_name when 'people' then 'person' when 'services' then 'help given' else 'case note' end;
  changed   text[];
  label     text;
  who       text;
begin
  -- Records moving to another organization aren't changes people made.
  if current_setting('app.moving_org', true) = 'on' then
    return coalesce(new, old);
  end if;

  -- When a whole organization is deleted, its history goes with it.
  if not exists (select 1 from organizations where id = (rec ->> 'organization_id')::uuid) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into changed
    from jsonb_object_keys(rec) k
    where k not in ('updated_at', 'access_token') and rec -> k is distinct from before -> k;
    -- Nothing people would call a change (e.g. only a timestamp moved).
    if changed is null then
      return new;
    end if;
  end if;

  label := case tg_table_name
    when 'people'   then rec ->> 'full_name'
    when 'services' then concat_ws(', ', rec ->> 'service_type', to_char((rec ->> 'date')::date, 'Mon FMDD, YYYY'))
    else 'Case note'
  end;

  select coalesce(nullif(trim(m.display_name), ''), m.email) into who
  from organization_members m
  where m.user_id = auth.uid() and m.organization_id = (rec ->> 'organization_id')::uuid;

  insert into activity_log (organization_id, actor_id, actor_name, action, record_type, record_id, person_id, summary, changed_fields)
  values (
    (rec ->> 'organization_id')::uuid,
    auth.uid(),
    who,
    case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'changed' else 'deleted' end,
    kind,
    (rec ->> 'id')::uuid,
    case when tg_table_name = 'people' then (rec ->> 'id')::uuid else (rec ->> 'person_id')::uuid end,
    left(label, 200),
    changed
  );
  return coalesce(new, old);
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Helpers
-- -----------------------------------------------------------------------------

-- Tables whose rows describe the organization itself; they never move.
create or replace function public.org_tables_not_moved()
returns text[]
language sql immutable
as $$
  select array['organizations', 'organization_members', 'organization_invitations', 'organization_billing',
               'organization_settings', 'tracker_settings', 'report_usage']
$$;

-- Moved after everything else, because their triggers check that the person
-- or inventory item is already in the same organization.
create or replace function public.org_tables_moved_last()
returns text[]
language sql immutable
as $$
  select array['services', 'case_notes', 'activity_log']
$$;

-- Counts one table's rows for an organization, skipping sample records.
-- Returns 0 if the table doesn't exist.
create or replace function public.count_org_rows(p_table text, p_org uuid, p_active_forms_only boolean default false)
returns integer
language plpgsql stable security definer set search_path = public
as $$
declare
  v_count integer;
  v_where text := 'organization_id = $1';
begin
  if to_regclass('public.' || p_table) is null then return 0; end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = p_table and column_name = 'is_sample') then
    v_where := v_where || ' and not is_sample';
  end if;
  if p_active_forms_only then
    v_where := v_where || ' and not coalesce(is_archived, false)';
  end if;
  execute format('select count(*) from public.%I where %s', p_table, v_where) into v_count using p_org;
  return v_count;
end
$$;

-- Why moving p_src's records into p_dst isn't allowed, or null if it is.
create or replace function public.move_limit_problem(p_src uuid, p_dst uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_plan    text := org_plan(p_dst);
  v_limit   integer;
  v_total   integer;
  v_problem text[] := '{}';
begin
  v_limit := plan_limit(v_plan, 'forms');
  v_total := plan_usage(p_dst, 'forms') + count_org_rows('forms', p_src, true);
  if v_limit is not null and v_total > v_limit then
    v_problem := v_problem || format('%s active forms (the plan allows %s)', v_total, v_limit);
  end if;

  v_limit := plan_limit(v_plan, 'people');
  v_total := plan_usage(p_dst, 'people') + count_org_rows('people', p_src);
  if v_limit is not null and v_total > v_limit then
    v_problem := v_problem || format('%s client profiles (the plan allows %s)', v_total, v_limit);
  end if;

  if cardinality(v_problem) = 0 then return null; end if;
  return format(
    'Bringing your records would give the team %s on its %s plan. Archive or delete some of your records first, or ask the team to upgrade.',
    array_to_string(v_problem, ' and '), initcap(v_plan));
end
$$;

-- -----------------------------------------------------------------------------
-- 3. What joining would mean for this person (used by both functions below)
-- -----------------------------------------------------------------------------

create or replace function public.join_details(p_user uuid, p_email text, p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  inv      organization_invitations%rowtype;
  v_src    uuid;
  v_role   text;
  v_others integer;
  v_billing organization_billing%rowtype;
begin
  select * into inv from organization_invitations where token = p_token;
  if not found then
    raise exception 'This invitation link is not valid. Ask for a new one.';
  end if;
  if inv.accepted_at is not null then
    raise exception 'This invitation has already been used.';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invitation has expired. Ask for a new one.';
  end if;
  if lower(inv.email) <> lower(coalesce(p_email, '')) then
    raise exception 'This invitation was sent to %. Sign in with that email address to accept it.', inv.email;
  end if;

  select organization_id, role into v_src, v_role from organization_members where user_id = p_user;
  if v_src is null then
    return jsonb_build_object('has_organization', false, 'target_organization_id', inv.organization_id);
  end if;
  if v_src = inv.organization_id then
    raise exception 'You''re already a member of this organization.';
  end if;

  select count(*) into v_others from organization_members where organization_id = v_src and user_id <> p_user;
  select * into v_billing from organization_billing where organization_id = v_src;

  return jsonb_build_object(
    'has_organization', true,
    'target_organization_id', inv.organization_id,
    'organization_id', v_src,
    'organization_name', (select name from organizations where id = v_src),
    'role', v_role,
    'other_members', v_others,
    'subscribed', coalesce(v_billing.status in ('active', 'trialing', 'past_due'), false)
                  and v_billing.stripe_subscription_id is not null,
    'records', jsonb_build_object(
      'forms',           count_org_rows('forms', v_src),
      'responses',       count_org_rows('form_submissions', v_src),
      'people',          count_org_rows('people', v_src),
      'donations',       count_org_rows('donations', v_src),
      'volunteer_hours', count_org_rows('volunteer_hours', v_src),
      'inventory_items', count_org_rows('inventory_items', v_src),
      'links',           count_org_rows('links', v_src),
      'media_items',     count_org_rows('media_items', v_src)),
    'move_problem', case when v_others = 0 then move_limit_problem(v_src, inv.organization_id) end
  );
end
$$;

revoke execute on function public.join_details(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.join_details(uuid, text, uuid) to service_role;

-- For the invite page: the same details for the signed-in person.
create or replace function public.get_join_options(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select public.join_details(auth.uid(), auth.email(), p_token)
$$;

revoke execute on function public.get_join_options(uuid) from public, anon;
grant execute on function public.get_join_options(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Join, moving or discarding the old organization
--
-- Called only by the join-organization function (service role), after it
-- has canceled the old organization's subscription and, for 'discard',
-- removed its files. Everything here happens in one transaction.
-- -----------------------------------------------------------------------------

create or replace function public.join_organization(
  p_user uuid, p_email text, p_display_name text, p_token uuid, p_mode text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_details jsonb := join_details(p_user, p_email, p_token);
  v_src     uuid := (v_details ->> 'organization_id')::uuid;
  v_dst     uuid := (v_details ->> 'target_organization_id')::uuid;
  v_problem text;
  t         text;
  v_where   text;
begin
  if p_mode not in ('move', 'discard') then
    raise exception 'Choose whether to bring your records or delete them.';
  end if;

  if v_src is not null then
    if (v_details ->> 'other_members')::integer > 0 then
      raise exception 'Your current organization has other members. Make someone else an owner and leave it on the Team page first.';
    end if;

    -- Two joins at once can't both pass the limit check.
    perform pg_advisory_xact_lock(hashtext('plan_limit:' || v_dst || ':forms'));
    perform pg_advisory_xact_lock(hashtext('plan_limit:' || v_dst || ':people'));

    if p_mode = 'move' then
      v_problem := move_limit_problem(v_src, v_dst);
      if v_problem is not null then
        raise exception '%', v_problem using errcode = 'P0001', hint = 'plan_limit';
      end if;

      perform set_config('app.moving_org', 'on', true);

      -- Custom fields: add the old organization's to the team's, per tracker.
      update tracker_settings d
      set config = jsonb_set(
        d.config, '{custom}',
        coalesce(d.config -> 'custom', '[]'::jsonb) || coalesce((
          select jsonb_agg(f.value)
          from jsonb_array_elements(coalesce(s.config -> 'custom', '[]'::jsonb)) as f(value)
          where not exists (
            select 1 from jsonb_array_elements(coalesce(d.config -> 'custom', '[]'::jsonb)) as g(value)
            where g.value ->> 'id' = f.value ->> 'id')
        ), '[]'::jsonb))
      from tracker_settings s
      where s.organization_id = v_src and s.tracker = d.tracker and d.organization_id = v_dst;
      -- Trackers the team never customized take the old settings as they are.
      update tracker_settings set organization_id = v_dst
      where organization_id = v_src
        and tracker not in (select tracker from tracker_settings where organization_id = v_dst);

      -- Help given that used a sample inventory item: keep the entry, drop the link.
      if to_regclass('public.services') is not null then
        update services set inventory_item_id = null
        where organization_id = v_src
          and inventory_item_id in (select id from inventory_items where organization_id = v_src and is_sample);
      end if;

      -- Every other table with an organization_id, real records only.
      for t in
        select c.table_name::text
        from information_schema.columns c
        join information_schema.tables tb
          on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
        where c.table_schema = 'public' and c.column_name = 'organization_id'
          and c.table_name::text <> all (org_tables_not_moved())
        -- Ordinary tables first (alphabetically), then the "moved last" ones in order.
        order by coalesce(array_position(org_tables_moved_last(), c.table_name::text), 0), c.table_name::text
      loop
        v_where := 'organization_id = $1';
        if exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'is_sample') then
          v_where := v_where || ' and not is_sample';
        end if;
        execute format('update public.%I set organization_id = $2 where %s', t, v_where) using v_src, v_dst;
      end loop;

      perform set_config('app.moving_org', 'off', true);
    end if;

    -- The old organization: empty of real records ('move') or everything
    -- ('discard'). Its billing, settings and anything left cascade with it.
    delete from organizations where id = v_src;
  end if;

  insert into organization_members (organization_id, user_id, role, email, display_name)
  select v_dst, p_user, i.role, p_email, nullif(left(trim(coalesce(p_display_name, '')), 100), '')
  from organization_invitations i where i.token = p_token;

  update organization_invitations set accepted_at = now() where token = p_token;
  return v_dst;
end
$$;

revoke execute on function public.join_organization(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.join_organization(uuid, text, text, uuid, text) to service_role;

revoke execute on function public.count_org_rows(text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.move_limit_problem(uuid, uuid)     from public, anon, authenticated;

commit;
