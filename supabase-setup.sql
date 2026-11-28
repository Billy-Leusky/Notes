-- Configuration Supabase pour la synchronisation de l'app (notes, chants, sets).
-- À coller dans Supabase : SQL Editor > New query > Run.
-- Le script peut être relancé sans risque.

-- Table des documents : une ligne par note, chant ou set.
-- « data » contient le document lui-même ; chaque utilisateur ne voit que les siens.
-- (team_id servira à l'étape 2 : partage avec l'équipe.)
create table if not exists public.docs (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  team_id uuid,
  kind text not null check (kind in ('note', 'song', 'set')),
  data jsonb not null default '{}'::jsonb,
  updated bigint not null,
  deleted boolean not null default false
);
alter table public.docs enable row level security;
drop policy if exists "docs perso" on public.docs;
create policy "docs perso" on public.docs for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Espace de stockage privé pour les enregistrements audio (un dossier par utilisateur)
insert into storage.buckets (id, name, public) values ('audio', 'audio', false)
  on conflict (id) do nothing;
drop policy if exists "audio perso" on storage.objects;
create policy "audio perso" on storage.objects for all to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
