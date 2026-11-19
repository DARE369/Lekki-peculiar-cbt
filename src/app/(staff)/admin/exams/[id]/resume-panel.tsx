"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { approveResumes, letStudentsContinue } from "../../actions";

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

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—";

/**
 * Students who finished (or ran out of time) can be let back in, in one step: tick them, give the extra
 * minutes and a reason, press "Let them continue". Requests made the old two-step way can still be approved.
 */
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
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [minutes, setMinutes] = useState("10");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, start] = useTransition();

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function letContinue() {
    setNotice(null);
    start(async () => {
      const res = await letStudentsContinue(windowId, [...ticked], Number.parseInt(minutes, 10), reason);
      if (res?.ok) {
        setNotice({ tone: "success", text: res.message ?? "Done." });
        setTicked(new Set());
        setReason("");
        router.refresh();
      } else setNotice({ tone: "danger", text: res?.error ?? "That didn't work." });
    });
  }

  function approveOld() {
    start(async () => {
      const res = await approveResumes(windowId, pending.map((p) => p.id));
      setNotice(res?.ok ? { tone: "success", text: res.message ?? "Approved." } : { tone: "danger", text: res?.error ?? "That didn't work." });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title="Let a student continue"
        description="For a student who ran out of time or was interrupted (power cut, computer problem). They get extra minutes and can sign in on any lab computer. Recorded in the audit log."
      />
      <div className="space-y-4 p-4 sm:p-5">
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

        {resumable.length ? (
          <>
            <fieldset>
              <legend className="text-[13px] font-medium">Students who have finished</legend>
              <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                {resumable.map((st) => (
                  <li key={st.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
                      <input type="checkbox" checked={ticked.has(st.id)} onChange={() => toggle(st.id)} className="size-4 accent-[var(--brand)]" />
                      <span className="flex-1">{st.name}</span>
                      <span className="text-xs text-muted">finished {time(st.submittedAt)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
              <Field label="Extra minutes">
                <Input type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </Field>
              <Field label="Reason">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Power cut 10:20–10:30" maxLength={300} />
              </Field>
              <Button onClick={letContinue} disabled={busy || ticked.size === 0 || !reason.trim()}>
                {busy ? "Working…" : `Let ${ticked.size || ""} continue`.replace("  ", " ")}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">No student has finished yet.</p>
        )}

        {pending.length ? (
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">Waiting from before: {pending.length} request{pending.length === 1 ? "" : "s"}</p>
            <p className="text-muted">{pending.map((p) => `${p.studentName} (${p.extraMinutes} min)`).join(", ")}</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={approveOld} disabled={busy}>
              Approve {pending.length === 1 ? "it" : "them"}
            </Button>
          </div>
        ) : null}

        {approved.length ? (
          <div className="text-sm">
            <p className="font-medium">Already let back in</p>
            <ul className="mt-1 space-y-0.5 text-muted">
              {approved.map((a) => (
                <li key={a.id}>
                  {a.studentName} <Badge>{a.extraMinutes} min</Badge> at {time(a.approvedAt)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
