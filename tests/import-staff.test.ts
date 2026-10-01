import { describe, expect, it } from "vitest";
import { parseRole, staffTable } from "@/lib/import/staff";

describe("staff import", () => {
  it("reads names, emails, roles and sections, flagging bad rows", () => {
    const r = staffTable([
      ["Full Name", "Email", "Role", "Section"],
      ["MRS ADA OKAFOR", "Ada.Okafor@peculiarschools.com", "Teacher", ""],
      ["Mr Tunde Bello", "tunde@peculiarschools.com", "HOD", "Elementary"],
      ["", "", "", ""],
      ["Ms Ife", "not-an-email", "teacher", ""],
      ["Mr Dup", "ada.okafor@peculiarschools.com", "", ""],
      ["Mr Head", "head@peculiarschools.com", "Head of Section", ""],
      ["Boss", "boss@peculiarschools.com", "Super admin", ""],
    ]);
    if ("error" in r) throw new Error(r.error);
    expect(r.rows.map((x) => [x.full_name, x.email, x.role, x.sections, x.problem ?? null])).toEqual([
      ["Mrs Ada Okafor", "ada.okafor@peculiarschools.com", "teacher", [], null],
      ["Mr Tunde Bello", "tunde@peculiarschools.com", "admin", ["Elementary"], null],
      ["Ms Ife", "not-an-email", "teacher", [], "Missing or invalid email"],
      ["Mr Dup", "ada.okafor@peculiarschools.com", "teacher", [], "Email appears twice in the file"],
      ["Mr Head", "head@peculiarschools.com", "admin", [], "Heads of Section need a Section (e.g. Elementary)"],
      ["Boss", "boss@peculiarschools.com", "teacher", [], "Add super admins one at a time on the Staff page"],
    ]);
  });

  it("accepts first name + surname and splits several sections", () => {
    const r = staffTable([
      ["First Name", "Surname", "E-mail", "Position", "Department"],
      ["Grace", "Eze", "grace@x.com", "Head of Section", "Elementary, College"],
    ]);
    if ("error" in r) throw new Error(r.error);
    expect(r.rows[0]).toMatchObject({ full_name: "Grace Eze", role: "admin", sections: ["Elementary", "College"] });
  });

  it("explains missing columns and reads roles leniently", () => {
    expect(staffTable([["Name", "Phone"]])).toHaveProperty("error");
    expect(parseRole("")).toBe("teacher");
    expect(parseRole("Section Admin")).toBe("admin");
    expect(parseRole("cleaner")).toBeNull();
  });
});
