import type { Metadata } from "next";
import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { teachableSubjects } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";
import type { QuestionOption } from "@/lib/types";
import { archiveQuestion } from "../actions";

export const metadata: Metadata = { title: "Question bank" };

const DIFF = ["", "Easy", "Medium", "Hard"];

export default async function QuestionBank(props: PageProps<"/teach/questions">) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const subjects = await teachableSubjects(staff, s, { includeRequested: true });
  const subjectId = typeof sp.subject === "string" && subjects.some((x) => x.id === sp.subject) ? sp.subject : subjects[0]?.id;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const topic = typeof sp.topic === "string" ? sp.topic : "";

  const supabase = await createClient();
  let query = supabase
    .from("questions")
    .select("id, body, options, answer, topic, difficulty, year_id, owner_id, created_at, staff:owner_id(full_name)")
    .eq("subject_id", subjectId ?? "")
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .limit(300);
  if (q) query = query.ilike("body", `%${q}%`);
  if (topic) query = query.eq("topic", topic);
  const { data: questions } = subjectId ? await query : { data: [] };
  const { data: topicRows } = subjectId
    ? await supabase.from("questions").select("topic").eq("subject_id", subjectId).eq("archived", false).not("topic", "is", null)
    : { data: [] };
  const topics = [...new Set((topicRows ?? []).map((t) => t.topic as string))].sort();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileQuestion}
        title="Question bank"
        description="Questions are shared by all teachers of the same subject, so good questions get reused."
        actions={
          <>
            <LinkButton href={`/teach/questions/import${subjectId ? `?subject=${subjectId}` : ""}`}>Upload questions</LinkButton>
            <LinkButton href={`/teach/questions/new${subjectId ? `?subject=${subjectId}` : ""}`} variant="secondary">
              Add one
            </LinkButton>
          </>
        }
      />
      {subjects.length === 0 ? (
        <Card>
          <EmptyState title="No subjects yet" action={<LinkButton href="/teach/classes">Add what you teach</LinkButton>}>
            Choose the subjects and classes you teach first — you can start adding questions straight away.
          </EmptyState>
        </Card>
      ) : (
        <>
          <form className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-xs text-muted">Subject</span>
              <Select name="subject" defaultValue={subjectId} className="w-56">
                {subjects.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({s.sectionById.get(x.section_id)?.name})
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-muted">Topic</span>
              <Select name="topic" defaultValue={topic} className="w-48">
                <option value="">All topics</option>
                {topics.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-muted">Search</span>
              <Input name="q" defaultValue={q} placeholder="Words in the question" className="w-64" />
            </label>
            <button className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-surface-2">Filter</button>
          </form>

          <Card>
            {(questions ?? []).length === 0 ? (
              <EmptyState title="No questions found" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th className="w-1/2">Question</Th>
                    <Th>Answer</Th>
                    <Th>Topic</Th>
                    <Th>Year</Th>
                    <Th>Added by</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {(questions ?? []).map((row) => {
                    const opts = row.options as QuestionOption[];
                    const correct = opts.find((o) => o.key === row.answer);
                    const owner = row.staff as unknown as { full_name: string } | null;
                    return (
                      <tr key={row.id}>
                        <Td>
                          <Link href={`/teach/questions/${row.id}`} className="line-clamp-2 hover:underline">
                            {row.body}
                          </Link>
                          <span className="text-xs text-muted">{opts.length} options</span>
                        </Td>
                        <Td>
                          <Badge tone="success">{row.answer}</Badge>{" "}
                          <span className="text-xs text-muted">{correct?.text.slice(0, 30)}</span>
                        </Td>
                        <Td className="text-xs">
                          {row.topic ?? "—"}
                          {row.difficulty ? <span className="block text-muted">{DIFF[row.difficulty]}</span> : null}
                        </Td>
                        <Td className="text-xs">{row.year_id ? s.yearById.get(row.year_id)?.name : "Any"}</Td>
                        <Td className="text-xs">{owner?.full_name}</Td>
                        <Td className="text-right">
                          {row.owner_id === staff.id || staff.isAdmin ? (
                            <form action={archiveQuestion}>
                              <input type="hidden" name="id" value={row.id} />
                              <button className="text-xs text-muted hover:text-danger">Archive</button>
                            </form>
                          ) : null}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          <p className="text-xs text-muted">{(questions ?? []).length} questions shown (max 300).</p>
        </>
      )}
    </div>
  );
}
