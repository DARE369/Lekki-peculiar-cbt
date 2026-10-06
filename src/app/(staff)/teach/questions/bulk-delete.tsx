"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Table, Td, Th, cn } from "@/components/ui";
import type { QuestionOption } from "@/lib/types";
import { confirmBulkDelete, previewBulkDelete } from "../actions";

type Question = {
  id: string;
  body: string;
  options: unknown;
  answer: string;
  topic: string | null;
  difficulty: number | null;
};

type PreviewResult = Awaited<ReturnType<typeof previewBulkDelete>>;

const DIFF = ["", "Easy", "Medium", "Hard"] as const;

export function QuestionBulkTable({ questions }: { questions: Question[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const checkAllRef = useRef<HTMLInputElement>(null);

  const allSelected = questions.length > 0 && selected.size === questions.length;

  useEffect(() => {
    if (checkAllRef.current) {
      checkAllRef.current.indeterminate = selected.size > 0 && selected.size < questions.length;
    }
  }, [selected.size, questions.length]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(questions.map((q) => q.id)));
  }

  function openPreview() {
    if (!selected.size) return;
    startTransition(async () => {
      const p = await previewBulkDelete([...selected]);
      setPreview(p);
    });
  }

  function confirmDelete() {
    if (!preview?.safe.length) return;
    startTransition(async () => {
      const res = await confirmBulkDelete(preview.safe.map((q) => q.id));
      setPreview(null);
      setSelected(new Set());
      if (res?.ok) {
        setNotice({ tone: "success", text: res.message ?? "Deleted." });
        router.refresh();
      } else {
        setNotice({ tone: "warning", text: res?.error ?? "Delete failed." });
      }
    });
  }

  const dismissNotice = useCallback(() => setNotice(null), []);

  if (questions.length === 0) return null;

  return (
    <>
      {/* Confirmation overlay */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-del-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <h2 id="bulk-del-title" className="text-base font-bold">
              Delete {selected.size} question{selected.size === 1 ? "" : "s"}?
            </h2>

            {preview.safe.length > 0 && (
              <p className="mt-3 text-sm">
                <strong className="text-danger">{preview.safe.length}</strong> question{preview.safe.length === 1 ? "" : "s"} will be permanently removed.
                This cannot be undone.
              </p>
            )}

            {preview.blocked.length > 0 && (
              <div className="mt-3 rounded-xl border border-warning/40 bg-warning-soft p-4">
                <p className="text-sm font-semibold text-warning">
                  {preview.blocked.length} question{preview.blocked.length === 1 ? "" : "s"} cannot be deleted right now:
                </p>
                <ul className="mt-2 space-y-2">
                  {preview.blocked.map((b) => (
                    <li key={b.id} className="rounded-lg bg-surface/60 p-2 text-xs">
                      <p className="line-clamp-1 font-medium text-text">
                        &ldquo;{b.body.slice(0, 80)}{b.body.length > 80 ? "…" : ""}&rdquo;
                      </p>
                      <p className="mt-0.5 text-warning">
                        {b.reason} — <em>{b.testTitle}</em>
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted">
                  Wait until the exam is finished, then you can delete these.
                </p>
              </div>
            )}

            {preview.safe.length === 0 && (
              <p className="mt-3 text-sm text-muted">
                Nothing can be deleted right now — all selected questions are linked to active or upcoming exams.
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPreview(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2"
              >
                Cancel
              </button>
              {preview.safe.length > 0 && (
                <button
                  onClick={confirmDelete}
                  disabled={pending}
                  className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger/90 disabled:opacity-50"
                >
                  {pending ? "Deleting…" : `Delete ${preview.safe.length} question${preview.safe.length === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Result notice */}
      {notice && (
        <div
          className={cn(
            "flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-medium",
            notice.tone === "success"
              ? "border-success/30 bg-success-soft text-success"
              : "border-warning/30 bg-warning-soft text-warning",
          )}
        >
          <span>{notice.text}</span>
          <button onClick={dismissNotice} className="ml-4 text-xs text-muted hover:text-text">
            Dismiss
          </button>
        </div>
      )}

      <Table stack>
        <thead>
          <tr>
            <Th className="w-8">
              <input
                ref={checkAllRef}
                type="checkbox"
                aria-label="Select all questions"
                checked={allSelected}
                onChange={toggleAll}
                className="accent-[var(--brand)]"
              />
            </Th>
            <Th className="w-1/2">Question</Th>
            <Th>Answer</Th>
            <Th>Topic</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {questions.map((r) => {
            const opts = r.options as QuestionOption[];
            const correct = opts.find((o) => o.key === r.answer);
            const isSelected = selected.has(r.id);
            return (
              <tr key={r.id} className={isSelected ? "bg-brand-soft/20" : undefined}>
                <Td>
                  <input
                    type="checkbox"
                    aria-label="Select question"
                    checked={isSelected}
                    onChange={() => toggle(r.id)}
                    className="accent-[var(--brand)]"
                  />
                </Td>
                <Td>
                  <Link href={`/teach/questions/${r.id}`} className="line-clamp-2 hover:underline">
                    {r.body}
                  </Link>
                  <span className="text-xs text-muted">{opts.length} options</span>
                </Td>
                <Td label="Answer">
                  <Badge tone="success">{r.answer}</Badge>{" "}
                  <span className="text-xs text-muted">{correct?.text.slice(0, 30)}</span>
                </Td>
                <Td label="Topic" className="text-xs">
                  {r.topic ?? "—"}
                  {r.difficulty ? <span className="block text-muted">{DIFF[r.difficulty]}</span> : null}
                </Td>
                <Td className="cell-actions text-right max-md:text-left">
                  <Link href={`/teach/questions/${r.id}`} className="text-xs text-muted hover:text-brand">
                    Edit
                  </Link>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {/* Sticky selection bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 left-0 z-10 mx-auto w-fit rounded-2xl border border-border bg-surface px-5 py-3 shadow-xl">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">
              {selected.size} question{selected.size === 1 ? "" : "s"} selected
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-muted hover:text-text"
            >
              Clear
            </button>
            <button
              onClick={openPreview}
              disabled={pending}
              className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:bg-danger/90 disabled:opacity-50"
            >
              {pending ? "Checking…" : "Delete selected"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
