-- LCB Training – Datenbank-Schema für Supabase
-- Einmal ausführen: Supabase → SQL Editor → New query → einfügen → Run.
--
-- Eine Tabelle für alle Einträge. kind = exercises | sets | tests | throws | results | baselines | profile.
-- data enthält den Eintrag als JSON (gleiches Format wie das JSON-Backup der App).

create table if not exists public.entries (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

-- Zugriffsregeln: jede Person sieht und ändert nur ihre eigenen Zeilen.
alter table public.entries enable row level security;

drop policy if exists "eigene Einträge lesen" on public.entries;
drop policy if exists "eigene Einträge anlegen" on public.entries;
drop policy if exists "eigene Einträge ändern" on public.entries;
drop policy if exists "eigene Einträge löschen" on public.entries;

create policy "eigene Einträge lesen"   on public.entries for select to authenticated using (user_id = auth.uid());
create policy "eigene Einträge anlegen" on public.entries for insert to authenticated with check (user_id = auth.uid());
create policy "eigene Einträge ändern"  on public.entries for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "eigene Einträge löschen" on public.entries for delete to authenticated using (user_id = auth.uid());

-- Nicht angemeldete Besucher haben keinerlei Zugriff.
revoke all on public.entries from anon;
grant select, insert, update, delete on public.entries to authenticated;
