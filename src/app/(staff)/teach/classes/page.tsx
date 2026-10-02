import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { saveMySubjects, withdrawAssignment } from "../actions";
import { SubjectPicker } from "@/app/welcome/subject-picker";
import { myPicks, pickerSections } from "@/lib/assignments";
import { homeSectionOf } from "@/lib/sections";

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

  const picks = await myPicks(staff.id, s);
  const home = await homeSectionOf(staff.id);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UsersRound} title="My classes" description="Classes and subjects you teach this session. Your Head of Section approves changes." />

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
        <CardHeader
          title="Subjects and classes you teach"
          description="Tap every class you teach under each subject — as many subjects and sections as you need. Ticks on approved classes can't be removed here."
        />
        <ActionForm action={saveMySubjects} className="p-5">
          <SubjectPicker sections={pickerSections(s, home)} initial={picks.pending} locked={picks.approved} />
          <SubmitButton size="lg" className="mt-5 w-full sm:w-auto">
            Save my subjects and classes
          </SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
