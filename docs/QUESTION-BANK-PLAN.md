# Question bank, rounds & upload reliability — plan

> Status: **Phase 1 built** (section 4), plus **uploads as named sets** in the bank (§4b). Phases 2–4 not built.
> Decisions in §7 were accepted as recommended. Covers three linked problems:
> 1. Exam questions and test questions end up mixed in one bank.
> 2. Assessment types (test / exam / mock / practice), "rounds" (1st CA, Exam…) and topics overlap and confuse people.
> 3. Some uploaded questions go missing with no explanation, and there is no record of why anything fails.

---

## 1. What's going on today

### 1.1 Why questions get mixed up

A question only knows its **subject**, an optional **year** and an optional **topic**
(`supabase/migrations/20261001000100_schema.sql`, table `questions`). It has no idea which term or which
round (1st CA, 2nd CA, Exam…) it was written for. Every upload goes into one pile per subject, so the test
builder shows a teacher's exam questions next to their 1st CA questions.

There are also **three overlapping ways** to say what kind of assessment something is:

| Concept | Where | Values |
|---|---|---|
| `assessments.type` (enum) | base schema + `mock_test` migration | test, exam, mock_test, mock, practice |
| `assessments.sequence_label` (free text, picked from `ca_round_configs`) | `20261010…`, `20261011…` | 1st CA, 2nd CA, 3rd CA, Mid-Term, Exam |
| `assessments.topic` | `20261008…` | free text |

"Exam" can be a type *and* a round label, so a "test" can carry the label "Exam" and the reverse. None of
these are carried onto the questions.

### 1.2 Why questions disappear on upload (confirmed)

I reproduced these with the real parser code:

| # | Cause | Where | What the teacher sees |
|---|---|---|---|
| D1 | **Duplicate check is far too loose.** It strips everything except `a–z` and `0–9`, so `What is 5 + 3?` and `What is 5 × 3?` both become `what is 5 3` and the second is thrown away. Same for `2x + 3x` vs `2x − 3x`, and any question that differs only in its options ("Which of the following is a noun?"). | `dedupeKey` in `src/lib/import/questions.ts:482` | "N duplicates skipped" — if they notice it at all |
| D2 | **Duplicate check covers the whole subject**: every teacher, every year group, every term. Another teacher's question, or your own Year 7 question, blocks your Year 9 one. The teacher can't find the "duplicate" because the bank page only shows their own questions for that year. | `commitImport`, `src/app/(staff)/teach/actions.ts:278-285` | A count they can't verify |
| D3 | **Duplicates are not added to the test.** When uploading into a test, a question that matches one already in the bank is skipped and **not linked**, so the test ends up short. | `actions.ts:288-316` | Test has fewer questions than the file |
| D4 | **The skipped count is thrown away.** After a successful import with no unreadable rows, the page jumps straight to the test; the "3 duplicates skipped" message is never seen. | `import-wizard.tsx:255-266` | Nothing at all — this is the "no reason" drop |
| D5 | **Word/text: two questions silently merge into one.** If the answer line is written `Ans B` / `Answer B` (no colon) or is missing, and there is no blank line before the next question, the whole next question is glued onto option D of the previous one. Zero errors are reported, and the merged question gets the *second* question's answer key. | `META_LINE` and option-wrap logic, `questions.ts:238`, `:279` | One question vanishes; the other has a wrong answer key |
| D6 | **Half-saved uploads.** The questions are inserted, then linked to the test in a second step. If linking fails, the questions stay in the bank but not in the test; re-uploading then treats them all as duplicates (D2 + D3) and says "nothing new to add". | `actions.ts:288-316` | Upload "works" but the test stays empty |
| D7 | Excel cells containing a **formula** come through as `[object Object]`. | `text()` in `questions.ts` | Garbled question |
| D8 | An **image column with a file name** (e.g. `diagram1.png`) rejects the whole question as "Invalid URL". | `parsedQuestionSchema`, `questions.ts:43` | Question left out |
| D9 | Excel: only the **first sheet** with a "question" heading is read; other sheets are silently ignored. | `src/lib/import/xlsx.ts:20` | Whole sheets missing |
| D10 | Word: **equations** (Equation editor) and inserted symbols aren't extracted, so options can come out empty and merge (→ D5). | `src/lib/import/docx.ts` | Maths/science questions mangled |
| D11 | Bank page shows only the **newest 300**; the test builder only the newest 500. Older questions look "gone". | `questions/page.tsx:77`, `assessments/[id]/page.tsx` | "My questions disappeared" |
| D12 | Changing the subject in the upload form keeps the old year group, which can belong to another section, so the questions are saved where no bank view will ever show them. | `import-wizard.tsx:283` | Uploaded but invisible |

D1–D5 are almost certainly what teachers are hitting.

### 1.3 Why we can't tell what broke

- Parse problems are plain English strings, grouped in the UI by matching words in the message (`groupIssues`) — fragile and untraceable.
- Server errors pass the raw database message to the user (`src/lib/actions.ts:17`), and nothing is recorded.
- There is no record of an upload: what file, how many questions were in it, how many were saved, skipped or rejected and why.

