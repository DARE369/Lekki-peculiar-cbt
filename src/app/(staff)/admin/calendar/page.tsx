import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, CardHeader, Input, PageHeader } from "@/components/ui";
import { can, requireAdmin } from "@/lib/auth";
import { getRoundConfigs, getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { isoToLagosLocal } from "@/lib/time";
import { saveRoundCalendar } from "./actions";
import { SettingsNav } from "../settings/settings-nav";

export const metadata: Metadata = { title: "Exam calendar" };

/**
 * When each round runs for each year group this term. Set it once; approving a test then
 * dates it from here, so nobody schedules class by class.
 */
export default async function CalendarPage() {
  const staff = await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  const sections = s.sections.filter((x) => x.cbt_enabled && (staff.isSuperAdmin || staff.sectionIds.includes(x.id)));
  const sectionIds = new Set(sections.map((x) => x.id));
  const years = s.years.filter((y) => sectionIds.has(y.section_id));
  const rounds = (await getRoundConfigs()).filter(
    (r) => r.is_active && (!r.section_ids?.length || r.section_ids.some((id) => sectionIds.has(id))),
  );
  const { data } = s.currentTerm
    ? await supabase.from("round_schedules").select("round_id, year_id, starts_at, ends_at").eq("term_id", s.currentTerm.id)
    : { data: [] };
  const slot = new Map((data ?? []).map((r) => [`${r.round_id}:${r.year_id}`, r as { starts_at: string; ends_at: string }]));
  const editable = can(staff, "exam.approve");

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        icon={CalendarDays}
        title="Exam calendar"
        description={`When each round runs for each year group${s.currentTerm ? ` this term (${s.currentTerm.name})` : ""}. Set it once: when you approve a test, it is dated from here and starts on its own.`}
      />
      <SettingsNav staff={staff} active="calendar" />
      {!s.currentTerm ? <Alert tone="warning">No current term is set. Ask the super admin.</Alert> : null}
      {!editable ? <Alert tone="info">Only staff who can approve exams can change the calendar.</Alert> : null}

      {rounds.map((r) => {
        const ys = years.filter((y) => !r.section_ids?.length || r.section_ids.includes(y.section_id));
        if (!ys.length) return null;
        return (
          <Card key={r.id}>
            <CardHeader title={r.label} description="Leave a year group empty to date its tests by hand." />
            <ActionForm action={saveRoundCalendar} className="p-4 sm:p-5">
              <input type="hidden" name="round_id" value={r.id} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="pb-2 font-medium">Year group</th>
                      <th className="pb-2 font-medium">Opens (Lagos time)</th>
                      <th className="pb-2 font-medium">Closes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ys.map((y) => {
                      const v = slot.get(`${r.id}:${y.id}`);
                      return (
                        <tr key={y.id}>
                          <td className="py-2 pr-3 font-medium whitespace-nowrap">
                            <input type="hidden" name="year_id" value={y.id} />
                            {y.name}
                          </td>
                          <td className="py-2 pr-3">
                            <Input
                              type="datetime-local"
                              name={`starts_${y.id}`}
                              defaultValue={v ? isoToLagosLocal(v.starts_at) : ""}
                              aria-label={`${r.label} opens for ${y.name}`}
                              disabled={!editable}
                            />
                          </td>
                          <td className="py-2">
                            <Input
                              type="datetime-local"
                              name={`ends_${y.id}`}
                              defaultValue={v ? isoToLagosLocal(v.ends_at) : ""}
                              aria-label={`${r.label} closes for ${y.name}`}
                              disabled={!editable}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {editable ? (
                <div className="mt-4">
                  <SubmitButton size="sm">Save {r.label} dates</SubmitButton>
                </div>
              ) : null}
            </ActionForm>
          </Card>
        );
      })}
    </div>
  );
}
