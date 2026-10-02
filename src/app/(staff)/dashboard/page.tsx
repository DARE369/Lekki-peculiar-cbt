import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  CalendarClock,
  ClipboardCheck,
  FilePlus2,
  GraduationCap,
  MonitorSmartphone,
  PlayCircle,
  Radio,
  Upload,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  Stat,
  cn,
} from "@/components/ui";
import { can, requireStaff } from "@/lib/auth";
import { formatDateTime, getStructure } from "@/lib/data";
import {
  STATUS_LABEL,
  TYPE_LABEL,
  WINDOW_LABEL,
  windowState,
} from "@/lib/labels";
import { getQuestionSettings, getUploadProgress } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { NextSteps } from "@/components/next-steps";
import { NeedsAttention, type AttentionItem } from "./needs-attention";
import { SchoolOverview } from "./school-overview";
import { UploadChecklist } from "./upload-checklist";
import type { AssessmentStatus, AssessmentType } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

interface QuickAction {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  count?: number;
}

export default async function Dashboard(props: PageProps<"/dashboard">) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const supabase = await createClient();

  const now = new Date();
  const dayStart = new Date(now.getTime() - 12 * 3600_000).toISOString();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 3600_000).toISOString();

  const [settings, myProgress] = await Promise.all([
    getQuestionSettings(),
    getUploadProgress(s, staff.id),
  ]);
  const showChecklist =
    !staff.isSuperAdmin && (staff.role === "teacher" || myProgress.length > 0);

  const [assignments, mine, windows, pending] = await Promise.all([
    supabase
      .from("teaching_assignments")
      .select("id, subject_id, class_id, status")
      .eq("teacher_id", staff.id)
      .eq("session_id", s.currentSessionId ?? ""),
    supabase
      .from("assessments")
      .select("id, title, type, status, subject_id, year_id, updated_at")
      .eq("created_by", staff.id)
      .order("updated_at", { ascending: false })
      .limit(6),
    supabase
      .from("exam_windows")
      .select(
        "id, class_id, starts_at, ends_at, status, auto_start, assessments(title, type, subject_id)",
      )
      .gte("ends_at", dayStart)
      .lte("starts_at", weekAhead)
      .order("starts_at")
      .limit(20),
    staff.isAdmin && can(staff, "exam.approve")
      ? supabase
          .from("assessments")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_approval")
      : Promise.resolve({ count: 0 }),
  ]);

  // My tests that were flagged after approval, or sent back.
  const { data: attention } = staff.isSuperAdmin
    ? { data: [] }
    : await supabase
        .from("assessments")
        .select(
          "id, title, subject_id, status, review_note, flag_status, flag_category, flag_note, amending, corrections_submitted_at",
        )
        .eq("created_by", staff.id)
        .or("flag_status.eq.open,status.eq.changes_requested")
        .order("updated_at", { ascending: false })
        .limit(20);
  const attentionItems: AttentionItem[] = (attention ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    subject: s.subjectById.get(a.subject_id)?.name ?? "",
    kind: a.flag_status === "open" ? "flag" : "back",
    category: a.flag_category,
    note: a.flag_status === "open" ? a.flag_note : a.review_note,
    amending: Boolean(a.amending),
    correctionsSent: Boolean(a.corrections_submitted_at),
  }));
  const approved = (assignments.data ?? []).filter(
    (a) => a.status === "approved",
  );
  const requested = (assignments.data ?? []).filter(
    (a) => a.status === "requested",
  );
  type W = {
    id: string;
    class_id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    auto_start: boolean;
    assessments: {
      title: string;
      type: AssessmentType;
      subject_id: string;
    } | null;
  };
  const upcoming = ((windows.data ?? []) as unknown as W[]).filter(
    (w) =>
      !staff.isAdmin ||
      staff.isSuperAdmin ||
      staff.sectionIds.includes(s.sectionOfClass(w.class_id)?.id ?? ""),
  );
  const liveNow = upcoming.filter((w) => windowState(w) === "live");
  const awaiting = upcoming.filter((w) => windowState(w) === "awaiting_start");
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Africa/Lagos",
    }).format(now),
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = staff.fullName
    .replace(/^(Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+/i, "")
    .split(" ")[0];

  const actions: QuickAction[] = staff.isAdmin
    ? [
        ...(can(staff, "exam.approve")
          ? [
              {
                href: "/admin/approvals",
                label: "Approvals",
                hint: "Review & schedule",
                icon: ClipboardCheck,
                count: pending.count ?? 0,
              },
            ]
          : []),
        {
          href: "/admin/exams",
          label: "Live monitor",
          hint: "Start & watch exams",
          icon: Radio,
          count: liveNow.length,
        },
        {
          href: "/admin/students",
          label: "Students",
          hint: "Records & photos",
          icon: GraduationCap,
        },
        {
          href: "/reports",
          label: "Reports",
          hint: "Results & analysis",
          icon: BarChart3,
        },
        ...(can(staff, "terminals.manage")
          ? [
              {
                href: "/admin/terminals",
                label: "Lab computers",
                hint: "Exam PCs",
                icon: MonitorSmartphone,
              },
            ]
          : []),
      ]
    : [
        {
          href: "/teach/assessments/new",
          label: "New test or exam",
          hint: "Build from the bank",
          icon: FilePlus2,
        },
        {
          href: "/teach/questions/import",
          label: "Upload questions",
          hint: "Excel, text or CSV",
          icon: Upload,
        },
        {
          href: "/teach/classes",
          label: "My classes",
          hint: "Students & subjects",
          icon: UsersRound,
        },
        {
          href: "/reports",
          label: "Reports",
          hint: "Scores & analysis",
          icon: BarChart3,
        },
      ];

  return (
    <div className="space-y-8">
      {sp.done === "subjects" ? (
        <NextSteps
          title="Your subjects and classes are saved."
          steps={[
            {
              href: "/teach/questions/import",
              label: "Upload my questions",
              primary: true,
            },
            { href: "/teach/classes", label: "Change my subjects" },
          ]}
        >
          Your Head of Section has been asked to approve them, and we will email
          you when they do. You do not have to wait: you can upload questions
          now.
        </NextSteps>
      ) : null}
      {sp.done === "corrected" ? (
        <NextSteps
          title="Your corrections were sent."
          steps={[
            {
              href: "/teach/assessments",
              label: "See my tests",
              primary: true,
            },
          ]}
        >
          Your Head of Section will accept them. Until then the approved version
          stays in use.
        </NextSteps>
      ) : null}
      <NeedsAttention items={attentionItems} />
      {sp.done === "submitted" ? (
        <NextSteps
          title="Your test was sent for approval."
          steps={[
            {
              href: "/teach/assessments/new",
              label: "Create another test",
              primary: true,
            },
            { href: "/teach/assessments", label: "See my tests" },
          ]}
        >
          Your Head of Section will review it and set the exam date. We will
          email you when it is approved or if changes are needed.
        </NextSteps>
      ) : null}
      {/* Welcome banner */}
      <section className="relative overflow-hidden rounded-3xl bg-[linear-gradient(135deg,var(--panel-1),var(--panel-2)_55%,var(--panel-3))] p-7 text-white shadow-float sm:p-9">
        <div
          className="bg-grid pointer-events-none absolute inset-0 opacity-[0.1]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -top-20 -right-10 size-72 rounded-full bg-[var(--gold)]/25 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-white/70">
              {s.currentTerm
                ? `${s.currentTerm.session_name} · ${s.currentTerm.name}`
                : "No current term set"}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
              {greeting}, {firstName}
            </h1>
            <p className="mt-2 max-w-xl text-white/80">
              {liveNow.length
                ? `${liveNow.length} exam${liveNow.length === 1 ? " is" : "s are"} live right now.`
                : awaiting.length
                  ? `${awaiting.length} exam${awaiting.length === 1 ? " is" : "s are"} waiting for an administrator to press Start.`
                  : upcoming.length
                    ? `${upcoming.length} exam${upcoming.length === 1 ? "" : "s"} scheduled this week.`
                    : "No exams scheduled this week."}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {staff.isAdmin && (liveNow.length || awaiting.length) ? (
              <Link
                href={
                  awaiting[0]
                    ? `/admin/exams/${awaiting[0].id}`
                    : `/admin/exams/${liveNow[0].id}`
                }
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--gold)] px-5 text-sm font-semibold text-[#1c1400] shadow-card hover:brightness-105"
              >
                <PlayCircle className="size-4" aria-hidden />{" "}
                {awaiting.length ? "Start waiting exam" : "Open live exam"}
              </Link>
            ) : null}
            {!staff.isSuperAdmin ? (
              <Link
                href="/teach/assessments/new"
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/10 px-5 text-sm font-semibold ring-1 ring-white/25 backdrop-blur hover:bg-white/20"
              >
                <FilePlus2 className="size-4" aria-hidden /> New test or exam
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {showChecklist ? (
        <UploadChecklist
          rows={myProgress}
          s={s}
          fallbackDeadline={settings.defaultDeadline}
        />
      ) : null}

      {/* Quick actions */}
      <section
        aria-label="Quick actions"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {actions.slice(0, 4).map(({ href, label, hint, icon: Icon, count }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-float"
          >
            <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand transition-colors group-hover:bg-brand group-hover:text-brand-ink">
              <Icon className="size-6" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-semibold">
                {label}
                {count ? (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">
                    {count}
                  </span>
                ) : null}
              </span>
              <span className="block truncate text-sm text-muted">{hint}</span>
            </span>
            <ArrowRight
              className="size-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
              aria-hidden
            />
          </Link>
        ))}
      </section>

      {/* Numbers (the super admin has the school-wide overview below instead) */}
      {!staff.isSuperAdmin ? (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat
            label="Classes I teach"
            value={approved.length}
            icon={UsersRound}
            hint={
              requested.length
                ? `${requested.length} awaiting approval`
                : "This session"
            }
          />
          <Stat
            label="My tests & exams"
            value={mine.data?.length ?? 0}
            icon={BookOpenCheck}
            hint="Most recent"
          />
          <Stat
            label="Live now"
            value={liveNow.length}
            icon={Radio}
            tone={liveNow.length ? "success" : undefined}
            hint="Students writing"
          />
          <Stat
            label="Waiting for start"
            value={awaiting.length}
            icon={CalendarClock}
            tone={awaiting.length ? "warning" : undefined}
            hint={
              staff.isAdmin && can(staff, "exam.start")
                ? "You can start these"
                : "Needs an administrator"
            }
          />
        </section>
      ) : null}

      {!staff.isAdmin && approved.length === 0 && !showChecklist ? (
        <Card>
          <EmptyState
            icon={UsersRound}
            title="You haven't been assigned any classes yet"
            action={
              <LinkButton href="/teach/classes">
                Tell us what you teach
              </LinkButton>
            }
          >
            Pick the subjects and classes you teach. Your Head of Section
            approves them, then you can set questions and see results.
          </EmptyState>
        </Card>
      ) : null}

      {staff.isSuperAdmin ? <SchoolOverview s={s} /> : null}

      {!staff.isSuperAdmin ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader
              icon={CalendarClock}
              title="Exams today & this week"
              actions={
                staff.isAdmin ? (
                  <LinkButton href="/admin/exams" size="sm" variant="secondary">
                    Open monitor
                  </LinkButton>
                ) : undefined
              }
            />
            {upcoming.length === 0 ? (
              <EmptyState icon={CalendarClock} title="Nothing scheduled">
                Approved tests appear here once they have a date.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((w) => {
                  const state = windowState(w);
                  const [label, tone] = WINDOW_LABEL[state];
                  const d = new Date(w.starts_at);
                  const inner = (
                    <>
                      <span
                        className={cn(
                          "flex w-14 shrink-0 flex-col items-center rounded-xl py-1.5 text-center",
                          state === "live"
                            ? "bg-success-soft text-success"
                            : "bg-surface-2 text-muted",
                        )}
                      >
                        <span className="text-[10px] font-semibold uppercase">
                          {d.toLocaleDateString("en-NG", {
                            weekday: "short",
                            timeZone: "Africa/Lagos",
                          })}
                        </span>
                        <span className="text-lg leading-tight font-bold text-text">
                          {d.toLocaleDateString("en-NG", {
                            day: "numeric",
                            timeZone: "Africa/Lagos",
                          })}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {w.assessments?.title}
                        </span>
                        <span className="block truncate text-sm text-muted">
                          {s.className(w.class_id)} ·{" "}
                          {
                            s.subjectById.get(w.assessments?.subject_id ?? "")
                              ?.name
                          }{" "}
                          · {TYPE_LABEL[w.assessments?.type ?? "test"]} ·{" "}
                          {formatDateTime(w.starts_at).split(", ").pop()}
                        </span>
                      </span>
                      <Badge tone={tone} dot={state === "live"}>
                        {label}
                      </Badge>
                    </>
                  );
                  return (
                    <li key={w.id}>
                      {staff.isAdmin ? (
                        <Link
                          href={`/admin/exams/${w.id}`}
                          className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2/60"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-4 px-5 py-3.5">
                          {inner}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              icon={BookOpenCheck}
              title="My recent tests & exams"
              actions={
                <LinkButton
                  href="/teach/assessments"
                  size="sm"
                  variant="secondary"
                >
                  See all
                </LinkButton>
              }
            />
            {(mine.data ?? []).length === 0 ? (
              <EmptyState
                icon={FilePlus2}
                title="No tests yet"
                action={
                  <LinkButton href="/teach/assessments/new" size="sm">
                    Create one
                  </LinkButton>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {(mine.data ?? []).map((a) => {
                  const [label, tone] =
                    STATUS_LABEL[a.status as AssessmentStatus];
                  return (
                    <li key={a.id}>
                      <Link
                        href={`/teach/assessments/${a.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2/60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">
                            {a.title}
                          </span>
                          <span className="block truncate text-sm text-muted">
                            {s.subjectById.get(a.subject_id)?.name} ·{" "}
                            {s.yearById.get(a.year_id)?.name} ·{" "}
                            {TYPE_LABEL[a.type as AssessmentType]}
                          </span>
                        </span>
                        <Badge tone={tone}>{label}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
