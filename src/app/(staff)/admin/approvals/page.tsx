import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { Alert, PageHeader } from "@/components/ui";
import { can, requireAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { loadReviewTests } from "@/lib/review-data";
import { ReviewBoard } from "./review-board";

export const metadata: Metadata = { title: "Approvals" };

export default async function Approvals(props: PageProps<"/admin/approvals">) {
  const staff = await requireAdmin();
  const sp = await props.searchParams;
  const s = await getStructure();
  const tests = await loadReviewTests(s);

  const classOrder = s.classes.filter((c) => c.active).map((c) => c.id);
  const names = {
    subjects: Object.fromEntries(s.subjects.map((x) => [x.id, x.name])),
    years: Object.fromEntries(s.years.map((y) => [y.id, y.name])),
    classes: Object.fromEntries(s.classes.map((c) => [c.id, c.name])),
    classOrder,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardCheck}
        title="Approvals"
        description="Review every test set for your classes in one place. Each test shows whether the questions are sound and whether the classes are ready to sit it. Approve the good ones together, flag the ones that need a second look, and send back the rest."
      />
      {typeof sp.error === "string" ? <Alert tone="danger">{sp.error}</Alert> : null}
      {sp.settled ? <Alert tone="success">Done.</Alert> : null}
      <ReviewBoard tests={tests} names={names} canDecide={can(staff, "exam.approve")} />
    </div>
  );
}
