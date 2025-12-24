-- Add manager role, profile fields, and password fingerprint for uniqueness

-- 1) Expand role enum check
alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check check (role in ('manager','admin','teacher','student'));

-- 2) Profile fields required by UI
alter table public.users
  add column if not exists first_name text null,
  add column if not exists last_name text null,
  add column if not exists middle_name text null,
  add column if not exists phone text null,
  add column if not exists birth_date date null,
  add column if not exists photo_data_url text null,
  add column if not exists teacher_subject text null;

-- 3) Password uniqueness support (hashed passwords are salted)
alter table public.users
  add column if not exists password_fingerprint text null;

create unique index if not exists uq_users_password_fingerprint
  on public.users(password_fingerprint)
  where password_fingerprint is not null;

-- 4) Seed a default manager account (username: Alikbek, password: alikbek)
-- NOTE: password_hash will be set by backend bootstrap tool; this seed is optional.
-- Keeping it here as a reminder only (cannot hash here without knowing algo params).
