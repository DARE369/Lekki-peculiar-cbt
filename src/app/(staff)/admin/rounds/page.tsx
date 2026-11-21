import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getStructure, type RoundConfig } from "@/lib/data";
import { canManageRound, roundDefaults, roundKind } from "@/lib/rounds";
import { createAdminClient } from "@/lib/supabase/server";
import { TYPE_DEFAULTS } from "@/lib/types";
import { createRound, deleteRound, moveRound, setDefaultRound, toggleRoundActive, updateRound } from "./actions";
import { SettingsNav } from "../settings/settings-nav";

export const metadata: Metadata = { title: "Rounds" };

/**
 * The school's rounds (1st CA, 2nd CA, Mid-Term, Exam…). Every paper and every uploaded question belongs
 * to one, so exam questions never mix with test questions. Super admins manage all rounds; Heads of
 * Section manage rounds for their own sections.
 */
export default async function RoundsPage() {
  const staff = await requireAdmin();
  const s = await getStructure();
  const { data } = await createAdminClient().from("ca_round_configs").select("*").order("sort_order");
  const rounds = (data ?? []) as RoundConfig[];
  const cbtSections = s.sections.filter((x) => x.cbt_enabled);
  const mySections = staff.isSuperAdmin ? cbtSections : cbtSections.filter((x) => staff.sectionIds.includes(x.id));
  const sectionName = (ids: string[] | undefined) =>
    !ids?.length ? "All sections" : ids.map((id) => s.sections.find((x) => x.id === id)?.name ?? "?").join(", ");

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Rounds"
        description="Every test and every uploaded question belongs to a round, so exam questions stay apart from CA questions. Teachers pick from this list."
      />
      <SettingsNav staff={staff} active="rounds" />

      <Card>
        <CardHeader
          title="Rounds"
          description={staff.isSuperAdmin ? "Rounds for all sections apply to Elementary and College alike." : "You can change rounds for your own section. School-wide rounds are set by the super admin."}
        />
        <ul className="divide-y divide-border">
          {rounds.map((r, i) => {
            const mine = canManageRound(staff, { section_ids: r.section_ids ?? [] });
            const d = roundDefaults(r);
            return (
              <li key={r.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className={r.is_active ? "font-medium" : "font-medium text-muted line-through"}>
                      {r.label}{" "}
                      {r.is_default ? <Badge tone="success">Default</Badge> : null} {!r.is_active ? <Badge>Hidden</Badge> : null}{" "}
                      {r.counts_to_result === false ? <Badge tone="info">Practice — doesn&apos;t count</Badge> : null}
                    </p>
                    <p className="text-sm text-muted">
                      {roundKind(r) === "exam" ? "Exam" : "Test"} · {d.questions} questions · {d.minutes} min · {sectionName(r.section_ids)}
                    </p>
                  </div>
                  {staff.isSuperAdmin ? (
                    <div className="flex gap-1">
                      {i > 0 ? (
                        <ActionForm action={moveRound} className="inline">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="direction" value="up" />
                          <SubmitButton size="sm" variant="ghost" aria-label={`Move ${r.label} up`}>↑</SubmitButton>
                        </ActionForm>
                      ) : null}
                      {i < rounds.length - 1 ? (
                        <ActionForm action={moveRound} className="inline">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="direction" value="down" />
                          <SubmitButton size="sm" variant="ghost" aria-label={`Move ${r.label} down`}>↓</SubmitButton>
                        </ActionForm>
                      ) : null}
                      {!r.is_default && r.is_active ? (
                        <ActionForm action={setDefaultRound} className="inline">
                          <input type="hidden" name="id" value={r.id} />
                          <SubmitButton size="sm" variant="ghost">Make default</SubmitButton>
                        </ActionForm>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {mine ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium text-brand">Change</summary>
                    <ActionForm action={updateRound} className="mt-3 space-y-4 rounded-md border border-border p-4">
                      <input type="hidden" name="id" value={r.id} />
                      <RoundFields round={r} sections={mySections} />
                      <div className="flex flex-wrap gap-2">
                        <SubmitButton size="sm">Save</SubmitButton>
                      </div>
                    </ActionForm>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ActionForm action={toggleRoundActive} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton size="sm" variant="secondary">{r.is_active ? "Hide from teachers" : "Show to teachers"}</SubmitButton>
                      </ActionForm>
                      <ActionForm action={deleteRound} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton size="sm" variant="ghost" confirm={`Delete "${r.label}"? This can't be undone.`}>
                          Delete
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {mySections.length ? (
        <Card>
          <CardHeader title="Add a round" />
          <ActionForm action={createRound} className="space-y-4 p-4 sm:p-5" resetOnSuccess>
            <Field label="Name" hint="e.g. 3rd CA, Mock exam. Up to 30 characters.">
              <Input name="label" maxLength={30} required />
            </Field>
            <RoundFields sections={mySections} />
            <SubmitButton>Add round</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}

function RoundFields({ round, sections }: { round?: RoundConfig; sections: { id: string; name: string }[] }) {
  const kind = round ? roundKind(round) : "test";
  return (
    <>
      {round ? (
        <Field label="Name">
          <Input name="label" defaultValue={round.label} maxLength={30} required />
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Kind" hint="Sets the usual length and strictness.">
          <Select name="kind" defaultValue={kind}>
            <option value="test">Test</option>
            <option value="exam">Exam</option>
          </Select>
        </Field>
        <Field label="Questions per paper" hint={`Blank = ${TYPE_DEFAULTS[kind].questions}`}>
          <Input name="question_count" type="number" min={1} max={200} defaultValue={round?.question_count ?? ""} />
        </Field>
        <Field label="Minutes" hint={`Blank = ${TYPE_DEFAULTS[kind].minutes}`}>
          <Input name="duration_minutes" type="number" min={1} max={600} defaultValue={round?.duration_minutes ?? ""} />
        </Field>
      </div>
      <Checkbox
        name="practice"
        label="Practice round (mock)"
        hint="Results don't count towards the term record."
        defaultChecked={round?.counts_to_result === false}
      />
      <fieldset>
        <legend className="text-[13px] font-medium">Sections</legend>
        <p className="text-xs text-muted">Tick none to use it in every section.</p>
        <div className="mt-2 flex flex-wrap gap-4">
          {sections.map((sec) => (
            <Checkbox key={sec.id} name="section_id" value={sec.id} label={sec.name} defaultChecked={round?.section_ids?.includes(sec.id)} />
          ))}
        </div>
      </fieldset>
    </>
  );
}
