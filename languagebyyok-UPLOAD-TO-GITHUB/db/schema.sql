-- =============================================================================
--  languagebyyok.com  -  IELTS Reading mock platform
--  Supabase / PostgreSQL schema
-- =============================================================================
--  HOW TO USE
--  1. Supabase dashboard -> SQL Editor -> New query
--  2. Paste this whole file, press RUN
--  3. Then run db/seed-test-01.sql (the answer key) the same way
--
--  DESIGN NOTES
--  * The answer key lives in this database and is NEVER sent to the browser
--    before a paper is submitted. Marking happens here, in submit_attempt().
--  * Students are identified by an access code you give them. They never see
--    another student's data: all student-side access goes through security
--    definer functions that require the code.
--  * You (the teacher) log in with Supabase Auth. Any authenticated user can
--    read everything, so keep public sign-ups DISABLED in Supabase.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  access_code   text unique not null,
  display_name  text not null,
  email         text,
  notes         text,
  target_band   numeric(2,1),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create table if not exists public.answer_keys (
  test_id         text primary key,
  title           text,
  total_questions int not null default 40,
  payload         jsonb not null,
  created_at      timestamptz not null default now()
);

create table if not exists public.attempts (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.students(id) on delete cascade,
  test_id         text not null,
  status          text not null default 'in_progress',   -- in_progress | submitted
  started_at      timestamptz not null default now(),
  deadline_at     timestamptz not null,
  submitted_at    timestamptz,
  duration_seconds int,          -- time actually used, capped at the paper length
  auto_submitted  boolean not null default false,
  ran_out_of_time boolean not null default false,
  raw_score       int,
  band            numeric(2,1),
  passage_scores  jsonb,
  type_scores     jsonb,
  skill_scores    jsonb,
  meta            jsonb
);

