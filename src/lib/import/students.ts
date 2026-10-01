// Turns a student spreadsheet (CSV or Excel, already read into rows of cells) into
// import rows. Shared by the browser preview and the tests.

export type StudentImportRow = {
  admission_no: string;
  first_name: string;
  last_name: string;
  other_names: string;
  gender: string;
  class_name: string;
};

const ALIASES: Record<string, string> = {
  "admission no": "admission_no",
  "admission number": "admission_no",
  admission: "admission_no",
  "adm no": "admission_no",
  "reg no": "admission_no",
  id: "admission_no",
  "student id": "admission_no",
  "student no": "admission_no",
  "first name": "first_name",
  firstname: "first_name",
  "last name": "last_name",
  lastname: "last_name",
  surname: "last_name",
  "other names": "other_names",
  "middle name": "other_names",
  "full name": "full_name",
  fullname: "full_name",
  name: "full_name",
  "student name": "full_name",
  gender: "gender",
  sex: "gender",
  class: "class_name",
  "class name": "class_name",
};

export function headingKey(h: string): string | undefined {
  const k = h.trim().toLowerCase().replace(/[_.]+/g, " ").replace(/\s+/g, " ");
  return ALIASES[k];
}

/** "ADAEZE KENDRA IGBOCHUBA" → "Adaeze Kendra Igbochuba"; mixed-case names are left alone. */
export function tidyName(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/** A single "full name" cell: first word is the first name, last word the surname, the rest other names. */
export function splitFullName(full: string): { first_name: string; last_name: string; other_names: string } {
  const parts = tidyName(full).split(" ").filter(Boolean);
  if (parts.length < 2) return { first_name: parts[0] ?? "", last_name: "", other_names: "" };
  return { first_name: parts[0], last_name: parts[parts.length - 1], other_names: parts.slice(1, -1).join(" ") };
}

/** Same as the database's normalize_admission(): "LPS/2024/0137" and "lps 2024 137" are the same student. */
export function normalizeAdmission(raw: string) {
  return raw
    .replace(/(^|[^0-9])0+([0-9])/g, "$1$2")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

export function normalizeClassName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export type StudentTable = { rows: StudentImportRow[]; ignored: string[] } | { error: string };

export function studentTable(cells: string[][]): StudentTable {
  const [header = [], ...body] = cells;
  const keys = header.map((h) => headingKey(String(h ?? "")));
  const has = (k: string) => keys.includes(k);
  const hasNames = has("full_name") || (has("first_name") && has("last_name"));
  if (!has("admission_no") || !hasNames) {
    return {
      error:
        "Couldn't find the columns. The first row needs headings for the admission number (e.g. Admission No or Student_id) and the name — either one Full Name column, or First Name and Surname.",
    };
  }
  const ignored = header.filter((h, i) => String(h ?? "").trim() && !keys[i]).map((h) => String(h).trim());
  const rows: StudentImportRow[] = [];
  for (const line of body) {
    const get = (k: string) => {
      const i = keys.indexOf(k);
      return i < 0 ? "" : String(line[i] ?? "").trim();
    };
    if (line.every((c) => !String(c ?? "").trim())) continue;
    const names =
      has("first_name") && has("last_name") && (get("first_name") || get("last_name"))
        ? { first_name: tidyName(get("first_name")), last_name: tidyName(get("last_name")), other_names: tidyName(get("other_names")) }
        : splitFullName(get("full_name"));
    rows.push({ admission_no: get("admission_no"), ...names, gender: get("gender"), class_name: get("class_name").replace(/\s+/g, " ") });
  }
  return { rows, ignored };
}
