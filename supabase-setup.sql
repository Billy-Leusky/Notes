-- Configuration Supabase de l'app (notes, chants, sets, équipes).
-- À coller dans Supabase : SQL Editor > New query > Run. Le script peut être relancé sans risque.

-- ===== Documents : une ligne par note, chant, set, chant d'un set, enregistrement, note perso =====
-- data._ts = { champ: horodatage de sa dernière modification } : sert à fusionner champ par champ.
create table if not exists public.docs (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  team_id uuid,
  kind text not null,
  data jsonb not null default '{}'::jsonb,
  updated bigint not null,
  deleted boolean not null default false
);
alter table public.docs drop constraint if exists docs_kind_check;
alter table public.docs add constraint docs_kind_check check (kind in ('note', 'song', 'set', 'item', 'rec', 'pnote'));
create index if not exists docs_user_id_idx on public.docs (user_id);
create index if not exists docs_team_id_idx on public.docs (team_id);
create index if not exists docs_updated_idx on public.docs (updated);

-- ===== Équipes =====
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.team_members (
  team_id uuid not null references public.teams on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  name text not null default '',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user_idx on public.team_members (user_id);
alter table public.docs drop constraint if exists docs_team_fk;
alter table public.docs add constraint docs_team_fk foreign key (team_id) references public.teams on delete cascade;

-- Fonctions internes (schéma privé, non exposé par l'API) utilisées par les règles d'accès
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.my_team_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$ select team_id from public.team_members where user_id = auth.uid() $$;
create or replace function private.my_admin_team_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$ select team_id from public.team_members where user_id = auth.uid() and role = 'admin' $$;
revoke execute on function private.my_team_ids(), private.my_admin_team_ids() from public, anon;
grant execute on function private.my_team_ids(), private.my_admin_team_ids() to authenticated;
create index if not exists teams_created_by_idx on public.teams (created_by);

-- ===== Règles d'accès =====
alter table public.docs enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
drop policy if exists "teams visibles" on public.teams;
create policy "teams visibles" on public.teams for select to authenticated using (id in (select private.my_team_ids()));
drop policy if exists "teams admin" on public.teams;
create policy "teams admin" on public.teams for update to authenticated
  using (id in (select private.my_admin_team_ids())) with check (id in (select private.my_admin_team_ids()));
drop policy if exists "membres visibles" on public.team_members;
create policy "membres visibles" on public.team_members for select to authenticated using (team_id in (select private.my_team_ids()));
drop policy if exists "quitter ou retirer" on public.team_members;
create policy "quitter ou retirer" on public.team_members for delete to authenticated
  using (user_id = (select auth.uid()) or team_id in (select private.my_admin_team_ids()));
-- Lecture : mes documents + ceux de mes équipes. Écriture : mes documents perso ; dans une équipe,
-- les responsables modifient tout, les musiciens gèrent seulement leurs propres enregistrements.
drop policy if exists "docs perso" on public.docs;
drop policy if exists "docs lecture" on public.docs;
drop policy if exists "docs ajout" on public.docs;
drop policy if exists "docs modif" on public.docs;
create policy "docs lecture" on public.docs for select to authenticated
  using (user_id = (select auth.uid()) or team_id in (select private.my_team_ids()));
create policy "docs ajout" on public.docs for insert to authenticated with check (
  (team_id is null and user_id = (select auth.uid()))
  or team_id in (select private.my_admin_team_ids())
  or (kind = 'rec' and user_id = (select auth.uid()) and team_id in (select private.my_team_ids())));
create policy "docs modif" on public.docs for update to authenticated using (
  (team_id is null and user_id = (select auth.uid()))
  or team_id in (select private.my_admin_team_ids())
  or (kind = 'rec' and user_id = (select auth.uid()) and team_id in (select private.my_team_ids())))
with check (
  (team_id is null and user_id = (select auth.uid()))
  or team_id in (select private.my_admin_team_ids())
  or (kind = 'rec' and user_id = (select auth.uid()) and team_id in (select private.my_team_ids())));

-- ===== Fusion champ par champ (atomique) : la modification la plus récente de chaque champ gagne =====
create or replace function public.merge_doc(p_id text, p_kind text, p_team uuid, p_data jsonb, p_deleted boolean default false)
returns public.docs language plpgsql security invoker set search_path = public
as $$
declare
  d public.docs; m jsonb; k text;
  tin jsonb := coalesce(p_data -> '_ts', '{}'::jsonb); tcur jsonb;
  now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000);
begin
  select * into d from public.docs where id = p_id for update;
  if not found then
    insert into public.docs (id, team_id, kind, data, updated, deleted)
    values (p_id, p_team, p_kind, p_data, now_ms, coalesce(p_deleted, false)) returning * into d;
    return d;
  end if;
  m := d.data; tcur := coalesce(d.data -> '_ts', '{}'::jsonb);
  for k in select jsonb_object_keys(p_data) loop
    if k <> '_ts' and coalesce((tin ->> k)::numeric, 0) >= coalesce((tcur ->> k)::numeric, 0) then
      m := jsonb_set(m, array[k], p_data -> k, true);
      tcur := jsonb_set(tcur, array[k], coalesce(tin -> k, '0'::jsonb), true);
    end if;
  end loop;
  m := jsonb_set(m, '{_ts}', tcur, true);
  update public.docs set data = m, updated = greatest(now_ms, d.updated + 1),
    deleted = d.deleted or coalesce(p_deleted, false), team_id = coalesce(p_team, d.team_id)
  where id = p_id returning * into d;
  return d;
end $$;

-- ===== Gestion des équipes =====
create or replace function public.new_code() returns text language sql volatile set search_path = public
as $$ select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)) $$;
create or replace function public.create_team(p_name text, p_member_name text) returns public.teams
language plpgsql security definer set search_path = public
as $$
declare t public.teams; c text;
begin
  if auth.uid() is null then raise exception 'non_connecte'; end if;
  loop c := public.new_code(); exit when not exists (select 1 from public.teams where code = c); end loop;
  insert into public.teams (name, code, created_by) values (coalesce(nullif(trim(p_name), ''), 'Mon équipe'), c, auth.uid()) returning * into t;
  insert into public.team_members (team_id, user_id, role, name) values (t.id, auth.uid(), 'admin', coalesce(trim(p_member_name), ''));
  return t;
