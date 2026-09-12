-- HelloPx
-- Fase 5 — Generalizar reglas de anticipo
--
-- Modelo:
-- ALL
-- APPOINTMENT_TYPE
-- INTAKE_FIELD
--
-- Una regla = una condición simple + un anticipo.
-- V1 sólo soporta EQUALS para condiciones sobre intake fields.

alter table public.deposit_rules
    add column appointment_type_id uuid
        references public.appointment_types(id)
        on delete cascade,
    add column intake_field_id uuid
        references public.assistant_intake_fields(id)
        on delete cascade,
    add column operator text,
    add column condition_value text;


-- =========================================================
-- MIGRAR REGLAS LEGACY ORIGIN_CITY
-- =========================================================
--
-- Si existe una regla antigua:
-- ORIGIN_CITY / Escuinapa
--
-- intentamos convertirla a:
-- INTAKE_FIELD / origin_city / EQUALS / Escuinapa

update public.deposit_rules dr
set
    intake_field_id = aif.id,
    operator = 'EQUALS',
    condition_value = dr.origin_city
from public.assistant_intake_fields aif
where
    dr.scope = 'ORIGIN_CITY'
    and aif.doctor_id = dr.doctor_id
    and aif.field_key = 'origin_city';


-- No continuar destructivamente si alguna regla de ciudad
-- no pudo asociarse al campo correspondiente.

do $$
begin
    if exists (
        select 1
        from public.deposit_rules
        where
            scope = 'ORIGIN_CITY'
            and intake_field_id is null
    ) then
        raise exception
            'Hay reglas ORIGIN_CITY que no pueden migrarse porque el doctor no tiene un intake field origin_city.';
    end if;
end
$$;


update public.deposit_rules
set scope = 'INTAKE_FIELD'
where scope = 'ORIGIN_CITY';


-- =========================================================
-- REEMPLAZAR CONSTRAINTS
-- =========================================================

alter table public.deposit_rules
    drop constraint if exists deposit_rules_scope_check;

alter table public.deposit_rules
    drop constraint if exists deposit_rules_scope_consistency;


alter table public.deposit_rules
    add constraint deposit_rules_scope_check
    check (
        scope in (
            'ALL',
            'APPOINTMENT_TYPE',
            'INTAKE_FIELD'
        )
    );


alter table public.deposit_rules
    add constraint deposit_rules_operator_check
    check (
        operator is null
        or operator in ('EQUALS')
    );


alter table public.deposit_rules
    add constraint deposit_rules_scope_consistency
    check (
        (
            scope = 'ALL'
            and appointment_type_id is null
            and intake_field_id is null
            and operator is null
            and condition_value is null
        )
        or
        (
            scope = 'APPOINTMENT_TYPE'
            and appointment_type_id is not null
            and intake_field_id is null
            and operator is null
            and condition_value is null
        )
        or
        (
            scope = 'INTAKE_FIELD'
            and appointment_type_id is null
            and intake_field_id is not null
            and operator = 'EQUALS'
            and condition_value is not null
            and btrim(condition_value) <> ''
        )
    );


-- La ciudad deja de ser un concepto especial del modelo.

alter table public.deposit_rules
    drop column origin_city;


create index deposit_rules_appointment_type_idx
on public.deposit_rules (appointment_type_id);

create index deposit_rules_intake_field_idx
on public.deposit_rules (intake_field_id);