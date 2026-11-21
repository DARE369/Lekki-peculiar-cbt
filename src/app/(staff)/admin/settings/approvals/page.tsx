import type { Metadata } from "next";
import { ActionForm } from "@/components/forms";
import { AutoSwitch } from "@/components/switch";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui";
import { can, requireAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { SettingsNav } from "../settings-nav";
import { setAutoApprove } from "./actions";

export const metadata: Metadata = { title: "Approval rules" };

export default async function ApprovalRulesPage() {
  const staff = await requireAdmin();
  const s = await getStructure();
  const editable = can(staff, "teachers.manage");
  const sections = s.sections.filter((x) => x.cbt_enabled && (staff.isSuperAdmin || staff.sectionIds.includes(x.id)));
  return (
    <div className="max-w-3xl">
      <PageHeader title="Approval rules" description="Part of Settings. Changes apply to the sections you look after." />
      <SettingsNav staff={staff} active="approvals" />
      <div className="space-y-6">
        {!editable ? <Alert tone="info">Only staff who can approve teaching assignments can change these.</Alert> : null}
        <Card>
          <CardHeader
            title="Teaching requests"
            description="When a teacher picks a subject and class that no other teacher has (or has asked for), there is nothing to decide. You can let those through straight away. Clashes always wait for you, and you can remove anything from Approvals → Teaching requests."
          />
          <ul className="divide-y divide-border">
            {sections.map((sec) => (
              <li key={sec.id} className="px-5 py-4">
                <ActionForm action={setAutoApprove} className="flex flex-wrap items-center justify-between gap-3">
                  <input type="hidden" name="section_id" value={sec.id} />
                  <div className="min-w-0">
                    <p className="font-semibold">{sec.name}</p>
                    <p className="text-sm text-muted">
                      {sec.auto_approve_requests === false ? "Every request waits for the Head of Section." : "Requests without a clash are approved straight away."}
                    </p>
                  </div>
                  <AutoSwitch
                    name="auto_approve"
                    defaultChecked={sec.auto_approve_requests !== false}
                    label={`Approve automatically in ${sec.name}`}
                    disabled={!editable}
                  />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
