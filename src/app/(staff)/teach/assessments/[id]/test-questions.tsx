"use client";

import { useState } from "react";
import { useAction } from "@/components/use-action";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Spinner } from "@/components/ui";
import type { QuestionOption } from "@/lib/types";
import { removeFromTest, setCommentFixed } from "../../bank-actions";

type Q = { id: string; body: string; options: QuestionOption[]; answer: string };
export type QComment = { id: string; body: string; resolved_at: string | null };

/** The questions in this test. Tick to remove several at once (they stay in the bank). */
export function TestQuestions({
  assessmentId,
  questions,
  editable,
  comments = {},
}: {
  assessmentId: string;
  questions: Q[];
  editable: boolean;
  /** The Head of Section's comments, by question id. */
  comments?: Record<string, QComment[]>;
}) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const { pending: busy, running, run } = useAction();
  const all = questions.length > 0 && ticked.size === questions.length;

  function remove(ids: string[], key = "bulk") {
    run(key, async () => {
      const res = await removeFromTest(assessmentId, ids);
      setMsg(res?.ok ? (res.message ?? "Removed.") : res && !res.ok ? res.error : "That didn't work.");
      setTicked(new Set());
      router.refresh();
    });
  }

  return (
    <>
      {editable && questions.length ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-2 text-sm">
          <button type="button" className="font-medium text-brand hover:underline" onClick={() => setTicked(all ? new Set() : new Set(questions.map((q) => q.id)))}>
            {all ? "Deselect all" : `Select all ${questions.length}`}
          </button>
          {ticked.size ? (
            <Button size="sm" variant="ghost" className="text-danger hover:text-danger" disabled={busy} loading={running("bulk")} onClick={() => remove([...ticked])}>
              Remove {ticked.size} from this test
            </Button>
          ) : null}
          {msg ? <span className="text-muted">{msg}</span> : null}
        </div>
      ) : null}
      <ol className="divide-y divide-border">
        {questions.map((q, i) => (
          <li
            key={q.id}
            id={`q-${q.id}`}
            className={`flex gap-3 px-5 py-3 ${(comments[q.id] ?? []).some((c) => !c.resolved_at) ? "bg-warning-soft/60" : ""}`}
          >
            {editable ? (
              <input
                type="checkbox"
                aria-label={`Select question ${i + 1}`}
                checked={ticked.has(q.id)}
                onChange={() =>
                  setTicked((s) => {
                    const n = new Set(s);
                    if (n.has(q.id)) n.delete(q.id);
                    else n.add(q.id);
                    return n;
                  })
                }
                className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
              />
            ) : null}
            <span className="w-6 shrink-0 text-sm text-muted tabular-nums">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm whitespace-pre-wrap">{q.body}</p>
              <div className="mt-1 grid gap-x-4 text-xs text-muted sm:grid-cols-2">
                {q.options.map((o) => (
                  <span key={o.key} className={o.key === q.answer ? "font-semibold text-success" : ""}>
                    {o.key}. {o.text}
                  </span>
                ))}
              </div>
              {(comments[q.id] ?? []).map((c) => (
                <div
                  key={c.id}
                  className={`mt-2 flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${c.resolved_at ? "border-border text-muted" : "border-warning/40 bg-surface text-warning"}`}
                >
                  <span className={c.resolved_at ? "line-through" : "font-medium"}>Head of Section: {c.body}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(c.id, async () => {
                        await setCommentFixed(c.id, !c.resolved_at);
                        router.refresh();
                      })
                    }
                    className="ml-auto inline-flex items-center font-semibold text-brand hover:underline"
                  >
                    {running(c.id) ? <Spinner className="mr-1 size-3" /> : null}
                    {running(c.id) ? "Saving…" : c.resolved_at ? "Reopen" : "Mark fixed"}
                  </button>
                </div>
              ))}
            </div>
            {editable ? (
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Link href={`/teach/questions/${q.id}?assessment=${assessmentId}`} className="text-xs font-semibold text-brand hover:underline">
                  Edit
                </Link>
                <button type="button" disabled={busy} onClick={() => remove([q.id], q.id)} className="inline-flex items-center text-xs text-muted hover:text-danger">
                  {running(q.id) ? <Spinner className="mr-1 size-3" /> : null}
                  {running(q.id) ? "Removing…" : "Remove"}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </>
  );
}
