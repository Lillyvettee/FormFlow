-- ============================================================
-- FormFlow - Initial Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS (extends Supabase auth.users)
-- ============================================================
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  full_name text,
  organization_name text,
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
create table public.subscriptions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan text not null default 'free', -- 'free' | 'starter' | 'mission'
  billing_cycle text, -- 'monthly' | 'yearly' | null (free)
  status text not null default 'active', -- 'active' | 'canceled' | 'past_due' | 'trialing'
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- FORMS
-- ============================================================
create table public.forms (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  description text,
  fields jsonb not null default '[]', -- array of field definitions
  settings jsonb not null default '{}', -- theme, notifications, etc.
  is_published boolean default false,
  is_archived boolean default false,
  response_count integer default 0,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- FORM SUBMISSIONS
-- ============================================================
create table public.form_submissions (
  id uuid default uuid_generate_v4() primary key,
  form_id uuid references public.forms(id) on delete cascade not null,
  data jsonb not null default '{}', -- submitted field values
  respondent_email text,
  ip_address text,
  submitted_at timestamptz default now() not null
);

-- ============================================================
-- LINKS (partner sites, grant portals, resources)
-- ============================================================
create table public.links (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  url text not null,
  description text,
  category text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- INVENTORY (donated supplies, equipment, resources)
-- ============================================================
create table public.inventory_items (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  description text,
  quantity integer default 0,
  unit text, -- 'boxes', 'units', 'lbs', etc.
  category text,
  condition text, -- 'new' | 'good' | 'fair' | 'poor'
  location text,
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- ORGANIZATION SETTINGS
-- ============================================================
create table public.organization_settings (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade unique not null,
  organization_name text,
  logo_url text,
  primary_color text default '#6366f1',
  contact_email text,
  website text,
  mission_statement text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- TEAM MEMBERS
-- ============================================================
create table public.team_members (
  id uuid default uuid_generate_v4() primary key,
  owner_id uuid references public.profiles(id) on delete cascade not null,
  member_id uuid references public.profiles(id) on delete cascade,
  email text not null,
  role text not null default 'member', -- 'admin' | 'member' | 'viewer'
  status text not null default 'pending', -- 'pending' | 'active'
  invited_at timestamptz default now() not null,
  joined_at timestamptz,
  unique(owner_id, email)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.forms enable row level security;
alter table public.form_submissions enable row level security;
alter table public.links enable row level security;
alter table public.inventory_items enable row level security;
alter table public.organization_settings enable row level security;
alter table public.team_members enable row level security;

-- Profiles: users can only see/edit their own
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- Subscriptions: users can only see their own
create policy "subscriptions_select_own" on public.subscriptions for select using (auth.uid() = user_id);

-- Forms: users can CRUD their own forms; team members can view
create policy "forms_select_own" on public.forms for select using (auth.uid() = user_id);
create policy "forms_insert_own" on public.forms for insert with check (auth.uid() = user_id);
create policy "forms_update_own" on public.forms for update using (auth.uid() = user_id);
create policy "forms_delete_own" on public.forms for delete using (auth.uid() = user_id);

-- Form submissions: owner of the form can see submissions; anyone can insert (public form submission)
create policy "submissions_select_owner" on public.form_submissions for select
  using (exists (select 1 from public.forms where forms.id = form_id and forms.user_id = auth.uid()));
create policy "submissions_insert_public" on public.form_submissions for insert with check (true);

-- Links: users can CRUD their own
create policy "links_select_own" on public.links for select using (auth.uid() = user_id);
create policy "links_insert_own" on public.links for insert with check (auth.uid() = user_id);
create policy "links_update_own" on public.links for update using (auth.uid() = user_id);
create policy "links_delete_own" on public.links for delete using (auth.uid() = user_id);

-- Inventory: users can CRUD their own
create policy "inventory_select_own" on public.inventory_items for select using (auth.uid() = user_id);
create policy "inventory_insert_own" on public.inventory_items for insert with check (auth.uid() = user_id);
create policy "inventory_update_own" on public.inventory_items for update using (auth.uid() = user_id);
create policy "inventory_delete_own" on public.inventory_items for delete using (auth.uid() = user_id);

-- Settings: users can CRUD their own
create policy "settings_select_own" on public.organization_settings for select using (auth.uid() = user_id);
create policy "settings_insert_own" on public.organization_settings for insert with check (auth.uid() = user_id);
create policy "settings_update_own" on public.organization_settings for update using (auth.uid() = user_id);

-- Team: owner can manage, members can see their own invites
create policy "team_select_own" on public.team_members for select using (auth.uid() = owner_id or auth.uid() = member_id);
create policy "team_insert_own" on public.team_members for insert with check (auth.uid() = owner_id);
create policy "team_update_own" on public.team_members for update using (auth.uid() = owner_id);
create policy "team_delete_own" on public.team_members for delete using (auth.uid() = owner_id);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  );

  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active');

  insert into public.organization_settings (user_id)
  values (new.id);

  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Auto-update updated_at timestamps
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.handle_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute procedure public.handle_updated_at();
create trigger forms_updated_at before update on public.forms for each row execute procedure public.handle_updated_at();
create trigger links_updated_at before update on public.links for each row execute procedure public.handle_updated_at();
create trigger inventory_updated_at before update on public.inventory_items for each row execute procedure public.handle_updated_at();
create trigger settings_updated_at before update on public.organization_settings for each row execute procedure public.handle_updated_at();

-- Auto-update form response_count
create or replace function public.update_form_response_count()
returns trigger as $$
begin
  update public.forms
  set response_count = (
    select count(*) from public.form_submissions where form_id = new.form_id
  )
  where id = new.form_id;
  return new;
end;
$$ language plpgsql;

create trigger on_submission_created
  after insert on public.form_submissions
  for each row execute procedure public.update_form_response_count();
