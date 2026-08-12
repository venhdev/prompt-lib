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

create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  tags text[] not null default '{}',
  updated_label text not null default 'vừa xong',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index prompts_owner_updated_idx
  on public.prompts (owner_id, updated_at desc);

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  name text not null,
  note text not null default '',
  created_label text not null default 'Bây giờ',
  content text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prompt_id, position)
);

create index prompt_versions_prompt_position_idx
  on public.prompt_versions (prompt_id, position);

alter table public.profiles enable row level security;
alter table public.prompts enable row level security;
alter table public.prompt_versions enable row level security;

create policy "profiles_read_authenticated"
  on public.profiles for select to authenticated using (true);
create policy "profiles_insert_self"
  on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "prompts_select_own"
  on public.prompts for select to authenticated using (auth.uid() = owner_id);
create policy "prompts_insert_own"
  on public.prompts for insert to authenticated with check (auth.uid() = owner_id);
create policy "prompts_update_own"
  on public.prompts for update to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "prompts_delete_own"
  on public.prompts for delete to authenticated using (auth.uid() = owner_id);

create policy "prompt_versions_select_own"
  on public.prompt_versions for select to authenticated
  using (exists (
    select 1 from public.prompts
    where prompts.id = prompt_versions.prompt_id
      and prompts.owner_id = auth.uid()
  ));
create policy "prompt_versions_insert_own"
  on public.prompt_versions for insert to authenticated
  with check (exists (
    select 1 from public.prompts
    where prompts.id = prompt_versions.prompt_id
      and prompts.owner_id = auth.uid()
  ));
create policy "prompt_versions_update_own"
  on public.prompt_versions for update to authenticated
  using (exists (
    select 1 from public.prompts
    where prompts.id = prompt_versions.prompt_id
      and prompts.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.prompts
    where prompts.id = prompt_versions.prompt_id
      and prompts.owner_id = auth.uid()
  ));
create policy "prompt_versions_delete_own"
  on public.prompt_versions for delete to authenticated
  using (exists (
    select 1 from public.prompts
    where prompts.id = prompt_versions.prompt_id
      and prompts.owner_id = auth.uid()
  ));

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.prompts to authenticated;
grant select, insert, update, delete on public.prompt_versions to authenticated;
revoke all on public.profiles, public.prompts, public.prompt_versions from anon;

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
