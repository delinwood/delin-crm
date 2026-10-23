begin;
-- One external Search attempt per research job. An ambiguous provider failure
-- never causes a leased job to replay a potentially billable request.
alter table public.crm_research_jobs add column if not exists search_attempted_at timestamptz;
commit;
