-- HelloPx
-- Fase 5 — Capacita a tu asistente
--
-- Configuración persistente que posteriormente consumirán
-- la aplicación, las tools de HelloPx y Retell.
--
-- NO duplica:
-- - doctors.timezone
-- - doctor_schedule_windows
-- - indisponibilidades
--
-- NO modifica todavía appointments ni crea flujos operativos
-- de solicitudes / anticipos.


-- =========================================================
-- 1. INFORMACIÓN PÚBLICA DEL CONSULTORIO
-- =========================================================

alter table public.doctors
    add column specialty text,
    add column address text;


-- =========================================================
-- 2. CONFIGURACIÓN GENERAL DEL ASISTENTE
-- =========================================================
--
-- Una fila por doctor.
--
-- assistant_name puede permanecer null mientras el producto
-- utiliza un nombre predeterminado en la aplicación.
--
-- Las reglas aquí son configuración, no ejecución del flujo.

create table public.assistant_settings (
    doctor_id uuid primary key
        references public.doctors(id)
        on delete cascade,

    assistant_name text,

    confirmation_lead_minutes integer
        check (
            confirmation_lead_minutes is null
            or confirmation_lead_minutes >= 0
        ),

    confirmation_response_window_minutes integer
        check (
            confirmation_response_window_minutes is null
            or confirmation_response_window_minutes > 0
        ),

    manual_follow_up_on_no_answer boolean
        not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- =========================================================
-- 3. TIPOS DE CITA
-- =========================================================
--
-- Catálogo propio de cada doctor.
--
-- price es opcional. Permite que el asistente pueda informar
-- costos sin crear después otra fuente de verdad.
--
-- Todavía NO relacionamos appointments con appointment_types.

create table public.appointment_types (
    id uuid primary key default gen_random_uuid(),

    doctor_id uuid not null
        references public.doctors(id)
        on delete cascade,

    name text not null,

    duration_minutes integer not null
        check (duration_minutes > 0),

    price numeric(10,2)
        check (
            price is null
            or price >= 0
        ),

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint appointment_types_name_not_blank
        check (btrim(name) <> '')
);

create index appointment_types_doctor_active_idx
on public.appointment_types (
    doctor_id,
    is_active
);


-- =========================================================
-- 4. DATOS QUE DEBE SOLICITAR EL ASISTENTE
-- =========================================================
--
-- Define QUÉ preguntar.
-- Todavía no almacena respuestas ni crea pacientes.
--
-- field_key será un identificador estable para que HelloPx
-- pueda reconocer campos conocidos o personalizados.
--
-- Ejemplos:
-- patient_name
-- phone
-- origin_city
-- reason_for_visit

create table public.assistant_intake_fields (
    id uuid primary key default gen_random_uuid(),

    doctor_id uuid not null
        references public.doctors(id)
        on delete cascade,

    field_key text not null,
    label text not null,

    is_required boolean not null default false,
    is_active boolean not null default true,

    sort_order integer not null default 0,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint assistant_intake_fields_key_not_blank
        check (btrim(field_key) <> ''),

    constraint assistant_intake_fields_label_not_blank
        check (btrim(label) <> ''),

    constraint assistant_intake_fields_unique_key
        unique (doctor_id, field_key)
);

create index assistant_intake_fields_doctor_order_idx
on public.assistant_intake_fields (
    doctor_id,
    sort_order,
    id
);


-- =========================================================
-- 5. REGLAS DE ANTICIPO
-- =========================================================
--
-- Fase 5 únicamente CAPACITA al asistente.
-- El flujo WAITING_DEPOSIT se implementará posteriormente.
--
-- scope:
-- ALL         -> aplica a cualquier paciente
-- ORIGIN_CITY -> aplica según ciudad/procedencia
--
-- Caso piloto:
-- ORIGIN_CITY / Escuinapa / PERCENTAGE / 50
--
-- deposit_type:
-- PERCENTAGE
-- FIXED

create table public.deposit_rules (
    id uuid primary key default gen_random_uuid(),

    doctor_id uuid not null
        references public.doctors(id)
        on delete cascade,

    name text not null,

    scope text not null
        check (
            scope in (
                'ALL',
                'ORIGIN_CITY'
            )
        ),

    origin_city text,

    deposit_type text not null
        check (
            deposit_type in (
                'PERCENTAGE',
                'FIXED'
            )
        ),

    deposit_value numeric(10,2) not null
        check (deposit_value > 0),

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint deposit_rules_name_not_blank
        check (btrim(name) <> ''),

    constraint deposit_rules_scope_consistency
        check (
            (
                scope = 'ALL'
                and origin_city is null
            )
            or
            (
                scope = 'ORIGIN_CITY'
                and origin_city is not null
                and btrim(origin_city) <> ''
            )
        ),

    constraint deposit_rules_percentage_valid
        check (
            deposit_type <> 'PERCENTAGE'
            or deposit_value <= 100
        )
);

create index deposit_rules_doctor_active_idx
on public.deposit_rules (
    doctor_id,
    is_active
);


-- =========================================================
-- 6. DATOS PARA RECIBIR ANTICIPOS
-- =========================================================
--
-- Una configuración por doctor.
--
-- Estos datos son operativos y posteriormente servirán para
-- construir el mensaje precargado de WhatsApp.
--
-- No son credenciales bancarias de acceso.

create table public.doctor_payment_instructions (
    doctor_id uuid primary key
        references public.doctors(id)
        on delete cascade,

    bank_name text,
    account_holder text,
    clabe text,
    account_number text,
    instructions text,
    message_template text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- =========================================================
-- 7. INFORMACIÓN ADMINISTRATIVA AUTORIZADA
-- =========================================================
--
-- Información que el doctor permite que el asistente responda.
--
-- Ejemplos:
-- - estacionamiento
-- - formas de pago
-- - servicios
-- - instrucciones administrativas
--
-- No debe utilizarse para expediente, diagnóstico,
-- indicaciones clínicas ni consejo médico.

create table public.assistant_knowledge_items (
    id uuid primary key default gen_random_uuid(),

    doctor_id uuid not null
        references public.doctors(id)
        on delete cascade,

    title text not null,
    content text not null,

    is_active boolean not null default true,
    sort_order integer not null default 0,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint assistant_knowledge_items_title_not_blank
        check (btrim(title) <> ''),

    constraint assistant_knowledge_items_content_not_blank
        check (btrim(content) <> '')
);

create index assistant_knowledge_items_doctor_order_idx
on public.assistant_knowledge_items (
    doctor_id,
    sort_order,
    id
);


-- =========================================================
-- 8. RLS
-- =========================================================

alter table public.assistant_settings
enable row level security;

alter table public.appointment_types
enable row level security;

alter table public.assistant_intake_fields
enable row level security;

alter table public.deposit_rules
enable row level security;

alter table public.doctor_payment_instructions
enable row level security;

alter table public.assistant_knowledge_items
enable row level security;


-- =========================================================
-- assistant_settings
-- =========================================================

create policy "assistant_settings_select"
on public.assistant_settings
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "assistant_settings_insert"
on public.assistant_settings
for insert
to authenticated
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "assistant_settings_update"
on public.assistant_settings
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

create policy "assistant_settings_delete"
on public.assistant_settings
for delete
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);


-- =========================================================
-- appointment_types
-- =========================================================

create policy "appointment_types_select"
on public.appointment_types
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "appointment_types_insert"
on public.appointment_types
for insert
to authenticated
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "appointment_types_update"
on public.appointment_types
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

create policy "appointment_types_delete"
on public.appointment_types
for delete
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);


