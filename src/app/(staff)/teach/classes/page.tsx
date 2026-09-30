import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, EmptyState, Field, PageHeader, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { requestAssignments, withdrawAssignment } from "../actions";

export const metadata: Metadata = { title: "My classes" };

export default async function MyClasses() {
  const staff = await requireStaff();
  const s = await getStructure();
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("teaching_assignments")
    .select("id, subject_id, class_id, status")
    .eq("teacher_id", staff.id)
    .eq("session_id", s.currentSessionId ?? "");

  const approved = (rows ?? []).filter((r) => r.status === "approved");
  const pending = (rows ?? []).filter((r) => r.status !== "approved");
  const byClass = new Map<string, string[]>();
  for (const r of approved) byClass.set(r.class_id, [...(byClass.get(r.class_id) ?? []), r.subject_id]);

  const cbtSections = s.sections.filter((x) => x.cbt_enabled);

  return (
    <div className="space-y-6">
      <PageHeader title="My classes" description="Classes and subjects you teach this session. Your Head of Section approves changes." />

      {byClass.size === 0 ? (
        <Card>
          <EmptyState title="No approved classes yet">Use the form below to tell us what you teach.</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...byClass.entries()]
            .sort((a, b) => s.className(a[0]).localeCompare(s.className(b[0]), undefined, { numeric: true }))
            .map(([classId, subjects]) => (
              <Link key={classId} href={`/teach/classes/${classId}`}>
                <Card className="h-full p-5 transition hover:border-brand">
                  <p className="text-xs text-muted">{s.sectionOfClass(classId)?.name}</p>
                  <p className="text-lg font-semibold">{s.className(classId)}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {subjects.map((id) => (
                      <Badge key={id} tone="brand">
                        {s.subjectById.get(id)?.name}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-4 text-sm text-brand">See students →</p>
                </Card>
              </Link>
            ))}
        </div>
      )}

      {pending.length ? (
        <Card>
          <CardHeader title="Requests" description="Waiting for, or declined by, your Head of Section." />
          <ul className="divide-y divide-border">
            {pending.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  {s.subjectById.get(r.subject_id)?.name} — {s.className(r.class_id)}
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={r.status === "requested" ? "warning" : "danger"}>
                    {r.status === "requested" ? "Awaiting approval" : "Declined"}
                  </Badge>
                  {r.status === "requested" ? (
                    <form action={withdrawAssignment}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-xs text-muted hover:underline">Withdraw</button>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Add a subject you teach" description="Pick one subject, then tick every class you teach it to." />
        <ActionForm action={requestAssignments} className="space-y-5 p-5" resetOnSuccess>
          <Field label="Subject">
            <Select name="subject_id" required defaultValue="">
              <option value="" disabled>
                Choose a subject…
              </option>
              {cbtSections.map((sec) => (
                <optgroup key={sec.id} label={sec.name}>
                  {s.subjects
                    .filter((x) => x.section_id === sec.id && x.active)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          {cbtSections.map((sec) => {
            const classes = s.classes.filter((c) => c.active && s.sectionOfClass(c.id)?.id === sec.id);
            return (
              <fieldset key={sec.id}>
                <legend className="mb-2 text-sm font-medium">{sec.name} classes</legend>
                {classes.length === 0 ? (
                  <p className="text-sm text-muted">No classes created yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {classes.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-brand has-checked:bg-brand-soft">
                        <input type="checkbox" name="class_id" value={c.id} className="accent-[var(--brand)]" />
                        {c.name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            );
          })}
          <SubmitButton>Send for approval</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
