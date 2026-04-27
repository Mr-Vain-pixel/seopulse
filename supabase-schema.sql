-- Dieses SQL im Supabase SQL-Editor ausführen (einmalig)
-- Supabase Dashboard → SQL Editor → New query → einfügen → Run

-- 1. Profiles Tabelle (User-Daten + Plan + Limits)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  plan text default 'free' check (plan in ('free', 'pro')),
  analyses_today integer default 0,
  last_analysis_date timestamptz,
  created_at timestamptz default now()
);

-- 2. Analysen Tabelle
create table if not exists public.analyses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  url text not null,
  score integer,
  issues_critical integer default 0,
  issues_warnings integer default 0,
  result_json jsonb,
  created_at timestamptz default now()
);

-- 3. Row Level Security aktivieren
alter table public.profiles enable row level security;
alter table public.analyses enable row level security;

-- 4. Policies: User sieht nur eigene Daten
create policy "User sieht eigenes Profil"
  on public.profiles for all
  using (auth.uid() = id);

create policy "User sieht eigene Analysen"
  on public.analyses for all
  using (auth.uid() = user_id);

-- 5. Trigger: Profil automatisch erstellen bei Registrierung
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Neue Spalten für Stripe/PayPal (einmalig ausführen)
alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists paypal_subscription_id text,
  add column if not exists plan_started_at timestamptz;
