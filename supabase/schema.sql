-- Tables cloud pour Sublimilou
create table if not exists public.tracks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  duration integer not null default 0,
  thumbnail text,
  youtube_url text,
  video_id text,
  tags text[] not null default '{}',
  affirmations text[] not null default '{}',
  source text not null default 'import',
  playlist_ids uuid[] not null default '{}',
  mime_type text not null default 'audio/mp4',
  storage_path text,
  created_at bigint not null
);

create table if not exists public.playlists (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  track_ids uuid[] not null default '{}',
  created_at bigint not null
);

alter table public.tracks enable row level security;
alter table public.playlists enable row level security;

drop policy if exists "tracks_select_own" on public.tracks;
drop policy if exists "tracks_insert_own" on public.tracks;
drop policy if exists "tracks_update_own" on public.tracks;
drop policy if exists "tracks_delete_own" on public.tracks;

create policy "tracks_select_own" on public.tracks
for select using (auth.uid() = user_id);
create policy "tracks_insert_own" on public.tracks
for insert with check (auth.uid() = user_id);
create policy "tracks_update_own" on public.tracks
for update using (auth.uid() = user_id);
create policy "tracks_delete_own" on public.tracks
for delete using (auth.uid() = user_id);

drop policy if exists "playlists_select_own" on public.playlists;
drop policy if exists "playlists_insert_own" on public.playlists;
drop policy if exists "playlists_update_own" on public.playlists;
drop policy if exists "playlists_delete_own" on public.playlists;

create policy "playlists_select_own" on public.playlists
for select using (auth.uid() = user_id);
create policy "playlists_insert_own" on public.playlists
for insert with check (auth.uid() = user_id);
create policy "playlists_update_own" on public.playlists
for update using (auth.uid() = user_id);
create policy "playlists_delete_own" on public.playlists
for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

drop policy if exists "audio_select_own" on storage.objects;
drop policy if exists "audio_insert_own" on storage.objects;
drop policy if exists "audio_update_own" on storage.objects;
drop policy if exists "audio_delete_own" on storage.objects;

create policy "audio_select_own" on storage.objects
for select using (bucket_id = 'audio' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "audio_insert_own" on storage.objects
for insert with check (bucket_id = 'audio' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "audio_update_own" on storage.objects
for update using (bucket_id = 'audio' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "audio_delete_own" on storage.objects
for delete using (bucket_id = 'audio' and auth.uid()::text = (storage.foldername(name))[1]);
