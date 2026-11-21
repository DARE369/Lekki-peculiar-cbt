import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, CalendarRange, ChevronRight, Clock, MonitorSmartphone, School, ShieldCheck, Tag, type LucideIcon } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getRoundConfigs, getStructure } from "@/lib/data";
import { getQuestionSettings } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { SettingsNav } from "./settings-nav";
import { settingsPages, type SettingsKey } from "./sections";

export const metadata: Metadata = { title: "Settings" };

type Status = { tone: "success" | "warning" | "neutral"; text: string };

const ICONS: Record<SettingsKey, LucideIcon> = {
  overview: School,
  school: CalendarRange,
  classes: School,
  rounds: Tag,
  calendar: CalendarDays,
  approvals: ShieldCheck,
  deadlines: Clock,
  terminals: MonitorSmartphone,
};

const ABOUT: Record<SettingsKey, string> = {
  overview: "",
  school: "Sessions, terms and sections. Switch the current term at the start of each term.",
  classes: "The arms in each year group and the subjects taught.",
  rounds: "1st CA, 2nd CA, Exam… Every test and question belongs to one.",
  calendar: "When each round runs for each year group. Approving a test dates it from here.",
  approvals: "Whether teaching requests without a clash are approved straight away.",
  deadlines: "When teachers should have their questions in.",
  terminals: "The lab computers allowed to open the student exam screen.",
};

/** One place for everything that sets up how the school runs the CBT, with what still needs doing first. */
export default async function SettingsPage() {
  const staff = await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  const sections = s.sections.filter((x) => x.cbt_enabled && (staff.isSuperAdmin || staff.sectionIds.includes(x.id)));
  const sectionIds = new Set(sections.map((x) => x.id));
  const years = s.years.filter((y) => sectionIds.has(y.section_id));
  const rounds = (await getRoundConfigs()).filter((r) => r.is_active && (!r.section_ids?.length || r.section_ids.some((id) => sectionIds.has(id))));
  const [settings, { count: slots }, { count: terminals }] = await Promise.all([
    getQuestionSettings(),
    s.currentTerm
      ? supabase.from("round_schedules").select("id", { count: "exact", head: true }).eq("term_id", s.currentTerm.id).in("year_id", years.map((y) => y.id))
      : Promise.resolve({ count: 0 }),
    supabase.from("lab_terminals").select("id", { count: "exact", head: true }),
  ]);
  const classes = s.classes.filter((c) => c.active && sectionIds.has(s.sectionOfClass(c.id)?.id ?? ""));
  const subjects = s.subjects.filter((x) => x.active && sectionIds.has(x.section_id));
  const deadlinesSet = sections.filter((x) => x.question_deadline ?? settings.defaultDeadline).length;
  const autoOn = sections.filter((x) => x.auto_approve_requests !== false).length;

  const status: Record<SettingsKey, Status> = {
    overview: { tone: "neutral", text: "" },
    school: s.currentTerm ? { tone: "success", text: `Current: ${s.currentTerm.session_name} · ${s.currentTerm.name}` } : { tone: "warning", text: "No current term set" },
    classes: classes.length && subjects.length ? { tone: "success", text: `${classes.length} classes · ${subjects.length} subjects` } : { tone: "warning", text: "No classes or subjects yet" },
    rounds: rounds.length ? { tone: "success", text: `${rounds.length} in use` } : { tone: "warning", text: "No rounds yet" },
    calendar: (slots ?? 0) > 0 ? { tone: "success", text: `${slots} of ${rounds.length * years.length} dates set this term` } : { tone: "warning", text: "No exam dates this term" },
    approvals: { tone: "neutral", text: autoOn === sections.length ? "Automatic when there's no clash" : autoOn === 0 ? "Every request waits for you" : `Automatic in ${autoOn} of ${sections.length} sections` },
    deadlines: deadlinesSet === sections.length ? { tone: "success", text: "Set" } : { tone: "warning", text: deadlinesSet ? `Set for ${deadlinesSet} of ${sections.length} sections` : "Not set" },
    terminals: (terminals ?? 0) > 0 ? { tone: "success", text: `${terminals} registered` } : { tone: "warning", text: "No computers registered" },
  };
  const pages = settingsPages(staff).filter((p) => p.key !== "overview");
  const todo = pages.filter((p) => status[p.key].tone === "warning");

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" description="Everything that sets up how the school runs the CBT, in one place." />
      <SettingsNav staff={staff} active="overview" />
      {todo.length ? (
        <Card className="animate-enter mb-6 border-warning/50 bg-warning-soft/40 p-4 sm:p-5">
          <p className="font-semibold text-warning">
            {todo.length} thing{todo.length === 1 ? "" : "s"} to set up
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {todo.map((p) => (
              <li key={p.key}>
                <Link href={p.href} className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-surface px-3 py-1.5 text-sm font-medium hover:border-warning">
                  {p.label}: {status[p.key].text.toLowerCase()} <ChevronRight className="size-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <ul className="stagger grid gap-3 sm:grid-cols-2">
        {pages.map((p) => {
          const Icon = ICONS[p.key];
          const st = status[p.key];
          return (
            <li key={p.key}>
              <Link
                href={p.href}
                className="group flex h-full gap-3 rounded-lg border border-border bg-surface p-4 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-sm"
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 font-semibold">
                    {p.label}
                    <ChevronRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">{ABOUT[p.key]}</span>
                  <span className="mt-2 block">
                    <Badge tone={st.tone} dot>
                      {st.text}
                    </Badge>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
