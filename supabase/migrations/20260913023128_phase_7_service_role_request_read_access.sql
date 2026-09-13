-- Phase 7 — Allow server-side Retell integration
-- to read appointment requests.
--
-- The voice integration resolves availability server-side using
-- service_role. It needs read-only access to appointment_requests.
-- Writes remain controlled by the Phase 7 RPCs.

begin;

grant select
on table public.appointment_requests
to service_role;

commit;