/* =============================================================================
   api.js - everything that talks to Supabase.

   If assets/js/config.js has no credentials the whole site falls back to
   PRACTICE MODE: identical behaviour, but attempts are marked in the browser
   and kept in localStorage. Useful for trying the site out before the database
   exists; useless for tracking students, because nothing leaves the device.
   ============================================================================= */
(function (w) {
  'use strict';

  const IELTS = (w.IELTS = w.IELTS || {});
  const CFG = w.IELTS_CONFIG || {};
  const LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);

  let sb = null;
  if (LIVE && w.supabase && w.supabase.createClient) {
    sb = w.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  }

  const LS = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  const uuid = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }

  /* ---- practice-mode helpers --------------------------------------------- */
  const keyCache = {};
  async function loadKey(testId) {
    if (keyCache[testId]) return keyCache[testId];
    // Only ever present when the project folder is being previewed locally.
    // The published site has no answer key - marking happens in the database.
    const res = await fetch(`private/${testId}.key.json`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(
        'This site is not connected to a database yet, so it cannot mark your paper. ' +
        'Ask your teacher to finish the setup.'
      );
    }
    const j = await res.json();
    keyCache[testId] = j.answers;
    return j.answers;
  }

  function markLocally(attempt, responses, key) {
    const rows = Object.keys(key)
      .map(Number)
      .sort((a, b) => a - b)
      .map((q) => {
        const entry = key[String(q)];
        const given = (responses.find((r) => r.q === q) || {});
        const res = IELTS.markAnswer(given.answer, entry);
        const first = IELTS.markAnswer(given.first_answer, entry);
        return {
          q,
          passage: entry.passage,
          q_type: entry.type,
          skill: entry.skill,
          answer: (given.answer || '').trim() || null,
          first_answer: (given.first_answer || '').trim() || null,
          correct_answer: entry.accept.join(' / '),
          is_correct: res.correct,
          first_was_correct: first.correct,
          over_limit: res.overLimit,
          seconds: given.seconds || 0,
          changes: given.changes || 0,
          visits: given.visits || 0,
          flagged: !!given.flagged,
          locate: entry.locate,
          explanation: entry.why,
        };
      });

    const group = (fn) => {
      const out = {};
      rows.forEach((r) => {
        const k = String(fn(r));
        out[k] = out[k] || { correct: 0, total: 0, seconds: 0 };
        out[k].total++;
        out[k].seconds += Math.round(r.seconds);
        if (r.is_correct) out[k].correct++;
      });
      return out;
    };

    const raw = rows.filter((r) => r.is_correct).length;
    const elapsed = (Date.now() - new Date(attempt.started_at).getTime()) / 1000;
    const cap = (new Date(attempt.deadline_at) - new Date(attempt.started_at)) / 1000;

    const student = attempt._student;
    Object.assign(attempt, {
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      duration_seconds: Math.round(Math.min(elapsed, cap)),
      ran_out_of_time: Date.now() > new Date(attempt.deadline_at).getTime(),
      raw_score: raw,
      band: IELTS.bandFor(raw),
      passage_scores: group((r) => r.passage),
      type_scores: group((r) => r.q_type),
      skill_scores: group((r) => r.skill),
    });

    const clean = Object.assign({}, attempt);
    delete clean._student;
    return { attempt: clean, student, responses: rows };
  }

  /* ---- public API --------------------------------------------------------- */
  const api = {
    live: LIVE && !!sb,
    mode: LIVE && sb ? 'live' : 'practice',

    async beginAttempt(code, name, testId) {
      const minutes = CFG.DURATION_MINUTES || 60;
      if (api.live) {
        return await rpc('begin_attempt', {
          p_code: code, p_name: name, p_test_id: testId, p_minutes: minutes,
        });
      }
      // practice mode
      const store = LS.get('ielts_practice', { attempts: {} });
      const codeU = String(code).trim().toUpperCase();
      const existing = Object.values(store.attempts).find(
        (a) => a.access_code === codeU && a.test_id === testId &&
          a.status === 'in_progress' && new Date(a.deadline_at) > new Date()
      );
      const attempt = existing || {
        id: uuid(),
        access_code: codeU,
        test_id: testId,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + minutes * 60000).toISOString(),
        _student: { name: String(name).trim(), code: codeU },
      };
      store.attempts[attempt.id] = attempt;
      LS.set('ielts_practice', store);
      return {
        attempt_id: attempt.id,
        student_name: attempt._student.name,
        access_code: codeU,
        test_id: testId,
        started_at: attempt.started_at,
        deadline_at: attempt.deadline_at,
        server_now: new Date().toISOString(),
        resumed: !!existing,
      };
    },

    async clock(attemptId) {
      if (api.live) return await rpc('attempt_clock', { p_attempt_id: attemptId });
      const store = LS.get('ielts_practice', { attempts: {} });
      const a = store.attempts[attemptId];
      if (!a) return null;
      return {
        server_now: new Date().toISOString(),
        deadline_at: a.deadline_at,
        status: a.status,
        seconds_left: Math.max(0, (new Date(a.deadline_at) - Date.now()) / 1000),
      };
    },

    async submitAttempt(attemptId, responses, auto) {
      if (api.live) {
        return await rpc('submit_attempt', {
          p_attempt_id: attemptId, p_responses: responses, p_auto: !!auto,
        });
      }
      const store = LS.get('ielts_practice', { attempts: {}, results: {} });
      store.results = store.results || {};
      const attempt = store.attempts[attemptId];
      if (!attempt) throw new Error('Attempt not found on this device.');
      if (attempt.status === 'submitted' && store.results[attemptId]) return store.results[attemptId];
      const key = await loadKey(attempt.test_id);
      const result = markLocally(attempt, responses, key);
      store.attempts[attemptId] = attempt;
      store.results[attemptId] = result;
      LS.set('ielts_practice', store);
      return result;
    },

    async studentAttempt(attemptId, code) {
      if (api.live) return await rpc('student_attempt', { p_attempt_id: attemptId, p_code: code });
      const store = LS.get('ielts_practice', { attempts: {}, results: {} });
      const r = (store.results || {})[attemptId];
      if (!r) throw new Error('That result is not stored on this device.');
      return r;
    },

    async studentHistory(code) {
      if (api.live) return await rpc('student_history', { p_code: code });
      const store = LS.get('ielts_practice', { attempts: {}, results: {} });
      return Object.values(store.attempts)
        .filter((a) => a.access_code === String(code).trim().toUpperCase() &&
          (store.results || {})[a.id])
        .map((a) => ({
          attempt_id: a.id, test_id: a.test_id, submitted_at: a.submitted_at,
          raw_score: a.raw_score, band: a.band, duration_seconds: a.duration_seconds,
        }))
        .sort((x, y) => (y.submitted_at || '').localeCompare(x.submitted_at || ''));
    },

    /* ---- teacher side ---------------------------------------------------- */
    async signIn(email, password) {
      if (!api.live) throw new Error('Connect Supabase first - see SETUP.md.');
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      return data;
    },
    async signOut() { if (sb) await sb.auth.signOut(); },
    async session() {
      if (!sb) return null;
      const { data } = await sb.auth.getSession();
      return data.session;
    },

    async teacherAttempts() {
      const { data, error } = await sb
        .from('v_attempt_summary').select('*')
        .eq('status', 'submitted').order('submitted_at', { ascending: false }).limit(1000);
      if (error) throw new Error(error.message);
      return data;
    },
    async teacherStudents() {
      const { data, error } = await sb.from('students').select('*').order('display_name');
      if (error) throw new Error(error.message);
      return data;
    },
    async teacherResponses(studentId) {
      let q = sb.from('responses').select('*').limit(20000);
      if (studentId) q = q.eq('student_id', studentId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data;
    },
    async teacherAttemptDetail(attemptId) {
      const { data, error } = await sb.rpc('attempt_result', { p_attempt_id: attemptId });
      if (error) throw new Error(error.message);
      return data;
    },
    async updateStudent(id, patch) {
      const { error } = await sb.from('students').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
  };

  IELTS.api = api;
})(window);
