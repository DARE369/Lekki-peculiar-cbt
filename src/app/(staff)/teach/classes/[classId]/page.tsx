import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import { notFound } from "next/navigation";
import { Avatar, Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fullName, getStructure } from "@/lib/data";
import { signPhotos } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Class" };

export default async function ClassPage(props: PageProps<"/teach/classes/[classId]">) {
  const { classId } = await props.params;
  const staff = await requireStaff();
  const s = await getStructure();
  const cls = s.classById.get(classId);
  if (!cls) notFound();
  const supabase = await createClient();
  const [{ data: students }, { data: mine }] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_no, first_name, last_name, other_names, gender, photo_path")
      .eq("class_id", classId)
      .eq("active", true)
      .order("last_name"),
    supabase
      .from("teaching_assignments")
      .select("subject_id")
      .eq("teacher_id", staff.id)
      .eq("class_id", classId)
      .eq("status", "approved"),
  ]);
  const photos = await signPhotos((students ?? []).map((x) => x.photo_path));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UsersRound}
        back={{ href: "/teach/classes", label: "My classes" }}
        title={cls.name}
        description={`${s.sectionOfClass(classId)?.name} · ${(students ?? []).length} students`}
        actions={<LinkButton href={`/reports/class/${classId}`}>Class results</LinkButton>}
      />
      <div className="flex flex-wrap gap-1.5">
        {(mine ?? []).map((m) => (
          <Badge key={m.subject_id} tone="brand">
            {s.subjectById.get(m.subject_id)?.name}
          </Badge>
        ))}
      </div>
      <Card>
        <CardHeader title="Students" description="Photos help you confirm who is who during exams." />
        {(students ?? []).length === 0 ? (
          <EmptyState title="No students in this class yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Admission no.</Th>
                <Th className="text-right">Results</Th>
              </tr>
            </thead>
            <tbody>
              {(students ?? []).map((st) => (
                <tr key={st.id}>
                  <Td>
                    <span className="flex items-center gap-3">
                      <Avatar src={st.photo_path ? photos.get(st.photo_path) : null} name={fullName(st)} />
                      <span className="font-medium">{fullName(st)}</span>
                    </span>
                  </Td>
                  <Td className="font-mono text-xs">{st.admission_no}</Td>
                  <Td className="text-right">
                    <LinkButton href={`/reports/student/${st.id}`} size="sm" variant="secondary">
                      View
                    </LinkButton>
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
