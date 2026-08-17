/* =============================================================================
   core.js - shared helpers: band conversion, answer marking, question labels.
   The marking rules here mirror db/schema.sql exactly. If you change one,
   change the other.
   ============================================================================= */
(function (w) {
  'use strict';

  const IELTS = (w.IELTS = w.IELTS || {});

  /* ---- band conversion ---------------------------------------------------
     39-40 = 9.0 down to 10-12 = 4.0 follows the conversion table printed in
     the Cambridge IELTS practice test books. Below 10 is extrapolated.
     Every test is equated slightly differently, so treat this as an estimate. */
  const BAND_TABLE = [
    [39, 9.0], [37, 8.5], [35, 8.0], [33, 7.5], [30, 7.0], [27, 6.5],
    [23, 6.0], [19, 5.5], [15, 5.0], [13, 4.5], [10, 4.0], [8, 3.5],
    [6, 3.0], [4, 2.5], [3, 2.0], [2, 1.5], [1, 1.0],
  ];

  IELTS.bandFor = function (raw) {
    for (const [min, band] of BAND_TABLE) if (raw >= min) return band;
    return 0;
  };

  /** Marks needed to reach the next half band, or null at 9.0 */
  IELTS.nextBandGap = function (raw) {
    for (let i = BAND_TABLE.length - 1; i >= 0; i--) {
      if (BAND_TABLE[i][0] > raw) return { need: BAND_TABLE[i][0] - raw, band: BAND_TABLE[i][1] };
    }
    return null;
  };

  /* ---- answer normalisation ---------------------------------------------- */
  IELTS.normalise = function (s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')   // café -> cafe, not caf
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  IELTS.wordCount = function (s) {
    const n = IELTS.normalise(s);
    return n ? n.split(' ').length : 0;
  };

  /** Used only in practice mode; the live site marks on the server. */
  IELTS.markAnswer = function (given, entry) {
    const g = (given || '').trim();
    if (!g) return { correct: false, overLimit: false };
    const overLimit = !!(entry.limit && IELTS.wordCount(g) > entry.limit);
    if (overLimit) return { correct: false, overLimit: true };
    const n = IELTS.normalise(g);
    return { correct: entry.accept.some((a) => IELTS.normalise(a) === n), overLimit: false };
  };

  /* ---- edit distance, for spotting near misses ---------------------------- */
  IELTS.levenshtein = function (a, b) {
    a = IELTS.normalise(a);
    b = IELTS.normalise(b);
    if (a === b) return 0;
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = cur;
    }
    return prev[b.length];
  };

  /* ---- question type labels ---------------------------------------------- */
  IELTS.TYPE_LABEL = {
    tfng: 'True / False / Not Given',
    ynng: 'Yes / No / Not Given',
    multiple_choice: 'Multiple choice',
    matching_headings: 'Matching headings',
    matching_features: 'Matching features',
    matching_sentence_endings: 'Sentence endings',
    matching_information: 'Matching information',
    sentence_completion: 'Sentence completion',
    summary_completion: 'Summary completion',
    summary_completion_box: 'Summary (word list)',
    table_completion: 'Table / note completion',
    short_answer: 'Short answer',
    diagram_labelling: 'Diagram labelling',
  };

  IELTS.SKILL_LABEL = {
    detail: 'Reading for detail',
    scanning: 'Scanning for specifics',
    paraphrase: 'Spotting paraphrase',
    gist: 'Main idea of a section',
    opinion: "The writer's view",
    not_given: 'What is NOT stated',
  };

  IELTS.typeLabel = (t) => IELTS.TYPE_LABEL[t] || t;
  IELTS.skillLabel = (s) => IELTS.SKILL_LABEL[s] || s;

  /* ---- formatting -------------------------------------------------------- */
  IELTS.mmss = function (totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  IELTS.humanTime = function (totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    if (m < 1) return s + 's';
    return m + ' min' + (s % 60 ? ' ' + (s % 60) + 's' : '');
  };

  IELTS.escape = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  };

  IELTS.fmtDate = function (iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
})(window);
