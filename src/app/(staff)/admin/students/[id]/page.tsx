import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Avatar, Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { SinglePhotoUpload } from "@/components/photo-upload";
import { can, requireAdmin } from "@/lib/auth";
import { fullName, getStructure } from "@/lib/data";
import { signPhotos } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";
import { StudentForm } from "../student-form";

export const metadata: Metadata = { title: "Student" };

export default async function StudentPage(props: PageProps<"/admin/students/[id]">) {
  const { id } = await props.params;
  const staff = await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  const { data: st } = await supabase.from("students").select("*").eq("id", id).maybeSingle();
  if (!st) notFound();
  const photos = await signPhotos([st.photo_path]);
  const classes = s.classes.filter((c) => staff.isSuperAdmin || staff.sectionIds.includes(s.sectionOfClass(c.id)?.id ?? ""));
  const manage = can(staff, "students.manage");
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        back={{ href: "/admin/students", label: "Students" }}
        title={fullName(st)}
        description={`${st.admission_no} · ${s.className(st.class_id)}`}
        actions={<LinkButton href={`/reports/student/${st.id}`} variant="secondary">Results</LinkButton>}
      />
      <Card>
        <CardHeader title="Photo" description="Shown on the exam screen so the student can confirm it's them, and to teachers." />
        <div className="flex items-center gap-6 p-5">
          <Avatar src={st.photo_path ? photos.get(st.photo_path) : null} name={fullName(st)} size={112} />
          {manage ? <SinglePhotoUpload studentId={st.id} /> : null}
        </div>
      </Card>
      {manage ? (
        <Card>
          <CardHeader title="Details" />
          <div className="p-5">
            <StudentForm classes={classes} values={st} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
