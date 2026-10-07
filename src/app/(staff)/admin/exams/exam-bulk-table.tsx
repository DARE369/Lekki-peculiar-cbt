"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Table, Td, Th, cn } from "@/components/ui";
import { WINDOW_LABEL, windowState } from "@/lib/labels";
import type { AssessmentType } from "@/lib/types";
import { bulkWindowAction } from "./actions";

export type ExamWindowRow = {
  id: string;
  class_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  auto_start: boolean;
  assessments: { id: string; title: string; type: AssessmentType; subject_id: string } | null;
};

function isStartable(row: ExamWindowRow) {
  const s = windowState(row);
  return s === "scheduled" || s === "awaiting_start";
}

export function ExamBulkTable({
  rows,
  classNames,
  subjectNames,
}: {
  rows: ExamWindowRow[];
  classNames: Record<string, string>;
  subjectNames: Record<string, string>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const checkAllRef = useRef<HTMLInputElement>(null);

  const startableIds = rows.filter(isStartable).map((r) => r.id);
  const startableSet = new Set(startableIds);
  const selectedStartable = [...selected].filter((id) => startableSet.has(id));

  const allStartableSelected = startableIds.length > 0 && selectedStartable.length === startableIds.length;

  useEffect(() => {
    if (checkAllRef.current) {
      checkAllRef.current.indeterminate =
        selectedStartable.length > 0 && selectedStartable.length < startableIds.length;
    }
  }, [selectedStartable.length, startableIds.length]);

  function toggle(id: string) {
    if (!startableSet.has(id)) return;
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    setSelected(allStartableSelected ? new Set() : new Set(startableIds));
  }

  function confirmStart() {
    if (!selectedStartable.length) return;
    startTransition(async () => {
      const res = await bulkWindowAction(selectedStartable, "start");
      setShowConfirm(false);
      setSelected(new Set());
      if (res?.ok) {
        setNotice({ tone: "success", text: res.message ?? "Started." });
        router.refresh();
      } else {
        setNotice({ tone: "warning", text: res?.error ?? "Could not start exams." });
      }
    });
  }

  const dismissNotice = useCallback(() => setNotice(null), []);

  if (rows.length === 0) return null;

  const TYPE_LABEL_SHORT: Record<string, string> = { test: "Test", exam: "Exam", quiz: "Quiz", mock: "Mock" };
  const fmtDt = (iso: string) =>
    new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" }).format(new Date(iso));

  return (
    <>
      {/* Confirmation dialog */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-start-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <h2 id="bulk-start-title" className="text-base font-bold">
              Start {selectedStartable.length} exam{selectedStartable.length === 1 ? "" : "s"}?
            </h2>
            <p className="mt-3 text-sm text-muted">
              Students in the selected classes will be able to begin immediately. This cannot be undone from this screen
              — you can pause or close each exam individually after starting.
            </p>
            <ul className="mt-4 max-h-48 space-y-1.5 overflow-y-auto">
              {rows
                .filter((r) => selectedStartable.includes(r.id))
                .map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="font-medium">{r.assessments?.title}</span>
                    <span className="text-muted">·</span>
                    <span className="text-muted">{classNames[r.class_id] ?? r.class_id}</span>
                  </li>
                ))}
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={pending}
                className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmStart}
                disabled={pending}
                className="rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white hover:bg-success/90 disabled:opacity-50"
              >
                {pending ? "Starting…" : `▶ Start ${selectedStartable.length} exam${selectedStartable.length === 1 ? "" : "s"}`}
              </button>
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
              {startableIds.length > 0 ? (
                <input
                  ref={checkAllRef}
                  type="checkbox"
                  aria-label="Select all startable exams"
                  checked={allStartableSelected}
                  onChange={toggleAll}
                  className="accent-[var(--brand)]"
                />
              ) : null}
            </Th>
            <Th>Exam</Th>
            <Th>Class</Th>
            <Th>Opens</Th>
            <Th>Closes</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const state = windowState(r);
            const [label, tone] = WINDOW_LABEL[state];
            const startable = isStartable(r);
            const isSelected = selected.has(r.id);
            return (
              <tr key={r.id} className={cn("hover:bg-surface-2", isSelected && "bg-brand-soft/20")}>
                <Td>
                  {startable ? (
                    <input
                      type="checkbox"
                      aria-label="Select exam"
                      checked={isSelected}
                      onChange={() => toggle(r.id)}
                      className="accent-[var(--brand)]"
                    />
                  ) : null}
                </Td>
                <Td>
                  <Link href={`/admin/exams/${r.id}`} className="font-medium text-brand hover:underline">
                    {r.assessments?.title}
                  </Link>
                  <span className="block text-xs text-muted">
                    {subjectNames[r.assessments?.subject_id ?? ""] ?? ""} · {TYPE_LABEL_SHORT[r.assessments?.type ?? "test"] ?? r.assessments?.type}
                  </span>
                </Td>
                <Td label="Class">{classNames[r.class_id] ?? r.class_id}</Td>
                <Td label="Opens" className="text-sm whitespace-nowrap">{fmtDt(r.starts_at)}</Td>
                <Td label="Closes" className="text-sm whitespace-nowrap">{fmtDt(r.ends_at)}</Td>
                <Td label="Status">
                  <Badge tone={tone}>{label}</Badge>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {/* Sticky selection bar */}
      {selectedStartable.length > 0 && (
        <div className="sticky bottom-4 left-0 z-10 mx-auto w-fit rounded-2xl border border-border bg-surface px-5 py-3 shadow-xl">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">
              {selectedStartable.length} exam{selectedStartable.length === 1 ? "" : "s"} selected
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-muted hover:text-text"
            >
              Clear
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={pending}
              className="rounded-lg bg-success px-3 py-1.5 text-sm font-semibold text-white hover:bg-success/90 disabled:opacity-50"
            >
              ▶ Start selected
            </button>
          </div>
        </div>
      )}
    </>
  );
}
