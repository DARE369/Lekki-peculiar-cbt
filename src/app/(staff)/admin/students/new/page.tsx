import type { Metadata } from "next";
import { UserPlus } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { StudentForm } from "../student-form";

export const metadata: Metadata = { title: "Add student" };

export default async function NewStudent() {
  const staff = await requireAdmin();
  const s = await getStructure();
  const classes = s.classes.filter((c) => c.active && (staff.isSuperAdmin || staff.sectionIds.includes(s.sectionOfClass(c.id)?.id ?? "")));
  return (
    <div className="max-w-2xl">
      <PageHeader
        icon={UserPlus} title="Add a student" back={{ href: "/admin/students", label: "Students" }} />
      <Card className="p-5">
        <StudentForm classes={classes} />
      </Card>
    </div>
  );
}
