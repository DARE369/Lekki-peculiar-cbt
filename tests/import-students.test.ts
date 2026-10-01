import { describe, expect, it } from "vitest";
import { splitFullName, studentTable, tidyName } from "@/lib/import/students";

describe("student import", () => {
  it("reads a sheet with one full-name column and extra columns", () => {
    const r = studentTable([
      ["Student_id", "Full_name", "Class", "parent_phone", "parent_email", "staff_type"],
      ["LPS2026/01/036", "ADAEZE KENDRA IGBOCHUBA", "Prep 1", "2348147292071", "x@y.com", ""],
      ["", "", "", "", "", ""],
      ["LPS2024/01/126", "LUCIUS  AISOSA ALARI", "Year  2", "", "", ""],
    ]);
    if ("error" in r) throw new Error(r.error);
    expect(r.ignored).toEqual(["parent_phone", "parent_email", "staff_type"]);
    expect(r.rows).toEqual([
      { admission_no: "LPS2026/01/036", first_name: "Adaeze", last_name: "Igbochuba", other_names: "Kendra", gender: "", class_name: "Prep 1" },
      { admission_no: "LPS2024/01/126", first_name: "Lucius", last_name: "Alari", other_names: "Aisosa", gender: "", class_name: "Year 2" },
    ]);
  });

  it("still reads the separate-columns template", () => {
    const r = studentTable([
      ["Admission No", "First Name", "Surname", "Other Names", "Gender", "Class"],
      ["LPS/2024/0137", "Charles", "Okafor", "Chidi", "M", "Year 4 Gold"],
    ]);
    if ("error" in r) throw new Error(r.error);
    expect(r.rows[0]).toMatchObject({ first_name: "Charles", last_name: "Okafor", other_names: "Chidi", gender: "M" });
  });

  it("explains missing columns", () => {
    expect(studentTable([["Name", "Class"]])).toHaveProperty("error");
  });

  it("tidies names", () => {
    expect(tidyName("KING DAVID O'NEIL-IWEREBOR")).toBe("King David O'Neil-Iwerebor");
    expect(tidyName("McDonald")).toBe("McDonald");
    expect(splitFullName("ADA")).toEqual({ first_name: "Ada", last_name: "", other_names: "" });
  });
});