end $$;
create or replace function public.join_team(p_code text, p_member_name text) returns public.teams
language plpgsql security definer set search_path = public
as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'non_connecte'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then raise exception 'code_invalide'; end if;
  insert into public.team_members (team_id, user_id, role, name) values (t.id, auth.uid(), 'member', coalesce(trim(p_member_name), ''))
  on conflict (team_id, user_id) do update set name = case when excluded.name <> '' then excluded.name else public.team_members.name end;
  return t;
end $$;
create or replace function public.set_member_role(p_team uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.team_members where team_id = p_team and user_id = auth.uid() and role = 'admin') then raise exception 'reserve_responsable'; end if;
  if p_role not in ('admin', 'member') then raise exception 'role_invalide'; end if;
  if p_role = 'member' and (select count(*) from public.team_members where team_id = p_team and role = 'admin' and user_id <> p_user) = 0 then raise exception 'dernier_responsable'; end if;
  update public.team_members set role = p_role where team_id = p_team and user_id = p_user;
end $$;
create or replace function public.set_my_name(p_team uuid, p_name text) returns void
language sql security definer set search_path = public
as $$ update public.team_members set name = trim(p_name) where team_id = p_team and user_id = auth.uid() $$;
create or replace function public.renew_team_code(p_team uuid) returns text
language plpgsql security definer set search_path = public
as $$
declare c text;
begin
  if not exists (select 1 from public.team_members where team_id = p_team and user_id = auth.uid() and role = 'admin') then raise exception 'reserve_responsable'; end if;
  loop c := public.new_code(); exit when not exists (select 1 from public.teams where code = c); end loop;
  update public.teams set code = c where id = p_team;
  return c;
end $$;
revoke execute on function public.create_team(text, text), public.join_team(text, text), public.set_member_role(uuid, uuid, text),
  public.set_my_name(uuid, text), public.renew_team_code(uuid), public.merge_doc(text, text, uuid, jsonb, boolean),
  public.new_code() from public, anon;
grant execute on function public.create_team(text, text), public.join_team(text, text), public.set_member_role(uuid, uuid, text),
  public.set_my_name(uuid, text), public.renew_team_code(uuid), public.merge_doc(text, text, uuid, jsonb, boolean) to authenticated;

-- ===== Audio : chacun écrit dans son dossier ; lecture de ses fichiers et de ceux de ses équipes =====
insert into storage.buckets (id, name, public) values ('audio', 'audio', false) on conflict (id) do nothing;
drop policy if exists "audio perso" on storage.objects;
drop policy if exists "audio lecture" on storage.objects;
drop policy if exists "audio ajout" on storage.objects;
drop policy if exists "audio maj" on storage.objects;
drop policy if exists "audio suppr" on storage.objects;
create policy "audio lecture" on storage.objects for select to authenticated using (
  bucket_id = 'audio' and ((storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.docs d where d.id = storage.filename(name) and d.kind = 'rec' and d.team_id in (select private.my_team_ids()))));
create policy "audio ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio maj" on storage.objects for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio suppr" on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ===== Temps réel =====
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'docs') then alter publication supabase_realtime add table public.docs; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'teams') then alter publication supabase_realtime add table public.teams; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'team_members') then alter publication supabase_realtime add table public.team_members; end if;
end $$;