---

## 2. The model we should move to

### 2.1 One organising idea: the **Round**

Teachers already think this way: *"I'm uploading my 2nd CA questions for Year 9 Maths."* Make **Round**
the one thing that organises both questions and assessments, and fold the other two concepts into it.

- **Round** (grows out of today's `ca_round_configs`): `label` (1st CA, 2nd CA, Mid-Term, Exam, Exam mock…),
  `kind` (`test` or `exam` — drives default question count, time and strictness), `counts_to_result`
  (false for mocks/practice), `sort_order`, `active`.
- **Paper** (today's `assessments` row) = Subject × Year group × **Term** × **Round** (+ the classes it is for).
  `type` is no longer chosen by hand; it is derived from the round. `sequence_label` is replaced by `round_id`.
- **Question** gets `term_id` and `round_id` — its *home*: where it was uploaded. `topic` stays as a
  tag *inside* a round (e.g. "Fractions"), never as a substitute for it.

```
Term 1 2026/27
 └─ Year 9 · Mathematics
     ├─ 1st CA   (paper: 20 Q, 30 min)   ← questions uploaded here live here
     ├─ 2nd CA   (paper: 20 Q, 30 min)
     ├─ Mid-Term
     └─ Exam     (paper: 40 Q, 60 min)
```

What this removes: the type picker (Test / Exam / Test mock / Exam mock), the free-text round label, and
the "Live vs Mock" grouping on the create screen. The teacher picks **one** thing: the round.

### 2.2 Reuse across rounds

A question has a home round but can still be **picked into any paper** of the same subject and year. The
picker defaults to "this round only" and has a filter for other rounds/terms ("reuse from 1st CA",
"from last term"). So nothing is mixed by default, and reuse is a deliberate choice.

### 2.3 Existing data

A one-time migration:

1. Turn existing `ca_round_configs` rows into rounds; add `kind` (Exam → `exam`, others → `test`) and add
   "Exam mock" / "Test mock" rounds with `counts_to_result = false`.
2. Papers: `sequence_label` → `round_id` by label. Papers with no label take a round from their `type`
   (exam → Exam, mock → Exam mock, …). Anything ambiguous goes to a review list for the admin.
3. Questions: if a question is used in exactly one paper, it inherits that paper's term and round. Otherwise
   it goes into an **"Unsorted"** bucket that the teacher can sort with a bulk "Move to round" action.
4. Keep `type` and `sequence_label` columns for one release (read-only, filled from the round) so reports
   and old links keep working; drop them afterwards.

---

## 3. The workflow (teacher)

One path, always the same:

1. **Dashboard → "This term's papers"**: a grid of *Year · Subject* rows × *Round* columns. Each cell shows
   its state: *Not started · 12 of 20 · Submitted · Approved · Scheduled · Live*. (Builds on the existing
   upload checklist and batch-create.)
2. **Click a cell → the paper page.** If the admin hasn't created the paper yet, it is created on the
   first click with the round's defaults.
3. **Add questions on the paper page** — Upload, Write one, or Pick from bank. Every question added here is
   saved with that subject, year, term and round and is linked to the paper in the same step.
4. **Submit for approval** — unchanged.

Uploading from the question bank page (not from a paper) is still allowed, but **round is required** there,
defaulting to the round of the paper the teacher last worked on.

**Question bank page:** Subject · Year in the sidebar (as now), then round tabs for the current term
(*1st CA · 2nd CA · Mid-Term · Exam · Unsorted*), a term switcher, search, topic filter, pagination
(no 300 cap), and bulk "Move to round".

**Admin:** sets up rounds (existing `/admin/rounds`, extended with kind / counts-to-result), batch-creates
papers for a round across classes (existing batch create, but picking a round instead of a type), and sees
the same grid school-wide to chase missing papers.

---

## 4. Fixing the dropped questions

These don't depend on the restructure and should ship first.

| Fix | Solves |
|---|---|
| New duplicate rule: compare **question text + options**, normalised in a Unicode-aware way (keep letters in any language, digits **and** maths symbols `+ − × ÷ = < > ^ √ π %` etc.; ignore only case, spacing and punctuation like `. , ? !`). | D1 |
| Only compare against **the same teacher's questions for the same subject and year** (and, after phase 3, the same round). | D2 |
| When a duplicate is found while uploading into a paper, **link the existing question** to the paper instead of skipping it. | D3 |
| Check for duplicates **in the preview, before importing** (server call), mark each one ("already in your bank — Year 9 · 1st CA, added 12 Oct"), and let the teacher choose *Use existing* (default) or *Import as a new copy*. | D3, D4 |
| Always end with an **upload summary** that adds up: *Found in file 42 = 38 imported + 2 already in bank (added to this test) + 1 removed by you + 1 couldn't be read.* Never navigate away without showing it. | D4 |
| Text/Word parser: accept `Ans B`, `Answer B`, `Ans. (B)`, `Correct: B`, `Answer - B`; and **detect suspected merges** (an option that contains another numbered question or its own `A. … B. …` run, or an unusually long last option followed by option-like text) — report them as an error on that question, never pass them through. | D5 |
| Save questions and test links in **one database transaction** (a `import_questions` SQL function) — all or nothing. | D6 |
| Excel: use a formula cell's result; read every sheet that has question headings (and say which sheets were read). | D7, D9 |
| A non-URL image value becomes a **warning** ("image not imported — add it in the editor"), the question is kept. | D8 |
| Word: extract equation text and inserted symbols; warn when a question contained a picture that couldn't be imported. | D10 |
| Paginate the bank and the test picker. | D11 |
| Reset the year group when the subject changes; validate year/subject section on the server. | D12 |
| Raise the 500 limit (send in chunks) and give a clear message if a file is too big. | — |

Each fix gets a unit test built from a real problem file (with personal data removed). I'd like **2–3
files teachers say lost questions** — that's the fastest way to confirm we've covered their actual cases.

### 4b. Uploads as named sets (built)

Every upload is saved as a named set (`question_uploads`), e.g. "1st CA — Year 9 Maths":

- **Bank:** tabs per upload, with "Added earlier" for older questions. Each upload can be renamed, deleted (questions in a live or upcoming exam are kept), or used to make a test. It also shows what couldn't be read and why.
- **Test builder:** "From upload" filter, plus "Add all N from ‘upload’".
- **Single questions:** Edit and Delete on every row.

This is also the upload receipt from §5.2: counts plus coded reasons are stored on each upload.

---

## 5. Error messages and being able to see why things break

### 5.1 Coded problems instead of loose sentences

Every parse/import problem gets a **code**, the **place** (row 12 / question 3, line 40), a short
**excerpt** of the text, and a **how to fix** message chosen by code:

`EMPTY_QUESTION`, `NO_ANSWER`, `ANSWER_NOT_AN_OPTION`, `OPTION_GAP`, `TOO_FEW_OPTIONS`, `TOO_MANY_OPTIONS`,
`SUSPECTED_MERGE`, `IMAGE_NOT_IMPORTED`, `EQUATION_NOT_READ`, `DUPLICATE_IN_FILE`, `DUPLICATE_IN_BANK`,
`TOO_LONG`, `SHEET_SKIPPED`, `FILE_UNREADABLE`, `SAVE_FAILED`.

Severity: **error** (question left out), **warning** (imported, but check it), **info** (we tidied something).
The UI groups by code (replacing today's word-matching), so the grouping can't silently break when a message
is reworded.

### 5.2 Upload history (the receipt)

New table `question_imports`: who, when, subject, year, term, round, paper, file name, format,
the counts from the summary above, and the full list of coded problems. Teachers see their own history
("Uploads" tab on the bank page); admins see everyone's in their section. When a teacher says "it dropped
my questions", we open their upload and see exactly which ones and why.

### 5.3 Server errors

- Every unexpected server error is written to an `app_errors` table with a short **reference code**,
  the action, the user, and the raw database message.
- The teacher sees a plain message plus the reference: *"Couldn't save your questions. Nothing was saved —
  please try again. (Ref K7Q2M)"*. Raw database text is never shown to teachers.
- Known database constraint failures get their own friendly messages instead of the generic one.
- A small **Admin → Problems** page lists recent errors and failed/partial uploads, filterable by section.

---

## 6. Order of work

| Phase | What | Schema change? | Risk |
|---|---|---|---|
| **1. Stop the drops** | Section 4 (all fixes) + honest upload summary + tests from real files | One SQL function (transactional import) | Low — improves existing flow, no data moved |
| **2. See what breaks** | Section 5: issue codes, `question_imports`, `app_errors`, ref codes, Admin → Problems | 2 new tables | Low |
| **3. Rounds** | Section 2: round table + `round_id`/`term_id` on papers and questions, backfill, "Unsorted" bucket, bulk move | Yes — migration + backfill | Medium — run on a copy of live data first |
| **4. One workflow** | Section 3: term grid, paper page as the upload hub, round-required upload, bank round tabs, round-based batch create | No | Medium — UI changes teachers will notice; brief staff notice |

Phases 1–2 can go out while you confirm the decisions below. Phase 3 should be done **between rounds**
(not while papers for the current round are being uploaded or are live).

---

## 7. Decisions needed from you / the school

1. **Reuse between rounds** — may exam papers reuse CA questions? *Recommendation:* allowed, but only by
   deliberately picking them (section 2.2). If the school forbids it, we hide other rounds in the picker.
2. **Same rounds for Elementary and College?** *Recommendation:* one school-wide list, with each round
   optionally limited to certain sections.
3. **One paper per subject × year × round, or one per teacher** (when different teachers take different
   arms of the same year)? *Recommendation:* one per subject × year × round by default; allow a second
   only for a different set of arms.
4. **Mocks and practice** — keep them as rounds that don't count towards results? *Recommendation:* yes.
5. **Duplicates across teachers** — should the system warn a teacher that a colleague already has the
   same question? *Recommendation:* no blocking; at most an info note.
