-- Fase 4 — Agenda propia de HelloPx
--
-- Retira el experimento Google Calendar del MVP y crea
-- las entidades mínimas de agenda/disponibilidad.
--
-- La timezone sigue perteneciendo a public.doctors.timezone.
--
-- Disponibilidad futura:
-- horario habitual
-- - citas confirmadas
-- - indisponibilidad recurrente
-- - indisponibilidad puntual
-- = slots disponibles


-- =========================================================
-- 1. RETIRAR EXPERIMENTO GOOGLE CALENDAR
-- =========================================================

drop function if exists public.upsert_doctor_google_calendar_credential(uuid, text);
drop function if exists public.get_doctor_google_calendar_refresh_token(uuid);
drop function if exists public.delete_doctor_google_calendar_credential(uuid);

drop table if exists private.doctor_google_calendar_credentials cascade;
drop table if exists public.doctor_google_calendar_connections cascade;

-- Esta tabla pertenecía al modelo anterior de bloqueos
-- semánticos + sincronización Google.
drop table if exists public.doctor_calendar_blocks cascade;


-- =========================================================
-- 2. HORARIO HABITUAL DEL DOCTOR
-- =========================================================
--
-- weekday usa ISO:
-- 1 lunes
-- ...
-- 7 domingo
--
-- Un día sin filas significa que el doctor no atiende.
--
-- Ejemplo:
-- lunes 09:00-14:00
-- lunes 16:00-19:00
-- = dos filas.

create table public.doctor_schedule_windows (
    id uuid primary key default gen_random_uuid(),

    doctor_id uuid not null
        references public.doctors(id)
        on delete cascade,

    weekday smallint not null
        check (weekday between 1 and 7),

    start_local time not null,
    end_local time not null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint doctor_schedule_windows_valid_range
        check (start_local < end_local)
);

create index doctor_schedule_windows_doctor_weekday_idx
on public.doctor_schedule_windows (
    doctor_id,
    weekday,
    start_local
);


-- =========================================================
-- 3. INDISPONIBILIDAD RECURRENTE
-- =========================================================
--
-- Ejemplo:
-- martes 13:00-15:00
-- jueves 13:00-15:00
--
-- Si la UI permite seleccionar varios días, crea una fila
-- por día seleccionado.
--
-- internal_note es exclusivamente interna.
-- Nunca deberá formar parte del contrato de disponibilidad
-- consumido por Retell/paciente.

create table public.doctor_recurring_unavailability (
    id uuid primary key default gen_random_uuid(),

    doctor_id uuid not null
        references public.doctors(id)
        on delete cascade,

    weekday smallint not null
        check (weekday between 1 and 7),

    start_local time not null,
    end_local time not null,

    internal_note text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint doctor_recurring_unavailability_valid_range
        check (start_local < end_local)
);

create index doctor_recurring_unavailability_doctor_weekday_idx
on public.doctor_recurring_unavailability (
    doctor_id,
    weekday,
    start_local
);


-- =========================================================
-- 4. INDISPONIBILIDAD PUNTUAL
-- =========================================================
--
-- Sirve para:
-- - unas horas
-- - un día completo
-- - varios días
--
-- La UI recibe fecha/hora local del doctor.
-- El servidor usa public.doctors.timezone para convertir
-- esas fechas a timestamptz.
--
-- No existen categorías como VACATION / CONFERENCE / FOOD.
-- Para disponibilidad sólo significa: NO DISPONIBLE.

create table public.doctor_unavailability (
    id uuid primary key default gen_random_uuid(),

    doctor_id uuid not null
        references public.doctors(id)
        on delete cascade,

    start_at timestamptz not null,
    end_at timestamptz not null,

    internal_note text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint doctor_unavailability_valid_range
        check (start_at < end_at)
);

create index doctor_unavailability_doctor_time_idx
on public.doctor_unavailability (
    doctor_id,
    start_at,
    end_at
);


-- =========================================================
-- 5. CITAS HELLOPX
-- =========================================================
--
-- Una misma tabla para citas creadas por:
-- - doctor
-- - MASTER
-- - agente en el futuro
--
-- Todavía NO creamos patients ni appointment_types.
-- La cita ya almacena el intervalo real que ocupa,
-- por lo que disponibilidad no depende todavía de esas tablas.

create table public.appointments (
    id uuid primary key default gen_random_uuid(),

    doctor_id uuid not null
        references public.doctors(id)
        on delete cascade,

    patient_name text not null,

    start_at timestamptz not null,
    end_at timestamptz not null,

    status text not null default 'CONFIRMED'
        check (
            status in (
                'CONFIRMED',
                'CANCELLED'
            )
        ),

    created_source text not null
        check (
            created_source in (
                'DOCTOR',
                'MASTER',
                'AGENT'
            )
        ),

    created_by_user_id uuid
        references public.users(id)
        on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint appointments_valid_range
        check (start_at < end_at)
);

create index appointments_doctor_time_idx
on public.appointments (
    doctor_id,
    start_at,
    end_at
);

create index appointments_doctor_status_time_idx
on public.appointments (
    doctor_id,
    status,
    start_at
);


-- =========================================================
-- 6. RLS
-- =========================================================

alter table public.doctor_schedule_windows
enable row level security;

alter table public.doctor_recurring_unavailability
enable row level security;

alter table public.doctor_unavailability
enable row level security;

alter table public.appointments
enable row level security;


-- ---------------------------------------------------------
-- doctor_schedule_windows
-- ---------------------------------------------------------

create policy "doctor_schedule_windows_select"
on public.doctor_schedule_windows
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "doctor_schedule_windows_insert"
on public.doctor_schedule_windows
for insert
to authenticated
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "doctor_schedule_windows_update"
on public.doctor_schedule_windows
for update
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
)
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "doctor_schedule_windows_delete"
on public.doctor_schedule_windows
for delete
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);


-- ---------------------------------------------------------
-- doctor_recurring_unavailability
-- ---------------------------------------------------------

create policy "doctor_recurring_unavailability_select"
on public.doctor_recurring_unavailability
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "doctor_recurring_unavailability_insert"
on public.doctor_recurring_unavailability
for insert
to authenticated
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "doctor_recurring_unavailability_update"
on public.doctor_recurring_unavailability
for update
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
)
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "doctor_recurring_unavailability_delete"
on public.doctor_recurring_unavailability
for delete
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);


-- ---------------------------------------------------------
-- doctor_unavailability
-- ---------------------------------------------------------

create policy "doctor_unavailability_select"
on public.doctor_unavailability
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "doctor_unavailability_insert"
on public.doctor_unavailability
for insert
to authenticated
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "doctor_unavailability_update"
on public.doctor_unavailability
for update
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
)
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "doctor_unavailability_delete"
on public.doctor_unavailability
for delete
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);


-- ---------------------------------------------------------
-- appointments
-- ---------------------------------------------------------

create policy "appointments_select"
on public.appointments
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "appointments_insert"
on public.appointments
for insert
to authenticated
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "appointments_update"
on public.appointments
for update
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
)
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "appointments_delete"
on public.appointments
for delete
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);


-- =========================================================
-- 7. GRANTS
-- =========================================================

grant select, insert, update, delete
on table public.doctor_schedule_windows
to authenticated;

grant select, insert, update, delete
on table public.doctor_recurring_unavailability
to authenticated;

grant select, insert, update, delete
on table public.doctor_unavailability
to authenticated;

grant select, insert, update, delete
on table public.appointments
to authenticated;

grant select, insert, update, delete
on table public.doctor_schedule_windows,
         public.doctor_recurring_unavailability,
         public.doctor_unavailability,
         public.appointments
to service_role;