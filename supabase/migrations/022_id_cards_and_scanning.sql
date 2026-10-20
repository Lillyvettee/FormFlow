-- =============================================================================
-- ID CARDS FOR PEOPLE AND INVENTORY SCANNING
--
-- Run after 021_restore_form_access_rules.sql.
--
-- Mission and Enterprise only (plan feature 'cards_scanning').
--
-- What this does:
--   1. People can be given a card: a number that counts up per organization
--      (card_number, shown as "<prefix>-000123") and the form that opens
--      when the card is scanned (card_form_id). issue_person_card() hands
--      them out.
--   2. organizations.card_prefix: the organization's own prefix, e.g. "FB".
--      Set with set_card_prefix().
--   3. inventory_items.barcode: a product barcode (UPC/EAN) or our own
--      label's code, unique within an organization.
--   4. adjust_inventory(): adds or removes stock in one step, never below
--      zero, for the scanner's Receive and Give out modes.
--
-- A card's QR code holds a link to /scan/person/<person id>. It only works
-- for signed-in members of the person's organization (the usual People
-- rules), and it never contains the person's private form-link token.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Plan feature
--
-- Replaces the version from 020, adding 'cards_scanning'.
-- -----------------------------------------------------------------------------

create or replace function public.plan_has_feature(p_plan text, p_feature text)
returns boolean
language sql immutable
as $$
  select p_plan in ('mission', 'enterprise')
     and p_feature in ('import_export', 'branding', 'funder_advanced', 'cards_scanning')
$$;

-- -----------------------------------------------------------------------------
-- 2. Columns
-- -----------------------------------------------------------------------------

alter table public.organizations
  add column if not exists card_prefix text
    check (card_prefix is null or card_prefix ~ '^[A-Z0-9]{1,6}$');

alter table public.people
  add column if not exists card_number    integer,
  add column if not exists card_form_id   uuid references public.forms(id) on delete set null,
  add column if not exists card_issued_at timestamptz;

create unique index if not exists people_card_number_unique
  on public.people (organization_id, card_number) where card_number is not null;

alter table public.inventory_items
  add column if not exists barcode text
    check (barcode is null or (length(barcode) between 1 and 128 and barcode = trim(barcode)));

create unique index if not exists inventory_items_barcode_unique
  on public.inventory_items (organization_id, barcode) where barcode is not null;

-- Barcodes are a Mission feature. Only a change to the barcode is checked, so
-- an organization that moved down to Starter can still edit its items.
create or replace function public.enforce_barcode_plan()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.barcode is not null
     and (tg_op = 'INSERT' or new.barcode is distinct from old.barcode)
     and not plan_has_feature(org_plan(new.organization_id), 'cards_scanning') then
    raise exception 'Barcodes and scanning are included with the Mission and Enterprise plans.'
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end
$$;

drop trigger if exists zz_barcode_plan on public.inventory_items;
create trigger zz_barcode_plan before insert or update of barcode on public.inventory_items
  for each row execute function public.enforce_barcode_plan();

revoke execute on function public.enforce_barcode_plan() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Card prefix
-- -----------------------------------------------------------------------------

-- Owners and admins. Letters and numbers, up to 6; '' removes it.
create or replace function public.set_card_prefix(p_prefix text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_prefix text := nullif(upper(trim(coalesce(p_prefix, ''))), '');
begin
  if not is_org_admin() then
    raise exception 'Only owners and admins can change the card prefix.';
  end if;
  if v_prefix is not null and v_prefix !~ '^[A-Z0-9]{1,6}$' then
    raise exception 'Use up to 6 letters or numbers, like FB or PANTRY.';
  end if;
  update organizations set card_prefix = v_prefix where id = current_org_id();
  return v_prefix;
end
$$;

revoke execute on function public.set_card_prefix(text) from public, anon;
grant execute on function public.set_card_prefix(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Issuing cards
-- -----------------------------------------------------------------------------

-- Gives the people their card (a number, if they don't have one yet) and sets
-- the form that opens when it's scanned (null = their profile). Returns how
-- many cards were issued or updated. Editors who can see People.
create or replace function public.issue_person_cards(p_person_ids uuid[], p_form_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_org  uuid := current_org_id();
  v_next integer;
  v_done integer := 0;
  pid    uuid;
begin
  if v_org is null or not can_edit_org_data() or not can_view_people() then
    raise exception 'You can''t make cards right now.';
  end if;
  if not plan_has_feature(org_plan(v_org), 'cards_scanning') then
    raise exception 'ID cards are included with the Mission and Enterprise plans.'
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  if p_form_id is not null and not exists (select 1 from forms where id = p_form_id and organization_id = v_org) then
    raise exception 'That form isn''t in your organization.';
  end if;

  -- One numbering at a time per organization.
  perform pg_advisory_xact_lock(hashtext('card_number:' || v_org));
  select coalesce(max(card_number), 0) into v_next from people where organization_id = v_org;

  foreach pid in array coalesce(p_person_ids, '{}')
  loop
    update people
    set card_number    = coalesce(card_number, v_next + 1),
        card_form_id   = p_form_id,
        card_issued_at = coalesce(card_issued_at, now())
    where id = pid and organization_id = v_org;
    if found then
      v_done := v_done + 1;
      select coalesce(max(card_number), 0) into v_next from people where organization_id = v_org;
    end if;
  end loop;
  return v_done;
end
$$;

revoke execute on function public.issue_person_cards(uuid[], uuid) from public, anon;
grant execute on function public.issue_person_cards(uuid[], uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Stock changes from the scanner
-- -----------------------------------------------------------------------------

-- Adds (positive) or removes (negative) stock and returns the new quantity.
-- Refuses to go below zero. Editors of the item's organization.
create or replace function public.adjust_inventory(p_item_id uuid, p_delta integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_org  uuid := current_org_id();
  v_item inventory_items%rowtype;
  v_new  integer;
begin
  if v_org is null or not can_edit_org_data() then
    raise exception 'You can''t change stock right now.';
  end if;
  if not plan_has_feature(org_plan(v_org), 'cards_scanning') then
    raise exception 'Scanning is included with the Mission and Enterprise plans.'
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'Enter a quantity between 1 and 100,000.';
  end if;

  select * into v_item from inventory_items where id = p_item_id and organization_id = v_org for update;
  if not found then
    raise exception 'That item isn''t in your inventory.';
  end if;
  v_new := coalesce(v_item.quantity, 0) + p_delta;
  if v_new < 0 then
    raise exception 'Only % left of "%".', coalesce(v_item.quantity, 0), v_item.name;
  end if;
  update inventory_items set quantity = v_new where id = p_item_id;
  return v_new;
end
$$;

revoke execute on function public.adjust_inventory(uuid, integer) from public, anon;
grant execute on function public.adjust_inventory(uuid, integer) to authenticated;

commit;
