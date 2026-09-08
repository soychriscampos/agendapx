-- Fase 4A — Google Calendar connection
-- Metadata no sensible en public.
-- Credenciales OAuth sensibles en private.

-- Metadata de la conexión Google Calendar por doctor.
create table public.doctor_google_calendar_connections (
    id uuid primary key default gen_random_uuid(),

    doctor_id uuid not null unique
        references public.doctors(id)
        on delete cascade,

    google_account_subject text not null,
    google_account_email text not null,

    calendar_id text not null default 'primary',

    scopes text[] not null default '{}',

    connected_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.doctor_google_calendar_connections
    enable row level security;

-- DOCTOR puede leer únicamente la conexión de su propio tenant.
-- MASTER puede leer cualquier conexión para soporte/onboarding.
create policy "doctor_google_calendar_connections_select"
on public.doctor_google_calendar_connections
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

-- No se crean policies INSERT / UPDATE / DELETE para authenticated.
-- Las escrituras se realizarán posteriormente exclusivamente server-side.


-- Credenciales OAuth sensibles.
-- private ya existe en AgendaPX y contiene los helpers de tenancy/auth.
create table private.doctor_google_calendar_credentials (
    connection_id uuid primary key
        references public.doctor_google_calendar_connections(id)
        on delete cascade,

    refresh_token text not null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Defensa adicional: no permitir acceso de los roles normales de la API.
revoke all on table private.doctor_google_calendar_credentials from anon;
revoke all on table private.doctor_google_calendar_credentials from authenticated;

-- service_role será usado únicamente desde código server-side
-- para gestionar las credenciales OAuth.
grant select, insert, update, delete
on table private.doctor_google_calendar_credentials
to service_role;