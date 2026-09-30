import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Card, CardHeader, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { BulkPhotoUpload } from "@/components/photo-upload";
import { can, requireAdmin } from "@/lib/auth";
import { fullName, getStructure } from "@/lib/data";
import { signPhotos } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";
import { moveStudents } from "./actions";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage(props: PageProps<"/admin/students">) {
  const sp = await props.searchParams;
  const staff = await requireAdmin();
  const s = await getStructure();
  const classId = typeof sp.class === "string" ? sp.class : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const showLeft = sp.left === "1";
  const supabase = await createClient();

  let query = supabase
    .from("students")
    .select("id, admission_no, admission_key, first_name, last_name, other_names, class_id, photo_path, active")
    .order("last_name")
    .limit(500);
  if (classId === "none") query = query.is("class_id", null);
  else if (classId) query = query.eq("class_id", classId);
  if (q) query = query.or(`search_name.ilike.%${q.toLowerCase().replace(/[%,()]/g, "")}%,admission_no.ilike.%${q.replace(/[%,()]/g, "")}%`);
  if (!showLeft) query = query.eq("active", true);
  const { data: students } = await query;
  const { count: withoutPhoto } = await supabase.from("students").select("id", { count: "exact", head: true }).is("photo_path", null).eq("active", true);
  const photos = await signPhotos((students ?? []).map((x) => x.photo_path));
  const manage = can(staff, "students.manage");
  const myClasses = s.classes.filter((c) => staff.isSuperAdmin || staff.sectionIds.includes(s.sectionOfClass(c.id)?.id ?? ""));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Students log in at the lab with their admission number, or by picking their class and name. Photos let them confirm it's them."
        actions={
          manage ? (
            <>
              <LinkButton href="/admin/students/import">Import from spreadsheet</LinkButton>
              <LinkButton href="/admin/students/new" variant="secondary">
                Add one
              </LinkButton>
            </>
          ) : null
        }
      />
      <form className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs text-muted">Class</span>
          <Select name="class" defaultValue={classId} className="w-52">
            <option value="">All classes</option>
            {myClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">No class</option>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted">Name or admission no.</span>
          <Input name="q" defaultValue={q} className="w-64" />
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="left" value="1" defaultChecked={showLeft} className="accent-[var(--brand)]" /> Include students who left
        </label>
        <button className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-surface-2">Filter</button>
      </form>

      <Card>
        {(students ?? []).length === 0 ? (
          <EmptyState title="No students found" />
        ) : (
          <ActionForm action={moveStudents}>
            <Table>
              <thead>
                <tr>
                  {manage ? <Th className="w-10" /> : null}
                  <Th>Student</Th>
                  <Th>Admission no.</Th>
                  <Th>Class</Th>
                  <Th>Photo</Th>
                </tr>
              </thead>
              <tbody>
                {(students ?? []).map((st) => (
                  <tr key={st.id} className={st.active ? "" : "opacity-60"}>
                    {manage ? (
                      <Td>
                        <input type="checkbox" name="student_id" value={st.id} className="h-4 w-4 accent-[var(--brand)]" aria-label={`Select ${fullName(st)}`} />
                      </Td>
                    ) : null}
                    <Td>
                      <Link href={`/admin/students/${st.id}`} className="flex items-center gap-3 hover:underline">
                        <Avatar src={st.photo_path ? photos.get(st.photo_path) : null} name={fullName(st)} size={32} />
                        <span className="font-medium">{fullName(st)}</span>
                        {!st.active ? <Badge>Left</Badge> : null}
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs">{st.admission_no}</Td>
                    <Td>{s.className(st.class_id)}</Td>
                    <Td>{st.photo_path ? <Badge tone="success">Yes</Badge> : <Badge tone="warning">Missing</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {manage ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-border p-4">
                <span className="text-sm text-muted">With ticked students:</span>
                <Select name="target_class_id" className="w-56" defaultValue="">
                  <option value="" disabled>
                    Move to class…
                  </option>
                  {myClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__leave">Mark as left the school</option>
                </Select>
                <SubmitButton size="sm" variant="secondary">
                  Apply
                </SubmitButton>
              </div>
            ) : null}
          </ActionForm>
        )}
      </Card>
      <p className="text-xs text-muted">{(students ?? []).length} shown (max 500 — filter by class to narrow down).</p>

      {manage ? (
        <Card>
          <CardHeader
            title="Upload photos in bulk"
            description={`${withoutPhoto ?? 0} active students have no photo. Name each photo file with the admission number, e.g. LPS-2024-0137.jpg, put them in a .zip and upload. Photos are shrunk automatically.`}
          />
          <div className="p-5">
            <BulkPhotoUpload students={(students ?? []).map((x) => ({ id: x.id, admission_key: x.admission_key }))} />
            <p className="mt-2 text-xs text-muted">Matches against the students listed above — choose “All classes” to match everyone.</p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
