create or replace function public.update_doctor_profile(
  p_display_name text,
  p_specialty text,
  p_address text
)
returns table (
  doctor_id uuid,
  display_name text,
  specialty text,
  address text
)
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

  if nullif(trim(p_display_name), '') is null then
    raise exception 'Doctor name is required';
  end if;

  return query
  update public.doctors as d
  set
    display_name = trim(p_display_name),
    specialty = nullif(trim(p_specialty), ''),
    address = nullif(trim(p_address), '')
  where d.id = v_doctor_id
  returning
    d.id,
    d.display_name,
    d.specialty,
    d.address;

  if not found then
    raise exception 'Doctor not found';
  end if;
end;
$$;

revoke all
on function public.update_doctor_profile(text, text, text)
from public;

grant execute
on function public.update_doctor_profile(text, text, text)
to authenticated;