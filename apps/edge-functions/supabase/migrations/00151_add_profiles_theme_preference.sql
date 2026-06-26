-- Per-user UI theme preference for light/dark/system.
-- Default 'system' so existing users follow their device until they choose.
alter table public.profiles
  add column theme_preference text not null default 'system'
  check (theme_preference in ('light','dark','system'));
