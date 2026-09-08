-- Permitir lectura de metadata de Google Calendar a usuarios autenticados.
-- RLS sigue determinando qué filas puede leer cada usuario.

grant select
on table public.doctor_google_calendar_connections
to authenticated;