-- Run with psql -v ON_ERROR_STOP=1 -f tests/supabase_schema.sql in a disposable
-- empty PostgreSQL database. Mock only Supabase's auth schema and database roles.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;

\ir ../supabase/migrations/202610120001_forecasts.sql

insert into auth.users values
('00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000002');
set role service_role;
insert into public.forecasts(id,owner_id,source,inputs,prediction) values
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','nba','{}','{}'),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','nba','{}','{}');
update public.forecasts set outcome='{}'
    where id='10000000-0000-0000-0000-000000000001';
do $$ begin
    begin
        update public.forecasts set prediction='{"points":999}';
        raise exception 'Snapshot mutation unexpectedly allowed';
    exception when raise_exception then
        if sqlerrm != 'Forecast snapshots are immutable' then raise; end if;
    end;
end $$;

set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin
    if (select count(*) from public.forecasts) != 1 then
        raise exception 'RLS isolation failed';
    end if;
    if exists(select 1 from public.forecasts where owner_id != auth.uid()) then
        raise exception 'Other user visible';
    end if;
    begin
        update public.forecasts set outcome='{"points":999}';
        raise exception 'Browser update unexpectedly allowed';
    exception when insufficient_privilege then null;
    end;
    begin
        insert into public.forecasts(id,owner_id,source,inputs,prediction)
            values (gen_random_uuid(),auth.uid(),'nba','{}','{}');
        raise exception 'Browser insert unexpectedly allowed';
    exception when insufficient_privilege then null;
    end;
end $$;

set role anon;
do $$ begin
    begin
        perform * from public.forecasts;
        raise exception 'Anonymous read unexpectedly allowed';
    exception when insufficient_privilege then null;
    end;
end $$;

reset role;
delete from auth.users where id='00000000-0000-0000-0000-000000000001';
do $$ begin
    if (select count(*) from public.forecasts) != 1 then
        raise exception 'Account deletion cascade failed';
    end if;
end $$;
select 'Supabase schema checks passed' as result;
