import type { Metadata } from "next";
import { Tag } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, CardHeader, Field, Input, PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { RoundConfig } from "@/lib/data";
import { createRound, deleteRound, moveRound, setDefaultRound, toggleRoundActive } from "./actions";

export const metadata: Metadata = { title: "CA rounds" };

export default async function RoundsPage() {
  await requireSuperAdmin();
  // Use admin client so we can see inactive rounds too.
  const db = createAdminClient();
  const { data } = await db.from("ca_round_configs").select("*").order("sort_order");
  const rounds = (data ?? []) as RoundConfig[];

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        icon={Tag}
        title="CA rounds"
        description="Define the labels teachers can assign to their tests — 1st CA, Exam, etc. Teachers pick from this list; they can't type free text."
      />

      <Alert tone="info">
        These labels group tests in reports, the approvals board, and the exams schedule. The <strong>default</strong> round is pre-selected when a teacher creates a new test.
      </Alert>

      <Card>
        <CardHeader title="Configured rounds" description={`${rounds.filter((r) => r.is_active).length} active, ${rounds.filter((r) => !r.is_active).length} hidden`} />
        {rounds.length === 0 ? (
          <p className="p-5 text-sm text-muted">No rounds yet — add one below.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rounds.map((r, i) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex-1 min-w-0">
                  <span className={`text-sm font-semibold ${r.is_active ? "" : "text-muted line-through"}`}>{r.label}</span>
                  <span className="ml-2 inline-flex gap-1">
                    {r.is_default && <Badge tone="success">Default</Badge>}
                    {!r.is_active && <Badge>Hidden</Badge>}
                  </span>
                </span>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {/* Move up */}
                  {i > 0 ? (
                    <ActionForm action={moveRound} className="inline">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="direction" value="up" />
                      <SubmitButton size="sm" variant="secondary">↑</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {/* Move down */}
                  {i < rounds.length - 1 ? (
                    <ActionForm action={moveRound} className="inline">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="direction" value="down" />
                      <SubmitButton size="sm" variant="secondary">↓</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {/* Set default */}
                  {!r.is_default && r.is_active ? (
                    <ActionForm action={setDefaultRound} className="inline">
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton size="sm" variant="secondary">Set default</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {/* Toggle active */}
                  <ActionForm action={toggleRoundActive} className="inline">
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton size="sm" variant={r.is_active ? "ghost" : "secondary"}>
                      {r.is_active ? "Hide" : "Show"}
                    </SubmitButton>
                  </ActionForm>
                  {/* Delete */}
                  <ActionForm action={deleteRound} className="inline">
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton size="sm" variant="ghost" confirm={`Delete "${r.label}"? This can't be undone.`}>
                      Delete
                    </SubmitButton>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}

        <ActionForm action={createRound} className="flex items-end gap-2 border-t border-border p-5" resetOnSuccess>
          <Field label="New round label" hint="e.g. 1st CA, Mid-Term, Exam — max 30 characters">
            <Input name="label" placeholder="e.g. 3rd CA" maxLength={30} required />
          </Field>
          <SubmitButton size="md">Add</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
