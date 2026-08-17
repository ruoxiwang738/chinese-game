# Setting this up on languagebyyok.com

Four parts, about 40 minutes the first time. Nothing costs money.

- **Part 1** – the database (Supabase). ~15 min
- **Part 2** – putting the site on GitHub. ~10 min
- **Part 3** – pointing your domain at it. ~10 min plus waiting for DNS
- **Part 4** – giving students their codes. ~2 min

You can preview the site before any of this: see *Trying it out first* at the bottom.

---

## Before you start: two folders, and only one of them goes online

| Folder | What it is | Goes on GitHub? |
|---|---|---|
| `private/` | the answer keys and the SQL that loads them | **NO — never** |
| `content/` | the papers as you author them, answers included | **NO — never** |
| `tools/` | the build script and tests | not needed |
| everything else | the website | **yes** |

`private/` and `content/` both hold every correct answer. If either goes into a
public GitHub repo, a student can read the answers before sitting the test.

**The easiest way to get this right: upload the contents of
`languagebyyok-UPLOAD-TO-GITHUB.zip`, which contains only the safe files.**
Keep the full project zip on your own computer for authoring and for the
answer keys.

The website itself contains no answers at all. Marking happens inside the
database, so the browser never receives the answer key until after a paper is
submitted.

---

## Part 1 — The database

### 1.1 Create the project

1. Go to **supabase.com** and sign up (the free tier is far more than you need).
2. **New project**. Name it something like `languagebyyok`.
3. Choose a database password and save it somewhere — you will not need it for
   this site, but you will be sad later if you lose it.
4. Pick the region closest to your students.
5. Wait about two minutes while it builds.

### 1.2 Create the tables

1. In the left sidebar: **SQL Editor** → **New query**.
2. Open `db/schema.sql` from this folder in any text editor, select all, copy.
3. Paste into the Supabase query box and press **Run**.
4. You should see *Success. No rows returned*. That is correct.

### 1.3 Load the answer key

1. **SQL Editor** → **New query** again.
2. Open `private/seed-test-01.sql`, copy all of it, paste, **Run**.

That file is the only place the answers exist online, and it sits in a table no
website visitor can read.

### 1.4 Make your teacher account

1. Sidebar → **Authentication** → **Users** → **Add user** → *Create new user*.
2. Use your own email and a strong password. Tick *auto-confirm* if offered.
3. Sidebar → **Authentication** → **Sign In / Providers** → find **Allow new users
   to sign up** and turn it **OFF**.

That last step matters. With sign-ups off, yours is the only account that can
ever exist, so nobody else can reach the dashboard.

### 1.5 Copy your two keys into the site

1. Sidebar → **Settings** → **Data API** → copy the **Project URL**.
2. Sidebar → **Settings** → **API Keys** → copy the **publishable** key
   (it starts `sb_publishable_`). On an older project this is labelled
   **anon public** instead — either one works.
3. Open `assets/js/config.js` in a text editor and paste them in:

```js
window.IELTS_CONFIG = {
  SUPABASE_URL: 'https://YOURPROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
```

> **Never** paste the key labelled *secret* or *service_role*. That one ignores
> every security rule. The publishable key is meant to be public — the security
> comes from the rules in `schema.sql`, not from hiding it.

---

## Part 2 — Put the site on GitHub

1. On **github.com**, click **+** → **New repository**.
2. Name: `languagebyyok` (anything is fine). Set it to **Public** — GitHub Pages
   needs a public repo on a free account. This is safe: the site contains no
   answers.
3. Click **uploading an existing file**.
4. Unzip `languagebyyok-UPLOAD-TO-GITHUB.zip` and drag in everything inside it:

   ```
   index.html   test.html   review.html   dashboard.html   404.html
   CNAME        robots.txt  README.md     SETUP.md         .gitignore
   assets/      tests/      db/schema.sql
   ```

   That zip deliberately leaves out `private/`, `content/` and `tools/`, so
   there is no way to upload an answer by accident.
5. **Commit changes.**
6. Repository → **Settings** → **Pages**.
   Source: *Deploy from a branch*. Branch: `main`, folder: `/ (root)`. **Save.**
