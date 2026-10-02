import "server-only";
import { getStructure } from "@/lib/data";
import { emailLayout, escapeHtml as esc, sendMail } from "@/lib/mail";
import { deadlineForSection, formatDeadline, getQuestionSettings } from "@/lib/onboarding";
import { flagLabel } from "@/lib/readiness";
import { siteOrigin } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Emails each teacher once about the subject/class choices just decided: what was approved (with their deadline
 * and a button to upload) and what was declined. Never throws.
 */
export async function notifyAssignmentDecisions(assignmentIds: string[]) {
  try {
    if (assignmentIds.length === 0) return;
    const admin = createAdminClient();
    const { data } = await admin
      .from("teaching_assignments")
      .select("teacher_id, subject_id, class_id, status, staff:teacher_id(full_name, email)")
      .in("id", assignmentIds);
    type Row = { teacher_id: string; subject_id: string; class_id: string; status: string; staff: { full_name: string; email: string } | null };
    const rows = (data ?? []) as unknown as Row[];
    const s = await getStructure();
    const settings = await getQuestionSettings();
    const site = await siteOrigin();
    const byTeacher = new Map<string, Row[]>();
    for (const r of rows) byTeacher.set(r.teacher_id, [...(byTeacher.get(r.teacher_id) ?? []), r]);

    for (const list of byTeacher.values()) {
      const who = list[0].staff;
      if (!who?.email) continue;
      const approved = list.filter((r) => r.status === "approved");
      const declined = list.filter((r) => r.status === "rejected");
      const lines = (rs: Row[]) => {
        const bySubject = new Map<string, string[]>();
        for (const r of rs) bySubject.set(r.subject_id, [...(bySubject.get(r.subject_id) ?? []), s.className(r.class_id)]);
        return `<ul style="margin:8px 0 0;padding-left:20px">${[...bySubject]
          .map(([sub, classes]) => `<li style="margin:4px 0"><strong>${esc(s.subjectById.get(sub)?.name ?? "")}</strong> — ${classes.map(esc).join(", ")}</li>`)
          .join("")}</ul>`;
      };
      const deadlines = [...new Set(approved.map((r) => deadlineForSection(s.subjectById.get(r.subject_id)?.section_id, s, settings)).filter(Boolean))].sort() as string[];
      let body = `<p style="margin:0 0 14px">Dear ${esc(who.full_name)},</p>`;
      if (approved.length) {
        body += `<p style="margin:0">Your Head of Section has <strong>approved</strong> these subjects and classes for you:</p>${lines(approved)}`;
        body += `<p style="margin:16px 0 0">You can now upload your questions and build your tests${
          deadlines[0] ? `. Please have them ready by <strong>${esc(formatDeadline(deadlines[0]))}</strong>` : ""
        }.</p>`;
      }
      if (declined.length) {
        body += `<p style="margin:${approved.length ? "18px" : "0"} 0 0">These were <strong>not approved</strong>:</p>${lines(declined)}<p style="margin:10px 0 0">If you think this is a mistake, please speak to your Head of Section.</p>`;
      }
      const subject = approved.length ? "Your subjects and classes are approved" : "An update on your subjects and classes";
      await sendMail(
        who.email,
        `${subject} — Peculiar CBT`,
        emailLayout({
          siteUrl: site,
          badge: approved.length ? "Approved" : "Update",
          title: subject,
          body,
          button: approved.length ? { label: "Upload my questions", href: `${site}/teach/questions/import` } : { label: "Open Peculiar CBT", href: `${site}/teach/classes` },
        }),
      );
    }
  } catch (e) {
    console.error("notifyAssignmentDecisions failed:", e);
  }
}

