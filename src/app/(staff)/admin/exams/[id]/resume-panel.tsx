"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, CardHeader, cn } from "@/components/ui";
import { approveResumes, requestResumes } from "../../actions";

export type ResumableStudent = {
  id: string;
  name: string;
  submittedAt: string | null;
};

export type PendingResumeRequest = {
  id: string;
  studentId: string;
  studentName: string;
  extraMinutes: number;
  requestedAt: string;
};

export type ApprovedResumeRequest = {
  id: string;
  studentId: string;
  studentName: string;
  extraMinutes: number;
  approvedAt: string;
};

function Notice({ tone, text, onDismiss }: { tone: "success" | "warning"; text: string; onDismiss: () => void }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-medium",
        tone === "success"
          ? "border-success/30 bg-success-soft text-success"
          : "border-warning/30 bg-warning-soft text-warning",
      )}
    >
      <span>{text}</span>
      <button onClick={onDismiss} className="ml-4 text-xs text-muted hover:text-text">
        Dismiss
      </button>
    </div>
  );
}

export function ResumePanel({
  windowId,
  resumable,
  pending,
  approved,
}: {
  windowId: string;
  resumable: ResumableStudent[];
  pending: PendingResumeRequest[];
  approved: ApprovedResumeRequest[];
}) {
  const router = useRouter();
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [isPendingReq, startReqTransition] = useTransition();
  const [isPendingAppr, startApprTransition] = useTransition();
  const checkStudentsRef = useRef<HTMLInputElement>(null);
  const checkRequestsRef = useRef<HTMLInputElement>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const allStudentsSelected = resumable.length > 0 && selectedStudents.size === resumable.length;
  const allRequestsSelected = pending.length > 0 && selectedRequests.size === pending.length;

  useEffect(() => {
    if (checkStudentsRef.current) {
      checkStudentsRef.current.indeterminate =
        selectedStudents.size > 0 && selectedStudents.size < resumable.length;
    }
  }, [selectedStudents.size, resumable.length]);

  useEffect(() => {
    if (checkRequestsRef.current) {
      checkRequestsRef.current.indeterminate =
        selectedRequests.size > 0 && selectedRequests.size < pending.length;
    }
  }, [selectedRequests.size, pending.length]);

  function toggleStudent(id: string) {
    setSelectedStudents((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAllStudents() {
    setSelectedStudents(allStudentsSelected ? new Set() : new Set(resumable.map((s) => s.id)));
  }

  function toggleRequest(id: string) {
    setSelectedRequests((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAllRequests() {
    setSelectedRequests(allRequestsSelected ? new Set() : new Set(pending.map((r) => r.id)));
  }

  function handleRequest() {
    if (!selectedStudents.size) return;
    startReqTransition(async () => {
      const res = await requestResumes(windowId, [...selectedStudents]);
      setSelectedStudents(new Set());
      if (res?.ok) {
        setNotice({ tone: "success", text: res.message ?? "Resume requested." });
        router.refresh();
      } else {
        setNotice({ tone: "warning", text: res?.error ?? "Could not request resume." });
      }
    });
  }

  function handleApprove() {
    if (!selectedRequests.size) return;
    startApprTransition(async () => {
      const res = await approveResumes(windowId, [...selectedRequests]);
      setSelectedRequests(new Set());
      if (res?.ok) {
        setNotice({ tone: "success", text: res.message ?? "Approved." });
        router.refresh();
      } else {
        setNotice({ tone: "warning", text: res?.error ?? "Could not approve resumes." });
      }
    });
  }

  const hasAnything = resumable.length > 0 || pending.length > 0 || approved.length > 0;
  if (!hasAnything) return null;

  return (
    <Card>
      <CardHeader
        title="Resume attempts"
        description="Students who ran out of time can continue with their allocated extra time. Step 1: select students and request resume. Step 2: approve the requests."
      />
      <div className="space-y-6 p-5">
        {notice && <Notice tone={notice.tone} text={notice.text} onDismiss={dismissNotice} />}

        {/* Step 1: Request */}
        {resumable.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">
              Step 1 — Select students to request resume
              <span className="ml-2 font-normal text-muted text-xs">Extra time must already be allocated.</span>
            </p>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs font-semibold text-muted uppercase tracking-wide">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input
                        ref={checkStudentsRef}
                        type="checkbox"
                        aria-label="Select all"
                        checked={allStudentsSelected}
                        onChange={toggleAllStudents}
                        className="accent-[var(--brand)]"
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Student</th>
                    <th className="px-3 py-2 text-left">Submitted at</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {resumable.map((st) => (
                    <tr
                      key={st.id}
                      className={cn("cursor-pointer hover:bg-surface-2", selectedStudents.has(st.id) && "bg-brand-soft/20")}
                      onClick={() => toggleStudent(st.id)}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedStudents.has(st.id)}
                          onChange={() => toggleStudent(st.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="accent-[var(--brand)]"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{st.name}</td>
                      <td className="px-3 py-2 text-muted">
                        {st.submittedAt ? new Date(st.submittedAt).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={handleRequest}
              disabled={!selectedStudents.size || isPendingReq}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand/90 disabled:opacity-40"
            >
              {isPendingReq ? "Requesting…" : `Request resume for ${selectedStudents.size || 0} student${selectedStudents.size === 1 ? "" : "s"}`}
            </button>
          </div>
        )}

        {/* Step 2: Approve */}
        {pending.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">
              Step 2 — Approve pending requests
              <Badge tone="warning" className="ml-2">{pending.length} pending</Badge>
            </p>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs font-semibold text-muted uppercase tracking-wide">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input
                        ref={checkRequestsRef}
                        type="checkbox"
                        aria-label="Select all"
                        checked={allRequestsSelected}
                        onChange={toggleAllRequests}
                        className="accent-[var(--brand)]"
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Student</th>
                    <th className="px-3 py-2 text-left">Extra time</th>
                    <th className="px-3 py-2 text-left">Requested</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pending.map((req) => (
                    <tr
                      key={req.id}
                      className={cn("cursor-pointer hover:bg-surface-2", selectedRequests.has(req.id) && "bg-brand-soft/20")}
                      onClick={() => toggleRequest(req.id)}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedRequests.has(req.id)}
                          onChange={() => toggleRequest(req.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="accent-[var(--brand)]"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{req.studentName}</td>
                      <td className="px-3 py-2">{req.extraMinutes} min</td>
                      <td className="px-3 py-2 text-muted">
                        {new Date(req.requestedAt).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={handleApprove}
              disabled={!selectedRequests.size || isPendingAppr}
              className="rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white hover:bg-success/90 disabled:opacity-40"
            >
              {isPendingAppr ? "Approving…" : `✓ Approve ${selectedRequests.size || 0} request${selectedRequests.size === 1 ? "" : "s"}`}
            </button>
          </div>
        )}

        {/* Already approved */}
        {approved.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-muted">Already approved</p>
            <ul className="space-y-1">
              {approved.map((req) => (
                <li key={req.id} className="flex items-center gap-2 text-sm">
                  <Badge tone="success">Resumed</Badge>
                  <span className="font-medium">{req.studentName}</span>
                  <span className="text-muted">+{req.extraMinutes} min ·</span>
                  <span className="text-muted">
                    approved {new Date(req.approvedAt).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
