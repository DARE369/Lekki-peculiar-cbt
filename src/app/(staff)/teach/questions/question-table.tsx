"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Table, Td, Th, cn } from "@/components/ui";
import type { QuestionOption } from "@/lib/types";
import { confirmBulkDelete, moveQuestionsToRound, previewBulkDelete } from "../actions";
import { makeTestFromQuestions, moveToBank, setTopicFor } from "../bank-actions";

export type BankQuestion = {
  id: string;
  body: string;
  options: unknown;
  answer: string;
  topic: string | null;
  difficulty: number | null;
  /** shown in grey when the teacher hasn't set a topic: the bank's name (Subject · Round · date) */
  autoLabel: string;
};

type PreviewResult = Awaited<ReturnType<typeof previewBulkDelete>>;
type Mode = null | "bank" | "round" | "topic";
const DIFF = ["", "Easy", "Medium", "Hard"] as const;

/**
 * The questions in the bank. Tick some, or "Select all" (every question in this view, on every page), then
 * one bar of actions: make a test, move to a bank, move to a round, set the topic, delete.
 */
export function QuestionTable({
  questions,
  allIds,
  rounds,
  banks,
  topics,
  subjectId,
  yearId,
}: {
  questions: BankQuestion[];
  allIds: string[];
  rounds: { id: string; label: string }[];
  banks: { id: string; label: string }[];
  topics: string[];
  subjectId: string;
  yearId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const head = useRef<HTMLInputElement>(null);

  const pageIds = questions.map((q) => q.id);
  const pageAll = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const everything = allIds.length > 0 && selected.size === allIds.length;

  useEffect(() => {
    if (head.current) head.current.indeterminate = !pageAll && pageIds.some((id) => selected.has(id));
  }, [pageAll, pageIds, selected]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const togglePage = () =>
    setSelected((s) => {
      const n = new Set(s);
      for (const id of pageIds) {
        if (pageAll) n.delete(id);
        else n.add(id);
      }
      return n;
    });
  const clear = () => {
    setSelected(new Set());
    setMode(null);
  };

  function after(res: { ok: boolean; message?: string; error?: string } | null | undefined) {
    if (res === undefined) return; // it moved on to another page (e.g. the new test)
    if (res?.ok) {
      setNotice({ tone: "success", text: res.message ?? "Done." });
      clear();
      router.refresh();
    } else setNotice({ tone: "warning", text: (res as { error?: string } | null)?.error ?? "That didn't work." });
  }

  const ids = () => [...selected];

  return (
    <>
      {/* Selection summary: select every question in this view, not just this page. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-sm sm:px-5">
        {selected.size ? (
          <span className="font-medium">
            {everything ? `All ${allIds.length} selected` : `${selected.size} selected`}
          </span>
        ) : (
          <span className="text-muted">Tick questions to act on them</span>
        )}
        {!everything && allIds.length > 1 ? (
          <button type="button" onClick={() => setSelected(new Set(allIds))} className="font-medium text-brand hover:underline">
            Select all {allIds.length}
          </button>
        ) : null}
        {selected.size ? (
          <button type="button" onClick={clear} className="font-medium text-muted hover:text-text">
            Deselect all
          </button>
        ) : null}
      </div>

      {notice ? (
        <div className={cn("flex items-start justify-between gap-3 border-b border-border px-4 py-2.5 text-sm sm:px-5", notice.tone === "success" ? "text-success" : "text-warning")} role="status">
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs text-muted hover:text-text">
            Dismiss
          </button>
        </div>
      ) : null}

      <Table stack>
        <thead>
          <tr>
            <Th className="w-8">
              <input ref={head} type="checkbox" aria-label="Select every question on this page" checked={pageAll} onChange={togglePage} className="size-4 accent-[var(--brand)]" />
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
            const on = selected.has(r.id);
            return (
              <tr key={r.id} className={on ? "bg-brand-soft/30" : undefined}>
                <Td>
                  <input type="checkbox" aria-label="Select question" checked={on} onChange={() => toggle(r.id)} className="size-4 accent-[var(--brand)]" />
                </Td>
                <Td>
                  <Link href={`/teach/questions/${r.id}`} className="line-clamp-2 hover:underline">
                    {r.body}
                  </Link>
                  <span className="text-xs text-muted">{opts.length} options</span>
                </Td>
                <Td label="Answer">
                  <Badge tone="success">{r.answer}</Badge> <span className="text-xs text-muted">{correct?.text.slice(0, 30)}</span>
                </Td>
                <Td label="Topic" className="text-xs">
                  {r.topic ? r.topic : <span className="text-subtle" title="No topic set — shown by its bank">{r.autoLabel}</span>}
                  {r.difficulty ? <span className="block text-muted">{DIFF[r.difficulty]}</span> : null}
                </Td>
                <Td className="cell-actions whitespace-nowrap text-right max-md:text-left">
                  <Link href={`/teach/questions/${r.id}`} className="inline-flex min-h-8 items-center px-2 text-xs font-medium text-brand hover:underline">
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(new Set([r.id]));
                      start(async () => setPreview(await previewBulkDelete([r.id])));
                    }}
                    className="inline-flex min-h-8 items-center px-2 text-xs font-medium text-muted hover:text-danger"
                    aria-label="Delete this question"
                  >
                    Delete
                  </button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {/* One bar of actions for whatever is ticked. */}
      {selected.size > 0 ? (
        <div className="sticky bottom-3 z-20 mx-2 mt-3 rounded-lg border border-border bg-surface p-3 shadow-float sm:mx-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm font-medium">{selected.size} selected</span>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => start(async () => after(await makeTestFromQuestions({ ids: ids(), subjectId, yearId })))}
            >
              Make a test from these
            </Button>
            <Button size="sm" variant={mode === "bank" ? "soft" : "secondary"} onClick={() => setMode(mode === "bank" ? null : "bank")}>
              Move to bank
            </Button>
            {rounds.length ? (
              <Button size="sm" variant={mode === "round" ? "soft" : "secondary"} onClick={() => setMode(mode === "round" ? null : "round")}>
                Move to round
              </Button>
            ) : null}
            <Button size="sm" variant={mode === "topic" ? "soft" : "secondary"} onClick={() => setMode(mode === "topic" ? null : "topic")}>
              Set topic
            </Button>
            <Button size="sm" variant="ghost" className="text-danger hover:text-danger" disabled={pending} onClick={() => start(async () => setPreview(await previewBulkDelete(ids())))}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={clear}>
              Deselect all
            </Button>
          </div>
          {mode === "bank" ? <BankPicker banks={banks} busy={pending} onPick={(choice) => start(async () => after(await moveToBank({ ids: ids(), ...choice, subjectId, yearId })))} /> : null}
          {mode === "round" ? <RoundPicker rounds={rounds} busy={pending} onPick={(roundId) => start(async () => after(await moveQuestionsToRound(ids(), roundId)))} /> : null}
          {mode === "topic" ? <TopicPicker topics={topics} busy={pending} onPick={(topic) => start(async () => after(await setTopicFor(ids(), topic)))} /> : null}
        </div>
      ) : null}

      {preview ? (
        <DeleteDialog
          preview={preview}
          busy={pending}
          onCancel={() => setPreview(null)}
          onConfirm={() =>
            start(async () => {
              const res = await confirmBulkDelete(preview.safe.map((q) => q.id));
              setPreview(null);
              after(res);
            })
          }
        />
      ) : null}
    </>
  );
}

function BankPicker({ banks, busy, onPick }: { banks: { id: string; label: string }[]; busy: boolean; onPick: (c: { bankId?: string; newName?: string }) => void }) {
  const [bankId, setBankId] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3 text-sm">
      {banks.length ? (
        <label className="space-y-1">
          <span className="block text-xs text-muted">An existing bank</span>
          <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface px-2">
            <option value="">Choose…</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="space-y-1">
        <span className="block text-xs text-muted">{banks.length ? "…or a new bank called" : "A new bank called"}</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2nd CA revision" maxLength={80} className="h-8 w-56" />
      </label>
      <Button size="sm" disabled={busy || (!bankId && !name.trim())} onClick={() => onPick(name.trim() ? { newName: name.trim() } : { bankId })}>
        Move
      </Button>
    </div>
  );
}

function RoundPicker({ rounds, busy, onPick }: { rounds: { id: string; label: string }[]; busy: boolean; onPick: (id: string) => void }) {
  const [id, setId] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3 text-sm">
      <select value={id} onChange={(e) => setId(e.target.value)} aria-label="Round" className="h-8 rounded-md border border-border-strong bg-surface px-2">
        <option value="">Choose a round…</option>
        {rounds.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={busy || !id} onClick={() => onPick(id)}>
        Move
      </Button>
    </div>
  );
}

function TopicPicker({ topics, busy, onPick }: { topics: string[]; busy: boolean; onPick: (t: string) => void }) {
  const [t, setT] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3 text-sm">
      <Input value={t} onChange={(e) => setT(e.target.value)} list="bank-topics" placeholder="Topic, e.g. Fractions" maxLength={200} aria-label="Topic" className="h-8 w-56" />
      <datalist id="bank-topics">
        {topics.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <Button size="sm" disabled={busy || !t.trim()} onClick={() => onPick(t)}>
        Set topic
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onPick("")}>
        Clear topic
      </Button>
    </div>
  );
}

function DeleteDialog({ preview, busy, onCancel, onConfirm }: { preview: PreviewResult; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="del-title">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-float">
        <h2 id="del-title" className="text-base font-semibold">
          Delete {preview.safe.length + preview.blocked.length} question{preview.safe.length + preview.blocked.length === 1 ? "" : "s"}?
        </h2>
        {preview.safe.length ? (
          <p className="mt-2 text-sm text-muted">
            {preview.safe.length} will be removed from your bank. Tests that already ran keep their own copy, so no results change.
          </p>
        ) : null}
        {preview.blocked.length ? (
          <div className="mt-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
            <p className="font-medium text-warning">{preview.blocked.length} can&apos;t be deleted yet: they&apos;re in a live or upcoming exam.</p>
            <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-xs">
              {preview.blocked.slice(0, 20).map((b) => (
                <li key={b.id}>
                  “{b.body.slice(0, 70)}” — {b.testTitle}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy || preview.safe.length === 0}>
            {busy ? "Deleting…" : `Delete ${preview.safe.length}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
