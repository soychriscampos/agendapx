-- HelloPx: optional confirmation for appointments created manually in Agenda.
-- Review with Codex against the pending application changes BEFORE deploying.
-- Existing appointments and Retell-created appointments retain NULL (legacy behavior).

begin;

alter table public.appointments
  add column manual_confirmation_requested boolean,
  add column confirmation_contact_phone_id uuid,
  add column manual_creation_key uuid;

alter table public.appointments
  add constraint appointments_manual_confirmation_requires_contact_chk
  check (
    manual_confirmation_requested is distinct from true
    or (patient_id is not null and confirmation_contact_phone_id is not null)
  ),
  add constraint appointments_confirmation_phone_tenant_fk
  foreign key (confirmation_contact_phone_id, doctor_id)
  references public.contact_phones (id, doctor_id);

create unique index appointments_manual_creation_key_doctor_unique
  on public.appointments (doctor_id, manual_creation_key)
  where manual_creation_key is not null;

-- Transactional operation. SECURITY INVOKER uses existing RLS policies.
-- p_patient_mode: NEW | EXISTING (only when confirmation requested).
-- p_phone_owner: PATIENT | OTHER (only for a new phone number).
create function public.create_manual_appointment(
  p_manual_creation_key uuid,
  p_doctor_id uuid,
  p_patient_name text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_manual_confirmation_requested boolean,
  p_patient_mode text,
  p_patient_id uuid,
  p_phone_e164 text,
  p_phone_owner text,
  p_contact_name text,
  p_relationship text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_role text;
  v_user_doctor_id uuid;
  v_timezone text;
  v_start_local timestamp;
  v_end_local timestamp;
  v_weekday integer;
  v_appointment_id uuid;
  v_patient_id uuid;
  v_contact_id uuid;
  v_phone_id uuid;
  v_relation text;
  v_phone text;
  v_new_phone_is_patient boolean := false;
  v_name text := nullif(btrim(p_patient_name), '');
  v_confirm boolean := coalesce(p_manual_confirmation_requested, false);
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select u.role::text, u.doctor_id
    into v_role, v_user_doctor_id
  from public.users u where u.id = auth.uid();

  if v_role not in ('MASTER', 'DOCTOR') or v_role is null then
    raise exception 'FORBIDDEN';
  end if;
  if p_doctor_id is null or (v_role = 'DOCTOR' and v_user_doctor_id is distinct from p_doctor_id) then
    raise exception 'FORBIDDEN_DOCTOR';
  end if;
  if v_name is null or p_manual_creation_key is null or p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'INVALID_APPOINTMENT_INPUT';
  end if;
  -- Serialize creation for the doctor (including concurrent manual creations).
  select d.timezone into v_timezone
  from public.doctors d
  where d.id = p_doctor_id and d.status = 'ACTIVE'
  for update;
  if not found then raise exception 'DOCTOR_NOT_AVAILABLE'; end if;

  select a.id into v_appointment_id
  from public.appointments a
  where a.doctor_id = p_doctor_id and a.manual_creation_key = p_manual_creation_key;
  if found then return v_appointment_id; end if;

  if p_start_at <= now() then
    raise exception 'APPOINTMENT_IN_PAST';
  end if;

  v_start_local := p_start_at at time zone v_timezone;
  v_end_local := p_end_at at time zone v_timezone;
  v_weekday := extract(isodow from v_start_local)::integer;

  if v_start_local::date <> v_end_local::date then
    raise exception 'APPOINTMENT_MUST_FIT_LOCAL_DAY';
  end if;
  if not exists (
    select 1 from public.doctor_schedule_windows w
    where w.doctor_id = p_doctor_id and w.weekday = v_weekday
      and v_start_local::time >= w.start_local
      and v_end_local::time <= w.end_local
  ) then raise exception 'OUTSIDE_SCHEDULE'; end if;
  if exists (
    select 1 from public.doctor_recurring_unavailability x
    where x.doctor_id = p_doctor_id and x.weekday = v_weekday
      and v_start_local::time < x.end_local
      and v_end_local::time > x.start_local
  ) then raise exception 'RECURRING_UNAVAILABLE'; end if;
  if exists (
    select 1 from public.doctor_unavailability x
    where x.doctor_id = p_doctor_id
      and p_start_at < x.end_at and p_end_at > x.start_at
  ) then raise exception 'UNAVAILABLE'; end if;
  if exists (
    select 1 from public.appointments a
    where a.doctor_id = p_doctor_id and a.status = 'CONFIRMED'
      and p_start_at < a.end_at and p_end_at > a.start_at
  ) then raise exception 'SLOT_UNAVAILABLE'; end if;

  if v_confirm then
    v_phone := nullif(btrim(p_phone_e164), '');
    if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'INVALID_CONTACT_PHONE';
    end if;
    if p_patient_mode not in ('NEW', 'EXISTING') or p_patient_mode is null then
      raise exception 'INVALID_PATIENT_MODE';
    end if;

    if p_patient_mode = 'EXISTING' then
      select id into v_patient_id from public.patients
      where id = p_patient_id and doctor_id = p_doctor_id;
      if not found then raise exception 'PATIENT_NOT_FOUND'; end if;
    else
      if p_patient_id is not null then raise exception 'UNEXPECTED_PATIENT_ID'; end if;
      insert into public.patients (doctor_id, full_name)
      values (p_doctor_id, v_name) returning id into v_patient_id;
    end if;

    -- Phone ownership is unique within doctor; find and reuse its contact.
    -- Lock serializes concurrent writers attempting to create this phone.
    perform pg_advisory_xact_lock(hashtextextended(p_doctor_id::text || ':' || v_phone, 0));
    select cp.id, cp.contact_id into v_phone_id, v_contact_id
    from public.contact_phones cp
    where cp.doctor_id = p_doctor_id and cp.phone_e164 = v_phone;

    if v_phone_id is null then
      if p_phone_owner = 'PATIENT' then
        v_relation := 'SELF';
        v_new_phone_is_patient := true;
        insert into public.contacts (doctor_id, full_name)
        values (p_doctor_id, v_name) returning id into v_contact_id;
      elsif p_phone_owner = 'OTHER' then
        v_relation := nullif(btrim(p_relationship), '');
        if nullif(btrim(p_contact_name), '') is null or v_relation is null or v_relation = 'SELF' then
          raise exception 'CONTACT_NAME_AND_RELATIONSHIP_REQUIRED';
        end if;
        insert into public.contacts (doctor_id, full_name)
        values (p_doctor_id, btrim(p_contact_name)) returning id into v_contact_id;
      else
        raise exception 'PHONE_OWNER_REQUIRED';
      end if;
      insert into public.contact_phones (doctor_id, contact_id, phone_e164)
      values (p_doctor_id, v_contact_id, v_phone) returning id into v_phone_id;
    end if;

    -- Existing relationships are authoritative; never overwrite them.
    select pc.relationship into v_relation
    from public.patient_contacts pc
    where pc.doctor_id = p_doctor_id
      and pc.patient_id = v_patient_id and pc.contact_id = v_contact_id;
    if not found then
      if v_new_phone_is_patient then
        -- The patient explicitly owns this newly registered phone.
        -- Never let a residual relationship parameter override SELF.
        v_relation := 'SELF';
      else
        v_relation := nullif(btrim(p_relationship), '');
        if v_relation is null then
          raise exception 'CONTACT_RELATIONSHIP_REQUIRED';
        end if;
      end if;
      insert into public.patient_contacts (doctor_id, patient_id, contact_id, relationship)
      values (p_doctor_id, v_patient_id, v_contact_id, v_relation);
    end if;
  else
    if p_patient_id is not null or nullif(btrim(p_phone_e164), '') is not null then
      raise exception 'UNEXPECTED_CONTACT_DATA';
    end if;
  end if;

  insert into public.appointments (
    doctor_id, patient_name, patient_id, start_at, end_at,
    status, created_source, created_by_user_id, confirmation_status,
    manual_confirmation_requested, confirmation_contact_phone_id, manual_creation_key
  ) values (
    p_doctor_id, v_name, v_patient_id, p_start_at, p_end_at,
    'CONFIRMED', case when v_role = 'MASTER' then 'MASTER' else 'DOCTOR' end,
    auth.uid(), 'PENDING', v_confirm, v_phone_id, p_manual_creation_key
  ) returning id into v_appointment_id;
  return v_appointment_id;
end;
$fn$;

revoke all on function public.create_manual_appointment(
  uuid,uuid,text,timestamptz,timestamptz,boolean,text,uuid,text,text,text,text
) from public;
grant execute on function public.create_manual_appointment(
  uuid,uuid,text,timestamptz,timestamptz,boolean,text,uuid,text,text,text,text
) to authenticated;

-- Keep the exact deployed RPC implementations and inject ONLY two guards.
-- Abort if their current bodies differ from the audited versions, rather than
-- silently replacing a newer RPC with an outdated copy.
do $patch$
declare
  v_oid oid;
  v_src text;
  v_new text;
  v_needle text;
begin
  select to_regprocedure('public.claim_appointment_confirmation_call(uuid)') into v_oid;
  if v_oid is null then raise exception 'Missing claim RPC'; end if;
  v_src := pg_get_functiondef(v_oid);
  v_needle := '  -- Appointment must still occupy the slot.';
  if position(v_needle in v_src)=0 then raise exception 'Claim RPC unexpected structure (guard)'; end if;
  v_new := replace(v_src, v_needle,
    '  if v_appointment.manual_confirmation_requested is false then' || chr(10) ||
    '    return jsonb_build_object(''ok'', false, ''code'', ''MANUAL_CONFIRMATION_DISABLED'', ''appointment_id'', v_appointment.id);' || chr(10) ||
    '  end if;' || chr(10) || chr(10) || v_needle);

  v_needle := '  if v_appointment.appointment_request_id is not null then';
  if position(v_needle in v_new)=0 then raise exception 'Claim RPC unexpected structure (phone)'; end if;
  v_new := replace(v_new, v_needle,
    '  if v_appointment.confirmation_contact_phone_id is not null then' || chr(10) ||
    '    select cp.phone_e164 into v_phone from public.contact_phones cp' || chr(10) ||
    '    where cp.id = v_appointment.confirmation_contact_phone_id' || chr(10) ||
    '      and cp.doctor_id = v_appointment.doctor_id;' || chr(10) ||
    '  end if;' || chr(10) || chr(10) ||
    '  if v_phone is null and v_appointment.appointment_request_id is not null then');
  execute v_new;

  select to_regprocedure('public.get_due_appointment_confirmations(integer)') into v_oid;
  if v_oid is null then raise exception 'Missing due confirmations RPC'; end if;
  v_src := pg_get_functiondef(v_oid);
  v_needle := '      and a.start_at > now()';
  if position(v_needle in v_src)=0 then raise exception 'Due RPC unexpected structure'; end if;
  v_new := replace(v_src, v_needle,
    v_needle || chr(10) || '      and a.manual_confirmation_requested is distinct from false');
  execute v_new;
end;
$patch$;

commit;
