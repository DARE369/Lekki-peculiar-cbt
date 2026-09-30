"use client";

import { useState } from "react";
import { Field, Select } from "@/components/ui";
import { PERMISSIONS, type Permission, type Section, type StaffRole } from "@/lib/types";

const HOD_DEFAULT: Permission[] = [
  "exam.approve",
  "exam.start",
  "exam.extend_time",
  "attempt.unlock",
  "students.manage",
  "teachers.manage",
  "terminals.manage",
];

export function AccessFields({
  sections,
  role: initialRole = "teacher",
  sectionIds = [],
  permissions = [],
}: {
  sections: Section[];
  role?: StaffRole;
  sectionIds?: string[];
  permissions?: Permission[];
}) {
  const [role, setRole] = useState<StaffRole>(initialRole);
  const [perms, setPerms] = useState<Set<Permission>>(new Set(permissions));
  return (
    <div className="space-y-4">
      <Field label="Role">
        <Select
          name="role"
          value={role}
          onChange={(e) => {
            const r = e.target.value as StaffRole;
            setRole(r);
            if (r === "admin" && perms.size === 0) setPerms(new Set(HOD_DEFAULT));
          }}
        >
          <option value="teacher">Teacher</option>
          <option value="admin">Head of Section (admin)</option>
          <option value="super_admin">Super admin (full control)</option>
        </Select>
      </Field>
      {role === "admin" ? (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Sections they manage</legend>
          <div className="flex flex-wrap gap-2">
            {sections
              .filter((s) => s.cbt_enabled)
              .map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-brand has-checked:bg-brand-soft">
                  <input type="checkbox" name="section_id" value={s.id} defaultChecked={sectionIds.includes(s.id)} className="accent-[var(--brand)]" />
                  {s.name}
                </label>
              ))}
          </div>
        </fieldset>
      ) : null}
      {role !== "super_admin" ? (
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Permissions</legend>
          <p className="mb-2 text-xs text-muted">
            {role === "teacher" ? "Teachers normally need none." : "Make-ups and voiding are off by default — grant them only to people you trust with exceptions."}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(PERMISSIONS) as Permission[]).map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="permission"
                  value={p}
                  checked={perms.has(p)}
                  onChange={(e) => {
                    const next = new Set(perms);
                    if (e.target.checked) next.add(p);
                    else next.delete(p);
                    setPerms(next);
                  }}
                  className="accent-[var(--brand)]"
                />
                {PERMISSIONS[p]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-sm text-muted">Super admins can do everything, in every section.</p>
      )}
    </div>
  );
}
