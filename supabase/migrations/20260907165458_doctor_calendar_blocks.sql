-- Fase 4D — Bloqueos operativos de calendario
--
-- AgendaPX conserva la semántica del bloqueo.
-- Google Calendar conserva su representación visual mediante google_event_id.

create table public.doctor_calendar_blocks (
    id uuid primary key default gen_random_uuid(),

    doctor_id uuid not null
        references public.doctors(id)
        on delete cascade,

    block_type text not null
        check (
            block_type in (
                'TIME_BLOCK',
                'NON_WORKING_DAY',
                'VACATION',
                'CONFERENCE'
            )
        ),

    start_at timestamptz not null,
    end_at timestamptz not null,

    all_day boolean not null default false,

    label text,

    google_event_id text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint doctor_calendar_blocks_valid_range
        check (start_at < end_at)
);


-- Búsqueda principal futura:
-- doctor + rango temporal.
create index doctor_calendar_blocks_doctor_time_idx
on public.doctor_calendar_blocks (
    doctor_id,
    start_at,
    end_at
);


-- Un mismo evento Google no debe representar dos bloqueos
-- del mismo doctor.
create unique index doctor_calendar_blocks_google_event_idx
on public.doctor_calendar_blocks (
    doctor_id,
    google_event_id
)
where google_event_id is not null;


-- Seguridad por tenant.
alter table public.doctor_calendar_blocks
enable row level security;


-- DOCTOR lee solamente sus propios bloqueos.
-- MASTER puede leerlos todos para soporte.
create policy "doctor_calendar_blocks_select"
on public.doctor_calendar_blocks
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);


-- La aplicación autenticada necesita privilegio SELECT;
-- RLS determina qué filas puede ver.
grant select
on table public.doctor_calendar_blocks
to authenticated;


-- Las escrituras se realizan exclusivamente desde backend
-- usando el cliente service_role.
grant select, insert, update, delete
on table public.doctor_calendar_blocks
to service_role;