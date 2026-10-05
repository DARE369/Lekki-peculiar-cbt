"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { scheduleAssessmentWindow } from "../../actions";

function lagosClose(startsLocal: string, windowHours: number): string {
  if (!startsLocal) return "";
  const d = new Date(`${startsLocal.slice(0, 16)}:00+01:00`);
  if (Number.isNaN(d.getTime())) return "";
  const close = new Date(d.getTime() + windowHours * 3_600_000);
  const utcMs = close.getTime() + 60 * 60 * 1000; // +01:00
  const local = new Date(utcMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    ` ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
  );
}

export function ScheduleForm({
  assessmentId,
  classId,
  className,
}: {
  assessmentId: string;
  classId: string;
  className: string;
}) {
  const [starts, setStarts] = useState("");
  const [hours, setHours] = useState("2");
  const h = Math.max(1, Number(hours) || 2);
  const closeDisplay = lagosClose(starts, h);

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <p className="text-sm font-semibold">{className}</p>
      <ActionForm action={scheduleAssessmentWindow} className="space-y-3">
        <input type="hidden" name="id" value={assessmentId} />
        <input type="hidden" name="class_id" value={classId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Opens at">
            <Input
              type="datetime-local"
              name="starts_at"
              value={starts}
              onChange={(e) => setStarts(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Window (hours)"
            hint={closeDisplay ? `Closes at ${closeDisplay}` : "How long the window stays open"}
          >
            <Input
              type="number"
              name="window_hours"
              min={1}
              max={24}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </Field>
        </div>
        <SubmitButton size="sm">Schedule</SubmitButton>
      </ActionForm>
    </div>
  );
}
