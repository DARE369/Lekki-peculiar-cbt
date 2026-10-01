import Link from "next/link";
import { CheckCircle2, CircleAlert, Rocket } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import type { Structure } from "@/lib/data";
import { mailConfigured } from "@/lib/mail";
import { createAdminClient } from "@/lib/supabase/server";

type Check = { ok: boolean; label: string; fix: string; href?: string };

/** Super admin only: what still needs doing before staff are invited, so teachers don't hit a dead end. */
export async function Readiness({ s, schoolDeadline }: { s: Structure; schoolDeadline: string | null }) {
  const sections = s.sections.filter((x) => x.cbt_enabled);
  const { data: heads } = await createAdminClient().from("admin_sections").select("section_id, staff!inner(active)").eq("staff.active", true);
  const headed = new Set((heads ?? []).map((h) => h.section_id as string));
  const missing = (has: (id: string) => boolean) => sections.filter((x) => !has(x.id)).map((x) => x.name);
  const noClasses = missing((id) => s.classes.some((c) => c.active && s.sectionOfClass(c.id)?.id === id));
  const noSubjects = missing((id) => s.subjects.some((x) => x.section_id === id));
  const noHead = missing((id) => headed.has(id));
  const noDeadline = schoolDeadline ? [] : missing((id) => Boolean(s.sectionById.get(id)?.question_deadline));
  const list = (names: string[]) => names.join(", ");

  const checks: Check[] = [
    { ok: sections.length > 0, label: "At least one section uses CBT", fix: "Tick “Uses CBT” for a section.", href: "/admin/school" },
    {
      ok: Boolean(s.currentTerm),
      label: s.currentTerm ? `Current term: ${s.currentTerm.name}, ${s.currentTerm.session_name}` : "Current session and term",
      fix: "Set the current session and term — teachers can't choose subjects without it.",
      href: "/admin/school",
    },
    { ok: noClasses.length === 0, label: "Every section has classes", fix: `Add classes for ${list(noClasses)}.`, href: "/admin/classes" },
    { ok: noSubjects.length === 0, label: "Every section has subjects", fix: `Add subjects for ${list(noSubjects)}.`, href: "/admin/classes" },
    {
      ok: noHead.length === 0,
      label: "Every section has a Head of Section",
      fix: `Add a Head of Section for ${list(noHead)} first, so someone approves those teachers' subjects (you can also approve them yourself).`,
      href: "/admin/staff",
    },
    { ok: noDeadline.length === 0, label: "Question deadline set", fix: `Set a whole-school date or a date for ${list(noDeadline)} below.` },
    {
      ok: mailConfigured(),
      label: "App emails (approvals and test reviews)",
      fix: "Add the SMTP settings in Vercel and redeploy — see docs/DEPLOYMENT.md. Invitations still send through Supabase.",
    },
  ];
  const todo = checks.filter((c) => !c.ok).length;

  return (
    <Card className={todo ? "border-warning/50" : undefined}>
      <CardHeader
        icon={Rocket}
        title={todo ? "Before you invite staff" : "Ready to invite staff"}
        description={todo ? `${todo} thing${todo === 1 ? "" : "s"} to sort out so teachers don't get stuck.` : "Everything teachers need is in place."}
      />
      <ul className="grid gap-x-6 gap-y-2.5 px-5 pb-5 sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.label} className="flex gap-2.5 text-sm">
            {c.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-label="To do" />
            )}
            <span>
              <span className={c.ok ? "text-muted" : "font-semibold"}>{c.label}</span>
              {c.ok ? null : (
                <span className="block text-muted">
                  {c.fix}{" "}
                  {c.href ? (
                    <Link href={c.href} className="font-semibold text-brand hover:underline">
                      Fix →
                    </Link>
                  ) : null}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
