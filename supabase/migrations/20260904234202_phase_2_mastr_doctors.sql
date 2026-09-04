-- AgendaPX
-- Phase 2: minimal MASTER doctor management.

-- ---------------------------------------------------------------------------
-- DOCTOR OPERATIONAL / TECHNICAL DATA
-- ---------------------------------------------------------------------------

alter table public.doctors
  add column phone text,
  add column whatsapp text,
  add column retell_agent_id text,
  add column twilio_phone_number text;

-- ---------------------------------------------------------------------------
-- DATA API PRIVILEGES
--
-- MASTER needs to edit doctor configuration from the internal panel.
-- Row-level authorization remains enforced by RLS.
-- ---------------------------------------------------------------------------

grant update on table public.doctors to authenticated;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Only MASTER may update doctor records.
-- DOCTOR users remain read-only on public.doctors.
-- ---------------------------------------------------------------------------

create policy "doctors_update_by_master"
on public.doctors
for update
to authenticated
using (
  private.current_user_role() = 'MASTER'
)
with check (
  private.current_user_role() = 'MASTER'
);