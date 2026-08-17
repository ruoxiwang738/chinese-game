# Language by Yok — IELTS Academic Reading platform

A realistic, strictly timed IELTS Academic Reading mock test that marks itself,
estimates a band score, stores every attempt in a database, and tells the
teacher what each student is actually getting wrong.

Static site (GitHub Pages) + Supabase (Postgres) for storage and marking.
No build step, no framework, no server to maintain.

**→ Start with [SETUP.md](SETUP.md).**

---

## What it does

**For the student**

- Three passages, 40 questions, 60 minutes, in the split-screen layout of the
  computer-delivered test.
- The clock runs on the server. Refreshing, closing the tab or switching
  computers does not add a second. At zero the paper submits itself.
- Text highlighting, flag-for-review, and a question palette, as in the real thing.
- Marked instantly: band estimate, per-passage and per-question-type accuracy,
  and for every question — what they wrote, what was right, where the answer is
  in the passage, and why.

**For the teacher**

- Every attempt, every answer, permanently stored and reachable from any device.
- Per student: band over time, accuracy by question type and by underlying
  skill, and an automatic diagnosis.
- Class-wide: which question types the group fails most, and the individual
  questions most people get wrong.
- CSV export.

**The diagnosis is the interesting part.** Rather than only counting marks, it
looks for the specific mistakes IELTS candidates make:

| Pattern | What it catches |
|---|---|
| NOT GIVEN confusion | Choosing FALSE when the passage is merely silent, or NOT GIVEN when it does contradict |
| Spelling near misses | `circels` for `circles` — comprehension was fine, the mark was lost in transcription |
| Word-limit breaches | Three words where the rubric allowed two |
| Second-guessing | Answers that were right and got changed to wrong |
| Passage 3 squeeze | Accuracy collapsing on the last passage because the time went on the first |
| Rushing | Wrong answers taking far less time than right ones — keyword matching instead of reading |
| Blanks | Questions left empty when a guess is free |

---

## Layout

```
index.html            Student sign-in, test list, past results
test.html             The exam
review.html           Marked paper and diagnosis
dashboard.html        Teacher (password-protected)

assets/js/config.js   ← the only file you need to edit
assets/js/core.js     Band table, answer marking, formatting
assets/js/api.js      Supabase calls, with an offline practice mode
assets/js/analysis.js The diagnosis engine
assets/js/exam.js     Timer, rendering, tracking
assets/js/report.js   Shared charts and question review
assets/js/dashboard.js

content/*.json        Source for the papers, WITH answers (authoring only)
tests/*.json          The papers as published — no answers in them
private/              Answer keys + the SQL that loads them. NEVER upload.
db/schema.sql         Tables, security rules, marking function
tools/build.js        Turns content/ into tests/ + private/
```

## How the answers stay secret

The published site contains no answer key. When a paper is submitted, the
browser sends the answers to a Postgres function which marks them against a key
held in a table that no website visitor can read — not even a signed-in teacher
through the API. Only then does it return the correct answers, so the student
can review them.

Students reach their own results with their access code and nothing else.
Everything on the teacher side requires a real login.

## Tests

```
node tools/test-analysis.js      # marking maths + diagnosis engine (45 checks)
node tools/e2e.js                # drives a full paper in a real browser
node tools/dashboard-preview.js  # renders the dashboard against fixture data
```

The last two need the site running locally: `python3 -m http.server 8811`.

## Notes

The reading passages are original, written for this site. Band estimates use the
raw-score conversion published in the Cambridge IELTS practice test books; every
real test is equated slightly differently, so treat the figure as a good
estimate rather than a promise.
