/* =============================================================================
   report.js - shared rendering for the results page and the teacher dashboard.
   ============================================================================= */
(function (w, d) {
  'use strict';
  const IELTS = (w.IELTS = w.IELTS || {});
  const esc = IELTS.escape;

  /* ---- horizontal bars -----------------------------------------------------
     One series, one colour. The value is printed beside every bar so the chart
     doubles as its own table view. */
  IELTS.renderBars = function (el, items, opts) {
    opts = opts || {};
    const max = opts.max != null ? opts.max : Math.max(100, ...items.map((i) => i.value));
    el.innerHTML = '<div class="chart">' + items.map((i) => `
      <div class="barrow">
        <div class="lab" title="${esc(i.label)}">${esc(i.label)}</div>
        <div class="bartrack"><div class="barfill" style="width:${Math.max(1, (100 * i.value) / max)}%"></div></div>
        <div class="val">${esc(i.display != null ? i.display : i.value + (opts.suffix || ''))}</div>
      </div>`).join('') + '</div>';
  };

  /* ---- band trend line ---------------------------------------------------- */
  IELTS.renderTrend = function (el, points, opts) {
    opts = opts || {};
    if (points.length < 2) {
      el.innerHTML = '<p class="small muted">A trend line appears once there are two or more marked papers.</p>';
      return;
    }
    const W = 640, H = 180, PL = 34, PR = 14, PT = 14, PB = 26;
    const lo = 4, hi = 9;
    const x = (i) => PL + (i * (W - PL - PR)) / (points.length - 1);
    const y = (v) => PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo));
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.band).toFixed(1)}`).join(' ');
    const ticks = [4, 5, 6, 7, 8, 9];

    el.innerHTML = `<svg class="spark" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
        aria-label="Band score across ${points.length} papers">
      ${ticks.map((t) => `<line x1="${PL}" x2="${W - PR}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>
        <text x="${PL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${t.toFixed(1)}</text>`).join('')}
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.band)}" r="4.5" fill="var(--accent)" stroke="#fff" stroke-width="2">
          <title>${esc(p.label)}: band ${p.band.toFixed(1)}</title></circle>`).join('')}
      ${points.map((p, i) => (i === 0 || i === points.length - 1)
        ? `<text x="${x(i)}" y="${y(p.band) - 12}" text-anchor="middle" font-size="11" font-weight="650" fill="var(--ink)">${p.band.toFixed(1)}</text>`
        : '').join('')}
      ${points.map((p, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(p.short || '')}</text>`).join('')}
    </svg>`;
  };

  /* ---- findings ----------------------------------------------------------- */
  const LEVEL_TEXT = { high: 'Priority', medium: 'Watch', good: 'Strength', info: 'Note' };

  IELTS.renderFindings = function (el, findings) {
    if (!findings.length) {
      el.innerHTML = '<p class="small muted">No recurring problems stood out in this paper.</p>';
      return;
    }
    el.innerHTML = findings.map((f) => `
      <div class="finding ${f.level}">
        <h4><span class="pill ${f.level}">${LEVEL_TEXT[f.level] || 'Note'}</span> ${esc(f.title)}</h4>
        <p>${esc(f.detail)}</p>
        ${f.action ? `<div class="action"><b>What to do:</b> ${esc(f.action)}</div>` : ''}
      </div>`).join('');
  };

  /* ---- score header ------------------------------------------------------- */
  IELTS.renderScoreHeader = function (el, result, a) {
    const at = result.attempt || {};
    const blanks = (result.responses || []).filter((r) => !r.answer).length;
    const gap = a.nextBand;
    el.innerHTML = `
      <div class="hero">
        <div class="band-figure">
          <div class="n">${a.band.toFixed(1)}</div>
          <div class="l">Estimated band</div>
        </div>
        <div style="flex:1;min-width:260px">
          <div class="tiles">
            <div class="tile"><div class="v">${a.raw}<span class="muted" style="font-size:1rem">/${a.total}</span></div><div class="k">Correct answers</div></div>
            <div class="tile"><div class="v">${IELTS.humanTime(at.duration_seconds || 0)}</div><div class="k">Time used${at.ran_out_of_time ? ' · ran out' : ''}</div></div>
            <div class="tile"><div class="v">${blanks}</div><div class="k">Left blank</div></div>
          </div>
          ${gap ? `<p class="small dim" style="margin:12px 0 0">
              ${gap.need} more correct answer${gap.need > 1 ? 's' : ''} would have reached band ${gap.band.toFixed(1)}.</p>` : ''}
        </div>
      </div>`;
  };

  /* ---- question-by-question ------------------------------------------------ */
  IELTS.renderQuestionReview = function (el, rows, opts) {
    opts = opts || {};
    const paper = opts.paper || null;
    const qText = {};
    if (paper) {
      paper.passages.forEach((p) => p.groups.forEach((g) => g.questions.forEach((q) => {
        qText[q.n] = { text: q.text, group: g.heading, options: q.options || g.options };
      })));
    }

    el.innerHTML = rows.map((r) => {
      const info = qText[r.q] || {};
      const wrong = !r.is_correct;
      const yours = r.answer
        ? `<span class="ansbox ${wrong ? 'bad' : 'ok'}">${esc(r.answer)}</span>`
        : '<span class="ansbox">- blank -</span>';
      const notes = [];
      if (r.over_limit) notes.push('over the word limit');
      if (r.first_was_correct && !r.is_correct) notes.push(`changed from "${r.first_answer}", which was right`);
      if (r.flagged) notes.push('flagged for review');
      if (Number(r.seconds) > 0) notes.push(IELTS.humanTime(r.seconds));
      if (Number(r.changes) > 0) notes.push(`changed ${r.changes}×`);

      return `<div class="rev ${wrong ? 'wrong' : 'correct'}">
        <div class="rev-head">
          <span class="n">Q${r.q}</span>
          <span class="tag">${esc(IELTS.typeLabel(r.q_type))}</span>
          <span class="tag">Passage ${r.passage}</span>
          <span class="tag ${wrong ? 'bad' : 'ok'}">${wrong ? 'Incorrect' : 'Correct'}</span>
          <div class="spacer"></div>
          <span class="small muted">${notes.join(' · ')}</span>
        </div>
        ${info.text ? `<div class="rev-q">${esc(info.text)}</div>` : ''}
        <div class="rev-ans">
          <div><b>Your answer:</b> ${yours}</div>
          ${wrong ? `<div><b>Correct:</b> <span class="ansbox ok">${esc(r.correct_answer)}</span></div>` : ''}
        </div>
        ${(r.locate || r.explanation) ? `<div class="rev-why">
            ${r.locate ? `<b>${esc(r.locate)}.</b> ` : ''}${esc(r.explanation || '')}</div>` : ''}
      </div>`;
    }).join('');
  };

  /* ---- csv ---------------------------------------------------------------- */
  IELTS.toCSV = function (rows, cols) {
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    return [cols.map(q).join(',')]
      .concat(rows.map((r) => cols.map((c) => q(r[c])).join(',')))
      .join('\n');
  };

  IELTS.download = function (filename, text) {
    const b = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = d.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
})(window, document);
