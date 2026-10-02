import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, ClipboardList } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, Stat, Table, Td, Th, cn } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { formatDeadline, getQuestionSettings, getUploadProgress, type ProgressRow } from "@/lib/onboarding";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { staffSectionMap } from "@/lib/sections";
import { SectionBadges } from "@/components/section-badges";
import { resendInvite, saveDeadlines } from "./actions";
import { Readiness } from "./readiness";

export const metadata: Metadata = { title: "Staff progress" };

type Stage = "invited" | "setup" | "no_subjects" | "no_questions" | "uploading" | "done" | "ready";
const STAGE: Record<Stage, [string, "neutral" | "warning" | "info" | "success" | "danger"]> = {
  invited: ["Not signed in yet", "danger"],
  setup: ["Setting up", "warning"],
  no_subjects: ["No subjects chosen", "warning"],
  no_questions: ["No questions yet", "warning"],
  uploading: ["Adding questions", "info"],
  done: ["Tests sent for approval", "success"],
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
  const [settings, progress, sectionsOf, { data: staffRows }] = await Promise.all([
    getQuestionSettings(),
    getUploadProgress(s, null),
    staffSectionMap(),
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

  // Row-level security already limits Heads of Section to the staff of their own section(s); this also keeps
  // anyone with subject choices in their sections visible.
  let people = staffRows ?? [];
  if (!me.isSuperAdmin) {
    people = people.filter(
      (p) => p.id === me.id || byTeacher.has(p.id) || (sectionsOf.get(p.id) ?? []).some((sec) => me.sectionIds.includes(sec)),
    );
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
          : mine.every((r) => r.testsSubmitted > 0)
            ? "done"
            : mine.some((r) => r.questions > 0)
              ? "uploading"
              : "no_questions";
    return { ...p, mine, signedIn, stage };
  });
  const filter = typeof sp.show === "string" ? sp.show : "all";
  const sectionFilter = typeof sp.section === "string" ? sp.section : "";
  const href = (show: string, section: string) => {
    const q = new URLSearchParams();
    if (show !== "all") q.set("show", show);
    if (section) q.set("section", section);
    return q.size ? `/admin/progress?${q}` : "/admin/progress";
  };
  const inSection = rows.filter((r) => (!sectionFilter ? true : (sectionsOf.get(r.id) ?? []).includes(sectionFilter)));
  const shown = inSection.filter((r) =>
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

      {me.isSuperAdmin ? <Readiness s={s} schoolDeadline={settings.defaultDeadline} /> : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Signed in" value={`${rows.filter((r) => r.signedIn).length} / ${rows.length}`} />
        <Stat label="Finished setup" value={`${rows.filter((r) => r.onboarded_at).length} / ${rows.length}`} />
        <Stat label="Waiting for approval" value={progress.filter((r) => !r.approved).length} hint="subject & year groups" />
        <Stat label="Tests sent for approval" value={`${teachers.filter((r) => r.stage === "done").length} / ${teachers.length}`} hint="teachers with a test for every subject & year" />
      </div>

      <Card>
        <CardHeader
          icon={CalendarClock}
          title="Deadlines"
          description={`The date teachers should have their questions uploaded and tests sent for approval. A section date overrides the school date for that section.${me.isSuperAdmin ? "" : " You can set the date for your section."}`}
        />
        <ActionForm action={saveDeadlines} className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {me.isSuperAdmin ? (
              <Field label="Whole school">
                <Input name="school_deadline" type="date" defaultValue={settings.defaultDeadline ?? ""} />
              </Field>
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
        <div className="space-y-3 border-b border-border p-4">
          {cbtSections.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Section">
              {[["", "All sections"], ...cbtSections.map((x) => [x.id, x.name])].map(([key, label]) => (
                <Link
                  key={key}
                  href={href(filter, key)}
                  role="tab"
                  aria-selected={sectionFilter === key}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-sm font-semibold",
                    sectionFilter === key ? "border-accent bg-accent-soft text-text" : "border-border hover:border-accent",
                  )}
                >
                  {label}
                </Link>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Show">
            {FILTERS.map(([key, label]) => (
              <Link
                key={key}
                href={href(key, sectionFilter)}
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
        </div>
        {shown.length === 0 ? (
          <EmptyState title="Nobody here" />
        ) : (
          <Table stack>
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
                const questions = r.mine.reduce((n, p) => n + p.questions, 0);
                const sent = r.mine.reduce((n, p) => n + p.testsSubmitted, 0);
                // One line per subject: "Year 1 · 0, Year 2 · 4 …" instead of one line per subject and year.
                const bySubject = new Map<string, ProgressRow[]>();
                for (const p of r.mine) bySubject.set(p.subjectId, [...(bySubject.get(p.subjectId) ?? []), p]);
                const waiting = r.mine.some((p) => !p.approved);
                return (
                  <tr key={r.id} className="align-top">
                    <Td>
                      <span className="font-medium">{r.full_name}</span>
                      {r.role === "admin" ? <Badge tone="info" className="ml-2">Head of Section</Badge> : null}
                      <span className="mt-1 block">
                        <SectionBadges ids={sectionsOf.get(r.id) ?? []} s={s} empty="" />
                      </span>
                      <span className="block text-xs break-all text-muted">{r.email}</span>
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} className="block text-xs font-medium text-brand hover:underline">
                          {r.phone}
                        </a>
                      ) : null}
                    </Td>
                    <Td label="Status">
                      <Badge tone={tone} dot>
                        {label}
                      </Badge>
                      <span className="mt-1 block text-xs text-muted">
                        {r.signedIn ? `Last signed in ${new Date(r.signedIn).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })}` : "Invitation not used yet"}
                      </span>
                    </Td>
                    <Td label="Subjects">
                      {r.mine.length === 0 ? (
                        <span className="text-sm text-muted">—</span>
                      ) : (
                        <details className="group">
                          <summary className="cursor-pointer list-none text-sm">
                            <span className="font-semibold">
                              {bySubject.size} subject{bySubject.size === 1 ? "" : "s"}
                            </span>
                            <span className="text-muted">
                              {" "}
                              · {questions} question{questions === 1 ? "" : "s"}
                              {sent ? ` · ${sent} test${sent === 1 ? "" : "s"} sent` : ""}
                            </span>
                            {waiting ? <Badge tone="warning" className="ml-1.5">awaiting approval</Badge> : null}
                            <span className="ml-1.5 text-xs font-semibold text-brand group-open:hidden">Show</span>
                            <span className="ml-1.5 hidden text-xs font-semibold text-brand group-open:inline">Hide</span>
                          </summary>
                          <ul className="mt-2 space-y-2">
                            {[...bySubject].map(([subjectId, list]) => (
                              <li key={subjectId} className="text-sm">
                                <span className="font-medium">{s.subjectById.get(subjectId)?.name}</span>
                                <span className="block text-xs text-muted">
                                  {list
                                    .map(
                                      (p) =>
                                        `${s.yearById.get(p.yearId)?.name} · ${p.questions}${p.testsSubmitted ? " ✓" : ""}${p.approved ? "" : " (waiting)"}`,
                                    )
                                    .join("  ·  ")}
                                </span>
                                {list.some((p) => p.deadline && !p.testsSubmitted) ? (
                                  <span className="block text-xs text-muted">due {formatDeadline(list.find((p) => p.deadline)!.deadline!)}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </Td>
                    <Td className="cell-actions">
                      {r.stage === "invited" ? (
                        <ActionForm action={resendInvite}>
                          <input type="hidden" name="id" value={r.id} />
                          <SubmitButton size="sm" variant="secondary" pendingText="Sending…">
                            Resend invitation
                          </SubmitButton>
                        </ActionForm>
                      ) : waiting ? (
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
