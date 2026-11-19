import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, cn } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getRoundConfigs, getStructure } from "@/lib/data";
import { roundsForSection } from "@/lib/rounds";
import { ActionForm, SubmitButton } from "@/components/forms";
import { autoSortIntoRounds } from "../actions";
import { teachableSubjects } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";
import { defaultBankName, groupByUpload, type EarlierGroup } from "@/lib/banks";
import { QuestionTable, type BankQuestion } from "./question-table";
import { UploadPanel, type UploadInfo } from "./upload-panel";
import { EarlierGroupPanel } from "./earlier-group";

const PAGE_SIZE = 100;

type QuestionRow = { id: string; body: string; options: unknown; answer: string; topic: string | null; difficulty: number | null; year_id: string | null; owner_id: string; created_at: string; upload_id: string | null; round_id: string | null };

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

  // Filters: round (tabs), bank (an upload or an unnamed earlier group), search, topic.
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const topic = typeof sp.topic === "string" ? sp.topic : "";
  const roundParam = typeof sp.round === "string" ? sp.round : "";
  const bankParam = typeof sp.bank === "string" ? sp.bank : typeof sp.upload === "string" ? sp.upload : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const allRounds = await getRoundConfigs();
  const roundLabel = (id: string | null | undefined) => (id ? allRounds.find((r) => r.id === id)?.label : undefined);

  let questions: BankQuestion[] = [];
  let allIds: string[] = [];
  let total = 0;
  let topics: string[] = [];
  let banks: UploadInfo[] = [];
  let earlier: EarlierGroup[] = [];
  let allCount = 0;
  const roundCounts = new Map<string, number>();
  /** the rounds each bank has questions in, so a bank shows under every round it covers */
  const bankRounds = new Map<string, Set<string>>();
  let unsortedCount = 0;

  if (active) {
    const yearFilter = `year_id.eq.${active.yearId},year_id.is.null`;
    // Everything the teacher has for this subject and year (light columns): counts, earlier groups, "select all".
    type Light = { id: string; created_at: string; round_id: string | null; upload_id: string | null; topic: string | null; body: string };
    const light: Light[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("questions")
        .select("id, created_at, round_id, upload_id, topic, body")
        .eq("owner_id", staff.id)
        .eq("subject_id", active.subjectId)
        .eq("archived", false)
        .or(yearFilter)
        .order("created_at", { ascending: false })
        .range(from, from + 999);
      light.push(...((data ?? []) as Light[]));
      if (!data || data.length < 1000) break;
    }
    allCount = light.length;
    for (const r of light) {
      if (r.round_id) roundCounts.set(r.round_id, (roundCounts.get(r.round_id) ?? 0) + 1);
      else unsortedCount += 1;
    }
    topics = [...new Set(light.map((r) => r.topic).filter((t): t is string => Boolean(t)))].sort();
    // Older questions with no bank, split back into the uploads they came from.
    earlier = groupByUpload(light.filter((r) => !r.upload_id));

    const { data: upRows } = await supabase
      .from("question_uploads")
      .select("id, label, created_at, file_name, assessment_id, round_id, found_count, imported_count, linked_count, duplicate_count, removed_count, unreadable_count, issues, source_format")
      .eq("owner_id", staff.id)
      .eq("subject_id", active.subjectId)
      .or(yearFilter)
      .order("created_at", { ascending: false });
    const perBank = new Map<string, number>();
    for (const r of light) {
      if (!r.upload_id) continue;
      perBank.set(r.upload_id, (perBank.get(r.upload_id) ?? 0) + 1);
      if (!bankRounds.has(r.upload_id)) bankRounds.set(r.upload_id, new Set());
      bankRounds.get(r.upload_id)!.add(r.round_id ?? "none");
    }
    const testIds = [...new Set((upRows ?? []).map((u) => u.assessment_id).filter((x): x is string => Boolean(x)))];
    const titles = new Map<string, string>();
    if (testIds.length) {
      const { data } = await supabase.from("assessments").select("id, title").in("id", testIds);
      for (const t of data ?? []) titles.set(t.id as string, t.title as string);
    }
    banks = ((upRows ?? []) as unknown as Omit<UploadInfo, "count" | "testTitle">[]).map((u) => ({
      ...u,
      count: perBank.get(u.id) ?? 0,
      testTitle: u.assessment_id ? (titles.get(u.assessment_id) ?? null) : null,
    }));

    // What's in view: round tab + bank + search + topic.
    const inBank = (r: Light) => {
      if (!bankParam) return true;
      if (bankParam.startsWith("earlier:")) {
        const g = earlier.find((e) => `earlier:${e.from}` === bankParam);
        return Boolean(g && !r.upload_id && g.ids.includes(r.id));
      }
      return r.upload_id === bankParam;
    };
    const needle = q.toLowerCase();
    const view = light.filter(
      (r) =>
        (!roundParam || (roundParam === "none" ? !r.round_id : r.round_id === roundParam)) &&
        inBank(r) &&
        (!topic || r.topic === topic) &&
        (!needle || r.body.toLowerCase().includes(needle)),
    );
    total = view.length;
    allIds = view.map((r) => r.id).slice(0, 5000);
    const pageIds = view.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => r.id);
    const rows: QuestionRow[] = [];
    for (let i = 0; i < pageIds.length; i += 150) {
      const { data } = await supabase
        .from("questions")
        .select("id, body, options, answer, topic, difficulty, year_id, owner_id, created_at, upload_id, round_id")
        .in("id", pageIds.slice(i, i + 150));
      rows.push(...((data ?? []) as unknown as QuestionRow[]));
    }
    const order = new Map(pageIds.map((id, i) => [id, i]));
    rows.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
    const bankName = new Map(banks.map((b) => [b.id, b.label]));
    questions = rows.map((r) => ({
      id: r.id,
      body: r.body,
      options: r.options,
      answer: r.answer,
      topic: r.topic,
      difficulty: r.difficulty,
      autoLabel: (r.upload_id && bankName.get(r.upload_id)) || defaultBankName(active.subjectName, roundLabel(r.round_id), r.created_at),
    }));
  }

  const selectedBank = banks.find((b) => b.id === bankParam) ?? null;
  const selectedEarlier = bankParam.startsWith("earlier:") ? (earlier.find((e) => `earlier:${e.from}` === bankParam) ?? null) : null;
  const activeSection = active ? s.subjectById.get(active.subjectId)?.section_id : null;
  const sectionRounds = roundsForSection(allRounds, activeSection, true).filter((r) => r.is_active || roundCounts.has(r.id));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const base = active ? `/teach/questions?subject=${active.subjectId}&year=${active.yearId}` : "/teach/questions";
  const withParams = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    if (active) {
      p.set("subject", active.subjectId);
      p.set("year", active.yearId);
    }
    const merged = { round: roundParam || undefined, bank: bankParam || undefined, q: q || undefined, topic: topic || undefined, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/teach/questions?${p.toString()}`;
  };
  const visibleBanks = banks.filter(
    (b) =>
      (b.count > 0 || b.unreadable_count > 0 || b.id === bankParam) &&
      (!roundParam || b.id === bankParam || bankRounds.get(b.id)?.has(roundParam) || (!bankRounds.has(b.id) && b.round_id === roundParam)),
  );
  const visibleEarlier = earlier.filter((g) => !roundParam || (roundParam === "none" ? !g.roundId : g.roundId === roundParam) || `earlier:${g.from}` === bankParam);

  // Group sidebar entries by year for display
  const yearGroups = new Map<string, { yearName: string; entries: NavEntry[] }>();
  for (const e of navEntries) {
    if (!yearGroups.has(e.yearId)) yearGroups.set(e.yearId, { yearName: e.yearName, entries: [] });
    yearGroups.get(e.yearId)!.entries.push(e);
  }

  const uploadHref = active ? `/teach/questions/import?subject=${active.subjectId}&year=${active.yearId}${roundParam && roundParam !== "none" ? `&round=${roundParam}` : ""}` : "/teach/questions/import";
  const writeHref = active ? `/teach/questions/new?subject=${active.subjectId}` : "/teach/questions/new";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Question bank"
        description="Upload questions first, then make tests from them. Each upload is a bank you can name, use and reuse."
        actions={
          <>
            <LinkButton href={uploadHref}>Upload questions</LinkButton>
            <LinkButton href={writeHref} variant="secondary">
              Write one
            </LinkButton>
          </>
        }
      />

      {navEntries.length === 0 ? (
        <Card>
          <EmptyState title="No subjects yet" action={<LinkButton href="/teach/classes">Add what you teach</LinkButton>}>
            Choose the subjects and classes you teach first, then come back to add questions.
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Mobile: horizontal chip nav */}
          <div className="-mx-4 overflow-x-auto px-4 md:hidden">
            <div className="flex gap-2 pb-2">
              {navEntries.map((e) => {
                const isActive = active?.subjectId === e.subjectId && active?.yearId === e.yearId;
                return (
                  <Link
                    key={`${e.subjectId}:${e.yearId}`}
                    href={`/teach/questions?subject=${e.subjectId}&year=${e.yearId}`}
                    className={cn("shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium whitespace-nowrap", isActive ? "border-brand bg-brand-soft text-brand" : "border-border")}
                  >
                    {e.subjectName} · {e.yearName}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-start gap-6">
            <aside className="hidden w-48 shrink-0 md:block">
              <nav className="space-y-5" aria-label="Subjects">
                {[...yearGroups.entries()].map(([yearId, group]) => (
                  <div key={yearId}>
                    <p className="mb-1 text-xs font-medium text-muted">{group.yearName}</p>
                    <ul className="space-y-0.5">
                      {group.entries.map((e) => {
                        const isActive = active?.subjectId === e.subjectId && active?.yearId === e.yearId;
                        return (
                          <li key={`${e.subjectId}:${e.yearId}`}>
                            <Link
                              href={`/teach/questions?subject=${e.subjectId}&year=${e.yearId}`}
                              className={cn("block rounded-md px-3 py-2 text-sm font-medium transition-colors", isActive ? "bg-brand-soft text-brand" : "text-text hover:bg-surface-2")}
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

            <div className="min-w-0 flex-1 space-y-4">
              {active ? (
                <>
                  <div>
                    <h2 className="text-lg font-semibold">
                      {active.subjectName} <span className="font-normal text-muted">· {active.yearName}</span>
                    </h2>
                    <p className="text-sm text-muted">
                      {allCount} question{allCount === 1 ? "" : "s"} · {banks.filter((b) => b.count > 0).length} named bank{banks.filter((b) => b.count > 0).length === 1 ? "" : "s"}
                      {earlier.length ? ` · ${earlier.length} earlier upload${earlier.length === 1 ? "" : "s"} not named yet` : ""}
                    </p>
                  </div>

                  {allCount === 0 ? (
                    <Card>
                      <EmptyState
                        title="No questions here yet"
                        action={
                          <div className="flex flex-wrap justify-center gap-2">
                            <LinkButton href={uploadHref}>Upload questions</LinkButton>
                            <LinkButton href={writeHref} variant="secondary">
                              Write one
                            </LinkButton>
                          </div>
                        }
                      >
                        Upload your questions for {active.subjectName}, {active.yearName}. When they&apos;re saved you can make a test from them straight away.
                      </EmptyState>
                    </Card>
                  ) : (
                    <>
                      {/* Rounds: exam questions never mix with CA questions. */}
                      <nav aria-label="Rounds" className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border">
                        <RoundTab href={withParams({ round: undefined, bank: undefined, page: undefined })} active={!roundParam} label="All rounds" count={allCount} />
                        {sectionRounds.map((r) => (
                          <RoundTab key={r.id} href={withParams({ round: r.id, bank: undefined, page: undefined })} active={roundParam === r.id} label={r.label} count={roundCounts.get(r.id) ?? 0} />
                        ))}
                        {unsortedCount ? (
                          <RoundTab href={withParams({ round: "none", bank: undefined, page: undefined })} active={roundParam === "none"} label="Not sorted yet" count={unsortedCount} warn />
                        ) : null}
                      </nav>

                      {roundParam === "none" && unsortedCount ? (
                        <Card className="p-4 sm:p-5">
                          <p className="font-medium">
                            {unsortedCount} question{unsortedCount === 1 ? " isn't" : "s aren't"} in a round yet
                          </p>
                          <p className="mt-1 text-sm text-muted">
                            <strong className="font-medium text-text">Sort automatically</strong> puts each question that&apos;s used in a test into that test&apos;s round. For the rest, tick them and choose{" "}
                            <strong className="font-medium text-text">Move to round</strong>. Nothing changes until you do.
                          </p>
                          <ActionForm action={autoSortIntoRounds} className="mt-3">
                            <input type="hidden" name="subject_id" value={active.subjectId} />
                            <input type="hidden" name="year_id" value={active.yearId} />
                            <SubmitButton size="sm" variant="secondary">
                              Sort automatically
                            </SubmitButton>
                          </ActionForm>
                        </Card>
                      ) : null}

                      {/* Banks: every upload, and older uploads not named yet (grouped by the upload they came from). */}
                      <nav aria-label="Banks" className="flex flex-wrap gap-1.5">
                        <BankChip href={withParams({ bank: undefined, page: undefined })} active={!bankParam} label="Every bank" count={roundParam ? (roundParam === "none" ? unsortedCount : (roundCounts.get(roundParam) ?? 0)) : allCount} />
                        {visibleBanks.map((b) => (
                          <BankChip key={b.id} href={withParams({ bank: b.id, page: undefined })} active={bankParam === b.id} label={b.label} count={b.count} flag={b.unreadable_count > 0} />
                        ))}
                        {visibleEarlier.map((g) => (
                          <BankChip
                            key={g.from}
                            href={withParams({ bank: `earlier:${g.from}`, page: undefined })}
                            active={bankParam === `earlier:${g.from}`}
                            label={`Uploaded ${new Date(g.from).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}`}
                            count={g.ids.length}
                            muted
                          />
                        ))}
                      </nav>

                      {selectedBank ? (
                        <UploadPanel upload={selectedBank} subjectId={active.subjectId} yearId={active.yearId} afterDeleteHref={base} />
                      ) : selectedEarlier ? (
                        <EarlierGroupPanel
                          ids={selectedEarlier.ids}
                          from={selectedEarlier.from}
                          suggestedName={defaultBankName(active.subjectName, roundLabel(selectedEarlier.roundId), selectedEarlier.from)}
                          subjectId={active.subjectId}
                          yearId={active.yearId}
                          namedHref={base}
                        />
                      ) : null}

                      <form className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="subject" value={active.subjectId} />
                        <input type="hidden" name="year" value={active.yearId} />
                        {roundParam ? <input type="hidden" name="round" value={roundParam} /> : null}
                        {bankParam ? <input type="hidden" name="bank" value={bankParam} /> : null}
                        <Input name="q" defaultValue={q} placeholder="Search question text" aria-label="Search question text" className="h-9 w-56 text-sm" />
                        {topics.length > 0 ? (
                          <Select name="topic" defaultValue={topic} aria-label="Topic" className="h-9 w-40 text-sm">
                            <option value="">All topics</option>
                            {topics.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </Select>
                        ) : null}
                        <button type="submit" className="h-9 rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface-2">
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
                          <EmptyState title="No questions match" />
                        ) : (
                          <QuestionTable
                            key={`${roundParam}:${bankParam}:${q}:${topic}`}
                            questions={questions}
                            allIds={allIds}
                            rounds={sectionRounds.map((r) => ({ id: r.id, label: r.label }))}
                            banks={banks.map((b) => ({ id: b.id, label: b.label }))}
                            topics={topics}
                            subjectId={active.subjectId}
                            yearId={active.yearId}
                          />
                        )}
                      </Card>

                      {total > 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                          <p>{total > PAGE_SIZE ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}` : `${total} question${total === 1 ? "" : "s"}`}</p>
                          {pages > 1 ? (
                            <div className="flex gap-2">
                              {page > 1 ? (
                                <LinkButton size="sm" variant="secondary" href={withParams({ page: page - 1 })}>
                                  Previous
                                </LinkButton>
                              ) : null}
                              {page < pages ? (
                                <LinkButton size="sm" variant="secondary" href={withParams({ page: page + 1 })}>
                                  Next
                                </LinkButton>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RoundTab({ href, active, label, count, warn }: { href: string; active: boolean; label: string; count: number; warn?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("-mb-px inline-flex items-center gap-1.5 border-b-2 py-2 text-sm", active ? "border-brand font-semibold text-text" : "border-transparent text-muted hover:text-text")}
    >
      {label}
      <span className={cn("text-xs tabular-nums", warn ? "text-warning" : "text-subtle")}>{count}</span>
    </Link>
  );
}

function BankChip({ href, active, label, count, flag, muted }: { href: string; active: boolean; label: string; count: number; flag?: boolean; muted?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
        active ? "border-brand bg-brand-soft font-semibold text-brand" : muted ? "border-dashed border-border-strong text-muted hover:text-text" : "border-border bg-surface hover:border-border-strong",
      )}
    >
      <span className="truncate">{label}</span>
      <span className={cn("text-xs tabular-nums", active ? "text-brand" : "text-muted")}>{count}</span>
      {flag ? <span className="size-1.5 rounded-full bg-warning" title="Some questions in this upload couldn't be read" /> : null}
    </Link>
  );
}
