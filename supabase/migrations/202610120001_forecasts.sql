-- Run once in Supabase's SQL editor (or with `supabase db push`).
create table if not exists public.forecasts (
    id uuid primary key,
    owner_id uuid not null references auth.users(id) on delete cascade,
    source text not null check (source in ('nba', 'stub')),
    created_at timestamptz not null default now(),
    inputs jsonb not null,
    prediction jsonb not null,
    outcome jsonb,
    updated_at timestamptz
);

create index if not exists forecasts_owner_source_created
    on public.forecasts (owner_id, source, created_at, id);

alter table public.forecasts enable row level security;
revoke all on public.forecasts from anon, authenticated;
grant select on public.forecasts to authenticated;
grant all on public.forecasts to service_role;

create function public.preserve_forecast_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id
       or new.source is distinct from old.source
       or new.created_at is distinct from old.created_at
       or new.inputs is distinct from old.inputs
       or new.prediction is distinct from old.prediction then
        raise exception 'Forecast snapshots are immutable';
    end if;
    return new;
end;
$$;

create trigger preserve_forecast_snapshot
    before update on public.forecasts
    for each row execute function public.preserve_forecast_snapshot();

create policy "Users can read their own forecasts"
    on public.forecasts for select to authenticated
    using ((select auth.uid()) = owner_id);

-- Only the trusted API can create forecasts or attach outcomes. Browser users
-- cannot rewrite forecast inputs, prediction snapshots, or accuracy results.
