alter table public.doctors
add column if not exists onboarding_completed boolean not null default false;

comment on column public.doctors.onboarding_completed is
'Whether the doctor has successfully completed the initial HelloPx onboarding.';