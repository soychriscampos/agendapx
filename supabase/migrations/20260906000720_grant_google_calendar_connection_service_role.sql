-- Permitir que el backend privilegiado gestione la metadata
-- de Google Calendar durante OAuth y futuras operaciones server-side.

grant select, insert, update, delete
on table public.doctor_google_calendar_connections
to service_role;