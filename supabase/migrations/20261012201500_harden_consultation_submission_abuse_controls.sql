-- Durable abuse controls for public consultation submissions.
-- The public form writes through trusted server-side handlers; anonymous
-- PostgREST inserts are no longer needed.

create schema if not exists ingressible_private;
revoke all on schema ingressible_private from public, anon, authenticated;
grant usage on schema ingressible_private to service_role;

create table if not exists ingressible_private.consultation_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default clock_timestamp()
);

revoke all on ingressible_private.consultation_rate_limits from public, anon, authenticated;
grant select, insert, update, delete
  on ingressible_private.consultation_rate_limits to service_role;

create or replace function public.consume_consultation_rate_limit(
  p_key text,
  p_limit integer default 10,
  p_window_seconds integer default 3600
)
returns table(allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if p_key is null or length(p_key) < 16 or length(p_key) > 160 then
    raise exception 'Invalid rate limit key' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 1000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit configuration' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));

  select r.window_started_at, r.request_count
    into v_window_started_at, v_request_count
    from ingressible_private.consultation_rate_limits r
   where r.rate_key = p_key
   for update;

  if not found
     or v_window_started_at <= v_now - make_interval(secs => p_window_seconds) then
    insert into ingressible_private.consultation_rate_limits(
      rate_key, window_started_at, request_count, updated_at
    )
    values (p_key, v_now, 1, v_now)
    on conflict (rate_key) do update
      set window_started_at = excluded.window_started_at,
          request_count = 1,
          updated_at = excluded.updated_at;
    return query select true, 0;
    return;
  end if;

  v_request_count := v_request_count + 1;
  update ingressible_private.consultation_rate_limits
     set request_count = v_request_count,
         updated_at = v_now
   where rate_key = p_key;

  return query
    select
      v_request_count <= p_limit,
      case
        when v_request_count <= p_limit then 0
        else greatest(
          1,
          ceil(extract(epoch from (
            v_window_started_at
              + make_interval(secs => p_window_seconds)
              - v_now
          )))::integer
        )
      end;
end;
$function$;

revoke all on function public.consume_consultation_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_consultation_rate_limit(text, integer, integer)
  to service_role;

drop policy if exists anon_insert_submissions on public.consultation_submissions;
revoke insert on public.consultation_submissions from anon;