-- =========================================================
-- assistant_intake_fields
-- =========================================================

create policy "assistant_intake_fields_select"
on public.assistant_intake_fields
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "assistant_intake_fields_insert"
on public.assistant_intake_fields
for insert
to authenticated
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "assistant_intake_fields_update"
on public.assistant_intake_fields
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

create policy "assistant_intake_fields_delete"
on public.assistant_intake_fields
for delete
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);


-- =========================================================
-- deposit_rules
-- =========================================================

create policy "deposit_rules_select"
on public.deposit_rules
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "deposit_rules_insert"
on public.deposit_rules
for insert
to authenticated
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "deposit_rules_update"
on public.deposit_rules
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

create policy "deposit_rules_delete"
on public.deposit_rules
for delete
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);


-- =========================================================
-- doctor_payment_instructions
-- =========================================================

create policy "doctor_payment_instructions_select"
on public.doctor_payment_instructions
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "doctor_payment_instructions_insert"
on public.doctor_payment_instructions
for insert
to authenticated
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "doctor_payment_instructions_update"
on public.doctor_payment_instructions
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

create policy "doctor_payment_instructions_delete"
on public.doctor_payment_instructions
for delete
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);


-- =========================================================
-- assistant_knowledge_items
-- =========================================================

create policy "assistant_knowledge_items_select"
on public.assistant_knowledge_items
for select
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "assistant_knowledge_items_insert"
on public.assistant_knowledge_items
for insert
to authenticated
with check (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);

create policy "assistant_knowledge_items_update"
on public.assistant_knowledge_items
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

create policy "assistant_knowledge_items_delete"
on public.assistant_knowledge_items
for delete
to authenticated
using (
    private.current_user_role() = 'MASTER'
    or doctor_id = private.current_doctor_id()
);


-- =========================================================
-- 9. DATA API PRIVILEGES
-- =========================================================

grant select, insert, update, delete
on table public.assistant_settings,
         public.appointment_types,
         public.assistant_intake_fields,
         public.deposit_rules,
         public.doctor_payment_instructions,
         public.assistant_knowledge_items
to authenticated;

grant select, insert, update, delete
on table public.assistant_settings,
         public.appointment_types,
         public.assistant_intake_fields,
         public.deposit_rules,
         public.doctor_payment_instructions,
         public.assistant_knowledge_items
to service_role;