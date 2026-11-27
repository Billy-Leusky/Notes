-- Configuration Supabase pour la synchronisation de l'app Notes.
-- À coller dans Supabase : SQL Editor > New query > Run.

-- Table des notes (une ligne par note ; chaque utilisateur ne voit que les siennes)
create table if not exists public.notes (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null default '',
  html text not null default '',
  text text not null default '',
  recs int not null default 0,
  updated bigint not null,
  deleted boolean not null default false
);
alter table public.notes enable row level security;
drop policy if exists "notes perso" on public.notes;
create policy "notes perso" on public.notes for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Espace de stockage privé pour les enregistrements audio (un dossier par utilisateur)
insert into storage.buckets (id, name, public) values ('audio', 'audio', false)
  on conflict (id) do nothing;
drop policy if exists "audio perso" on storage.objects;
create policy "audio perso" on storage.objects for all to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
