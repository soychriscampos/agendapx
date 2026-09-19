-- HelloPx MVP:
-- Las reglas nuevas/activas de anticipo sólo pueden ser cantidades fijas.
-- Las reglas históricas PERCENTAGE pueden conservarse únicamente inactivas.
-- Los snapshots históricos de appointment_requests NO se modifican.

-- 1. Desactivar cualquier regla porcentual que todavía esté activa.
update public.deposit_rules
set is_active = false
where deposit_type = 'PERCENTAGE'
  and is_active = true;

-- 2. Eliminar la validación antigua específica de porcentajes.
alter table public.deposit_rules
drop constraint if exists deposit_rules_percentage_valid;

-- 3. Sustituir la constraint del tipo.
alter table public.deposit_rules
drop constraint if exists deposit_rules_deposit_type_check;

-- FIXED puede existir activo o inactivo.
-- PERCENTAGE sólo puede mantenerse como dato histórico inactivo.
alter table public.deposit_rules
add constraint deposit_rules_deposit_type_check
check (
  deposit_type = 'FIXED'
  or (
    deposit_type = 'PERCENTAGE'
    and is_active = false
  )
);