import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { can, requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { createTerminalCode, updateTerminal } from "../actions";

export const metadata: Metadata = { title: "Lab computers" };

export default async function TerminalsPage() {
  const staff = await requireAdmin();
  const supabase = await createClient();
  const { data: terminals } = await supabase.from("lab_terminals").select("*").order("name");
  const manage = can(staff, "terminals.manage");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lab computers"
        description="Only registered computers can open the student exam screen. This keeps exams in the lab and stops logins from home."
      />
      <Card>
        <CardHeader title="Register computers" />
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Create a registration code below (valid for a few hours, works on any number of computers).</li>
            <li>
              On each lab computer, open <strong>/exam</strong> on this website. It will ask for the code and a name for the computer (e.g. “Lab 1 – PC 14”).
            </li>
            <li>Bookmark the page or set it as the browser&apos;s home page. Done — the computer stays registered.</li>
          </ol>
          {manage ? (
            <ActionForm action={createTerminalCode} className="space-y-3">
              <Field label="Code valid for (hours)">
                <Input name="hours" type="number" min={1} max={72} defaultValue={8} className="w-28" />
              </Field>
              <SubmitButton>Create registration code</SubmitButton>
            </ActionForm>
          ) : (
            <Alert tone="warning">You need the “Register lab computers” permission.</Alert>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title={`Registered computers (${(terminals ?? []).length})`} />
        {(terminals ?? []).length === 0 ? (
          <EmptyState title="None yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Registered</Th>
                <Th>Last seen</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(terminals ?? []).map((t) => (
                <tr key={t.id}>
                  <Td>
                    {manage ? (
                      <form action={updateTerminal} className="flex gap-2">
                        <input type="hidden" name="id" value={t.id} />
                        <Input name="name" defaultValue={t.name} className="h-8 w-48" />
                        <button className="text-xs text-brand">Rename</button>
                      </form>
                    ) : (
                      t.name
                    )}
                  </Td>
                  <Td className="text-xs">{formatDateTime(t.registered_at)}</Td>
                  <Td className="text-xs">{formatDateTime(t.last_seen_at)}</Td>
                  <Td>{t.active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Blocked</Badge>}</Td>
                  <Td className="text-right">
                    {manage ? (
                      <form action={updateTerminal}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="active" value={String(!t.active)} />
                        <button className="text-xs text-muted hover:text-danger">{t.active ? "Block" : "Unblock"}</button>
                      </form>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
