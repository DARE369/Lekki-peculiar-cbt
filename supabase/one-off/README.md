# One-off data fixes

These are **not** migrations. They are run once, by hand, in the Supabase SQL editor, because a data fix must never
run on its own on a new or restored database (where it could move real data).

## Move everything filed under Second Term to First Term (2026-11-27)

Only the **term label** on each record changes. Tests, questions, question banks and exam calendar dates are
relabelled; results, scores, answers and exam windows have no term of their own, so they follow their test.
Every other value is left exactly as it was, including "last edited" times.

1. **Preview** (changes nothing): run `2026-11-27_1_preview.sql`. Run Query 1, read the totals, then run Query 2 to see
   the list of tests. Check they are the ones you expect, and that "Moving FROM / TO" name the right terms.
2. **Back up first**, if your Supabase plan offers backups (Dashboard → Database → Backups). The undo script below is
   the second safety net.
3. **Move**: paste the whole of `2026-11-27_2_move_second_term_to_first_term.sql` and run it once. It shows a summary.
   If any check fails it changes nothing and says why. It will not run a second time.
4. **Look at the app**: Settings → School year & terms shows how many tests each term holds. Reports, "Tests & exams"
   and "This term's papers" now show the old work under First Term.
5. **Only if it was a mistake**: run `2026-11-27_3_undo_move.sql` to put everything back.

Notes
- Only the **current session's** Second Term is touched. Earlier years' Second Terms are never moved.
- The move does **not** change which term is current. When Second Term really starts, switch it in
  Settings → School year & terms.
- An exam calendar date that would clash with one already in First Term (same round and year group) is left where it
  is and counted in the summary.
- Run it when nobody is editing tests or questions. Students sitting an exam do not matter: they only write answers.
