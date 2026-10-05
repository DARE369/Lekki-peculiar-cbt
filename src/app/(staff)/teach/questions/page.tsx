import type { Metadata } from "next";
import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui";
import { NextSteps } from "@/components/next-steps";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { teachableSubjects } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";
import type { QuestionOption } from "@/lib/types";
import { deleteQuestion } from "../actions";

type QuestionRow = { id: string; body: string; options: unknown; answer: string; topic: string | null; difficulty: number | null; year_id: string | null; owner_id: string; created_at: string };

export const metadata: Metadata = { title: "Question bank" };

const DIFF = ["", "Easy", "Medium", "Hard"];

type NavEntry = { subjectId: string; subjectName: string; yearId: string; yearName: string; yearLevel: number };

export default async function QuestionBank(props: PageProps<"/teach/questions">) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const supabase = await createClient();
  const subjects = await teachableSubjects(staff, s, { includeRequested: true });
  const subjectIdSet = new Set(subjects.map((x) => x.id));

  // Build sidebar navigation: (subject, year) pairs this teacher works with
  const navEntries: NavEntry[] = [];
  const seen = new Set<string>();

  if (staff.isAdmin || staff.isSuperAdmin) {
    for (const sub of subjects) {
      const sectionClasses = s.classes.filter((c) => c.active && s.sectionOfClass(c.id)?.id === sub.section_id);
      const yearIds = [...new Set(sectionClasses.map((c) => c.year_id))];
      for (const yearId of yearIds) {
        const year = s.yearById.get(yearId);
        if (!year) continue;
        const key = `${sub.id}:${yearId}`;
        if (!seen.has(key)) {
          seen.add(key);
          navEntries.push({ subjectId: sub.id, subjectName: sub.name, yearId, yearName: year.name, yearLevel: year.level });
        }
      }
    }
  } else {
    const { data: assignments } = await supabase
      .from("teaching_assignments")
      .select("subject_id, class_id")
      .eq("teacher_id", staff.id)
      .eq("session_id", s.currentSessionId ?? "")
      .in("status", ["approved", "requested"]);
    for (const asgn of assignments ?? []) {
      if (!subjectIdSet.has(asgn.subject_id)) continue;
      const cls = s.classById.get(asgn.class_id);
      if (!cls) continue;
      const year = s.yearById.get(cls.year_id);
      if (!year) continue;
      const sub = subjects.find((x) => x.id === asgn.subject_id);
      if (!sub) continue;
      const key = `${asgn.subject_id}:${cls.year_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        navEntries.push({ subjectId: asgn.subject_id, subjectName: sub.name, yearId: cls.year_id, yearName: year.name, yearLevel: year.level });
      }
    }
  }

  navEntries.sort((a, b) => a.yearLevel - b.yearLevel || a.subjectName.localeCompare(b.subjectName));

  // Determine active selection from URL params
  const spSubject = typeof sp.subject === "string" ? sp.subject : undefined;
  const spYear = typeof sp.year === "string" ? sp.year : undefined;
  const active =
    navEntries.find((e) => e.subjectId === spSubject && e.yearId === spYear) ??
    navEntries[0];

  // Per-entry filters
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const topic = typeof sp.topic === "string" ? sp.topic : "";

  // Fetch questions for active entry
  let questions: QuestionRow[] = [];
  let topics: string[] = [];
  if (active) {
    let qQuery = supabase
      .from("questions")
      .select("id, body, options, answer, topic, difficulty, year_id, owner_id, created_at")
      .eq("subject_id", active.subjectId)
      .eq("owner_id", staff.id)
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(300);
    qQuery = qQuery.or(`year_id.eq.${active.yearId},year_id.is.null`);
    if (q) qQuery = qQuery.ilike("body", `%${q}%`);
    if (topic) qQuery = qQuery.eq("topic", topic);
    const { data } = await qQuery;
    questions = (data ?? []) as unknown as QuestionRow[];

    const { data: tRows } = await supabase
      .from("questions")
      .select("topic")
      .eq("subject_id", active.subjectId)
      .eq("owner_id", staff.id)
      .eq("archived", false)
      .or(`year_id.eq.${active.yearId},year_id.is.null`)
      .not("topic", "is", null);
    topics = [...new Set((tRows ?? []).map((t) => t.topic as string))].sort();
  }

  // Group sidebar entries by year for display
  const yearGroups = new Map<string, { yearName: string; entries: NavEntry[] }>();
  for (const e of navEntries) {
    if (!yearGroups.has(e.yearId)) yearGroups.set(e.yearId, { yearName: e.yearName, entries: [] });
    yearGroups.get(e.yearId)!.entries.push(e);
  }

  const uploadHref = active
    ? `/teach/questions/import?subject=${active.subjectId}&year=${active.yearId}`
    : "/teach/questions/import";
  const writeHref = active ? `/teach/questions/new?subject=${active.subjectId}` : "/teach/questions/new";

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileQuestion}
        title="Question bank"
        description="Your questions, organised by class and subject."
        actions={
          <>
            <LinkButton href={uploadHref}>Upload questions</LinkButton>
            <LinkButton href={writeHref} variant="secondary">Write one</LinkButton>
          </>
        }
      />

      {sp.added || sp.updated ? (
        <NextSteps
          title={sp.updated ? "Question saved." : `Added ${Number(sp.added) || 1} question${Number(sp.added) === 1 || !Number(sp.added) ? "" : "s"}.`}
          steps={[
            { href: active ? `/teach/assessments/new?subject=${active.subjectId}&year=${active.yearId}` : "/teach/assessments/new", label: "Create a test with these questions", primary: true },
            { href: uploadHref, label: "Upload more questions" },
          ]}
        >
          {Number(sp.skipped) ? `${Number(sp.skipped)} duplicate${Number(sp.skipped) === 1 ? " was" : "s were"} left out. ` : ""}
          They are in the list below. Open any question to edit it.
        </NextSteps>
      ) : null}

      {navEntries.length === 0 ? (
        <Card>
          <EmptyState title="No subjects yet" action={<LinkButton href="/teach/classes">Add what you teach</LinkButton>}>
            Choose the subjects and classes you teach first — then come back to add questions.
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Mobile: horizontal chip nav */}
          <div className="md:hidden -mx-4 overflow-x-auto px-4">
            <div className="flex gap-2 pb-2">
              {navEntries.map((e) => {
                const isActive = active?.subjectId === e.subjectId && active?.yearId === e.yearId;
                return (
                  <Link
                    key={`${e.subjectId}:${e.yearId}`}
                    href={`/teach/questions?subject=${e.subjectId}&year=${e.yearId}`}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                      isActive ? "border-brand bg-brand-soft text-brand" : "border-border",
                    )}
                  >
                    {e.subjectName} · {e.yearName}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-start gap-6">
            {/* Desktop sidebar */}
            <aside className="hidden md:block w-48 shrink-0">
              <nav className="space-y-5">
                {[...yearGroups.entries()].map(([yearId, group]) => (
                  <div key={yearId}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{group.yearName}</p>
                    <ul className="space-y-0.5">
                      {group.entries.map((e) => {
                        const isActive = active?.subjectId === e.subjectId && active?.yearId === e.yearId;
                        return (
                          <li key={`${e.subjectId}:${e.yearId}`}>
                            <Link
                              href={`/teach/questions?subject=${e.subjectId}&year=${e.yearId}`}
                              className={cn(
                                "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                isActive
                                  ? "bg-brand-soft text-brand"
                                  : "text-text hover:bg-surface-2",
                              )}
                            >
                              {e.subjectName}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </nav>
            </aside>

            {/* Main content */}
            <div className="min-w-0 flex-1 space-y-4">
              {active ? (
                <>
                  {/* Header + filters */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">{active.subjectName}</h2>
                      <p className="text-sm text-muted">{active.yearName}</p>
                    </div>
                    <form className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="subject" value={active.subjectId} />
                      <input type="hidden" name="year" value={active.yearId} />
                      {topics.length > 0 ? (
                        <Select name="topic" defaultValue={topic} className="h-9 w-36 text-sm">
                          <option value="">All topics</option>
                          {topics.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </Select>
                      ) : null}
                      <Input name="q" defaultValue={q} placeholder="Search questions…" className="h-9 w-48 text-sm" />
                      <button type="submit" className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-surface-2">
                        Search
                      </button>
                      {(q || topic) ? (
                        <Link href={`/teach/questions?subject=${active.subjectId}&year=${active.yearId}`} className="h-9 flex items-center px-2 text-sm text-muted hover:text-text">
                          Clear
                        </Link>
                      ) : null}
                    </form>
                  </div>

                  <Card>
                    {questions.length === 0 ? (
                      <EmptyState
                        title={q || topic ? "No questions match your filters" : "No questions here yet"}
                        action={
                          !q && !topic ? (
                            <LinkButton href={uploadHref}>Upload questions</LinkButton>
                          ) : undefined
                        }
                      />
                    ) : (
                      <Table stack>
                        <thead>
                          <tr>
                            <Th className="w-1/2">Question</Th>
                            <Th>Answer</Th>
                            <Th>Topic</Th>
                            <Th />
                          </tr>
                        </thead>
                        <tbody>
                          {questions.map((r) => {
                            const opts = r.options as QuestionOption[];
                            const correct = opts.find((o) => o.key === r.answer);
                            return (
                              <tr key={r.id}>
                                <Td>
                                  <Link href={`/teach/questions/${r.id}`} className="line-clamp-2 hover:underline">
                                    {r.body}
                                  </Link>
                                  <span className="text-xs text-muted">{opts.length} options</span>
                                </Td>
                                <Td label="Answer">
                                  <Badge tone="success">{r.answer}</Badge>{" "}
                                  <span className="text-xs text-muted">{correct?.text.slice(0, 30)}</span>
                                </Td>
                                <Td label="Topic" className="text-xs">
                                  {r.topic ?? "—"}
                                  {r.difficulty ? <span className="block text-muted">{DIFF[r.difficulty]}</span> : null}
                                </Td>
                                <Td className="cell-actions text-right max-md:text-left">
                                  <form action={deleteQuestion}>
                                    <input type="hidden" name="id" value={r.id} />
                                    <button type="submit" className="text-xs text-muted hover:text-danger">
                                      Delete
                                    </button>
                                  </form>
                                </Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    )}
                  </Card>

                  {questions.length > 0 ? (
                    <p className="text-xs text-muted">
                      {questions.length} question{questions.length === 1 ? "" : "s"}
                      {questions.length === 300 ? " (showing first 300)" : ""}.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
