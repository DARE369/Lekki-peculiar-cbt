import type { Metadata } from "next";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { StaffImport } from "./staff-import";

export const metadata: Metadata = { title: "Bulk add staff" };

export default async function BulkStaffPage() {
  await requireSuperAdmin();
  const s = await getStructure();
  return (
    <div>
      <PageHeader
        icon={Users}
        title="Bulk add staff"
        back={{ href: "/admin/staff", label: "Staff" }}
        description="Add all your teachers and Heads of Section from one spreadsheet. You can fine-tune anyone's access afterwards on the Staff page."
      />
      <StaffImport sectionNames={s.sections.filter((x) => x.cbt_enabled).map((x) => x.name)} />
    </div>
  );
}
