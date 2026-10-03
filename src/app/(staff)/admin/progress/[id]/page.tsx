import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { SectionBadges } from "@/components/section-badges";
import { requireAdmin } from "@/lib/auth";
import { formatDeadline, getUploadProgress } from "@/lib/onboarding";
import { getStructure } from "@/lib/data";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { staffSectionMap } from "@/lib/sections";

export const metadata: Metadata = { title: "Staff progress" };

const STATUS_LABEL: Record<string, [string, "neutral" | "warning" | "info" | "success" | "danger"]> = {
  draft: ["Draft", "neutral"],
  pending_approval: ["Pending approval", "warning"],
  approved: ["Approved", "success"],
  rejected: ["Sent back", "danger"],
};

export default async function StaffProgressDetail(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  const admin = createAdminClient();

  const [{ data: person }, progress, sectionsOf] = await Promise.all([
    supabase.from("staff").select("id, full_name, email, phone, role, active, onboarded_at").eq("id", id).maybeSingle(),
    getUploadProgress(s, id),
    staffSectionMap(),
  ]);
  if (!person) notFound();

  // Last sign-in
  const { data: authUser } = await admin.auth.admin.getUserById(id);
  const lastSignIn = authUser?.user?.last_sign_in_at ?? null;

  // Tests for this teacher
  const { data: tests } = await supabase
    .from("assessments")
    .select("id, title, type, status, subject_id, year_id, question_count, created_at")
    .eq("created_by", id)
    .order("created_at", { ascending: false });

  const bySubject = new Map<string, typeof progress>();
  for (const r of progress) bySubject.set(r.subjectId, [...(bySubject.get(r.subjectId) ?? []), r]);

  const testsBySubjectYear = new Map<string, typeof tests>();
  for (const t of tests ?? []) {
    const k = `${t.subject_id}:${t.year_id}`;
    testsBySubjectYear.set(k, [...(testsBySubjectYear.get(k) ?? []), t]);
  }

  const totalQuestions = progress.reduce((n, r) => n + r.questions, 0);
  const totalTests = (tests ?? []).length;
  const pendingCount = (tests ?? []).filter((t) => t.status === "pending_approval").length;
  const approvedCount = (tests ?? []).filter((t) => t.status === "approved").length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        title={person.full_name}
        description={person.email}
        back={{ href: "/admin/progress", label: "Staff progress" }}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Questions uploaded" value={totalQuestions} />
        <Stat label="Tests created" value={totalTests} />
        <Stat label="Pending approval" value={pendingCount} />
        <Stat label="Approved" value={approvedCount} />
      </div>

      <Card>
        <CardHeader title="Profile" />
        <dl className="divide-y divide-border">
          {[
            ["Section", <SectionBadges ids={sectionsOf.get(person.id) ?? []} s={s} empty="—" key="sec" />],
            ["Role", person.role === "admin" ? "Head of Section" : "Teacher"],
            ["Last signed in", lastSignIn ? new Date(lastSignIn).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }) : "Never"],
            ["Account set up", person.onboarded_at ? new Date(person.onboarded_at).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "Not yet"],
            ["Phone", person.phone ?? "—"],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex items-start gap-4 px-5 py-3 text-sm">
              <dt className="w-36 shrink-0 text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {bySubject.size === 0 ? (
        <Card>
          <EmptyState title="No subjects yet" />
        </Card>
      ) : (
        [...bySubject.entries()].map(([subjectId, rows]) => {
          const subject = s.subjectById.get(subjectId);
          return (
            <Card key={subjectId}>
              <CardHeader
                title={subject?.name ?? subjectId}
                description={`${rows.reduce((n, r) => n + r.questions, 0)} questions across ${rows.length} year group${rows.length === 1 ? "" : "s"}`}
              />
              <Table stack>
                <thead>
                  <tr>
                    <Th>Year</Th>
                    <Th>Classes</Th>
                    <Th>Questions</Th>
                    <Th>Tests</Th>
                    <Th>Deadline</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const year = s.yearById.get(r.yearId);
                    const yearTests = testsBySubjectYear.get(`${subjectId}:${r.yearId}`) ?? [];
                    return (
                      <tr key={r.yearId}>
                        <Td className="font-medium">{year?.name ?? r.yearId}</Td>
                        <Td label="Classes" className="text-sm">
                          {r.classIds.map((cid) => s.classes.find((c) => c.id === cid)?.name ?? cid).join(", ") || "—"}
                        </Td>
                        <Td label="Questions">
                          <span className="font-semibold">{r.questions}</span>
                          {!r.approved ? <Badge tone="warning" className="ml-1.5">Awaiting approval</Badge> : null}
                        </Td>
                        <Td label="Tests">
                          {yearTests.length === 0 ? (
                            <span className="text-sm text-muted">None yet</span>
                          ) : (
                            <ul className="space-y-1">
                              {yearTests.map((t) => {
                                const [stLabel, stTone] = STATUS_LABEL[t.status] ?? ["Unknown", "neutral"];
                                return (
                                  <li key={t.id} className="text-sm">
                                    <span className="font-medium">{t.title}</span>
                                    <span className="block text-xs text-muted">{t.question_count} questions</span>
                                    <Badge tone={stTone} className="mt-0.5">{stLabel}</Badge>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </Td>
                        <Td label="Deadline" className="text-sm text-muted">
                          {r.deadline ? formatDeadline(r.deadline) : "—"}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          );
        })
      )}
    </div>
  );
}
