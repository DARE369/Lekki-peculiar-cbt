import type { Metadata } from "next";
import { Upload } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { StudentImport } from "./student-import";

export const metadata: Metadata = { title: "Import students" };

export default async function ImportStudentsPage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader
        icon={Upload}
        title="Import students"
        back={{ href: "/admin/students", label: "Students" }}
        description="After importing, upload photos in bulk from the Students page."
      />
      <StudentImport />
    </div>
  );
}
