alter table public.deposit_rules
add column if not exists sort_order integer;

-- Asignar un orden estable a las reglas existentes de cada doctor.
with ranked_rules as (
  select
    id,
    row_number() over (
      partition by doctor_id
      order by created_at asc, id asc
    ) as position
  from public.deposit_rules
)
update public.deposit_rules as dr
set sort_order = ranked_rules.position * 10
from ranked_rules
where dr.id = ranked_rules.id
  and dr.sort_order is null;

alter table public.deposit_rules
alter column sort_order set default 1000;

alter table public.deposit_rules
alter column sort_order set not null;

alter table public.deposit_rules
add constraint deposit_rules_sort_order_positive
check (sort_order > 0);

create index if not exists deposit_rules_doctor_active_sort_order_idx
on public.deposit_rules (doctor_id, is_active, sort_order);

comment on column public.deposit_rules.sort_order is
'Priority order for deposit rules. Lower values have higher priority when multiple active rules match.';