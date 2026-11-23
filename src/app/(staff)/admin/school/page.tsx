import type { Metadata } from "next";
import { CalendarRange } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, Checkbox, Field, Input, PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getStructure } from "@/lib/data";
import { createSession, setCurrentTerm, updateSection } from "../staff/actions";
import { SettingsNav } from "../settings/settings-nav";

export const metadata: Metadata = { title: "Sessions & terms" };

export default async function SchoolPage() {
  const staff = await requireSuperAdmin();
  const s = await getStructure();
  const sessions = [...new Set(s.terms.map((t) => t.session_name))];
  // What each term holds, so a term that looks empty is easy to spot before (or after) switching to it.
  const supabase = await createClient();
  const testCount = new Map<string, number>();
  await Promise.all(
    s.terms.map(async (t) => {
      const { count } = await supabase.from("assessments").select("id", { count: "exact", head: true }).eq("term_id", t.id);
      testCount.set(t.id, count ?? 0);
    }),
  );
  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarRange}
        title="Sessions, terms & sections"
        description="Every test belongs to a term, so reports stay organised year after year. Switch the current term at the start of each term. Switching only changes which term staff see: nothing is deleted or moved, and you can switch back."
      />
      <SettingsNav staff={staff} active="school" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Terms" />
          <div className="divide-y divide-border">
            {sessions.map((name) => (
              <div key={name} className="px-5 py-3">
                <p className="mb-2 font-medium">{name}</p>
                <div className="flex flex-wrap gap-2">
                  {s.terms
                    .filter((t) => t.session_name === name)
                    .map((t) =>
                      t.is_current ? (
                        <Badge key={t.id} tone="success" className="text-sm">
                          {t.name} · current · {testCount.get(t.id) ?? 0} test{testCount.get(t.id) === 1 ? "" : "s"}
                        </Badge>
                      ) : (
                        <form key={t.id} action={setCurrentTerm}>
                          <input type="hidden" name="term_id" value={t.id} />
                          <SubmitButton
                            variant="secondary"
                            size="sm"
                            pendingText="Switching…"
                            confirm={`Make ${t.name} (${name}) the current term?\n\nEvery staff screen switches to it: "This term's papers", Tests & exams, approvals and reports will show ${t.name}'s tests (${testCount.get(t.id) ?? 0} so far). Nothing is deleted or moved, and you can switch back at any time.`}
                          >
                            {t.name} · {testCount.get(t.id) ?? 0} test{testCount.get(t.id) === 1 ? "" : "s"}
                          </SubmitButton>
                        </form>
                      ),
                    )}
                </div>
              </div>
            ))}
          </div>
          <ActionForm action={createSession} className="flex items-end gap-2 border-t border-border p-5" resetOnSuccess>
            <Field label="New session">
              <Input name="name" placeholder="2027/2028" required />
            </Field>
            <SubmitButton size="md">Create</SubmitButton>
          </ActionForm>
        </Card>
        <Card>
          <CardHeader title="Sections & logos" description="Pre-School is kept out of CBT. Add a logo web address per section for the exam screen." />
          <div className="divide-y divide-border">
            {s.sections.map((sec) => (
              <ActionForm key={sec.id} action={updateSection} className="space-y-3 p-5">
                <input type="hidden" name="id" value={sec.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name">
                    <Input name="name" defaultValue={sec.name} required />
                  </Field>
                  <Field label="Logo URL">
                    <Input name="logo_url" type="url" defaultValue={sec.logo_url ?? ""} placeholder="https://…" />
                  </Field>
                </div>
                <div className="flex items-center justify-between">
                  <Checkbox name="cbt_enabled" label="Uses CBT" defaultChecked={sec.cbt_enabled} />
                  <SubmitButton size="sm" variant="secondary">
                    Save
                  </SubmitButton>
                </div>
              </ActionForm>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
