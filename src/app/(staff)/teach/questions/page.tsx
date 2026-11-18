import type { Metadata } from "next";
import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, cn } from "@/components/ui";
import { NextSteps } from "@/components/next-steps";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { teachableSubjects } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";
import { QuestionBulkTable } from "./bulk-delete";
import { UploadPanel, type UploadInfo } from "./upload-panel";

const PAGE_SIZE = 100;

type QuestionRow = { id: string; body: string; options: unknown; answer: string; topic: string | null; difficulty: number | null; year_id: string | null; owner_id: string; created_at: string };

export const metadata: Metadata = { title: "Question bank" };

type NavEntry = { subjectId: string; subjectName: string; yearId: string; yearName: string; yearLevel: number };

export default async function QuestionBank(props: PageProps<"/teach/questions">) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const supabase = await createClient();
  const subjects = await teachableSubjects(staff, s, { includeRequested: true });
  const subjectIdSet = new Set(subjects.map((x) => x.id));

  // Build sidebar navigation from this staff member's own teaching assignments.
  // The question bank is personal (owner_id = staff.id), so the sidebar always
  // reflects what this specific person teaches — even for admins.
  const navEntries: NavEntry[] = [];
  const seen = new Set<string>();

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
  const uploadParam = typeof sp.upload === "string" ? sp.upload : "";
  const page = Math.max(1, Number(sp.page) || 1);

  let questions: QuestionRow[] = [];
  let total = 0;
  let topics: string[] = [];
  let uploads: UploadInfo[] = [];
  let untrackedCount = 0;
  let allCount = 0;
  if (active) {
    const yearFilter = `year_id.eq.${active.yearId},year_id.is.null`;
    const [upRes, untrackedRes, allRes, tRows] = await Promise.all([
      supabase
        .from("question_uploads")
        .select("id, label, created_at, file_name, assessment_id, found_count, imported_count, linked_count, duplicate_count, removed_count, unreadable_count, issues, questions(count)")
        .eq("owner_id", staff.id)
        .eq("subject_id", active.subjectId)
        .or(yearFilter)
        .eq("questions.archived", false)
        .order("created_at", { ascending: false }),
      supabase.from("questions").select("id", { count: "exact", head: true }).eq("owner_id", staff.id).eq("subject_id", active.subjectId).eq("archived", false).or(yearFilter).is("upload_id", null),
      supabase.from("questions").select("id", { count: "exact", head: true }).eq("owner_id", staff.id).eq("subject_id", active.subjectId).eq("archived", false).or(yearFilter),
      supabase.from("questions").select("topic").eq("subject_id", active.subjectId).eq("owner_id", staff.id).eq("archived", false).or(yearFilter).not("topic", "is", null),
    ]);
    untrackedCount = untrackedRes.count ?? 0;
    allCount = allRes.count ?? 0;
    topics = [...new Set((tRows.data ?? []).map((t) => t.topic as string))].sort();

    type UpRow = Omit<UploadInfo, "count" | "testTitle"> & { questions: { count: number }[] };
    const upRows = (upRes.data ?? []) as unknown as UpRow[];
    const testIds = [...new Set(upRows.map((u) => u.assessment_id).filter((x): x is string => Boolean(x)))];
    const titles = new Map<string, string>();
    if (testIds.length) {
      const { data } = await supabase.from("assessments").select("id, title").in("id", testIds);
      for (const t of data ?? []) titles.set(t.id as string, t.title as string);
    }
    uploads = upRows.map(({ questions: qc, ...u }) => ({
      ...u,
      count: qc?.[0]?.count ?? 0,
      testTitle: u.assessment_id ? (titles.get(u.assessment_id) ?? null) : null,
    }));

    let qQuery = supabase
      .from("questions")
      .select("id, body, options, answer, topic, difficulty, year_id, owner_id, created_at", { count: "exact" })
      .eq("subject_id", active.subjectId)
      .eq("owner_id", staff.id)
      .eq("archived", false)
      .or(yearFilter)
      .order("created_at", { ascending: uploadParam !== "" && uploadParam !== "none" })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (uploadParam === "none") qQuery = qQuery.is("upload_id", null);
    else if (uploadParam) qQuery = qQuery.eq("upload_id", uploadParam);
    if (q) qQuery = qQuery.ilike("body", `%${q.replace(/[%_]/g, "\\$&")}%`);
    if (topic) qQuery = qQuery.eq("topic", topic);
    const { data, count } = await qQuery;
    questions = (data ?? []) as unknown as QuestionRow[];
    total = count ?? questions.length;
  }
  const selectedUpload = uploads.find((u) => u.id === uploadParam) ?? null;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const base = active ? `/teach/questions?subject=${active.subjectId}&year=${active.yearId}` : "/teach/questions";
  const withParams = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    if (active) {
      p.set("subject", active.subjectId);
      p.set("year", active.yearId);
    }
    const merged = { upload: uploadParam || undefined, q: q || undefined, topic: topic || undefined, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/teach/questions?${p.toString()}`;
  };

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
                      "shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium whitespace-nowrap",
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
                    <p className="mb-1 text-xs font-semibold text-muted">{group.yearName}</p>
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
                  <div>
                    <h2 className="text-lg font-semibold">
                      {active.subjectName} <span className="font-normal text-muted">· {active.yearName}</span>
                    </h2>
                    <p className="text-sm text-muted">
                      {allCount} question{allCount === 1 ? "" : "s"} in {uploads.filter((u) => u.count > 0).length} upload{uploads.filter((u) => u.count > 0).length === 1 ? "" : "s"}
                      {untrackedCount ? `, plus ${untrackedCount} added earlier` : ""}
                    </p>
                  </div>

                  {/* Uploads: every file or paste is its own set */}
                  <nav aria-label="Uploads" className="-mx-1 flex flex-wrap gap-1.5 px-1">
                    <UploadTab href={withParams({ upload: undefined, page: undefined })} active={!uploadParam} label="All questions" count={allCount} />
                    {uploads.filter((u) => u.count > 0 || u.unreadable_count > 0 || u.id === uploadParam).map((u) => (
                      <UploadTab
                        key={u.id}
                        href={withParams({ upload: u.id, page: undefined })}
                        active={uploadParam === u.id}
                        label={u.label}
                        count={u.count}
                        flag={u.unreadable_count > 0}
                      />
                    ))}
                    {untrackedCount ? (
                      <UploadTab href={withParams({ upload: "none", page: undefined })} active={uploadParam === "none"} label="Added earlier" count={untrackedCount} />
                    ) : null}
                  </nav>

                  {selectedUpload ? (
                    <UploadPanel
                      upload={selectedUpload}
                      useHref={`/teach/assessments/new?subject=${active.subjectId}&year=${active.yearId}&upload=${selectedUpload.id}`}
                      afterDeleteHref={base}
                    />
                  ) : uploadParam === "none" ? (
                    <p className="text-sm text-muted">
                      Questions added before uploads were named, or typed in one at a time. They work exactly like the rest.
                    </p>
                  ) : null}

                  <form className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="subject" value={active.subjectId} />
                    <input type="hidden" name="year" value={active.yearId} />
                    {uploadParam ? <input type="hidden" name="upload" value={uploadParam} /> : null}
                    <Input name="q" defaultValue={q} placeholder="Search question text" aria-label="Search question text" className="h-9 w-56 text-sm" />
                    {topics.length > 0 ? (
                      <Select name="topic" defaultValue={topic} aria-label="Topic" className="h-9 w-40 text-sm">
                        <option value="">All topics</option>
                        {topics.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </Select>
                    ) : null}
                    <button type="submit" className="h-9 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-2">
                      Search
                    </button>
                    {q || topic ? (
                      <Link href={withParams({ q: undefined, topic: undefined, page: undefined })} className="flex h-9 items-center px-2 text-sm text-muted hover:text-text">
                        Clear
                      </Link>
                    ) : null}
                  </form>

                  <Card>
                    {questions.length === 0 ? (
                      <EmptyState
                        title={q || topic ? "No questions match your search" : "No questions here yet"}
                        action={!q && !topic ? <LinkButton href={uploadHref}>Upload questions</LinkButton> : undefined}
                      />
                    ) : (
                      <QuestionBulkTable key={`${uploadParam}:${page}:${q}:${topic}`} questions={questions} />
                    )}
                  </Card>

                  {total > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                      <p>
                        {total > PAGE_SIZE
                          ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`
                          : `${total} question${total === 1 ? "" : "s"}`}
                      </p>
                      {pages > 1 ? (
                        <div className="flex gap-2">
                          {page > 1 ? <LinkButton size="sm" variant="secondary" href={withParams({ page: page - 1 })}>Previous</LinkButton> : null}
                          {page < pages ? <LinkButton size="sm" variant="secondary" href={withParams({ page: page + 1 })}>Next</LinkButton> : null}
                        </div>
                      ) : null}
                    </div>
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

function UploadTab({ href, active, label, count, flag }: { href: string; active: boolean; label: string; count: number; flag?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
        active ? "border-brand bg-brand-soft font-semibold text-brand" : "border-border bg-surface hover:border-border-strong",
      )}
    >
      <span className="truncate">{label}</span>
      <span className={cn("tabular-nums text-xs", active ? "text-brand" : "text-muted")}>{count}</span>
      {flag ? <span className="size-1.5 rounded-full bg-warning" title="Some questions in this upload couldn't be read" /> : null}
    </Link>
  );
}
