create table public.commercial_survey_responses (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text not null unique,
  ip_hash text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'started' check (status in ('started', 'completed')),
  specialty text,
  specialty_other text,
  call_handler text,
  appointment_channels text[],
  missed_calls text,
  obstacle text,
  obstacle_other text,
  missed_call_followup text,
  assistant_usefulness text,
  wants_demo boolean,
  demo_call_clicked_at timestamptz,
  commercial_interest text check (commercial_interest in ('personalized_demo', 'information', 'none')),
  contact_name text,
  contact_method text check (contact_method in ('email', 'phone', 'whatsapp')),
  contact_value text,
  contact_consent_at timestamptz,
  constraint completed_answers check (
    status = 'started' or (
      completed_at is not null and specialty is not null and call_handler is not null
      and appointment_channels is not null and missed_calls is not null
      and obstacle is not null and missed_call_followup is not null
      and assistant_usefulness is not null
    )
  ),
  constraint consent_required check (
    commercial_interest not in ('personalized_demo', 'information')
    or (contact_name is not null and contact_method is not null
      and contact_value is not null and contact_consent_at is not null)
  )
);

create index commercial_survey_started_idx on public.commercial_survey_responses (started_at desc);
create index commercial_survey_ip_idx on public.commercial_survey_responses (ip_hash, started_at desc);
create index commercial_survey_interest_idx on public.commercial_survey_responses (commercial_interest);

alter table public.commercial_survey_responses enable row level security;
revoke all on table public.commercial_survey_responses from anon, authenticated;
grant select, insert, update on table public.commercial_survey_responses to service_role;
