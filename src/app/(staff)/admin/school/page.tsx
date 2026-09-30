import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, Checkbox, Field, Input, PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { createSession, setCurrentTerm, updateSection } from "../staff/actions";

export const metadata: Metadata = { title: "Sessions & terms" };

export default async function SchoolPage() {
  await requireSuperAdmin();
  const s = await getStructure();
  const sessions = [...new Set(s.terms.map((t) => t.session_name))];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sessions, terms & sections"
        description="Every test belongs to a term, so reports stay organised year after year. Switch the current term at the start of each term."
      />
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
                          {t.name} · current
                        </Badge>
                      ) : (
                        <form key={t.id} action={setCurrentTerm}>
                          <input type="hidden" name="term_id" value={t.id} />
                          <button className="rounded-full border border-border px-3 py-0.5 text-sm hover:border-brand" title="Make this the current term">
                            {t.name}
                          </button>
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
