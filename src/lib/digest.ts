import "server-only";
import { getStructure } from "@/lib/data";
import { emailLayout, escapeHtml as esc, sendMail } from "@/lib/mail";
import { siteOrigin } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The end-of-day email for each Head of Section: tests waiting for review, teaching requests that clash,
 * and requests approved automatically today. Nobody is emailed when there is nothing for them.
 */
export async function sendDailyDigests(): Promise<{ sent: number; skipped: number }> {
  const admin = createAdminClient();
  const s = await getStructure();
  const site = await siteOrigin();
  const [{ data: people }, { data: perms }, { data: secs }, { data: tests }, { data: requests }] = await Promise.all([
    admin.from("staff").select("id, full_name, email, role").eq("active", true).in("role", ["admin", "super_admin"]),
    admin.from("staff_permissions").select("staff_id, permission").in("permission", ["exam.approve", "teachers.manage"]),
    admin.from("admin_sections").select("staff_id, section_id"),
    admin.from("assessments").select("id, title, subject_id, submitted_at, staff:created_by(full_name)").eq("status", "pending_approval").order("submitted_at"),
    admin
      .from("teaching_assignments")
      .select("id, subject_id, class_id, status, decided_by, decided_at, staff:teacher_id(full_name)")
      .eq("session_id", s.currentSessionId ?? "")
      .or(`status.eq.requested,and(status.eq.approved,decided_by.is.null,decided_at.gte.${new Date(Date.now() - 86400_000).toISOString()})`),
  ]);

  const permsOf = new Map<string, Set<string>>();
  for (const p of perms ?? []) permsOf.set(p.staff_id as string, (permsOf.get(p.staff_id as string) ?? new Set()).add(p.permission as string));
  const sectionsOf = new Map<string, Set<string>>();
  for (const x of secs ?? []) sectionsOf.set(x.staff_id as string, (sectionsOf.get(x.staff_id as string) ?? new Set()).add(x.section_id as string));

  type T = { id: string; title: string; subject_id: string; submitted_at: string | null; staff: { full_name: string } | null };
  type R = { id: string; subject_id: string; class_id: string; status: string; staff: { full_name: string } | null };
  let sent = 0;
  let skipped = 0;
  for (const p of people ?? []) {
    if (!p.email) continue;
    const superAdmin = p.role === "super_admin";
    const mine = superAdmin ? new Set(s.sections.map((x) => x.id)) : (sectionsOf.get(p.id as string) ?? new Set<string>());
    const may = (perm: string) => superAdmin || permsOf.get(p.id as string)?.has(perm);
    const inMine = (subjectId: string) => mine.has(s.subjectById.get(subjectId)?.section_id ?? "");
    const t = may("exam.approve") ? ((tests ?? []) as unknown as T[]).filter((x) => inMine(x.subject_id)) : [];
    const r = may("teachers.manage") ? ((requests ?? []) as unknown as R[]).filter((x) => inMine(x.subject_id)) : [];
    const clashes = r.filter((x) => x.status === "requested");
    const auto = r.filter((x) => x.status === "approved");
    if (!t.length && !clashes.length && !auto.length) {
      skipped++;
      continue;
    }
    const days = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400_000) : 0);
    const li = (x: string) => `<li style="margin:0 0 4px">${x}</li>`;
    let body = `<p style="margin:0 0 14px">Dear ${esc(p.full_name as string)},</p>`;
    if (t.length) {
      body += `<p style="margin:0 0 6px"><strong>${t.length} test${t.length === 1 ? "" : "s"} waiting for your review</strong></p><ul style="margin:0 0 14px;padding-left:20px">`;
      body += t
        .slice(0, 15)
        .map((x) => {
          const d = days(x.submitted_at);
          return li(`${esc(x.title)} — ${esc(x.staff?.full_name ?? "")}${d ? ` <span style="color:#b54708">(waiting ${d} day${d === 1 ? "" : "s"})</span>` : ""}`);
        })
        .join("");
      body += t.length > 15 ? li(`…and ${t.length - 15} more`) : "";
      body += `</ul>`;
    }
    if (clashes.length) {
      body += `<p style="margin:0 0 6px"><strong>${clashes.length} teaching request${clashes.length === 1 ? "" : "s"} need${clashes.length === 1 ? "s" : ""} you</strong> (another teacher has the same subject and class)</p><ul style="margin:0 0 14px;padding-left:20px">`;
      body += clashes.slice(0, 15).map((x) => li(`${esc(x.staff?.full_name ?? "")}: ${esc(s.subjectById.get(x.subject_id)?.name ?? "")}, ${esc(s.className(x.class_id))}`)).join("");
      body += `</ul>`;
    }
    if (auto.length) {
      body += `<p style="margin:0 0 6px">Approved automatically today (no clash):</p><ul style="margin:0 0 14px;padding-left:20px;color:#475467">`;
      body += auto.slice(0, 15).map((x) => li(`${esc(x.staff?.full_name ?? "")}: ${esc(s.subjectById.get(x.subject_id)?.name ?? "")}, ${esc(s.className(x.class_id))}`)).join("");
      body += `</ul>`;
    }
    const ok = await sendMail(
      p.email as string,
      `Today's approvals: ${t.length} test${t.length === 1 ? "" : "s"}${clashes.length ? `, ${clashes.length} request${clashes.length === 1 ? "" : "s"}` : ""} — Peculiar CBT`,
      emailLayout({
        siteUrl: site,
        badge: "Daily summary",
        title: "What's waiting for you",
        body,
        button: { label: "Open Approvals", href: `${site}${t.length || !may("teachers.manage") ? "/admin/approvals" : "/admin/assignments"}` },
      }),
    );
    if (ok) sent++;
    else skipped++;
  }
  return { sent, skipped };
}
