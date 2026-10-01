import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, ClipboardList } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, Stat, Table, Td, Th, cn } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { formatDeadline, getQuestionSettings, getUploadProgress, type ProgressRow } from "@/lib/onboarding";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resendInvite, saveDeadlines } from "./actions";

export const metadata: Metadata = { title: "Staff progress" };

type Stage = "invited" | "setup" | "no_subjects" | "uploading" | "done" | "ready";
const STAGE: Record<Stage, [string, "neutral" | "warning" | "info" | "success" | "danger"]> = {
  invited: ["Not signed in yet", "danger"],
  setup: ["Setting up", "warning"],
  no_subjects: ["No subjects chosen", "warning"],
  uploading: ["Uploading questions", "info"],
  done: ["All questions in", "success"],
  ready: ["Set up", "success"],
};
const FILTERS: [string, string][] = [
  ["all", "Everyone"],
  ["invited", "Not signed in"],
  ["behind", "Still to finish"],
  ["done", "Finished"],
];

export default async function ProgressPage(props: PageProps<"/admin/progress">) {
  const me = await requireAdmin();
  const sp = await props.searchParams;
  const s = await getStructure();
  const supabase = await createClient();
  const [settings, progress, { data: staffRows }] = await Promise.all([
    getQuestionSettings(),
    getUploadProgress(s, null),
    supabase.from("staff").select("id, full_name, email, phone, role, active, onboarded_at").eq("active", true).neq("role", "super_admin").order("full_name"),
  ]);

  // Last sign-in comes from the auth service (server-side only).
  const lastSignIn = new Map<string, string | null>();
  const admin = createAdminClient();
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    for (const u of data?.users ?? []) lastSignIn.set(u.id, u.last_sign_in_at ?? null);
    if ((data?.users.length ?? 0) < 1000) break;
  }

  const byTeacher = new Map<string, ProgressRow[]>();
  for (const r of progress) byTeacher.set(r.teacherId, [...(byTeacher.get(r.teacherId) ?? []), r]);

  // Heads of Section see teachers working in their sections, plus teachers who haven't chosen anything yet.
  // (upload_progress only returns rows for the viewer's sections.)
  let people = staffRows ?? [];
  if (!me.isSuperAdmin) {
    const { data: anyChoice } = await admin
      .from("teaching_assignments")
      .select("teacher_id")
      .eq("session_id", s.currentSessionId ?? "")
      .in("status", ["requested", "approved"]);
    const chose = new Set((anyChoice ?? []).map((x) => x.teacher_id as string));
    people = people.filter((p) => p.id === me.id || byTeacher.has(p.id) || (p.role === "teacher" && !chose.has(p.id)));
  }
  const rows = people.map((p) => {
    const mine = byTeacher.get(p.id) ?? [];
    const signedIn = lastSignIn.get(p.id) ?? null;
    const stage: Stage = !signedIn
      ? "invited"
      : !p.onboarded_at
        ? "setup"
        : mine.length === 0
          ? p.role === "admin"
            ? "ready"
            : "no_subjects"
          : mine.every((r) => r.done)
            ? "done"
            : "uploading";
    return { ...p, mine, signedIn, stage };
  });
  const filter = typeof sp.show === "string" ? sp.show : "all";
  const shown = rows.filter((r) =>
    filter === "invited" ? r.stage === "invited" : filter === "behind" ? r.stage !== "done" && r.stage !== "ready" : filter === "done" ? r.stage === "done" || r.stage === "ready" : true,
  );
  const teachers = rows.filter((r) => r.role !== "admin" || r.mine.length);
  const cbtSections = s.sections.filter((x) => x.cbt_enabled && (me.isSuperAdmin || me.sectionIds.includes(x.id)));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        title="Staff progress"
        description="Who has signed in, chosen their subjects and uploaded their questions — and the deadlines they're working to."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Signed in" value={`${rows.filter((r) => r.signedIn).length} / ${rows.length}`} />
        <Stat label="Finished setup" value={`${rows.filter((r) => r.onboarded_at).length} / ${rows.length}`} />
        <Stat label="Waiting for approval" value={progress.filter((r) => !r.approved).length} hint="subject & year groups" />
        <Stat label="All questions in" value={`${teachers.filter((r) => r.stage === "done").length} / ${teachers.length}`} hint="teachers" />
      </div>

      <Card>
        <CardHeader
          icon={CalendarClock}
          title="Question deadlines"
          description={`The date teachers should finish uploading. A section date overrides the school date for that section.${me.isSuperAdmin ? "" : " You can set the date for your section."}`}
        />
        <ActionForm action={saveDeadlines} className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {me.isSuperAdmin ? (
              <>
                <Field label="Whole school">
                  <Input name="school_deadline" type="date" defaultValue={settings.defaultDeadline ?? ""} />
                </Field>
                <Field label="Questions per subject" hint="For each subject and year group a teacher teaches.">
                  <Input name="questions_per_subject" type="number" min={1} max={500} defaultValue={settings.perSubject} required />
                </Field>
              </>
            ) : null}
            {cbtSections.map((sec) => (
              <Field key={sec.id} label={sec.name} hint={me.isSuperAdmin ? "Leave empty to use the school date." : undefined}>
                <Input name={`section_${sec.id}`} type="date" defaultValue={sec.question_deadline ?? ""} />
              </Field>
            ))}
          </div>
          <SubmitButton variant="secondary">Save deadlines</SubmitButton>
        </ActionForm>
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-4" role="tablist" aria-label="Show">
          {FILTERS.map(([key, label]) => (
            <Link
              key={key}
              href={key === "all" ? "/admin/progress" : `/admin/progress?show=${key}`}
              role="tab"
              aria-selected={filter === key}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-semibold",
                filter === key ? "border-brand bg-brand text-white" : "border-border hover:border-brand",
              )}
            >
              {label}
            </Link>
          ))}
        </div>
        {shown.length === 0 ? (
          <EmptyState title="Nobody here" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Staff member</Th>
                <Th>Status</Th>
                <Th>Subjects & questions</Th>
                <Th className="w-40" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const [label, tone] = STAGE[r.stage];
                return (
                  <tr key={r.id} className="align-top">
                    <Td>
                      <span className="font-medium">{r.full_name}</span>
                      {r.role === "admin" ? <Badge tone="info" className="ml-2">Head of Section</Badge> : null}
                      <span className="block text-xs text-muted">{r.email}</span>
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} className="block text-xs font-medium text-brand hover:underline">
                          {r.phone}
                        </a>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge tone={tone} dot>
                        {label}
                      </Badge>
                      <span className="mt-1 block text-xs text-muted">
                        {r.signedIn ? `Last signed in ${new Date(r.signedIn).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })}` : "Invitation not used yet"}
                      </span>
                    </Td>
                    <Td>
                      {r.mine.length === 0 ? (
                        <span className="text-sm text-muted">—</span>
                      ) : (
                        <ul className="space-y-1.5">
                          {r.mine.map((p) => (
                            <li key={`${p.subjectId}:${p.yearId}`} className="text-sm">
                              <span className="font-medium">{s.subjectById.get(p.subjectId)?.name}</span>{" "}
                              <span className="text-muted">· {s.yearById.get(p.yearId)?.name}</span>{" "}
                              <span className={cn("font-semibold", p.done ? "text-success" : "text-text")}>
                                {p.questions}/{p.target}
                              </span>
                              {!p.approved ? (
                                <Badge tone="warning" className="ml-1.5">
                                  awaiting approval
                                </Badge>
                              ) : null}
                              {p.deadline && !p.done ? <span className="ml-1.5 text-xs text-muted">due {formatDeadline(p.deadline)}</span> : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td>
                      {r.stage === "invited" ? (
                        <ActionForm action={resendInvite}>
                          <input type="hidden" name="id" value={r.id} />
                          <SubmitButton size="sm" variant="secondary" pendingText="Sending…">
                            Resend invitation
                          </SubmitButton>
                        </ActionForm>
                      ) : r.mine.some((p) => !p.approved) ? (
                        <Link href="/admin/assignments" className="text-sm font-semibold text-brand hover:underline">
                          Approve subjects →
                        </Link>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