/** Emails the teacher who wrote a test when it is approved or sent back for changes. Never throws. */
export async function notifyAssessmentReview(assessmentId: string, approved: boolean, note: string | null) {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("assessments")
      .select("id, title, staff:created_by(full_name, email)")
      .eq("id", assessmentId)
      .maybeSingle();
    const a = data as unknown as { id: string; title: string; staff: { full_name: string; email: string } | null } | null;
    if (!a?.staff?.email) return;
    const site = await siteOrigin();
    const title = approved ? `“${a.title}” is approved` : `Changes requested on “${a.title}”`;
    const body =
      `<p style="margin:0 0 14px">Dear ${esc(a.staff.full_name)},</p>` +
      (approved
        ? `<p style="margin:0">Your test <strong>${esc(a.title)}</strong> has been <strong>approved</strong>. It is now locked and will be scheduled for your classes.</p>`
        : `<p style="margin:0">Your Head of Section has asked for some changes to <strong>${esc(a.title)}</strong> before it can be approved.</p>`) +
      (note ? `<p style="margin:14px 0 0;padding:12px 16px;background:#f6f8fc;border-left:4px solid #1d3f9a;border-radius:0 8px 8px 0"><strong>Note:</strong> ${esc(note)}</p>` : "") +
      (approved ? "" : `<p style="margin:14px 0 0">Make the changes, then press <strong>Submit for approval</strong> again.</p>`);
    await sendMail(
      a.staff.email,
      `${approved ? "Test approved" : "Changes requested"}: ${a.title} — Peculiar CBT`,
      emailLayout({
        siteUrl: site,
        badge: approved ? "Approved" : "Changes requested",
        title,
        body,
        button: { label: approved ? "View my test" : "Make the changes", href: `${site}/teach/assessments/${a.id}` },
      }),
    );
  } catch (e) {
    console.error("notifyAssessmentReview failed:", e);
  }
}

export interface BulkDecision {
  id: string;
  action: "approve" | "flag" | "send_back";
  category?: string;
  note?: string;
}

/** One email per teacher covering everything decided in a bulk review: approved, approved with a flag, sent back. Never throws. */
export async function notifyBulkReview(decisions: BulkDecision[]) {
  try {
    if (decisions.length === 0) return;
    const admin = createAdminClient();
    const { data } = await admin
      .from("assessments")
      .select("id, title, subject_id, created_by, staff:created_by(full_name, email)")
      .in("id", decisions.map((d) => d.id));
    type Row = { id: string; title: string; subject_id: string; created_by: string; staff: { full_name: string; email: string } | null };
    const rows = (data ?? []) as unknown as Row[];
    const s = await getStructure();
    const site = await siteOrigin();
    const byTeacher = new Map<string, { who: NonNullable<Row["staff"]>; items: { row: Row; d: BulkDecision }[] }>();
    for (const row of rows) {
      const d = decisions.find((x) => x.id === row.id);
      if (!d || !row.staff?.email) continue;
      const entry = byTeacher.get(row.created_by) ?? { who: row.staff, items: [] };
      entry.items.push({ row, d });
      byTeacher.set(row.created_by, entry);
    }
    for (const { who, items } of byTeacher.values()) {
      const label = (r: Row) => `<strong>${esc(r.title)}</strong> <span style="color:#6b7280">(${esc(s.subjectById.get(r.subject_id)?.name ?? "")})</span>`;
      const list = (xs: { row: Row; d: BulkDecision }[], extra: (d: BulkDecision) => string) =>
        `<ul style="margin:8px 0 0;padding-left:20px">${xs.map(({ row, d }) => `<li style="margin:6px 0">${label(row)}${extra(d)}</li>`).join("")}</ul>`;
      const approved = items.filter((i) => i.d.action === "approve");
      const flagged = items.filter((i) => i.d.action === "flag");
      const back = items.filter((i) => i.d.action === "send_back");
      let body = `<p style="margin:0 0 14px">Dear ${esc(who.full_name)},</p>`;
      if (approved.length) body += `<p style="margin:0">These tests are <strong>approved</strong>:</p>${list(approved, () => "")}`;
      if (flagged.length) {
        body += `<p style="margin:${approved.length ? "18px" : "0"} 0 0">These are <strong>approved, but need a second look</strong>. Please open each one and correct what is mentioned:</p>${list(
          flagged,
          (d) => `<br><span style="color:#92400e">${esc(flagLabel(d.category))}${d.note ? ` — ${esc(d.note)}` : ""}</span>`,
        )}`;
      }
      if (back.length) {
        body += `<p style="margin:${approved.length || flagged.length ? "18px" : "0"} 0 0">These were <strong>sent back</strong> for changes:</p>${list(
          back,
          (d) => (d.note ? `<br><span style="color:#b91c1c">${esc(d.note)}</span>` : ""),
        )}`;
      }
      body += `<p style="margin:16px 0 0">Open Peculiar CBT to see them.</p>`;
      await sendMail(
        who.email,
        `${flagged.length || back.length ? "Your tests were reviewed — action needed" : "Your tests are approved"} — Peculiar CBT`,
        emailLayout({
          siteUrl: site,
          badge: flagged.length || back.length ? "Action needed" : "Approved",
          title: flagged.length || back.length ? "Your tests were reviewed" : "Your tests are approved",
          body,
          button: { label: "Open my tests", href: `${site}/dashboard` },
        }),
      );
    }
  } catch (e) {
    console.error("notifyBulkReview failed:", e);
  }
}
