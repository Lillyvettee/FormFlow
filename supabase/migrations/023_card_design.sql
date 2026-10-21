-- =============================================================================
-- ID CARD DESIGN
--
-- Run after 022_id_cards_and_scanning.sql.
--
-- One card design per organization (organizations.card_design), used for
-- every printed ID card: title, layout, orientation, colors, which custom
-- People fields to show, and up to 3 lines of the organization's own text.
-- Owners and admins on Mission or Enterprise set it with set_card_design().
-- The app fills in defaults for anything missing, so '{}' is a valid design.
-- Shape: see CardDesign in client/src/lib/card-design.ts.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

alter table public.organizations
  add column if not exists card_design jsonb not null default '{}'::jsonb;

alter table public.organizations drop constraint if exists organizations_card_design_check;
alter table public.organizations add constraint organizations_card_design_check
  check (jsonb_typeof(card_design) = 'object' and length(card_design::text) <= 5000);

create or replace function public.set_card_design(p_design jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_org_admin() then
    raise exception 'Only owners and admins can change the card design.';
  end if;
  if not plan_has_feature(org_plan(current_org_id()), 'cards_scanning') then
    raise exception 'ID cards are included with the Mission and Enterprise plans.'
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  if p_design is null or jsonb_typeof(p_design) <> 'object' or length(p_design::text) > 5000 then
    raise exception 'That card design couldn''t be saved.';
  end if;
  update organizations set card_design = p_design where id = current_org_id();
end
$$;

revoke execute on function public.set_card_design(jsonb) from public, anon;
grant execute on function public.set_card_design(jsonb) to authenticated;

commit;
