-- AgendaPX
-- Add the doctor's operational timezone.
--
-- The timezone belongs to the doctor tenant / medical practice rather than
-- the application user. Agenda, voice agent and calendar integrations must
-- operate using this IANA timezone.

alter table public.doctors
  add column timezone text;

update public.doctors
set timezone = 'America/Mazatlan'
where timezone is null;

alter table public.doctors
  alter column timezone set not null;
