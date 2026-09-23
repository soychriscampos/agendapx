create or replace function public.get_due_appointment_confirmations(
  p_limit integer default 50
)
returns table (
  appointment_id uuid,
  doctor_id uuid,
  confirmation_due_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin

  if p_limit is null or p_limit <= 0 then
    p_limit := 50;
  end if;

  p_limit := least(p_limit, 200);

  return query

  with candidates as (
    select
      a.id as appointment_id,
      a.doctor_id,
      a.start_at,
      a.created_at,
      d.timezone as doctor_timezone,

      public.compute_effective_confirmation_at(
        a.start_at,
        s.confirmation_lead_minutes,
        d.timezone
      ) as effective_confirmation_at

    from public.appointments a

    join public.assistant_settings s
      on s.doctor_id = a.doctor_id

    join public.doctors d
      on d.id = a.doctor_id

    where
      a.status = 'CONFIRMED'
      and a.confirmation_status = 'PENDING'
      and s.confirmation_enabled is true
      and s.confirmation_lead_minutes is not null
      and s.confirmation_lead_minutes >= 0
      and d.status = 'ACTIVE'
      and a.start_at > now()
  )

  select
    c.appointment_id,
    c.doctor_id,
    c.effective_confirmation_at as confirmation_due_at

  from candidates c

  where
    c.effective_confirmation_at <= now()

    and c.created_at < c.effective_confirmation_at

    and (now() at time zone c.doctor_timezone)::time
        between time '09:00' and time '20:00'

    and not exists (
      select 1
      from public.appointment_confirmation_call_attempts aca
      where aca.appointment_id = c.appointment_id
        and aca.status in ('CREATING', 'DISPATCHED')
    )

  order by
    c.effective_confirmation_at asc,
    c.start_at asc

  limit p_limit;

end;
$function$;


revoke all
on function public.get_due_appointment_confirmations(integer)
from public;

grant execute
on function public.get_due_appointment_confirmations(integer)
to service_role;