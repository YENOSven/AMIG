create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  guest_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  check (guest_id is null or guest_id <> host_id)
);

create index if not exists game_rooms_host_id_idx on public.game_rooms(host_id);
create index if not exists game_rooms_guest_id_idx on public.game_rooms(guest_id);

alter table public.game_rooms enable row level security;
grant select, insert, delete on public.game_rooms to authenticated;

drop policy if exists "Players read their rooms" on public.game_rooms;
create policy "Players read their rooms"
on public.game_rooms for select
to authenticated
using (auth.uid() = host_id or auth.uid() = guest_id);

drop policy if exists "Players create rooms" on public.game_rooms;
create policy "Players create rooms"
on public.game_rooms for insert
to authenticated
with check (auth.uid() = host_id and guest_id is null);

drop policy if exists "Hosts delete their rooms" on public.game_rooms;
create policy "Hosts delete their rooms"
on public.game_rooms for delete
to authenticated
using (auth.uid() = host_id);

create or replace function public.join_game_room(room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_room public.game_rooms;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select *
  into selected_room
  from public.game_rooms
  where code = upper(trim(room_code))
  for update;

  if selected_room.id is null or selected_room.expires_at <= now() then
    raise exception 'Room not found or expired.';
  end if;

  if selected_room.host_id = auth.uid() then
    raise exception 'You cannot join your own room.';
  end if;

  if selected_room.guest_id is not null and selected_room.guest_id <> auth.uid() then
    raise exception 'This room is already full.';
  end if;

  update public.game_rooms
  set guest_id = auth.uid()
  where id = selected_room.id
  returning * into selected_room;

  return to_jsonb(selected_room);
end;
$$;

revoke all on function public.join_game_room(text) from public;
grant execute on function public.join_game_room(text) to authenticated;

create or replace function public.leave_game_room(room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  delete from public.game_rooms
  where id = room_id
    and host_id = auth.uid();

  if found then
    return;
  end if;

  update public.game_rooms
  set guest_id = null
  where id = room_id
    and guest_id = auth.uid();
end;
$$;

revoke all on function public.leave_game_room(uuid) from public;
grant execute on function public.leave_game_room(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_rooms'
  ) then
    alter publication supabase_realtime add table public.game_rooms;
  end if;
end
$$;

drop policy if exists "Room players receive broadcasts" on realtime.messages;
create policy "Room players receive broadcasts"
on realtime.messages for select
to authenticated
using (
  extension = 'broadcast'
  and exists (
    select 1
    from public.game_rooms
    where ('match-' || id::text) = (select realtime.topic())
      and (host_id = auth.uid() or guest_id = auth.uid())
      and expires_at > now()
  )
);

drop policy if exists "Room players send broadcasts" on realtime.messages;
create policy "Room players send broadcasts"
on realtime.messages for insert
to authenticated
with check (
  extension = 'broadcast'
  and exists (
    select 1
    from public.game_rooms
    where ('match-' || id::text) = (select realtime.topic())
      and (host_id = auth.uid() or guest_id = auth.uid())
      and expires_at > now()
  )
);

drop policy if exists "Room players receive presence" on realtime.messages;
create policy "Room players receive presence"
on realtime.messages for select
to authenticated
using (
  extension = 'presence'
  and exists (
    select 1
    from public.game_rooms
    where ('match-' || id::text) = (select realtime.topic())
      and (host_id = auth.uid() or guest_id = auth.uid())
      and expires_at > now()
  )
);

drop policy if exists "Room players send presence" on realtime.messages;
create policy "Room players send presence"
on realtime.messages for insert
to authenticated
with check (
  extension = 'presence'
  and exists (
    select 1
    from public.game_rooms
    where ('match-' || id::text) = (select realtime.topic())
      and (host_id = auth.uid() or guest_id = auth.uid())
      and expires_at > now()
  )
);
