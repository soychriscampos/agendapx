create or replace function public.complete_doctor_onboarding()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doctor_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select u.doctor_id
  into v_doctor_id
  from public.users as u
  where u.id = auth.uid()
    and u.role = 'DOCTOR';

  if v_doctor_id is null then
    raise exception 'Doctor context not found';
  end if;

  update public.doctors
  set onboarding_completed = true
  where id = v_doctor_id;

  if not found then
    raise exception 'Doctor not found';
  end if;

  return true;
end;
$$;

revoke all
on function public.complete_doctor_onboarding()
from public;

grant execute
on function public.complete_doctor_onboarding()
to authenticated;