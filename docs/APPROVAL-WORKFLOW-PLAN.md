# Approval workflow — plan to simplify

> Status: **§5 step 1 (quick wins) built**, plus approve-with-note and auto-start by default. Decisions (§6):
> exams start automatically at the set time, and an admin can start earlier or later; one person lets a student
> continue; Heads of Section set who teaches what; topic is optional.
> Still to build: §5 steps 2–4 (round calendar that schedules on approval, HOD-set teaching assignments, unified inbox).

## 1. What a single test goes through today

Counting every hand-off for **one** teacher's **one** test, from the code as it is now:

| # | Step | Who | Notes |
|---|---|---|---|
| 1 | Ask to teach a subject + class | Teacher | `teaching_assignments.status = requested` |
| 2 | Approve that request | Head of Section | `decide_assignment` — one per subject × class, every session |
| 3 | Create the test: type, round label, title, classes, question count, time | Teacher | Type and round overlap (see question-bank plan) |
| 4 | Add questions (upload / write / pick) | Teacher | |
| 5 | Fill in a **topic** — required before submitting | Teacher | Blocks submission; adds no safety |
| 6 | Submit for approval | Teacher | |
| 7 | Review: approve / flag / send back | HOD | `bulk_review` |
| 8 | (if sent back) fix, resubmit, review again | Teacher → HOD | |
| 9 | Schedule a window **per class** | HOD | `schedule_window` — separate from approval |
| 10 | Press **Start** on the day (unless auto-start was ticked) | Admin | |
| 11 | (if flagged after approval) Begin correction → edit → Send corrections → Accept | Teacher → HOD | 4 actions for one fix |
| 12 | (if a student ran out of time) Allocate extra time → Request resume → Approve resume | Admin → Admin | 3 actions, often the same person |

A normal test needs **at least 9 actions across 2–3 people**, before anyone sits it.

## 2. Principles

1. **The machine checks, people judge.** Anything a computer can verify (enough questions, every answer key valid, no duplicates, classes set) is checked automatically and never sent to a person.
2. **Decide once, apply many.** Things that are true for the whole term (who teaches what, when each round runs) are set once in bulk, not per test.
3. **One button per decision.** No "begin X" / "submit X" / "accept X" chains for one change.
4. **Two people only where it protects students.** The Head of Section approves what students will see. Everything else is one person.

## 3. Proposed workflow

### 3.1 Before the term (HOD, once)

- **Who teaches what.** The HOD sets subject × class × teacher for the session in one table, or imports it from the timetable spreadsheet. Teachers see their classes immediately.
  - *Removes steps 1–2.* A teacher may still ask for a change; the HOD gets it in the same inbox.
- **Round calendar.** For each round (1st CA, Mid-Term, Exam…) the HOD sets the dates per year group, and whether exams start automatically or need a Start press.
  - *Removes step 9 for normal tests.*

### 3.2 Teacher (per round)

1. Open **This term's papers** (grid of Year·Subject × Round). The paper already exists with the round's defaults.
   - *Removes step 3.*
2. Add questions.
3. Press **Send for review**. It's only enabled when the automatic checks pass; otherwise the button says exactly what's missing ("needs 4 more questions", "question 12 has no correct answer").
   - Topic becomes optional. *Removes step 5.*

### 3.3 Head of Section (per round)

- **One review queue**, grouped by round and year group (the current review board, with the automatic checks already done).
- Three choices per paper:
  - **Approve** — it is placed into its slot on the round calendar automatically. *Removes step 9.*
  - **Approve with a note** — approved, with a comment for the teacher (no rework needed).
  - **Needs changes** — returned with a note.
- Bulk approve stays.

### 3.4 Fixing an approved paper

Replaces step 11's four actions with two:

- HOD presses **Needs changes** on an approved paper.
- The teacher edits it directly (no "Begin correction" button) and presses **Send fix**.
- The approved version stays in use until the HOD accepts the fix, as now.
- If students have already started, the screen sends them to **Fix answer key** instead.

### 3.5 On exam day

- Papers start at their calendar time (auto-start) unless the HOD chose "press Start" for that round, or the paper has an open "Needs changes".
  - *Step 10 only when chosen.*
- **Let a student continue** is one action: minutes + reason, by anyone with the extra-time permission. It replaces allocate → request → approve.
  - *Step 12 becomes 1 action.* If the school wants two people for this, keep the approval, but let the requester be anyone and show it in the HOD's inbox.

### 3.6 Everyone: one inbox

Each person's dashboard shows only what's waiting on them:

| Teacher | HOD / admin |
|---|---|
| Papers due this round, with progress | Papers to review |
| Papers returned with notes | Fixes to accept |
| Deadline countdown | Exams to start today (if manual) |
| | Students waiting to continue |
| | Teaching changes requested |

(The new dashboard's "Needs you now" list is the start of this.)

## 4. Before and after

| | Today | Proposed |
|---|---|---|
| Teacher actions for one test | create, set type/round/title/topic, add questions, submit (5+) | add questions, send for review (2) |
| HOD actions for one test | approve assignment, review, schedule each class, maybe start (3–4+) | approve (1), done in bulk |
| Fix after approval | 4 actions | 2 actions |
| Student continues after time-out | 3 actions | 1 action |

## 5. Order of work

1. **Quick wins** (no new tables):
   - make topic optional;
   - automatic pre-submit checks with clear messages;
   - merge begin/submit amendment into "edit → Send fix";
   - one-step "Let a student continue".
2. **Round calendar and approve-schedules-it.** Needs the Rounds model from the question-bank plan, phase 3.
3. **Teaching assignments set by the HOD** (bulk table or spreadsheet import), with teacher change requests.
4. **Unified inbox** on the dashboard for each role.

## 6. Decisions needed

1. Should exams **start automatically** at their calendar time by default? *Recommendation: yes, per round, with the HOD able to switch a round to "press Start".*
2. **Let a student continue:** one person, or keep two? *Recommendation: one person with the extra-time permission; everything is in the audit log.*
3. **Who teaches what:** set by the HOD (or imported), rather than requested by teachers? *Recommendation: yes; teachers can still request changes.*
4. **Topic:** optional? *Recommendation: yes. It's still shown in reports when given.*
