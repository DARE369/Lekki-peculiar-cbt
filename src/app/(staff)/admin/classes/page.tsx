import type { Metadata } from "next";
import { School } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { addClasses, addSubject, addYearClasses, restoreSubjects, toggleSubject, updateClass } from "../actions";

export const metadata: Metadata = { title: "Classes & subjects" };

export default async function ClassesPage() {
  const staff = await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  const { data: tracks } = await supabase.from("tracks").select("id, name").order("name");
  const { data: counts } = await supabase.from("students").select("class_id").eq("active", true);
  const perClass = new Map<string, number>();
  for (const r of counts ?? []) if (r.class_id) perClass.set(r.class_id, (perClass.get(r.class_id) ?? 0) + 1);
  const sections = s.sections.filter((x) => x.cbt_enabled && (staff.isSuperAdmin || staff.sectionIds.includes(x.id)));

  return (
    <div className="space-y-8">
      <PageHeader
        icon={School} title="Classes & subjects" description="Year groups are fixed (Year 1–6 Elementary, Year 7–12 College). Add the arms/classes and subjects for your section." />
      {sections.map((sec) => {
        const years = s.years.filter((y) => y.section_id === sec.id);
        const subjects = s.subjects.filter((x) => x.section_id === sec.id);
        return (
          <section key={sec.id} className="space-y-4">
            <h2 className="text-lg font-semibold">{sec.name}</h2>
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <Card>
                <CardHeader title="Classes" description="Click a class to rename it, set its track or retire it." />
                <div className="divide-y divide-border">
                  {years.map((y) => {
                    const classes = s.classes.filter((c) => c.year_id === y.id);
                    return (
                      <div key={y.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                        <span className="w-24 shrink-0 pt-1 text-sm font-medium">
                          {y.name}
                          {y.stage ? <span className="block text-xs text-muted capitalize">{y.stage} college</span> : null}
                        </span>
                        <div className="flex flex-1 flex-wrap gap-2">
                          {classes.length === 0 ? <span className="pt-1 text-sm text-muted">No classes</span> : null}
                          {classes.map((c) => (
                            <details key={c.id} className="relative open:max-md:basis-full">
                              <summary className="cursor-pointer list-none">
                                <Badge tone={c.active ? "brand" : "neutral"} className="text-sm">
                                  {c.name} · {perClass.get(c.id) ?? 0}
                                  {c.track_id ? ` · ${(tracks ?? []).find((t) => t.id === c.track_id)?.name}` : ""}
                                  {!c.active ? " (retired)" : ""}
                                </Badge>
                              </summary>
                              <div className="absolute z-10 mt-1 w-72 rounded-xl border border-border bg-surface p-4 shadow-lg max-md:static max-md:w-full">
                                <ActionForm action={updateClass} className="space-y-3">
                                  <input type="hidden" name="id" value={c.id} />
                                  <Field label="Name">
                                    <Input name="name" defaultValue={c.name} required />
                                  </Field>
                                  {y.stage === "senior" ? (
                                    <Field label="Track">
                                      <Select name="track_id" defaultValue={c.track_id ?? ""}>
                                        <option value="">—</option>
                                        {(tracks ?? []).map((t) => (
                                          <option key={t.id} value={t.id}>
                                            {t.name}
                                          </option>
                                        ))}
                                      </Select>
                                    </Field>
                                  ) : null}
                                  <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" name="active" defaultChecked={c.active} className="accent-[var(--brand)]" /> Active
                                  </label>
                                  <SubmitButton size="sm">Save</SubmitButton>
                                </ActionForm>
                              </div>
                            </details>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
              <div className="space-y-6">
                {years.some((y) => !s.classes.some((c) => c.year_id === y.id)) ? (
                  <Card>
                    <CardHeader
                      title="One class per year?"
                      description={`If ${sec.name} has a single class in each year, create them in one go — named exactly like the year (${years[0]?.name} … ${years[years.length - 1]?.name}), which is what a student spreadsheet's Class column usually says.`}
                    />
                    <ActionForm action={addYearClasses} className="px-5 pb-5">
                      <input type="hidden" name="section_id" value={sec.id} />
                      <SubmitButton size="sm" variant="secondary">
                        Create {years.filter((y) => !s.classes.some((c) => c.year_id === y.id)).length} year classes
                      </SubmitButton>
                    </ActionForm>
                  </Card>
                ) : null}
                <Card>
                  <CardHeader title="Add classes" />
                  <ActionForm action={addClasses} className="space-y-3 p-5" resetOnSuccess>
                    <Field label="Year">
                      <Select name="year_id" required defaultValue="">
                        <option value="" disabled>
                          Choose…
                        </option>
                        {years.map((y) => (
                          <option key={y.id} value={y.id}>
                            {y.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Class names" hint="One per line or separated by commas, e.g. Year 7 Gold, Year 7 Blue">
                      <Textarea name="names" rows={3} required />
                    </Field>
                    {sec.code === "COLL" ? (
                      <Field label="Track (Senior College only)">
                        <Select name="track_id" defaultValue="">
                          <option value="">—</option>
                          {(tracks ?? []).map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}
                    <SubmitButton size="sm">Add</SubmitButton>
                  </ActionForm>
                </Card>
                <Card>
                  <CardHeader title="Subjects" description="Teachers pick from these. Retire one only if it is no longer taught." />
                  <ul className="divide-y divide-border">
                    {subjects
                      .filter((x) => x.active)
                      .map((x) => (
                        <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                          <span className="min-w-0 text-sm font-medium">{x.name}</span>
                          <form action={toggleSubject}>
                            <input type="hidden" name="id" value={x.id} />
                            <input type="hidden" name="active" value="false" />
                            <SubmitButton
                              size="sm"
                              variant="ghost"
                              pendingText="…"
                              confirm={`Retire ${x.name}? Teachers will no longer be able to choose it. You can restore it at any time.`}
                            >
                              Retire
                            </SubmitButton>
                          </form>
                        </li>
                      ))}
                  </ul>
                  {subjects.some((x) => !x.active) ? (
                    <details className="border-t border-border" open>
                      <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-danger">
                        Retired subjects ({subjects.filter((x) => !x.active).length})
                      </summary>
                      <ul className="divide-y divide-border border-t border-border bg-danger-soft/30">
                        {subjects
                          .filter((x) => !x.active)
                          .map((x) => (
                            <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                              <span className="min-w-0 text-sm text-muted line-through">{x.name}</span>
                              <form action={toggleSubject}>
                                <input type="hidden" name="id" value={x.id} />
                                <input type="hidden" name="active" value="true" />
                                <SubmitButton size="sm" variant="secondary" pendingText="…">
                                  Restore
                                </SubmitButton>
                              </form>
                            </li>
                          ))}
                      </ul>
                      <form action={restoreSubjects} className="border-t border-border p-4">
                        <input type="hidden" name="section_id" value={sec.id} />
                        <SubmitButton size="sm" variant="primary" pendingText="Restoring…">
                          Restore all retired subjects
                        </SubmitButton>
                      </form>
                    </details>
                  ) : null}
                  <ActionForm action={addSubject} className="flex gap-2 border-t border-border p-5" resetOnSuccess>
                    <input type="hidden" name="section_id" value={sec.id} />
                    <Input name="name" placeholder="New subject" required />
                    <SubmitButton size="sm">Add</SubmitButton>
                  </ActionForm>
                </Card>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
