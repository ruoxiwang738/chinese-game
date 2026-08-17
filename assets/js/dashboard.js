/* =============================================================================
   dashboard.js - what the teacher sees.
   ============================================================================= */
(function (w, d) {
  'use strict';
  const IELTS = w.IELTS, api = IELTS.api;
  const $ = (id) => d.getElementById(id);
  const esc = IELTS.escape;
  const view = () => $('view');

  const DATA = { attempts: [], students: [], responses: [], loaded: false };

  /* ======================= auth ========================================== */
  async function boot() {
    if (!api.live) {
      $('loading').classList.add('hidden');
      $('not-configured').classList.remove('hidden');
      return;
    }
    const session = await api.session();
    $('loading').classList.add('hidden');
    if (session) { await enter(session); } else { $('login').classList.remove('hidden'); }
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api.signIn($('email').value.trim(), $('password').value);
      $('login').classList.add('hidden');
      $('login-error').classList.add('hidden');
      await enter(await api.session());
    } catch (err) {
      $('login-error').textContent = err.message || 'Sign-in failed.';
      $('login-error').classList.remove('hidden');
    } finally { btn.disabled = false; }
  });

  $('signout').addEventListener('click', async () => { await api.signOut(); location.reload(); });

  async function enter(session) {
    $('who').textContent = session.user.email;
    $('signout').classList.remove('hidden');
    $('app').classList.remove('hidden');
    view().innerHTML = '<div class="card center dim">Loading results…</div>';
    try {
      const [attempts, students, responses] = await Promise.all([
        api.teacherAttempts(), api.teacherStudents(), api.teacherResponses(),
      ]);
      DATA.attempts = attempts || [];
      DATA.students = students || [];
      DATA.responses = responses || [];
      DATA.loaded = true;
      showTab('overview');
    } catch (err) {
      view().innerHTML = `<div class="notice notice-error">${esc(err.message)}</div>`;
    }
  }

  d.querySelectorAll('.tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      d.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      showTab(b.dataset.tab);
    });
  });

  function showTab(t) {
    if (t === 'overview') return renderOverview();
    if (t === 'students') return renderStudents();
    if (t === 'attempts') return renderAttempts();
  }

  /* ======================= helpers ======================================= */
  const submitted = () => DATA.attempts.filter((a) => a.status === 'submitted');
  const nameOf = (id) => (DATA.students.find((s) => s.id === id) || {}).display_name || 'Unknown';

  function card(title, body, sub) {
    return `<div class="card"><div class="card-head"><h3>${esc(title)}</h3></div>
      ${sub ? `<p class="small muted" style="margin:-8px 0 10px">${esc(sub)}</p>` : ''}${body}</div>`;
  }

  function bandTag(b) {
    if (b == null) return '-';
    return `<b>${Number(b).toFixed(1)}</b>`;
  }

  /* ======================= overview ====================================== */
  function renderOverview() {
    const subs = submitted();
    if (!subs.length) {
      view().innerHTML = '<div class="card"><h2>No papers yet</h2>' +
        '<p class="dim">Give a student an access code and ask them to sit a test. Their results will appear here.</p></div>';
      return;
    }
    const bands = subs.map((a) => Number(a.band)).filter((b) => !isNaN(b));
    const avg = bands.reduce((s, b) => s + b, 0) / bands.length;
    const ran = subs.filter((a) => a.ran_out_of_time).length;
    const agg = IELTS.analyseRows(DATA.responses, { attemptCount: subs.length });

    // most-missed questions
    const byQ = new Map();
    DATA.responses.forEach((r) => {
      const k = r.test_id + '#' + r.q;
      if (!byQ.has(k)) byQ.set(k, { test: r.test_id, q: r.q, type: r.q_type, passage: r.passage, n: 0, wrong: 0 });
      const o = byQ.get(k);
      o.n++; if (!r.is_correct) o.wrong++;
    });
    const missed = [...byQ.values()].filter((o) => o.n >= 2)
      .map((o) => ({ ...o, pct: Math.round((100 * o.wrong) / o.n) }))
      .sort((a, b) => b.pct - a.pct || b.n - a.n).slice(0, 10);

    view().innerHTML = `
      <div class="tiles" style="margin-bottom:16px">
        <div class="tile"><div class="v">${subs.length}</div><div class="k">Papers marked</div></div>
        <div class="tile"><div class="v">${DATA.students.length}</div><div class="k">Students</div></div>
        <div class="tile"><div class="v">${avg.toFixed(1)}</div><div class="k">Average band</div></div>
        <div class="tile"><div class="v">${Math.max(...bands).toFixed(1)}</div><div class="k">Best band</div></div>
        <div class="tile"><div class="v">${ran}</div><div class="k">Ran out of time</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        ${card('Accuracy by question type - whole class', '<div id="c-types"></div>', 'Weakest first. This is where group teaching time pays off most.')}
        ${card('Accuracy by underlying skill', '<div id="c-skills"></div>')}
      </div>

      ${card('Patterns across the class', '<div id="c-findings"></div>',
        'The same diagnosis the students see, run over every marked paper together.')}

      ${card('Questions the class gets wrong most often',
        `<table class="data"><thead><tr><th>Question</th><th>Type</th><th class="num">Sat by</th><th class="num">Wrong</th></tr></thead>
         <tbody>${missed.map((m) => `<tr>
            <td><b>Q${m.q}</b> <span class="muted small">${esc(m.test)}, passage ${m.passage}</span></td>
            <td><span class="tag">${esc(IELTS.typeLabel(m.type))}</span></td>
            <td class="num">${m.n}</td>
            <td class="num"><span class="tag ${m.pct >= 60 ? 'bad' : ''}">${m.pct}%</span></td>
          </tr>`).join('')}</tbody></table>`,
        'Items at least two students have attempted. A high figure usually means the item is worth teaching, not that the students are weak.')}
    `;

    IELTS.renderBars($('c-types'), agg.types.map((t) => ({
      label: IELTS.typeLabel(t.key), value: t.pct, display: `${t.correct}/${t.total} · ${t.pct}%`,
    })));
    IELTS.renderBars($('c-skills'), agg.skills.map((t) => ({
      label: IELTS.skillLabel(t.key), value: t.pct, display: `${t.correct}/${t.total} · ${t.pct}%`,
    })));
    IELTS.renderFindings($('c-findings'), agg.findings);
  }

  /* ======================= students ====================================== */
  function renderStudents() {
    const rows = DATA.students.map((s) => {
      const mine = submitted().filter((a) => a.student_id === s.id)
        .sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || ''));
      const bands = mine.map((a) => Number(a.band)).filter((b) => !isNaN(b));
      return {
        s, n: mine.length,
        latest: bands.length ? bands[bands.length - 1] : null,
        best: bands.length ? Math.max(...bands) : null,
        first: bands.length ? bands[0] : null,
        last: mine.length ? mine[mine.length - 1].submitted_at : null,
      };
    }).sort((a, b) => (b.last || '').localeCompare(a.last || ''));

    view().innerHTML = card('Students',
      `<table class="data"><thead><tr>
         <th>Name</th><th>Code</th><th class="num">Papers</th><th class="num">Latest</th>
         <th class="num">Best</th><th class="num">Change</th><th>Last sat</th></tr></thead>
       <tbody>${rows.map((r) => {
        const delta = r.first != null && r.latest != null ? r.latest - r.first : null;
        return `<tr class="clickable" data-student="${r.s.id}">
          <td><b>${esc(r.s.display_name)}</b></td>
          <td><span class="tag">${esc(r.s.access_code)}</span></td>
          <td class="num">${r.n}</td>
          <td class="num">${bandTag(r.latest)}</td>
          <td class="num">${bandTag(r.best)}</td>
          <td class="num">${delta == null || r.n < 2 ? '-' :
            `<span class="tag ${delta > 0 ? 'ok' : delta < 0 ? 'bad' : ''}">${delta > 0 ? '+' : ''}${delta.toFixed(1)}</span>`}</td>
          <td class="small muted">${r.last ? IELTS.fmtDate(r.last) : 'never'}</td>
        </tr>`;
      }).join('')}</tbody></table>`,
      'Click a student for their full history and diagnosis.');

    view().querySelectorAll('[data-student]').forEach((tr) =>
      tr.addEventListener('click', () => renderStudent(tr.dataset.student)));
  }

  function renderStudent(id) {
    const s = DATA.students.find((x) => x.id === id);
    const mine = submitted().filter((a) => a.student_id === id)
      .sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || ''));
    const rows = DATA.responses.filter((r) => r.student_id === id);
    const agg = IELTS.analyseRows(rows, { attemptCount: mine.length });

    view().innerHTML = `
      <button class="btn btn-sm" id="back">← All students</button>
      <div class="card" style="margin-top:14px">
        <div class="card-head">
          <h2>${esc(s.display_name)}</h2>
          <span class="tag">${esc(s.access_code)}</span>
          <div class="spacer"></div>
          <button class="btn btn-sm" id="export">Export CSV</button>
        </div>
        <div class="tiles">
          <div class="tile"><div class="v">${mine.length}</div><div class="k">Papers sat</div></div>
          <div class="tile"><div class="v">${mine.length ? Number(mine[mine.length - 1].band).toFixed(1) : '-'}</div><div class="k">Latest band</div></div>
          <div class="tile"><div class="v">${rows.length ? Math.round(100 * rows.filter((r) => r.is_correct).length / rows.length) : 0}%</div><div class="k">Lifetime accuracy</div></div>
          <div class="tile"><div class="v">${rows.filter((r) => !r.answer).length}</div><div class="k">Blanks left</div></div>
        </div>
      </div>

      ${mine.length > 1 ? card('Band across papers', '<div id="c-trend"></div>') : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        ${card('Accuracy by question type', '<div id="c-types"></div>', 'Across every paper this student has sat.')}
        ${card('Accuracy by skill', '<div id="c-skills"></div>')}
      </div>

      ${card('Diagnosis', '<div id="c-findings"></div>')}

      ${card('Papers', `<table class="data"><thead><tr><th>Date</th><th>Test</th>
        <th class="num">Score</th><th class="num">Band</th><th class="num">Time</th><th class="num">Blanks</th><th></th></tr></thead>
        <tbody>${mine.slice().reverse().map((a) => `<tr>
          <td>${IELTS.fmtDate(a.submitted_at)}</td>
          <td>${esc(a.test_id)}</td>
          <td class="num">${a.raw_score}/40</td>
          <td class="num">${bandTag(a.band)}</td>
          <td class="num">${IELTS.humanTime(a.duration_seconds || 0)}${a.ran_out_of_time ? ' <span class="tag bad">out of time</span>' : ''}</td>
          <td class="num">${a.unanswered != null ? a.unanswered : '-'}</td>
          <td class="right"><button class="btn btn-sm" data-attempt="${a.attempt_id}">Open</button></td>
        </tr>`).join('')}</tbody></table>`)}
    `;

    $('back').addEventListener('click', renderStudents);
    IELTS.renderBars($('c-types'), agg.types.map((t) => ({
      label: IELTS.typeLabel(t.key), value: t.pct, display: `${t.correct}/${t.total} · ${t.pct}%`,
    })));
    IELTS.renderBars($('c-skills'), agg.skills.map((t) => ({
      label: IELTS.skillLabel(t.key), value: t.pct, display: `${t.correct}/${t.total} · ${t.pct}%`,
    })));
    IELTS.renderFindings($('c-findings'), agg.findings);

    if (mine.length > 1) {
      IELTS.renderTrend($('c-trend'), mine.map((a, i) => ({
        band: Number(a.band), label: IELTS.fmtDate(a.submitted_at), short: 'P' + (i + 1),
      })));
    }

    $('export').addEventListener('click', () => {
      IELTS.download(`${s.display_name.replace(/\W+/g, '-')}-responses.csv`,
        IELTS.toCSV(rows, ['test_id', 'q', 'passage', 'q_type', 'skill', 'answer',
          'correct_answer', 'is_correct', 'over_limit', 'seconds', 'changes', 'flagged']));
    });

    view().querySelectorAll('[data-attempt]').forEach((b) =>
      b.addEventListener('click', () => openAttempt(b.dataset.attempt, () => renderStudent(id))));
  }

  /* ======================= attempts ====================================== */
  function renderAttempts() {
    const subs = submitted();
    view().innerHTML = card('All marked papers',
      `<table class="data"><thead><tr><th>Date</th><th>Student</th><th>Test</th>
        <th class="num">Score</th><th class="num">Band</th><th class="num">Time</th><th class="num">Blanks</th><th></th></tr></thead>
       <tbody>${subs.map((a) => `<tr>
          <td>${IELTS.fmtDate(a.submitted_at)}</td>
          <td><b>${esc(a.display_name)}</b> <span class="muted small">${esc(a.access_code)}</span></td>
          <td>${esc(a.test_id)}</td>
          <td class="num">${a.raw_score}/40</td>
          <td class="num">${bandTag(a.band)}</td>
          <td class="num">${IELTS.humanTime(a.duration_seconds || 0)}${a.ran_out_of_time ? ' <span class="tag bad">out of time</span>' : ''}</td>
          <td class="num">${a.unanswered != null ? a.unanswered : '-'}</td>
          <td class="right"><button class="btn btn-sm" data-attempt="${a.attempt_id}">Open</button></td>
        </tr>`).join('')}</tbody></table>`);

    view().querySelectorAll('[data-attempt]').forEach((b) =>
      b.addEventListener('click', () => openAttempt(b.dataset.attempt, renderAttempts)));
  }

  /* ======================= one paper ===================================== */
  const paperCache = {};
  async function openAttempt(attemptId, back) {
    view().innerHTML = '<div class="card center dim">Loading paper…</div>';
    let result;
    try { result = await api.teacherAttemptDetail(attemptId); }
    catch (e) { view().innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`; return; }

    const testId = result.attempt.test_id;
    if (!paperCache[testId]) {
      try { paperCache[testId] = await (await fetch(`tests/${testId}.json`, { cache: 'no-store' })).json(); }
      catch (e) { paperCache[testId] = null; }
    }
    const a = IELTS.analyse(result);

    view().innerHTML = `
      <button class="btn btn-sm" id="back">← Back</button>
      <p class="small muted" style="margin:14px 0 8px">
        ${esc(result.student.name)} · ${esc(testId)} · ${IELTS.fmtDate(result.attempt.submitted_at)}
        ${result.attempt.auto_submitted ? ' · auto-submitted at time' : ''}</p>
      <div class="card" id="score-header"></div>
      ${card('Diagnosis', '<div id="findings"></div>')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        ${card('By passage', '<div id="c-p"></div>')}
        ${card('By question type', '<div id="c-t"></div>')}
      </div>
      <div class="card">
        <div class="card-head"><h3>Every question</h3><div class="spacer"></div>
          <button class="btn btn-sm btn-primary" data-f="wrong">Mistakes</button>
          <button class="btn btn-sm" data-f="all">All</button>
          <button class="btn btn-sm" data-f="flagged">Flagged</button>
        </div>
        <div id="qr"></div>
      </div>`;

    $('back').addEventListener('click', back);
    IELTS.renderScoreHeader($('score-header'), result, a);
    IELTS.renderFindings($('findings'), a.findings);
    IELTS.renderBars($('c-p'), a.passages.map((p) => ({
      label: `Passage ${p.key}`, value: p.pct, display: `${p.correct}/${p.total} · ${IELTS.humanTime(p.seconds)}`,
    })));
    IELTS.renderBars($('c-t'), a.types.map((t) => ({
      label: IELTS.typeLabel(t.key), value: t.pct, display: `${t.correct}/${t.total} · ${t.pct}%`,
    })));

    const paint = (f) => {
      let list = result.responses;
      if (f === 'wrong') list = list.filter((r) => !r.is_correct);
      if (f === 'flagged') list = list.filter((r) => r.flagged);
      if (!list.length) { $('qr').innerHTML = '<p class="small muted">Nothing to show.</p>'; return; }
      IELTS.renderQuestionReview($('qr'), list, { paper: paperCache[testId] });
    };
    paint('wrong');
    view().querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
      view().querySelectorAll('[data-f]').forEach((x) => x.classList.remove('btn-primary'));
      b.classList.add('btn-primary');
      paint(b.dataset.f);
    }));
  }

  boot();
})(window, document);
