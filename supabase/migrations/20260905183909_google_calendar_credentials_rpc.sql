-- Fase 4A — acceso server-side a credenciales Google Calendar
--
-- Las credenciales permanecen en schema private.
-- Se exponen únicamente operaciones muy específicas mediante RPCs
-- ejecutables sólo por service_role.

create or replace function public.upsert_doctor_google_calendar_credential(
    p_connection_id uuid,
    p_refresh_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_connection_id is null then
        raise exception 'connection_id is required';
    end if;

    if p_refresh_token is null or btrim(p_refresh_token) = '' then
        raise exception 'refresh_token is required';
    end if;

    insert into private.doctor_google_calendar_credentials (
        connection_id,
        refresh_token
    )
    values (
        p_connection_id,
        p_refresh_token
    )
    on conflict (connection_id)
    do update set
        refresh_token = excluded.refresh_token,
        updated_at = now();
end;
$$;


create or replace function public.get_doctor_google_calendar_refresh_token(
    p_connection_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select credentials.refresh_token
    from private.doctor_google_calendar_credentials as credentials
    where credentials.connection_id = p_connection_id;
$$;


create or replace function public.delete_doctor_google_calendar_credential(
    p_connection_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
    delete from private.doctor_google_calendar_credentials
    where connection_id = p_connection_id;
$$;


-- SECURITY:
-- Postgres concede EXECUTE sobre funciones a PUBLIC por defecto.
-- Se revoca explícitamente y sólo se permite service_role.

revoke all
on function public.upsert_doctor_google_calendar_credential(uuid, text)
from public, anon, authenticated;

revoke all
on function public.get_doctor_google_calendar_refresh_token(uuid)
from public, anon, authenticated;

revoke all
on function public.delete_doctor_google_calendar_credential(uuid)
from public, anon, authenticated;


grant execute
on function public.upsert_doctor_google_calendar_credential(uuid, text)
to service_role;

grant execute
on function public.get_doctor_google_calendar_refresh_token(uuid)
to service_role;

grant execute
on function public.delete_doctor_google_calendar_credential(uuid)
to service_role;