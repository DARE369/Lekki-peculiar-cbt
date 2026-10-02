import type { Metadata } from "next";
import Link from "next/link";
import { Phone, Users } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { SectionBadges } from "@/components/section-badges";
import { requireAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { staffSectionMap } from "@/lib/sections";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My staff" };

/** View-only list of the staff in the Head of Section's own section(s): who they are and how to reach them. */
export default async function TeamPage(props: PageProps<"/admin/team">) {
  const me = await requireAdmin();
  const sp = await props.searchParams;
  const s = await getStructure();
  const supabase = await createClient();
  const [sectionsOf, { data: staff }] = await Promise.all([
    staffSectionMap(),
    supabase.from("staff").select("id, full_name, email, phone, role, active, onboarded_at").order("full_name"),
  ]);
  // Last sign-in is held by the auth service.
  const lastSignIn = new Map<string, string | null>();
  const { data: users } = await createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of users?.users ?? []) lastSignIn.set(u.id, u.last_sign_in_at ?? null);

  const mine = me.isSuperAdmin ? s.sections.filter((x) => x.cbt_enabled).map((x) => x.id) : me.sectionIds;
  const people = (staff ?? []).filter((p) => p.role !== "super_admin" && (sectionsOf.get(p.id) ?? []).some((x) => mine.includes(x)));
  const sectionFilter = typeof sp.section === "string" ? sp.section : "";
  const shown = people.filter((p) => !sectionFilter || (sectionsOf.get(p.id) ?? []).includes(sectionFilter));
  const sections = s.sections.filter((x) => mine.includes(x.id));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="My staff"
        description="The teachers and Heads of Section in your section. This list is for viewing only; the school office changes staff details and access."
      />
      {sections.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Section">
          {[["", "All"], ...sections.map((x) => [x.id, x.name])].map(([key, label]) => (
            <Link
              key={key}
              href={key ? `/admin/team?section=${key}` : "/admin/team"}
              role="tab"
              aria-selected={sectionFilter === key}
              className={cn("rounded-full border px-3.5 py-1.5 text-sm font-semibold", sectionFilter === key ? "border-brand bg-brand text-white" : "border-border hover:border-brand")}
            >
              {label}
            </Link>
          ))}
        </div>
      ) : null}
      <Card>
        {shown.length === 0 ? (
          <EmptyState title="No staff in your section yet" />
        ) : (
          <Table stack>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Section</Th>
                <Th>Phone</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                  <Td>
                    <span className="font-medium">{p.full_name}</span>
                    <span className="block text-xs break-all text-muted">{p.email}</span>
                  </Td>
                  <Td label="Role">
                    <Badge tone={p.role === "admin" ? "info" : "neutral"}>{p.role === "admin" ? "Head of Section" : "Teacher"}</Badge>
                  </Td>
                  <Td label="Section">
                    <SectionBadges ids={sectionsOf.get(p.id) ?? []} s={s} />
                  </Td>
                  <Td label="Phone">
                    {p.phone ? (
                      <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                        <Phone className="size-3.5" aria-hidden /> {p.phone}
                      </a>
                    ) : (
                      <span className="text-muted">Not given yet</span>
                    )}
                  </Td>
                  <Td label="Status">
                    {!p.active ? (
                      <Badge tone="danger">Inactive</Badge>
                    ) : !lastSignIn.get(p.id) ? (
                      <Badge tone="danger" dot>
                        Not signed in yet
                      </Badge>
                    ) : !p.onboarded_at ? (
                      <Badge tone="warning" dot>
                        Setting up
                      </Badge>
                    ) : (
                      <Badge tone="success" dot>
                        Active
                      </Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
