/* =============================================================================
   analysis.js - turns a marked paper into a diagnosis.

   Everything here is derived from the stored response rows, so the same code
   explains one attempt on the student's results page and a whole class on the
   teacher dashboard.
   ============================================================================= */
(function (w) {
  'use strict';
  const IELTS = (w.IELTS = w.IELTS || {});

  const COMPLETION = [
    'sentence_completion', 'summary_completion', 'table_completion',
    'short_answer', 'diagram_labelling',
  ];
  const JUDGEMENT = ['tfng', 'ynng'];
  const NEGATIVE = ['false', 'no'];

  const pct = (c, t) => (t ? Math.round((100 * c) / t) : 0);

  /* ---- breakdowns --------------------------------------------------------- */
  function breakdown(rows, keyFn) {
    const m = new Map();
    rows.forEach((r) => {
      const k = keyFn(r);
      if (k == null) return;
      if (!m.has(k)) m.set(k, { key: k, correct: 0, total: 0, seconds: 0, blanks: 0 });
      const o = m.get(k);
      o.total++;
      o.seconds += Number(r.seconds) || 0;
      if (r.is_correct) o.correct++;
      if (!r.answer) o.blanks++;
    });
    return [...m.values()].map((o) => ({
      ...o,
      pct: pct(o.correct, o.total),
      avgSeconds: o.total ? o.seconds / o.total : 0,
    }));
  }

  IELTS.breakdowns = function (rows) {
    return {
      passages: breakdown(rows, (r) => Number(r.passage)).sort((a, b) => a.key - b.key),
      types: breakdown(rows, (r) => r.q_type).sort((a, b) => a.pct - b.pct || b.total - a.total),
      skills: breakdown(rows, (r) => r.skill).sort((a, b) => a.pct - b.pct || b.total - a.total),
    };
  };

  /* ---- individual detectors ---------------------------------------------- */
  const F = (level, title, detail, action, tag) => ({ level, title, detail, action, tag });

  function detectFindings(rows, attempt, opts) {
    opts = opts || {};
    const many = !!opts.aggregate;       // looking across several papers
    const out = [];
    const wrong = rows.filter((r) => !r.is_correct);
    const b = IELTS.breakdowns(rows);
    const nAttempts = opts.attemptCount || 1;

    /* --- timing ---------------------------------------------------------- */
    if (attempt && attempt.ran_out_of_time) {
      out.push(F('high', 'Ran out of time',
        'The clock reached zero before the paper was finished. In the real test everything left blank at that point scores nothing.',
        'Set a hard limit of 20 minutes per passage and move on when it is up, even mid-question. Answer every remaining question with a guess in the last two minutes.',
        'timing'));
    }

    const p = b.passages;
    const p3 = p.find((x) => x.key === 3);
    const p1 = p.find((x) => x.key === 1);
    if (p1 && p3 && p1.total && p3.total) {
      if (p1.pct - p3.pct >= 25 && p3.seconds < p1.seconds) {
        out.push(F('high', 'Passage 3 is being squeezed',
          `Accuracy falls from ${p1.pct}% on Passage 1 to ${p3.pct}% on Passage 3, and less time was spent there (${IELTS.humanTime(p3.seconds)} against ${IELTS.humanTime(p1.seconds)}). That is a pacing problem, not a comprehension problem.`,
          'Passage 3 carries the same marks as Passage 1 but is harder. Budget 17 / 20 / 23 minutes across the three passages instead of an equal split.',
          'timing'));
      }
    }
    p.forEach((x) => {
      if (x.seconds > 1500 && x.key !== 3) {
        out.push(F('medium', `Too long on Passage ${x.key}`,
          `${IELTS.humanTime(x.seconds)} spent on Passage ${x.key}. Anything over 20 minutes is borrowed from a later passage.`,
          'Practise a single passage against a 20-minute timer until it feels routine.',
          'timing'));
      }
    });

    /* --- blanks ----------------------------------------------------------- */
    const blanks = rows.filter((r) => !r.answer).length;
    if (blanks > 0) {
      out.push(F(blanks >= 4 ? 'high' : 'medium', `${blanks} question${blanks > 1 ? 's' : ''} left blank`,
        'A blank scores zero. A guess costs nothing and there is no penalty for being wrong.',
        'Never hand in a blank. On True/False/Not Given a guess is right about a third of the time; on multiple choice, one in four.',
        'blanks'));
    }

    /* --- NOT GIVEN handling ------------------------------------------------ */
    const judg = rows.filter((r) => JUDGEMENT.includes(r.q_type));
    if (judg.length >= 4) {
      const overInfer = judg.filter(
        (r) => !r.is_correct && /not given/i.test(r.correct_answer || '') &&
          NEGATIVE.includes(String(r.answer || '').toLowerCase())
      ).length;
      const underInfer = judg.filter(
        (r) => !r.is_correct && NEGATIVE.includes(String(r.correct_answer || '').toLowerCase()) &&
          /not given/i.test(String(r.answer || ''))
      ).length;

      if (overInfer >= 2) {
        out.push(F('high', 'Reading in contradictions that are not there',
          `${overInfer} time${overInfer > 1 ? 's' : ''} the answer was NOT GIVEN but FALSE/NO was chosen. This is the single most common way to lose marks on this question type.`,
          'FALSE needs the passage to say the opposite. If the passage is merely silent, or says something related but not contradictory, the answer is NOT GIVEN. Ask: can I point at the words that contradict this? If not, it is NOT GIVEN.',
          'ng'));
      }
      if (underInfer >= 2) {
        out.push(F('high', 'Missing contradictions',
          `${underInfer} time${underInfer > 1 ? 's' : ''} the passage did contradict the statement, but NOT GIVEN was chosen - probably because the wording was different.`,
          'The contradiction is almost never in the same words as the question. Look for opposites of meaning: "declined" against "grew", "few" against "most", "never" against "occasionally".',
          'ng'));
      }
    }

    /* --- spelling and word form -------------------------------------------- */
    const nearMiss = wrong.filter((r) => {
      if (!COMPLETION.includes(r.q_type) || !r.answer || !r.correct_answer) return false;
      return r.correct_answer.split(' / ').some((a) => {
        const d = IELTS.levenshtein(r.answer, a);
        return d > 0 && d <= 2;
      });
    });
    if (nearMiss.length >= 2) {
      out.push(F('high', 'Marks lost on spelling, not on understanding',
        `${nearMiss.length} answers were within a letter or two of the correct word (${nearMiss.map((r) => `Q${r.q}: "${r.answer}" for "${r.correct_answer}"`).slice(0, 4).join('; ')}). The comprehension was right; the transcription was not.`,
        'Copy completion answers letter by letter from the passage, then read them back against the text before moving on. Singular and plural must match too.',
        'spelling'));
    }

    /* --- word limit --------------------------------------------------------- */
    const over = rows.filter((r) => r.over_limit);
    if (over.length) {
      out.push(F('high', `${over.length} answer${over.length > 1 ? 's' : ''} broke the word limit`,
        `Q${over.map((r) => r.q).join(', Q')} exceeded the number of words the instruction allowed, so ${over.length > 1 ? 'they were' : 'it was'} marked wrong even where the meaning was right.`,
        'Read the instruction line before every completion task and count the words in the answer. "NO MORE THAN TWO WORDS" means two, including small ones like "a" and "the".',
        'limit'));
    }

    /* --- second guessing ---------------------------------------------------- */
    const talkedOut = rows.filter((r) => r.first_was_correct && !r.is_correct);
    if (talkedOut.length >= 2) {
      out.push(F('medium', 'Changing right answers to wrong ones',
        `On Q${talkedOut.map((r) => r.q).join(', Q')} the first answer was correct and was then changed.`,
        'Only change an answer when you can point to the line in the passage that makes the new one right. A vague feeling that it "looks wrong" is not evidence.',
        'confidence'));
    }

    /* --- rushing ------------------------------------------------------------ */
    const timed = rows.filter((r) => Number(r.seconds) > 0);
    if (timed.length >= 20) {
      const avgW = timed.filter((r) => !r.is_correct).reduce((s, r) => s + Number(r.seconds), 0) /
        Math.max(1, timed.filter((r) => !r.is_correct).length);
      const avgR = timed.filter((r) => r.is_correct).reduce((s, r) => s + Number(r.seconds), 0) /
        Math.max(1, timed.filter((r) => r.is_correct).length);
      if (avgR > 0 && avgW < avgR * 0.6 && wrong.length >= 5) {
        out.push(F('medium', 'Wrong answers are the fast ones',
          `Average ${Math.round(avgW)}s on questions that were wrong against ${Math.round(avgR)}s on questions that were right. The mistakes are being made quickly, which usually means an answer was chosen on a matching keyword rather than on the meaning of the sentence.`,
          'When an answer feels instant, spend five more seconds checking the whole sentence around the keyword. Test writers put the trap exactly where the obvious word appears.',
          'rushing'));
      }
    }

    /* --- weakest question type ---------------------------------------------- */
    const scoreable = b.types.filter((t) => t.total >= (many ? 6 : 3));
    if (scoreable.length) {
      const worst = scoreable[0];
      if (worst.pct <= 60) {
        out.push(F(worst.pct <= 40 ? 'high' : 'medium',
          `Weakest question type: ${IELTS.typeLabel(worst.key)}`,
          `${worst.correct} out of ${worst.total} correct (${worst.pct}%)` +
          (many && nAttempts > 1 ? ` across ${nAttempts} papers` : '') +
          `, against ${pct(rows.filter((r) => r.is_correct).length, rows.length)}% overall.`,
          TYPE_ADVICE[worst.key] || 'Drill this question type on its own before sitting another full paper.',
          'type:' + worst.key));
      }
      const best = scoreable[scoreable.length - 1];
      if (best.pct >= 85 && best.key !== worst.key) {
        out.push(F('good', `Strongest question type: ${IELTS.typeLabel(best.key)}`,
          `${best.correct} out of ${best.total} correct (${best.pct}%).`,
          'Keep this one ticking over, but spend practice time on the weaker types.',
          'strength'));
      }
    }

    const order = { high: 0, medium: 1, good: 3, info: 2 };
    return out.sort((a, b2) => order[a.level] - order[b2.level]);
  }

  const TYPE_ADVICE = {
    tfng: 'Work through TRUE/FALSE/NOT GIVEN sets in isolation, saying out loud for each one which words in the passage decide it. If you cannot find the words, the answer is NOT GIVEN.',
    ynng: 'These follow the writer\'s opinion, not the facts. Underline the verbs that carry attitude - "claims", "argues", "concedes", "dismisses" - and decide what the writer would sign their name to.',
    matching_headings: 'Read only the first and last sentence of the paragraph, then decide. Headings describe the paragraph as a whole, so any heading matching one interesting detail is usually the trap.',
    matching_features: 'Underline every name in the passage first, then work through the statements. Answers do not come in passage order for this type, so a name-by-name sweep is faster.',
    matching_sentence_endings: 'Match on grammar first - most endings can be eliminated because the sentence would not read properly - then on meaning.',
    multiple_choice: 'Read all four options before returning to the passage. Wrong options are usually true statements that do not answer the question asked, or right ideas with one word changed.',
    sentence_completion: 'The answer must fit grammatically as well as factually. Predict the part of speech needed before you look for it.',
    summary_completion: 'Read the whole summary first to get the direction of the argument, then locate the section of the passage it paraphrases. Summaries usually cover only part of the text.',
    summary_completion_box: 'With a word list, eliminate by grammar first, and expect two or three deliberately plausible distractors.',
    table_completion: 'Answers follow the order of the passage. Find the first one, then read forwards - do not scan the whole text again for each gap.',
    short_answer: 'Answer in the exact words of the passage and respect the word limit.',
  };

  IELTS.analyse = function (result, opts) {
    const rows = result.responses || [];
    const attempt = result.attempt || {};
    const b = IELTS.breakdowns(rows);
    const raw = rows.filter((r) => r.is_correct).length;
    const gap = IELTS.nextBandGap(raw);
    return {
      raw,
      total: rows.length,
      band: attempt.band != null ? Number(attempt.band) : IELTS.bandFor(raw),
      pct: pct(raw, rows.length),
      nextBand: gap,
      passages: b.passages,
      types: b.types,
      skills: b.skills,
      findings: detectFindings(rows, attempt, opts),
    };
  };

  IELTS.analyseRows = function (rows, opts) {
    const b = IELTS.breakdowns(rows);
    return {
      raw: rows.filter((r) => r.is_correct).length,
      total: rows.length,
      pct: pct(rows.filter((r) => r.is_correct).length, rows.length),
      passages: b.passages,
      types: b.types,
      skills: b.skills,
      findings: detectFindings(rows, null, Object.assign({ aggregate: true }, opts || {})),
    };
  };

  IELTS.typeAdvice = (t) => TYPE_ADVICE[t] || '';
})(window);
