import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log" };

const LABELS: Record<string, string> = {
  "assessment.submit": "Submitted a test for approval",
  "assessment.approve": "Approved a test",
  "assessment.request_changes": "Asked for changes",
  "assessment.reopen": "Reopened a test for editing",
  "assessment.correct_key": "Corrected an answer key",
  "window.schedule": "Scheduled an exam",
  "window.start": "Started an exam",
  "window.resume": "Resumed an exam",
  "window.pause": "Paused an exam",
  "window.close": "Closed an exam",
  "window.delete": "Removed a scheduled exam",
  "window.extend_time": "Gave extra time",
  "exception.makeup": "Granted a make-up",
  "exception.relogin_unlock": "Unlocked a re-login",
  "attempt.void": "Voided an attempt",
  "assignment.approve": "Approved a teaching assignment",
  "assignment.reject": "Declined a teaching assignment",
  "term.set_current": "Changed the current term",
  "terminal.code_created": "Created a lab registration code",
  "terminal.registered": "Registered a lab computer",
  "staff.created": "Added a staff member",
  "staff.updated": "Changed a staff member's access",
  "setup.super_admin": "Completed first-time setup",
};

export default async function AuditPage(props: PageProps<"/admin/audit">) {
  const sp = await props.searchParams;
  const staff = await requireAdmin();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_log")
    .select("id, actor_id, action, entity, entity_id, detail, created_at")
    .order("created_at", { ascending: false })
    .range(page * 100, page * 100 + 99);
  const { data: staffRows } = await supabase.from("staff").select("id, full_name");
  const names = new Map((staffRows ?? []).map((r) => [r.id, r.full_name]));
  return (
    <div className="space-y-6">
      <PageHeader
        icon={ScrollText}
        title="Audit log"
        description={staff.isSuperAdmin ? "Every privileged action in the system. Entries can't be edited or deleted." : "Your own privileged actions. The super admin sees everyone's."}
      />
      <Card>
        {(data ?? []).length === 0 ? (
          <EmptyState title="Nothing recorded" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>What</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.id}>
                  <Td className="text-xs whitespace-nowrap">{formatDateTime(r.created_at)}</Td>
                  <Td>{r.actor_id ? (names.get(r.actor_id) ?? "Unknown") : "System"}</Td>
                  <Td>{LABELS[r.action] ?? r.action}</Td>
                  <Td className="max-w-md truncate font-mono text-xs text-muted" title={JSON.stringify(r.detail)}>
                    {r.detail ? JSON.stringify(r.detail) : ""}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <div className="flex gap-3 text-sm">
        {page > 0 ? <a href={`?page=${page - 1}`} className="text-brand">← Newer</a> : null}
        {(data ?? []).length === 100 ? <a href={`?page=${page + 1}`} className="text-brand">Older →</a> : null}
      </div>
    </div>
  );
}
