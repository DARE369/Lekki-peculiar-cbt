"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, cn } from "@/components/ui";
import { addQuestionsToAssessment } from "../../actions";
import { addRandomFromBank } from "../../bank-actions";

export type PoolQuestion = { id: string; body: string; answer: string; topic: string | null; bank: string };
export type PoolBank = { id: string; label: string; round: string | null; count: number; sameRound: boolean };

/**
 * Add questions to a test: choose a bank, then tick some, select all, or take a number at random.
 * Banks from this test's round come first; others are there for deliberate reuse.
 */
export function AddQuestions({
  assessmentId,
  banks,
  pool,
  needed,
  defaultBank,
}: {
  assessmentId: string;
  banks: PoolBank[];
  pool: PoolQuestion[];
  needed: number;
  defaultBank: string;
}) {
  const router = useRouter();
  const [chosen, setBank] = useState(defaultBank);
  // If the chosen bank has run out (all its questions are now in the test), move on to the next one.
  const bank = banks.some((b) => b.id === chosen) ? chosen : (banks[0]?.id ?? "");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [random, setRandom] = useState(String(Math.max(1, needed || 5)));
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, start] = useTransition();

  const list = useMemo(() => pool.filter((q) => q.bank === bank), [pool, bank]);
  const all = list.length > 0 && list.every((q) => ticked.has(q.id));
  const current = banks.find((b) => b.id === bank);
  const same = banks.filter((b) => b.sameRound);
  const other = banks.filter((b) => !b.sameRound);

  function done(res: { ok: boolean; message?: string; error?: string } | null) {
    if (res?.ok) {
      setNotice({ tone: "success", text: res.message ?? "Added." });
      setTicked(new Set());
      router.refresh();
    } else setNotice({ tone: "danger", text: (res as { error?: string } | null)?.error ?? "That didn't work." });
  }

  function addTicked() {
    const fd = new FormData();
    fd.set("assessment_id", assessmentId);
    for (const id of ticked) fd.append("question_id", id);
    start(async () => done(await addQuestionsToAssessment(null, fd)));
  }

  if (!banks.length) {
    return <p className="px-5 py-4 text-sm text-muted">There are no other questions for this subject and year group yet. Upload some into this test above.</p>;
  }

  return (
    <div className="space-y-3 p-4 sm:p-5">
      <label className="block space-y-1">
        <span className="text-[13px] font-medium">Add questions from</span>
        <select
          value={bank}
          onChange={(e) => {
            setBank(e.target.value);
            setTicked(new Set());
            setNotice(null);
          }}
          className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm sm:w-auto sm:min-w-80"
        >
          {same.length ? (
            <optgroup label="This test's round">
              {same.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label} ({b.count})
                </option>
              ))}
            </optgroup>
          ) : null}
          {other.length ? (
            <optgroup label={same.length ? "Other banks (reuse on purpose)" : "Banks"}>
              {other.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                  {b.round && !b.label.includes(b.round) ? ` — ${b.round}` : ""} ({b.count})
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>

      {notice ? <p className={cn("text-sm", notice.tone === "success" ? "text-success" : "text-danger")}>{notice.text}</p> : null}

      <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 p-2 text-sm">
        <Button size="sm" disabled={busy || ticked.size === 0} onClick={addTicked}>
          Add {ticked.size || ""} ticked
        </Button>
        <span className="text-muted">or add</span>
        <Input value={random} onChange={(e) => setRandom(e.target.value)} inputMode="numeric" aria-label="How many at random" className="h-8 w-16" />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !Number(random) || !current}
          onClick={() => start(async () => done(await addRandomFromBank({ assessmentId, bankId: bank, count: Number(random) })))}
        >
          at random
        </Button>
        <span className="ml-auto flex gap-3">
          <button type="button" className="font-medium text-brand hover:underline" onClick={() => setTicked(all ? new Set() : new Set(list.map((q) => q.id)))}>
            {all ? "Deselect all" : `Select all ${list.length}`}
          </button>
        </span>
      </div>

      <ul className="max-h-[440px] divide-y divide-border overflow-y-auto rounded-md border border-border">
        {list.map((q) => (
          <li key={q.id}>
            <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-surface-2">
              <input
                type="checkbox"
                checked={ticked.has(q.id)}
                onChange={() =>
                  setTicked((s) => {
                    const n = new Set(s);
                    if (n.has(q.id)) n.delete(q.id);
                    else n.add(q.id);
                    return n;
                  })
                }
                className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2">{q.body}</span>
                <span className="text-xs text-muted">
                  Answer {q.answer}
                  {q.topic ? ` · ${q.topic}` : ""}
                </span>
              </span>
            </label>
          </li>
        ))}
        {list.length === 0 ? <li className="px-3 py-4 text-sm text-muted">Every question in this bank is already in the test.</li> : null}
      </ul>
    </div>
  );
}
