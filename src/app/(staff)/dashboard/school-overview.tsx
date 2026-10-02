import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Layers, Radio, Users } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, Stat, cn } from "@/components/ui";
import type { Structure } from "@/lib/data";
import { windowState } from "@/lib/labels";
import { daysUntil, deadlineForSection, getQuestionSettings, getUploadProgress } from "@/lib/onboarding";
import { flagLabel } from "@/lib/readiness";
import { loadReviewTests } from "@/lib/review-data";
import { staffSectionMap } from "@/lib/sections";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const DAY = 86_400_000;
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : 0);

/** Super admin: how the whole school is doing — tests by stage, each section, class-by-subject coverage and what needs attention. */
export async function SchoolOverview({ s }: { s: Structure }) {
  const supabase = await createClient();
  const termId = s.currentTerm?.id ?? "";
  const [tests, progress, settings, sectionsOf, drafts, windowsRes, sat, staffRes, usersRes, assignmentsRes] = await Promise.all([
    loadReviewTests(s),
    getUploadProgress(s, null),
    getQuestionSettings(),
    staffSectionMap(),
    supabase.from("assessments").select("id", { count: "exact", head: true }).eq("term_id", termId).eq("status", "draft"),
    supabase.from("exam_windows").select("id, assessment_id, class_id, status, starts_at, ends_at, auto_start").limit(1000),
    supabase.from("attempts").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    supabase.from("staff").select("id, role, active, onboarded_at, full_name").eq("active", true).neq("role", "super_admin"),
    createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from("teaching_assignments").select("teacher_id, subject_id, class_id").eq("status", "approved").eq("session_id", s.currentSessionId ?? "").limit(5000),
  ]);

  // Tests by stage.
  const pending = tests.filter((t) => t.status === "pending_approval");
  const approved = tests.filter((t) => t.status === "approved");
  const flagged = tests.filter((t) => t.flag?.status === "open");
  const windows = (windowsRes.data ?? []) as { id: string; assessment_id: string; class_id: string; status: string; starts_at: string; ends_at: string; auto_start: boolean }[];
  const testIds = new Set(tests.map((t) => t.id));
  const termWindows = windows.filter((w) => testIds.has(w.assessment_id));
  const live = termWindows.filter((w) => ["live", "paused"].includes(windowState(w)));
  const waiting = termWindows.filter((w) => windowState(w) === "awaiting_start");
  const weekAhead = new Date().getTime() + 7 * DAY;
  const thisWeek = termWindows.filter((w) => windowState(w) === "scheduled" && Date.parse(w.starts_at) <= weekAhead);
  const titleOf = new Map(tests.map((t) => [t.id, t.title]));

  // Teachers, sign-ins and who has finished.
  const lastSignIn = new Map((usersRes.data?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]));
  const staff = (staffRes.data ?? []) as { id: string; role: string; onboarded_at: string | null; full_name: string }[];
  const teachers = staff.filter((p) => p.role === "teacher");
  const neverSignedIn = staff.filter((p) => !lastSignIn.get(p.id));
  const byTeacher = new Map<string, typeof progress>();
  for (const r of progress) byTeacher.set(r.teacherId, [...(byTeacher.get(r.teacherId) ?? []), r]);
  const finished = (id: string) => (byTeacher.get(id) ?? []).length > 0 && (byTeacher.get(id) ?? []).every((r) => r.testsSubmitted > 0);

  const cbtSections = s.sections.filter((x) => x.cbt_enabled);
  const sectionData = await Promise.all(
    cbtSections.map(async (sec) => {
      const subjectIds = s.subjects.filter((x) => x.section_id === sec.id).map((x) => x.id);
      const { count: questions } = subjectIds.length
        ? await supabase.from("questions").select("id", { count: "exact", head: true }).in("subject_id", subjectIds).eq("archived", false)
        : { count: 0 };
      const inSec = (id: string) => (sectionsOf.get(id) ?? []).includes(sec.id);
      const myTeachers = teachers.filter((t) => inSec(t.id));
      const myTests = tests.filter((t) => s.subjectById.get(t.subjectId)?.section_id === sec.id);
      const deadline = deadlineForSection(sec.id, s, settings);
      const left = deadline ? daysUntil(deadline) : null;
      return {
        sec,
        questions: questions ?? 0,
        teachers: myTeachers.length,
        setUp: myTeachers.filter((t) => t.onboarded_at).length,
        finished: myTeachers.filter((t) => finished(t.id)).length,
        submitted: myTests.length,
        approved: myTests.filter((t) => t.status === "approved").length,
        flagged: myTests.filter((t) => t.flag?.status === "open").length,
        deadline,
        left,
        behind: left !== null && left < 0 ? myTeachers.filter((t) => !finished(t.id)).length : 0,
      };
    }),
  );

  // Coverage: for every approved teaching assignment (class × subject), is there a test, and is it scheduled?
  const assignments = (assignmentsRes.data ?? []) as { teacher_id: string; subject_id: string; class_id: string }[];
  type Cell = "scheduled" | "approved" | "pending" | "none";
  const rank: Record<Cell, number> = { scheduled: 3, approved: 2, pending: 1, none: 0 };
  const cellFor = (subjectId: string, classId: string): Cell => {
    let best: Cell = "none";
    for (const t of tests) {
      if (t.subjectId !== subjectId || !t.classIds.includes(classId)) continue;
      const c: Cell = t.status === "approved" ? (t.windows.some((w) => w.classId === classId) ? "scheduled" : "approved") : t.status === "pending_approval" ? "pending" : "none";
      if (rank[c] > rank[best]) best = c;
    }
    return best;
  };
  const pairs = new Map<string, { classId: string; subjectId: string }>();
  for (const a of assignments) pairs.set(`${a.class_id}:${a.subject_id}`, { classId: a.class_id, subjectId: a.subject_id });
  const cells = [...pairs.values()].map((p) => ({ ...p, state: cellFor(p.subjectId, p.classId) }));
  const gaps = cells.filter((c) => c.state === "none").length;
  const classesWithAssignments = [...new Set(cells.map((c) => c.classId))].sort(
    (a, b) => (s.yearById.get(s.classById.get(a)?.year_id ?? "")?.level ?? 0) - (s.yearById.get(s.classById.get(b)?.year_id ?? "")?.level ?? 0) || s.className(a).localeCompare(s.className(b)),
  );
  const CELL: Record<Cell, string> = {
    scheduled: "bg-success-soft text-success border-success/30",
    approved: "bg-info-soft text-info border-info/30",
    pending: "bg-warning-soft text-warning border-warning/30",
    none: "bg-danger-soft text-danger border-danger/30",
  };

  // Needs attention.
  const attention: { text: string; href: string; tone: "danger" | "warning" }[] = [];
  const slow = pending.filter((t) => daysSince(t.submittedAt) >= 3);
  if (slow.length) attention.push({ text: `${slow.length} test${slow.length === 1 ? " has" : "s have"} waited 3 days or more for approval`, href: "/admin/approvals", tone: "danger" });
  if (flagged.length) attention.push({ text: `${flagged.length} flagged test${flagged.length === 1 ? " is" : "s are"} still waiting for corrections`, href: "/admin/approvals", tone: "warning" });
  const oldFlags = flagged.filter((t) => daysSince(t.flag?.flaggedAt ?? null) >= 7);
  if (oldFlags.length) attention.push({ text: `${oldFlags.length} flag${oldFlags.length === 1 ? " has" : "s have"} been open for a week or more`, href: "/admin/approvals", tone: "danger" });
  for (const d of sectionData.filter((x) => x.behind > 0)) attention.push({ text: `${d.behind} ${d.sec.name} teacher${d.behind === 1 ? " is" : "s are"} past the deadline and not finished`, href: "/admin/progress", tone: "danger" });
  if (gaps) attention.push({ text: `${gaps} class-and-subject pair${gaps === 1 ? " has" : "s have"} no test yet`, href: "/admin/approvals", tone: "warning" });
  const unscheduled = approved.filter((t) => t.windows.length === 0);
  if (unscheduled.length) attention.push({ text: `${unscheduled.length} approved test${unscheduled.length === 1 ? " has" : "s have"} no exam date`, href: "/admin/approvals", tone: "warning" });
  if (neverSignedIn.length) attention.push({ text: `${neverSignedIn.length} staff haven't signed in yet`, href: "/admin/progress?show=invited", tone: "warning" });
  const noSection = teachers.filter((t) => !(sectionsOf.get(t.id)?.length)).length;
  if (noSection) attention.push({ text: `${noSection} teacher${noSection === 1 ? " is" : "s are"} not in a section yet`, href: "/admin/staff?section=none", tone: "warning" });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Drafts" value={drafts.count ?? 0} hint="being written" />
        <Stat label="Awaiting approval" value={pending.length} tone={pending.length ? "warning" : undefined} />
        <Stat label="Approved" value={approved.length} tone="success" />
        <Stat label="Flagged" value={flagged.length} tone={flagged.length ? "warning" : undefined} hint="need corrections" />
        <Stat label="Live now" value={live.length} tone={live.length ? "success" : undefined} hint={waiting.length ? `${waiting.length} waiting to start` : undefined} />
        <Stat label="This week" value={thisWeek.length} hint="exams scheduled" />
        <Stat label="Sittings done" value={sat.count ?? 0} hint="students' attempts" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={AlertTriangle} title="Needs your attention" description={attention.length ? undefined : "Nothing is stuck right now."} />
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-success">
              <CheckCircle2 className="size-4" aria-hidden /> All clear.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {attention.map((a) => (
                <li key={a.text}>
                  <Link href={a.href} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-2/60">
                    <span>{a.text}</span>
                    <Badge tone={a.tone}>Open</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader icon={Radio} title="Live and next up" />
          {live.length + waiting.length + thisWeek.length === 0 ? (
            <EmptyState title="No exams running or scheduled this week" />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {[...live.map((w) => ({ w, label: "Live", tone: "success" as const })), ...waiting.map((w) => ({ w, label: "Waiting to start", tone: "warning" as const })), ...thisWeek.slice(0, 6).map((w) => ({ w, label: "Scheduled", tone: "info" as const }))].slice(0, 8).map(({ w, label, tone }) => (
                <li key={w.id}>
                  <Link href={`/admin/exams/${w.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-2/60">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{titleOf.get(w.assessment_id)}</span>
                      <span className="block truncate text-xs text-muted">{s.className(w.class_id)}</span>
                    </span>
                    <Badge tone={tone} dot={label === "Live"}>
                      {label}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {sectionData.map((d) => (
          <Card key={d.sec.id}>
            <CardHeader
              icon={Users}
              title={d.sec.name}
              description={
                d.deadline
                  ? `Deadline ${new Date(`${d.deadline}T12:00:00+01:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })}${d.left === null ? "" : d.left < 0 ? " — passed" : d.left === 0 ? " — today" : ` — ${d.left} days left`}`
                  : "No deadline set"
              }
              actions={
                <Link href={`/admin/progress?section=${d.sec.id}`} className="text-sm font-semibold text-brand hover:underline">
                  Staff progress
                </Link>
              }
            />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 pb-5 text-sm">
              {[
                ["Teachers set up", `${d.setUp} of ${d.teachers}`],
                ["Teachers finished", `${d.finished} of ${d.teachers}`],
                ["Questions uploaded", String(d.questions)],
                ["Tests sent", String(d.submitted)],
                ["Tests approved", String(d.approved)],
                ["Flagged", String(d.flagged)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-semibold tracking-wide text-muted uppercase">{k}</dt>
                  <dd className="text-lg font-bold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          icon={Layers}
          title="Test coverage by class"
          description="Every subject a class is being taught, coloured by where its test has got to."
          actions={
            <Link href="/admin/approvals" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
              <ClipboardCheck className="size-4" aria-hidden /> Open approvals
            </Link>
          }
        />
        <div className="flex flex-wrap gap-2 px-5 pb-3 text-xs">
          {([["scheduled", "Scheduled"], ["approved", "Approved, no date"], ["pending", "Awaiting approval"], ["none", "No test yet"]] as [Cell, string][]).map(([k, label]) => (
            <span key={k} className={cn("rounded-full border px-2.5 py-1 font-semibold", CELL[k])}>
              {label}
            </span>
          ))}
        </div>
        {classesWithAssignments.length === 0 ? (
          <EmptyState title="No approved subject assignments yet">Once Heads of Section approve what teachers teach, each class appears here.</EmptyState>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {classesWithAssignments.map((classId) => (
              <li key={classId} className="px-5 py-3">
                <p className="mb-2 text-sm font-semibold">{s.className(classId)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {cells
                    .filter((c) => c.classId === classId)
                    .sort((a, b) => (s.subjectById.get(a.subjectId)?.name ?? "").localeCompare(s.subjectById.get(b.subjectId)?.name ?? ""))
                    .map((c) => (
                      <span key={c.subjectId} className={cn("rounded-lg border px-2.5 py-1 text-xs font-medium", CELL[c.state])}>
                        {s.subjectById.get(c.subjectId)?.name}
                      </span>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {flagged.length ? (
        <Card>
          <CardHeader title="Flagged tests" description="Approved, but waiting for the teacher's corrections." />
          <ul className="divide-y divide-border border-t border-border">
            {flagged.slice(0, 8).map((t) => (
              <li key={t.id}>
                <Link href="/admin/approvals" className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-2/60">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {s.subjectById.get(t.subjectId)?.name} · {t.teacherName} · {flagLabel(t.flag?.category)}
                    </span>
                  </span>
                  <Badge tone="warning">{t.flag?.correctionsSubmittedAt ? "Corrections sent" : "Waiting"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