7. Wait 1–2 minutes, then visit `https://YOURNAME.github.io/languagebyyok/`.
   The site should load. Try a test — the front page should **not** show the
   orange "practice mode" banner. If it does, `config.js` did not save properly.

---

## Part 3 — Point languagebyyok.com at it

### 3.1 At your domain registrar

Wherever you bought the domain (GoDaddy, Namecheap, Cloudflare…), open the DNS
settings and add these records:

| Type | Name | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `YOURNAME.github.io` |

Replace `YOURNAME` with your GitHub username. Keep the trailing dot if your
registrar adds one. Delete any existing A record for `@` that points somewhere
else.

### 3.2 At GitHub

1. Repository → **Settings** → **Pages** → **Custom domain**.
2. Type `languagebyyok.com` and **Save**.
3. Wait for the DNS check to go green — usually minutes, occasionally a few hours.
4. Tick **Enforce HTTPS** once it becomes available.

The `CNAME` file in this folder already contains `languagebyyok.com`, so step 2
may already be done for you.

---

## Part 4 — Give your students their codes

There is nothing to set up. Invent a code per student and tell them:

> Go to **languagebyyok.com**, enter code **YOK-MINA** and your name.

The first time a code is used, that student is created automatically. From then
on the same code always finds the same person, on any device, in any country.
Use codes that are easy to type and hard to guess for someone else —
`YOK-MINA`, `YOK-2026-A`, and so on.

Codes are not passwords. Anyone who knows a code can see that student's results,
so don't post them publicly.

---

## Using the dashboard

Go to **languagebyyok.com/dashboard.html** and sign in with the email and
password from step 1.4.

- **Class overview** – average band, which question types the whole group fails
  most, and the individual questions most people get wrong. This is the page to
  look at before planning a lesson.
- **Students** – every student, their latest and best band, and whether they are
  improving. Click anyone for their full history, their accuracy by question
  type, and an automatic diagnosis. There is a CSV export here for your records.
- **All attempts** – every paper ever sat. Click one to see the whole thing
  question by question: what they answered, what was right, how long they spent
  on each item, and where they changed their mind.

---

## Adding another test later

1. Copy `content/p1.json` and write your own passage and questions in the same
   shape. Every question needs `accept` (the correct answer/s), `locate` (where
   it is in the passage) and `why` (the explanation students see).
2. Build it:

   ```
   node tools/build.js test-02 "Academic Reading Mock Test 2" content/p4.json content/p5.json content/p6.json
   ```

   The build refuses to run if an answer breaks its own word limit, if a
   question number is duplicated, or if an explanation is missing.

3. Upload the new `tests/test-02.json` and the updated `tests/manifest.json` to
   GitHub.
4. Run the new `private/seed-test-02.sql` in the Supabase SQL editor.

Your students will see the new paper in the dropdown immediately.

---

## Trying it out first

To look at the site before doing any of the above, open a terminal in this
folder and run:

```
python3 -m http.server 8000
```

then open `http://localhost:8000`. It will say *practice mode* — everything
works, but results are marked in the browser and stored only on that computer.
Opening `index.html` by double-clicking will **not** work; browsers block the
file loading a web page needs.

---

## If something goes wrong

**The orange "practice mode" banner won't go away.**
`config.js` is missing the URL or the key. Check for stray quotes and that you
saved the file before uploading it.

**"Unknown test: test-01" when a student presses Start.**
The answer key was never loaded. Run `private/seed-test-01.sql` in the SQL editor.

**The dashboard says "Invalid login credentials".**
The account was not created, or sign-ups were disabled before you created it.
Add the user again under Authentication → Users.

**The dashboard signs in but shows no papers.**
Nobody has finished a test yet, or `schema.sql` was only partly run. Re-run the
whole of `schema.sql`; it is safe to run twice.

**A student says the timer restarted when they refreshed.**
It cannot. The deadline lives in the database. Refreshing reopens the same paper
with the same finishing time — which is the point.

**A student lost their internet mid-test.**
Their answers are kept in their browser as they type. Reconnecting and pressing
*Finish test* again will submit. If the hour expired first, the paper is marked
with whatever they had.
