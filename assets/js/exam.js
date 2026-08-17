/* =============================================================================
   exam.js - the test engine.

   Responsibilities: render the paper, run the clock, record what the student
   does (answers, changes of mind, time per question, flags), and submit.
   ============================================================================= */
(function (w, d) {
  'use strict';
  const IELTS = w.IELTS, api = IELTS.api, CFG = w.IELTS_CONFIG;
  const $ = (id) => d.getElementById(id);
  const esc = IELTS.escape;

  const params = new URLSearchParams(location.search);
  const attemptId = params.get('a');
  const testId = params.get('t');

  const state = {
    paper: null,
    part: 0,
    answers: {},     // q -> value
    first: {},       // q -> the first answer given
    seconds: {},     // q -> seconds focused
    changes: {},
    visits: {},
    flags: {},
    partSeconds: {}, // part index -> seconds
    activeQ: null,
    deadline: null,  // ms epoch, server-derived
    offset: 0,       // serverNow - clientNow
    submitting: false,
    warned: {},
  };

  const DRAFT_KEY = 'ielts_draft_' + attemptId;

  /* ======================= boot ========================================== */
  async function boot() {
    if (!attemptId || !testId) { location.href = 'index.html'; return; }

    const meta = JSON.parse(sessionStorage.getItem('ielts_attempt_' + attemptId) || 'null');
    if (meta) {
      $('hdr-student').textContent = `${meta.student_name} · ${meta.access_code}`;
      state.deadline = new Date(meta.deadline_at).getTime();
      state.offset = new Date(meta.server_now).getTime() - Date.now();
    }

    try {
      const res = await fetch(`tests/${testId}.json`, { cache: 'no-store' });
      state.paper = await res.json();
    } catch (e) {
      d.body.innerHTML = '<div class="wrap-slim" style="padding:60px"><h1>Could not load the test</h1>' +
        '<p>Check your connection and reload.</p><a class="btn" href="index.html">Back</a></div>';
      return;
    }
    $('hdr-test').textContent = state.paper.title;
    d.title = state.paper.title;

    restoreDraft();
    await syncClock();
    buildFooter();
    renderPart(0);
    tickLoop();
    setInterval(syncClock, 60000);
    setInterval(saveDraft, 5000);
    wireHighlighter();

    w.addEventListener('beforeunload', (e) => {
      if (!state.submitting) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ======================= clock ========================================= */
  async function syncClock() {
    try {
      const c = await api.clock(attemptId);
      if (c && c.deadline_at) {
        state.offset = new Date(c.server_now).getTime() - Date.now();
        state.deadline = new Date(c.deadline_at).getTime();
      }
    } catch (e) { /* keep the local estimate */ }
  }

  function secondsLeft() {
    if (!state.deadline) return (CFG.DURATION_MINUTES || 60) * 60;
    return (state.deadline - (Date.now() + state.offset)) / 1000;
  }

  function tickLoop() {
    setInterval(() => {
      const left = secondsLeft();
      paintTimer(left);

      if (d.visibilityState === 'visible' && d.hasFocus()) {
        state.partSeconds[state.part] = (state.partSeconds[state.part] || 0) + 1;
        if (state.activeQ != null) {
          state.seconds[state.activeQ] = (state.seconds[state.activeQ] || 0) + 1;
        }
      }
      if (left <= 0 && !state.submitting) submit(true);
    }, 1000);
  }

  function paintTimer(left) {
    const el = $('timer');
    $('timer-text').textContent = IELTS.mmss(left);
    el.classList.toggle('warn', left <= 600 && left > 300);
    el.classList.toggle('danger', left <= 300);
    (CFG.WARN_AT || []).forEach((m) => {
      if (left <= m * 60 && left > m * 60 - 2 && !state.warned[m]) {
        state.warned[m] = true;
        toast(m === 1 ? 'One minute left. Fill in any blanks now.' : `${m} minutes remaining.`);
      }
    });
  }

  function toast(msg) {
    const t = d.createElement('div');
    t.className = 'notice notice-warn';
    t.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:70;box-shadow:var(--shadow);font-weight:550';
    t.textContent = msg;
    d.body.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  /* ======================= draft persistence ============================= */
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        answers: state.answers, first: state.first, seconds: state.seconds,
        changes: state.changes, visits: state.visits, flags: state.flags,
        partSeconds: state.partSeconds, deadline: state.deadline,
      }));
    } catch (e) {}
  }
  function restoreDraft() {
    try {
      const dr = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!dr) return;
      Object.assign(state, {
        answers: dr.answers || {}, first: dr.first || {}, seconds: dr.seconds || {},
        changes: dr.changes || {}, visits: dr.visits || {}, flags: dr.flags || {},
        partSeconds: dr.partSeconds || {},
      });
      if (!state.deadline && dr.deadline) state.deadline = dr.deadline;
    } catch (e) {}
  }

  /* ======================= rendering ===================================== */
  function renderPart(i) {
    state.part = i;
    const p = state.paper.passages[i];

    // ---- passage
    $('pane-passage').innerHTML =
      `<div class="passage-instr">${esc(p.instructions)}</div>
       <h2 class="passage-title">${esc(p.title)}</h2>
       <div class="passage-body">` +
      p.paragraphs.map((par) =>
        `<p>${p.lettered ? `<span class="para-label">${esc(par.label)}</span>` : ''}${esc(par.text)}</p>`
      ).join('') + '</div>';

    // ---- questions
    $('pane-questions').innerHTML = p.groups.map(renderGroup).join('');
    restoreInputs();
    $('pane-questions').scrollTop = 0;
    $('pane-passage').scrollTop = 0;
    updateFooter();
  }

  function renderGroup(g) {
    let html = `<div class="qgroup" data-type="${esc(g.type)}">
      <div class="qgroup-head">${esc(g.heading)}</div>
      <div class="qgroup-instr">${esc(g.instructions)}</div>`;
    if (g.rubric) html += `<div class="qgroup-rubric">${g.rubric.map(esc).join('<br>')}</div>`;

    if (g.options && g.type !== 'multiple_choice') {
      html += '<div class="opt-list">' +
        g.options.map((o) => `<div><b>${esc(o.key)}</b><span>${esc(o.text)}</span></div>`).join('') +
        '</div>';
    }
    if (g.example) {
      html += `<div class="small dim" style="margin:-8px 0 14px">
        <b>Example:</b> ${esc(g.example.label)} &nbsp;<span class="ansbox">${esc(g.example.answer)}</span></div>`;
    }

    if (g.type === 'table_completion' && g.table) {
      html += renderTable(g);
      html += g.questions.map((q) => flagRow(q)).join('');
    } else if (g.type === 'summary_completion_box' && g.summary) {
      html += renderSummary(g);
      html += g.questions.map((q) => flagRow(q)).join('');
    } else {
      html += g.questions.map((q) => renderQuestion(g, q)).join('');
    }
    return html + '</div>';
  }

  function renderQuestion(g, q) {
    let body = '';
    const t = g.type;

    if (t === 'tfng' || t === 'ynng') {
      const opts = t === 'tfng' ? ['TRUE', 'FALSE', 'NOT GIVEN'] : ['YES', 'NO', 'NOT GIVEN'];
      body = `<div class="qtext">${esc(q.text)}</div><div class="choices">` +
        opts.map((o) => `<label class="choice"><input type="radio" name="q${q.n}" value="${o}" data-q="${q.n}"><span>${o}</span></label>`).join('') +
        '</div>';
    } else if (t === 'multiple_choice') {
      body = `<div class="qtext">${esc(q.text)}</div><div class="choices">` +
        (q.options || []).map((o) =>
          `<label class="choice mcq"><input type="radio" name="q${q.n}" value="${esc(o.key)}" data-q="${q.n}">
            <span><b>${esc(o.key)}</b> &nbsp;${esc(o.text)}</span></label>`).join('') +
        '</div>';
    } else if (g.options) {
      body = `<div class="qtext">${esc(q.text)}</div>` + selectFor(q.n, g.options);
    } else {
      body = `<div class="qtext">${gapText(q.text, q.n)}</div>`;
    }

    return `<div class="q" id="q-${q.n}" data-qn="${q.n}">
      <div class="qnum">${q.n}</div>
      <div class="qmain">${body}
        <label class="flagbox"><input type="checkbox" data-flag="${q.n}"> Flag for review</label>
      </div></div>`;
  }

  function flagRow(q) {
    return `<label class="flagbox" style="margin-right:14px"><input type="checkbox" data-flag="${q.n}"> Flag Q${q.n}</label>`;
  }

  function selectFor(n, options) {
    return `<select data-q="${n}"><option value="">- select -</option>` +
      options.map((o) => `<option value="${esc(o.key)}">${esc(o.key)} &nbsp; ${esc(o.text)}</option>`).join('') +
      '</select>';
  }

  function gapText(text, n) {
    // the authoring format writes gaps as a run of underscores
    return esc(text).replace(/_{3,}/,
      `<input type="text" data-q="${n}" autocomplete="off" spellcheck="false" placeholder="answer">`);
  }

  function placeholders(str, mk) {
    return esc(str).replace(/\{\{(\d+)\}\}/g, (_, n) => mk(Number(n)));
  }

  function renderTable(g) {
    const t = g.table;
    return '<table class="qtable"><thead><tr>' +
      t.headers.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>' +
      t.rows.map((r) => '<tr>' + r.map((c) =>
        `<td>${placeholders(c, (n) => `<b>${n}</b> <input type="text" data-q="${n}" autocomplete="off" spellcheck="false">`)}</td>`
      ).join('') + '</tr>').join('') +
      '</tbody></table>';
  }

  function renderSummary(g) {
    return `<div class="summary-box"><b>${esc(g.summary.title || '')}</b><br>` +
      placeholders(g.summary.text, (n) => {
        const sel = selectFor(n, g.options).replace('<select', `<select id="sel-${n}"`);
        return `<b>${n}</b> ${sel}`;
      }) + '</div>';
  }

  function restoreInputs() {
    d.querySelectorAll('#pane-questions [data-q]').forEach((el) => {
      const n = Number(el.dataset.q);
      const v = state.answers[n];
      if (v == null) return;
      if (el.type === 'radio') el.checked = el.value === v;
      else el.value = v;
    });
    d.querySelectorAll('#pane-questions [data-flag]').forEach((el) => {
      el.checked = !!state.flags[Number(el.dataset.flag)];
    });
    d.querySelectorAll('#pane-questions .q').forEach((el) => {
      el.classList.toggle('answered', !!state.answers[Number(el.dataset.qn)]);
    });
  }

  /* ======================= input handling ================================ */
  function setAnswer(n, value) {
    const v = (value == null ? '' : String(value));
    const prev = state.answers[n] || '';
    if (v && !state.first[n]) state.first[n] = v;
    if (prev && v && prev !== v) state.changes[n] = (state.changes[n] || 0) + 1;
    state.answers[n] = v;
    const qEl = $('q-' + n);
    if (qEl) qEl.classList.toggle('answered', !!v);
    updateFooter();
    saveDraft();
  }

  function setActive(n) {
    if (state.activeQ === n) return;
    state.activeQ = n;
    state.visits[n] = (state.visits[n] || 0) + 1;
    d.querySelectorAll('#pane-questions .q.active').forEach((e) => e.classList.remove('active'));
    const el = $('q-' + n);
    if (el) el.classList.add('active');
    updateFooter();
  }

  const pane = $('pane-questions');
  pane.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.q) setAnswer(Number(el.dataset.q), el.value);
  });
  pane.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.q) setAnswer(Number(el.dataset.q), el.value);
    if (el.dataset && el.dataset.flag) {
      state.flags[Number(el.dataset.flag)] = el.checked;
      updateFooter(); saveDraft();
    }
  });
  pane.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.q) setActive(Number(el.dataset.q));
    else {
      const q = el.closest && el.closest('.q');
      if (q) setActive(Number(q.dataset.qn));
    }
  });
  pane.addEventListener('click', (e) => {
    const q = e.target.closest && e.target.closest('.q');
    if (q) setActive(Number(q.dataset.qn));
  });

  /* ======================= footer palette ================================ */
  function buildFooter() {
    $('footer').innerHTML = state.paper.passages.map((p, i) => {
      const nums = p.groups.flatMap((g) => g.questions.map((q) => q.n));
      return `<div class="part" data-part="${i}">
        <div class="part-label">Part ${p.number}<small>Q${nums[0]}-${nums[nums.length - 1]}</small></div>
        <div class="pal">${nums.map((n) => `<button data-goto="${n}" data-part-of="${i}">${n}</button>`).join('')}</div>
      </div>`;
    }).join('');

    $('footer').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-goto]');
      if (!b) return;
      const n = Number(b.dataset.goto), part = Number(b.dataset.partOf);
      if (part !== state.part) renderPart(part);
      setActive(n);
      const el = $('q-' + n) || d.querySelector(`[data-q="${n}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const inp = el.matches('[data-q]') ? el : el.querySelector('[data-q]');
        if (inp && inp.focus) setTimeout(() => inp.focus({ preventScroll: true }), 200);
      }
    });
  }

  function updateFooter() {
    d.querySelectorAll('#footer button[data-goto]').forEach((b) => {
      const n = Number(b.dataset.goto);
      b.classList.toggle('done', !!state.answers[n]);
      b.classList.toggle('flag', !!state.flags[n]);
      b.classList.toggle('cur', state.activeQ === n);
    });
    d.querySelectorAll('#footer .part').forEach((p) => {
      p.classList.toggle('current', Number(p.dataset.part) === state.part);
    });
  }

  /* ======================= highlighter =================================== */
  function wireHighlighter() {
    const btn = $('hl-btn');
    const passage = $('pane-passage');

    passage.addEventListener('mouseup', () => {
      const sel = w.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) { btn.style.display = 'none'; return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      btn.style.display = 'block';
      btn.style.top = (r.top - 38) + 'px';
      btn.style.left = Math.max(8, r.left + r.width / 2 - 40) + 'px';
    });

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const sel = w.getSelection();
      if (!sel || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const mark = d.createElement('mark');
      try { range.surroundContents(mark); }
      catch (err) { mark.appendChild(range.extractContents()); range.insertNode(mark); }
      sel.removeAllRanges();
      btn.style.display = 'none';
    });

    passage.addEventListener('click', (e) => {
      if (e.target.tagName === 'MARK') {
        const m = e.target;
        while (m.firstChild) m.parentNode.insertBefore(m.firstChild, m);
        m.remove();
      }
    });

    d.addEventListener('mousedown', (e) => {
      if (e.target !== btn && !passage.contains(e.target)) btn.style.display = 'none';
    });

    $('hl-clear').addEventListener('click', () => {
      passage.querySelectorAll('mark').forEach((m) => {
        while (m.firstChild) m.parentNode.insertBefore(m.firstChild, m);
        m.remove();
      });
    });
  }

  /* ======================= submission ==================================== */
  function allQuestionNumbers() {
    return state.paper.passages.flatMap((p) => p.groups.flatMap((g) => g.questions.map((q) => q.n)));
  }

  function buildPayload() {
    return allQuestionNumbers().map((n) => ({
      q: n,
      answer: state.answers[n] || '',
      first_answer: state.first[n] || '',
      seconds: Math.round(state.seconds[n] || 0),
      changes: state.changes[n] || 0,
      visits: state.visits[n] || 0,
      flagged: !!state.flags[n],
    }));
  }

  $('finish-btn').addEventListener('click', () => {
    const nums = allQuestionNumbers();
    const blank = nums.filter((n) => !state.answers[n]);
    const flagged = nums.filter((n) => state.flags[n]);
    modal(`
      <h2>Submit your paper?</h2>
      <p class="dim">You cannot reopen it once it is marked.</p>
      <div class="tiles" style="margin:16px 0">
        <div class="tile"><div class="v">${nums.length - blank.length}/${nums.length}</div><div class="k">Answered</div></div>
        <div class="tile"><div class="v">${blank.length}</div><div class="k">Left blank</div></div>
        <div class="tile"><div class="v">${IELTS.mmss(Math.max(0, secondsLeft()))}</div><div class="k">Time left</div></div>
      </div>
      ${blank.length ? `<div class="notice notice-warn">Q${blank.join(', Q')} ${blank.length === 1 ? 'is' : 'are'} still blank. A guess scores better than nothing.</div>` : ''}
      ${flagged.length ? `<div class="notice notice-info" style="margin-top:10px">Still flagged: Q${flagged.join(', Q')}</div>` : ''}
      <div class="row" style="margin-top:18px">
        <button class="btn" data-close>Keep working</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="confirm-submit">Submit and mark</button>
      </div>`);
    $('confirm-submit').addEventListener('click', () => submit(false));
  });

  async function submit(auto) {
    if (state.submitting) return;
    state.submitting = true;
    modal(`<h2>${auto ? 'Time is up' : 'Marking your paper'}</h2>
           <p class="dim">Sending your answers. Do not close this window.</p>`, true);
    try {
      const result = await api.submitAttempt(attemptId, buildPayload(), !!auto);
      localStorage.removeItem(DRAFT_KEY);
      sessionStorage.setItem('ielts_result_' + attemptId, JSON.stringify(result));
      location.href = `review.html?a=${encodeURIComponent(attemptId)}&fresh=1`;
    } catch (err) {
      state.submitting = false;
      modal(`<h2>Could not submit</h2>
             <p class="dim">${esc(err.message || 'Network problem.')}</p>
             <p class="small">Your answers are still saved in this browser. Check your connection and try again.</p>
             <div class="row" style="margin-top:16px">
               <button class="btn" data-close>Close</button><div class="spacer"></div>
               <button class="btn btn-primary" id="retry">Try again</button></div>`);
      const r = $('retry');
      if (r) r.addEventListener('click', () => submit(auto));
    }
  }

  function modal(html, locked) {
    $('modal-root').innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
    if (!locked) {
      $('modal-root').querySelectorAll('[data-close]').forEach((b) =>
        b.addEventListener('click', () => ($('modal-root').innerHTML = '')));
    }
  }

  boot();
})(window, document);
