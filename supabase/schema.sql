create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(username) between 3 and 32),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]+$')
);

create unique index profiles_username_lower_key
  on public.profiles (lower(username));

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, name),
  constraint folders_name_not_blank check (char_length(btrim(name)) between 1 and 80)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, normalized_name),
  constraint tags_name_not_blank check (char_length(btrim(name)) between 1 and 32)
);

create index folders_owner_position_idx on public.folders (owner_id, position);
create index tags_owner_name_idx on public.tags (owner_id, normalized_name);

create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid,
  title text not null default '',
  description text not null default '',
  draft_content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (folder_id, owner_id)
    references public.folders (id, owner_id)
    on delete set null
);

create index prompts_owner_updated_idx on public.prompts (owner_id, updated_at desc);
create index prompts_owner_folder_idx on public.prompts (owner_id, folder_id);

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  content text not null default '',
  position integer not null,
  created_at timestamptz not null default now(),
  constraint prompt_versions_position_positive check (position > 0),
  unique (prompt_id, position)
);

create table public.prompt_tags (
  owner_id uuid not null references auth.users(id) on delete cascade,
  prompt_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (prompt_id, tag_id),
  foreign key (prompt_id, owner_id)
    references public.prompts (id, owner_id)
    on delete cascade,
  foreign key (tag_id, owner_id)
    references public.tags (id, owner_id)
    on delete cascade
);

create index prompt_tags_owner_tag_idx on public.prompt_tags (owner_id, tag_id);

alter table public.profiles enable row level security;
alter table public.folders enable row level security;
alter table public.tags enable row level security;
alter table public.prompts enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.prompt_tags enable row level security;

create policy "profiles_read_authenticated" on public.profiles
  for select to authenticated using (true);
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_self" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "folders_select_own" on public.folders
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "folders_insert_own" on public.folders
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "folders_update_own" on public.folders
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "folders_delete_own" on public.folders
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "tags_select_own" on public.tags
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "tags_insert_own" on public.tags
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "tags_update_own" on public.tags
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "tags_delete_own" on public.tags
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "prompts_select_own" on public.prompts
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "prompts_insert_own" on public.prompts
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "prompts_update_own" on public.prompts
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "prompts_delete_own" on public.prompts
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "prompt_versions_select_own" on public.prompt_versions
  for select to authenticated using (exists (
    select 1 from public.prompts
    where prompts.id = prompt_versions.prompt_id
      and prompts.owner_id = (select auth.uid())
  ));
create policy "prompt_versions_insert_own" on public.prompt_versions
  for insert to authenticated with check (exists (
    select 1 from public.prompts
    where prompts.id = prompt_versions.prompt_id
      and prompts.owner_id = (select auth.uid())
  ));
create policy "prompt_versions_delete_own" on public.prompt_versions
  for delete to authenticated using (exists (
    select 1 from public.prompts
    where prompts.id = prompt_versions.prompt_id
      and prompts.owner_id = (select auth.uid())
  ));

create policy "prompt_tags_select_own" on public.prompt_tags
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "prompt_tags_insert_own" on public.prompt_tags
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "prompt_tags_delete_own" on public.prompt_tags
  for delete to authenticated using ((select auth.uid()) = owner_id);

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.folders to authenticated;
grant select, insert, update, delete on public.tags to authenticated;
grant select, insert, update, delete on public.prompts to authenticated;
grant select, insert, delete on public.prompt_versions to authenticated;
grant select, insert, delete on public.prompt_tags to authenticated;
revoke all on public.profiles, public.folders, public.tags, public.prompts, public.prompt_versions, public.prompt_tags from anon;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      'user_' || substr(replace(new.id::text, '-', ''), 1, 12)
    )
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
