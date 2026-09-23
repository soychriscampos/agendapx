-- ============================================================
-- Phase 12 — Safe outbound confirmation window
-- ============================================================
--
-- Automatic confirmation calls are allowed only between:
--
--   09:00 and 20:00
--
-- interpreted in public.doctors.timezone.
--
-- This affects outbound confirmation calls only.
-- Inbound patient calls remain unrestricted.
-- ============================================================


-- ============================================================
-- 1. Compute effective confirmation time
-- ============================================================
--
-- Theoretical time:
--
--   start_at - confirmation_lead_minutes
--
-- Safe outbound policy:
--
--   09:00 <= due <= 20:00
--     -> keep due
--
--   due < 09:00
--     -> previous local day at 20:00
--
--   due > 20:00
--     -> next local day at 09:00
--
-- All local interpretation uses the doctor's IANA timezone.
-- ============================================================

create or replace function public.compute_effective_confirmation_at(
  p_start_at timestamptz,
  p_lead_minutes integer,
  p_timezone text
)
returns timestamptz
language sql
stable
strict
set search_path = public
as $function$

  with theoretical as (
    select
      p_start_at - make_interval(mins => p_lead_minutes)
        as theoretical_due_at
  ),

  localized as (
    select
      theoretical_due_at,

      theoretical_due_at at time zone p_timezone
        as local_due_at

    from theoretical
  )

  select
    case

      -- Before 09:00:
      -- move to previous local day at 20:00.
      when local_due_at::time < time '09:00' then

        (
          (
            (local_due_at::date - 1)
            + time '20:00'
          )
          at time zone p_timezone
        )


      -- After 20:00:
      -- move to next local day at 09:00.
      when local_due_at::time > time '20:00' then

        (
          (
            (local_due_at::date + 1)
            + time '09:00'
          )
          at time zone p_timezone
        )


      -- Already inside safe outbound window.
      else theoretical_due_at

    end

  from localized;

$function$;


revoke all
on function public.compute_effective_confirmation_at(
  timestamptz,
  integer,
  text
)
from public;

grant execute
on function public.compute_effective_confirmation_at(
  timestamptz,
  integer,
  text
)
to service_role;


-- ============================================================
-- 2. Update scheduler candidate selection
-- ============================================================
--
-- Keep the existing RPC signature so the Phase 12 application
-- endpoint does not need to change.
--
-- NOTE:
-- The output column remains named confirmation_due_at for
-- compatibility, but from this migration forward it represents
-- the EFFECTIVE outbound confirmation time after applying the
-- 09:00–20:00 safety window.
-- ============================================================

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
      -- Appointment must still occupy availability.
      a.status = 'CONFIRMED'

      -- Only the initial confirmation state can start a call.
      and a.confirmation_status = 'PENDING'

      -- Confirmation must be enabled.
      and s.confirmation_enabled is true

      -- Valid lead configuration.
      and s.confirmation_lead_minutes is not null
      and s.confirmation_lead_minutes >= 0

      -- Doctor must still be operational.
      and d.status = 'ACTIVE'

      -- Never initiate confirmation after the appointment starts.
      and a.start_at > now()

  )

  select
    c.appointment_id,
    c.doctor_id,
    c.effective_confirmation_at as confirmation_due_at

  from candidates c

  where

    -- The safe/effective confirmation moment has arrived.
    c.effective_confirmation_at <= now()

    -- Product rule:
    --
    -- The appointment must have existed before its effective
    -- outbound confirmation moment.
    --
    -- If the appointment was created after that moment, this
    -- confirmation cycle is skipped rather than calling the
    -- patient immediately to "catch up".
    and c.created_at < c.effective_confirmation_at

    -- Phase 11 remains authoritative for call lifecycle.
    -- Avoid returning appointments that already have an active
    -- attempt.
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