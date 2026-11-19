import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Problems" };

const AREA_LABEL: Record<string, string> = {
  "questions.import": "Uploading questions",
  action: "Saving a form",
};

type UploadIssue = { code?: string; source: string; message: string; excerpt?: string };

/**
 * Where to look when someone says "it didn't work": errors staff hit (by reference code), and uploads
 * where some questions couldn't be read, with the reason for each one.
 */
export default async function ProblemsPage(props: PageProps<"/admin/problems">) {
  const sp = await props.searchParams;
  const staff = await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  const ref = typeof sp.ref === "string" ? sp.ref.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();

  let errQuery = supabase
    .from("app_errors")
    .select("id, ref, staff_id, area, shown, message, code, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (ref) errQuery = errQuery.eq("ref", ref);
  else errQuery = errQuery.gte("created_at", since);

  const [{ data: errors }, { data: uploads }, { data: people }] = await Promise.all([
    errQuery,
    supabase
      .from("question_uploads")
      .select("id, owner_id, subject_id, year_id, label, file_name, created_at, found_count, imported_count, unreadable_count, issues")
      .gt("unreadable_count", 0)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("staff").select("id, full_name"),
  ]);
  const name = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));
  // Heads of Section only see uploads for subjects in their own sections.
  const myUploads = (uploads ?? []).filter((u) => staff.isSuperAdmin || staff.sectionIds.includes(s.subjectById.get(u.subject_id as string)?.section_id ?? ""));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Problems"
        description="When someone says something didn't work, look here. Errors are kept with the reference code the person was shown; uploads list every question that couldn't be read and why. Last 30 days."
      />

      <Card>
        <CardHeader
          title="Errors"
          description={ref ? `Showing reference ${ref}` : "Unexpected failures staff ran into"}
          actions={
            <form className="flex gap-2">
              <Input name="ref" defaultValue={ref} placeholder="Reference code" aria-label="Find a reference code" className="h-8 w-40 font-mono text-sm uppercase" />
              <button className="h-8 rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface-2">Find</button>
              {ref ? (
                <Link href="/admin/problems" className="flex h-8 items-center px-2 text-sm text-muted hover:text-text">
                  Clear
                </Link>
              ) : null}
            </form>
          }
        />
        {(errors ?? []).length === 0 ? (
          <EmptyState title={ref ? `No error with reference ${ref}` : "No errors recorded"}>
            {ref ? "Check the code with the person. Codes use letters and numbers only, without 0, O, 1 or I." : "Nothing has gone wrong in the last 30 days."}
          </EmptyState>
        ) : (
          <Table stack>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Reference</Th>
                <Th>Who</Th>
                <Th>Doing</Th>
                <Th className="w-1/2">What happened</Th>
              </tr>
            </thead>
            <tbody>
              {(errors ?? []).map((e) => (
                <tr key={e.id}>
                  <Td label="When" className="whitespace-nowrap text-muted">
                    {formatDateTime(e.created_at)}
                  </Td>
                  <Td label="Reference" className="font-mono text-sm">
                    {e.ref}
                  </Td>
                  <Td label="Who">{e.staff_id ? (name.get(e.staff_id) ?? "Former staff") : "—"}</Td>
                  <Td label="Doing">{AREA_LABEL[e.area] ?? e.area}</Td>
                  <Td label="What happened">
                    <p>{e.shown ?? "—"}</p>
                    <details className="mt-1 text-xs text-muted">
                      <summary className="cursor-pointer">Technical detail</summary>
                      <p className="mt-1 font-mono break-all">
                        {e.code ? `[${e.code}] ` : ""}
                        {e.message}
                      </p>
                      {e.detail && Object.keys(e.detail).length ? (
                        <pre className="mt-1 overflow-x-auto font-mono whitespace-pre-wrap break-all">{JSON.stringify(e.detail, null, 1)}</pre>
                      ) : null}
                    </details>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Uploads with questions that couldn't be read" description="The teacher saw these too and was asked to fix them in their file." />
        {myUploads.length === 0 ? (
          <EmptyState title="None in the last 30 days" />
        ) : (
          <ul className="divide-y divide-border">
            {myUploads.map((u) => {
              const issues = (u.issues ?? []) as UploadIssue[];
              return (
                <li key={u.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">
                      {u.label} <span className="font-normal text-muted">· {name.get(u.owner_id) ?? "Former staff"}</span>
                    </p>
                    <p className="text-sm text-muted">{formatDateTime(u.created_at)}</p>
                  </div>
                  <p className="mt-0.5 text-sm text-muted">
                    {s.subjectById.get(u.subject_id)?.name}
                    {u.year_id ? ` · ${s.yearById.get(u.year_id)?.name}` : ""}
                    {u.file_name ? ` · ${u.file_name}` : ""} · {u.found_count} in file, {u.imported_count} saved,{" "}
                    <Badge tone="warning">{u.unreadable_count} couldn&apos;t be read</Badge>
                  </p>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-brand">Why</summary>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {issues.map((i, k) => (
                        <li key={k}>
                          <span className="font-semibold">{i.source}</span>
                          {i.excerpt ? <span className="text-muted"> (&ldquo;{i.excerpt}&rdquo;)</span> : null}: {i.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
