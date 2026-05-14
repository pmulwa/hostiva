create table if not exists public.message_translations (
  message_id uuid not null references public.messages(id) on delete cascade,
  target_language text not null,
  translation text not null,
  source_language text,
  created_at timestamptz not null default now(),
  primary key (message_id, target_language)
);

create index if not exists idx_message_translations_message
  on public.message_translations(message_id);

alter table public.message_translations enable row level security;

drop policy if exists "Translations readable by message participants" on public.message_translations;
create policy "Translations readable by message participants"
on public.message_translations
for select
to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_translations.message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
);