create table if not exists public.responses (
  id             bigserial primary key,
  attempt_id     uuid not null references public.attempts(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  test_id        text not null,
  q              int  not null,
  passage        int,
  q_type         text,
  skill          text,
  answer         text,          -- exactly what the student typed / chose
  first_answer   text,          -- what they put down first, before any changes
  correct_answer text,          -- the accepted answer(s), joined with " / "
  is_correct     boolean not null default false,
  first_was_correct boolean not null default false,  -- did they talk themselves out of it?
  over_limit     boolean not null default false,  -- broke the word limit
  seconds        numeric(8,2) not null default 0, -- time focused on this question
  changes        int not null default 0,          -- times the answer was altered
  visits         int not null default 0,
  flagged        boolean not null default false,  -- student marked it for review
  locate         text,          -- where the answer is in the passage
  explanation    text,          -- why that is the answer
  unique (attempt_id, q)
);

create index if not exists responses_attempt_idx  on public.responses(attempt_id);
create index if not exists responses_student_idx  on public.responses(student_id);
create index if not exists responses_type_idx     on public.responses(q_type);
create index if not exists attempts_student_idx   on public.attempts(student_id, submitted_at desc);

-- ---------------------------------------------------------------------------
-- 2. HELPERS
-- ---------------------------------------------------------------------------

-- Normalise an answer for comparison: lower case, drop apostrophes and
-- punctuation, collapse whitespace.  Mirrors normalise() in assets/js/marking.js.
create or replace function public.norm_answer(p text)
returns text language sql immutable as $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(
          replace(replace(
            -- fold accents first, so café matches cafe rather than becoming caf
            translate(lower(coalesce(p, '')),
                      'áàâäãåéèêëíìîïóòôöõúùûüñçÿ',
                      'aaaaaaeeeeiiiiooooouuuuncy'),
            '''', ''), '’', ''),
          '[^a-z0-9 ]+', ' ', 'g'),
        '\s+', ' ', 'g')
    ), '');
$$;

create or replace function public.word_count(p text)
returns int language sql immutable as $$
  select case when public.norm_answer(p) is null then 0
         else array_length(string_to_array(public.norm_answer(p), ' '), 1) end;
$$;

-- Academic Reading raw score (out of 40) -> band.
-- 39-40 = 9.0 down to 10-12 = 4.0 follows the conversion table published in the
-- Cambridge IELTS practice test books. Below 10 is extrapolated.
create or replace function public.band_for(raw int)
returns numeric language sql immutable as $$
  select (case
    when raw >= 39 then 9.0  when raw >= 37 then 8.5  when raw >= 35 then 8.0
    when raw >= 33 then 7.5  when raw >= 30 then 7.0  when raw >= 27 then 6.5
    when raw >= 23 then 6.0  when raw >= 19 then 5.5  when raw >= 15 then 5.0
    when raw >= 13 then 4.5  when raw >= 10 then 4.0  when raw >=  8 then 3.5
    when raw >=  6 then 3.0  when raw >=  4 then 2.5  when raw >=  3 then 2.0
    when raw >=  2 then 1.5  when raw >=  1 then 1.0  else 0.0
  end)::numeric(2,1);
$$;

-- ---------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
--    Nothing is readable with the public (anon) key. Students reach their own
--    data only through the functions below; the teacher reads everything after
--    signing in.
-- ---------------------------------------------------------------------------

alter table public.students    enable row level security;
alter table public.attempts    enable row level security;
alter table public.responses   enable row level security;
alter table public.answer_keys enable row level security;

drop policy if exists teacher_all_students  on public.students;
drop policy if exists teacher_all_attempts  on public.attempts;
drop policy if exists teacher_all_responses on public.responses;

create policy teacher_all_students  on public.students
  for all to authenticated using (true) with check (true);
create policy teacher_all_attempts  on public.attempts
  for all to authenticated using (true) with check (true);
create policy teacher_all_responses on public.responses
  for all to authenticated using (true) with check (true);

-- answer_keys deliberately has NO policies: not even a signed-in teacher reads
-- it through the API. Use the SQL editor if you need to inspect it.

-- ---------------------------------------------------------------------------
-- 4. STUDENT-SIDE FUNCTIONS  (called with the public anon key)
-- ---------------------------------------------------------------------------

-- Start a paper, or resume one that is still inside its 60 minutes.
-- The deadline is set by the server, so refreshing or switching device does
-- not buy the student any extra time.
create or replace function public.begin_attempt(
  p_code text, p_name text, p_test_id text, p_minutes int default 60
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code    text := upper(trim(coalesce(p_code, '')));
  v_name    text := trim(coalesce(p_name, ''));
  v_student students%rowtype;
  v_attempt attempts%rowtype;
  v_resumed boolean := false;
begin
  if v_code = '' or v_name = '' then
    raise exception 'An access code and a name are both required';
  end if;
  if not exists (select 1 from answer_keys where test_id = p_test_id) then
    raise exception 'Unknown test: %', p_test_id;
  end if;

  select * into v_student from students where access_code = v_code;
  if not found then
    insert into students (access_code, display_name)
    values (v_code, v_name)
    returning * into v_student;
  else
    update students
       set last_seen_at = now(),
           display_name = case when display_name = '' then v_name else display_name end
     where id = v_student.id
    returning * into v_student;
  end if;

  -- resume an unfinished attempt that still has time on the clock
  select * into v_attempt
    from attempts
   where student_id = v_student.id
     and test_id = p_test_id
     and status = 'in_progress'
     and deadline_at > now()
   order by started_at desc
   limit 1;

  v_resumed := found;

  if not found then
    -- close off any stale in-progress attempts for this paper
    update attempts
       set status = 'submitted', submitted_at = now(),
           auto_submitted = true, ran_out_of_time = true
     where student_id = v_student.id and test_id = p_test_id
       and status = 'in_progress' and deadline_at <= now();

    insert into attempts (student_id, test_id, deadline_at)
    values (v_student.id, p_test_id, now() + make_interval(mins => p_minutes))
    returning * into v_attempt;
  end if;

  return jsonb_build_object(
    'attempt_id',   v_attempt.id,
    'student_id',   v_student.id,
    'student_name', v_student.display_name,
    'access_code',  v_student.access_code,
    'test_id',      v_attempt.test_id,
    'started_at',   v_attempt.started_at,
    'deadline_at',  v_attempt.deadline_at,
    'server_now',   now(),
    'resumed',      v_resumed
  );
end $$;

-- The clock, straight from the server. Called periodically by the exam page so
-- a student cannot gain time by changing their computer's clock.
create or replace function public.attempt_clock(p_attempt_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'server_now',  now(),
    'deadline_at', a.deadline_at,
    'status',      a.status,
    'seconds_left', greatest(0, extract(epoch from (a.deadline_at - now()))))
  from attempts a where a.id = p_attempt_id;
$$;

-- Mark a paper. This is the only place the answer key is ever read.
create or replace function public.submit_attempt(
  p_attempt_id uuid, p_responses jsonb, p_auto boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_attempt  attempts%rowtype;
  v_key      jsonb;
  v_item     jsonb;
  v_qn       int;
  v_entry    jsonb;
  v_given    text;
  v_first    text;
  v_accept   text[];
  v_ok       boolean;
  v_first_ok boolean;
  v_limit    int;
  v_over     boolean;
  v_elapsed  numeric;
  v_raw      int;
  v_late     boolean;
begin
  select * into v_attempt from attempts where id = p_attempt_id;
  if not found then raise exception 'Attempt not found'; end if;

  -- already marked: hand back the existing result, do not re-score
  if v_attempt.status = 'submitted' then
    return public.attempt_result(p_attempt_id);
  end if;

  select payload into v_key from answer_keys where test_id = v_attempt.test_id;
  if v_key is null then raise exception 'No answer key for %', v_attempt.test_id; end if;

  delete from responses where attempt_id = p_attempt_id;

  -- one row per question in the key, whether the student answered it or not
  for v_qn, v_entry in select (key)::int, value from jsonb_each(v_key) loop
    v_item := null;
    select elem into v_item
      from jsonb_array_elements(coalesce(p_responses, '[]'::jsonb)) elem
     where (elem->>'q')::int = v_qn
     limit 1;

    v_given  := nullif(trim(coalesce(v_item->>'answer', '')), '');
    v_first  := nullif(trim(coalesce(v_item->>'first_answer', '')), '');
    v_accept := array(select jsonb_array_elements_text(v_entry->'accept'));
    v_limit  := nullif(v_entry->>'limit', '')::int;

    v_over := (v_limit is not null and v_given is not null
               and public.word_count(v_given) > v_limit);

    v_ok := (not v_over) and v_given is not null and exists (
      select 1 from unnest(v_accept) a
       where public.norm_answer(a) = public.norm_answer(v_given));

    v_first_ok := v_first is not null and exists (
      select 1 from unnest(v_accept) a
       where public.norm_answer(a) = public.norm_answer(v_first))
      and not (v_limit is not null and public.word_count(v_first) > v_limit);

    insert into responses (
      attempt_id, student_id, test_id, q, passage, q_type, skill,
      answer, first_answer, correct_answer, is_correct, first_was_correct, over_limit,
      seconds, changes, visits, flagged, locate, explanation)
    values (
      p_attempt_id, v_attempt.student_id, v_attempt.test_id, v_qn,
      (v_entry->>'passage')::int, v_entry->>'type', v_entry->>'skill',
      v_given, v_first, array_to_string(v_accept, ' / '), v_ok, v_first_ok, v_over,
      coalesce((v_item->>'seconds')::numeric, 0),
      coalesce((v_item->>'changes')::int, 0),
      coalesce((v_item->>'visits')::int, 0),
      coalesce((v_item->>'flagged')::boolean, false),
      v_entry->>'locate', v_entry->>'why');
  end loop;

  select count(*) filter (where is_correct) into v_raw
    from responses where attempt_id = p_attempt_id;

  v_elapsed := extract(epoch from (now() - v_attempt.started_at));
  v_late    := now() > v_attempt.deadline_at;

  update attempts a set
    status          = 'submitted',
    submitted_at    = now(),
    duration_seconds= least(round(v_elapsed)::int,
                            round(extract(epoch from (a.deadline_at - a.started_at)))::int),
    auto_submitted  = p_auto or v_late,
    ran_out_of_time = v_late,
    raw_score       = v_raw,
    band            = public.band_for(v_raw),
    passage_scores  = (select jsonb_object_agg(passage::text, j) from (
        select passage, jsonb_build_object(
                 'correct', count(*) filter (where is_correct),
                 'total',   count(*),
                 'seconds', round(sum(seconds))) j
          from responses where attempt_id = p_attempt_id group by passage) s),
    type_scores     = (select jsonb_object_agg(q_type, j) from (
        select q_type, jsonb_build_object(
                 'correct', count(*) filter (where is_correct),
                 'total',   count(*),
                 'seconds', round(sum(seconds))) j
          from responses where attempt_id = p_attempt_id group by q_type) s),
    skill_scores    = (select jsonb_object_agg(skill, j) from (
        select skill, jsonb_build_object(
                 'correct', count(*) filter (where is_correct),
                 'total',   count(*)) j
          from responses where attempt_id = p_attempt_id group by skill) s)
  where a.id = p_attempt_id;

  update students set last_seen_at = now() where id = v_attempt.student_id;

  return public.attempt_result(p_attempt_id);
end $$;

-- Full marked paper, including correct answers and explanations.
create or replace function public.attempt_result(p_attempt_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'attempt', to_jsonb(a) - 'student_id',
    'student', jsonb_build_object('name', s.display_name, 'code', s.access_code),
    'responses', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.q)
          from responses r where r.attempt_id = a.id), '[]'::jsonb))
  from attempts a join students s on s.id = a.student_id
  where a.id = p_attempt_id;
$$;

-- A student's own history. Requires the access code, so one student cannot
-- look up another.
create or replace function public.student_history(p_code text)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'submitted_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'attempt_id', a.id, 'test_id', a.test_id, 'submitted_at', a.submitted_at,
      'raw_score', a.raw_score, 'band', a.band,
      'duration_seconds', a.duration_seconds) x
    from attempts a
    join students s on s.id = a.student_id
    where s.access_code = upper(trim(coalesce(p_code, '')))
      and a.status = 'submitted'
  ) t;
$$;

-- A student reopening their own review page.
create or replace function public.student_attempt(p_attempt_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  select exists (
    select 1 from attempts a join students s on s.id = a.student_id
     where a.id = p_attempt_id
       and s.access_code = upper(trim(coalesce(p_code, '')))) into v_ok;
  if not v_ok then raise exception 'Not found'; end if;
  return public.attempt_result(p_attempt_id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. PERMISSIONS
--    Postgres needs BOTH a grant and an RLS policy before a row can be read,
--    so both are set explicitly here rather than relying on Supabase defaults.
--
--    anon gets no table access whatsoever. Every student action goes through
--    the security definer functions above, which require the access code.
-- ---------------------------------------------------------------------------

revoke all on public.students, public.attempts, public.responses, public.answer_keys
  from anon, authenticated;

grant select, insert, update, delete on public.students, public.attempts, public.responses
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- answer_keys stays revoked from everyone. Only the security definer functions
-- (which run as the table owner) can read it.

revoke all on function public.attempt_result(uuid) from anon, authenticated;

grant execute on function public.begin_attempt(text, text, text, int)   to anon, authenticated;
grant execute on function public.attempt_clock(uuid)                    to anon, authenticated;
grant execute on function public.submit_attempt(uuid, jsonb, boolean)   to anon, authenticated;
grant execute on function public.student_history(text)                  to anon, authenticated;
grant execute on function public.student_attempt(uuid, text)            to anon, authenticated;
grant execute on function public.attempt_result(uuid)                   to authenticated;

-- ---------------------------------------------------------------------------
-- 6. TEACHER VIEWS
-- ---------------------------------------------------------------------------

create or replace view public.v_attempt_summary as
  select a.id as attempt_id, s.display_name, s.access_code, s.id as student_id,
         a.test_id, a.submitted_at, a.raw_score, a.band, a.duration_seconds,
         a.ran_out_of_time, a.auto_submitted, a.status,
         (select count(*) from responses r
           where r.attempt_id = a.id and r.answer is null) as unanswered
    from attempts a join students s on s.id = a.student_id;

-- Accuracy by question type, per student, across every paper they have sat.
create or replace view public.v_type_accuracy as
  select r.student_id, s.display_name, r.q_type,
         count(*) as attempted,
         count(*) filter (where r.is_correct) as correct,
         round(100.0 * count(*) filter (where r.is_correct) / nullif(count(*), 0)) as pct,
         round(avg(r.seconds)) as avg_seconds
    from responses r
    join students s on s.id = r.student_id
    join attempts a on a.id = r.attempt_id and a.status = 'submitted'
   group by r.student_id, s.display_name, r.q_type;

-- security_invoker means the view obeys the RLS of whoever queries it, rather
-- than of whoever created it.
alter view public.v_attempt_summary set (security_invoker = on);
alter view public.v_type_accuracy   set (security_invoker = on);

revoke all on public.v_attempt_summary, public.v_type_accuracy from anon, authenticated;
grant select on public.v_attempt_summary, public.v_type_accuracy to authenticated;

-- =============================================================================
--  Next step: run db/seed-test-01.sql to load the answer key.
-- =============================================================================
