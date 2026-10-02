// Turns a staff spreadsheet (CSV or Excel, already read into rows of cells) into rows to add.

import { tidyName } from "./students";

export type StaffImportRow = {
  full_name: string;
  email: string;
  role: "teacher" | "admin";
  sections: string[]; // section names or codes as typed, resolved on the server (a teacher has at most one)
  problem?: string;
};

const ALIASES: Record<string, string> = {
  name: "full_name",
  "full name": "full_name",
  fullname: "full_name",
  "staff name": "full_name",
  "teacher name": "full_name",
  "first name": "first_name",
  firstname: "first_name",
  surname: "last_name",
  "last name": "last_name",
  lastname: "last_name",
  email: "email",
  "email address": "email",
  "school email": "email",
  "official email": "email",
  "e mail": "email",
  role: "role",
  position: "role",
  "staff type": "role",
  type: "role",
  section: "sections",
  sections: "sections",
  department: "sections",
};

function key(h: string) {
  return ALIASES[h.trim().toLowerCase().replace(/[_.-]+/g, " ").replace(/\s+/g, " ")];
}

export function parseRole(raw: string): StaffImportRow["role"] | "super_admin" | null {
  const r = raw.trim().toLowerCase().replace(/[_.-]+/g, " ");
  if (!r || /teacher|staff|tutor|instructor/.test(r)) return "teacher";
  if (/super/.test(r)) return "super_admin";
  if (/^hos$|^hod$|head|admin|coordinator/.test(r)) return "admin";
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type StaffTable = { rows: StaffImportRow[] } | { error: string };

export function staffTable(cells: string[][]): StaffTable {
  const [header = [], ...body] = cells;
  const keys = header.map((h) => key(String(h ?? "")));
  const has = (k: string) => keys.includes(k);
  if (!has("email") || !(has("full_name") || (has("first_name") && has("last_name")))) {
    return { error: "Couldn't find the columns. The first row needs headings for the name (Full Name, or First Name and Surname) and Email. Optional: Role, Section." };
  }
  const rows: StaffImportRow[] = [];
  const seen = new Set<string>();
  for (const line of body) {
    if (line.every((c) => !String(c ?? "").trim())) continue;
    const get = (k: string) => {
      const i = keys.indexOf(k);
      return i < 0 ? "" : String(line[i] ?? "").trim();
    };
    const full_name = tidyName(get("full_name") || [get("first_name"), get("last_name")].filter(Boolean).join(" "));
    const email = get("email").toLowerCase();
    const role = parseRole(get("role"));
    const sections = get("sections")
      .split(/[,;/&]|\band\b/i)
      .map((x) => x.trim())
      .filter(Boolean);
    let problem: string | undefined;
    if (!full_name) problem = "Missing name";
    else if (!EMAIL.test(email)) problem = "Missing or invalid email";
    else if (seen.has(email)) problem = "Email appears twice in the file";
    else if (role === "super_admin") problem = "Add super admins one at a time on the Staff page";
    else if (!role) problem = `Unknown role "${get("role")}" — use Teacher or Head of Section`;
    else if (role === "admin" && sections.length === 0) problem = "Heads of Section need a Section (e.g. Elementary)";
    else if (role !== "admin" && sections.length > 1) problem = "A teacher belongs to one section — Elementary or College";
    seen.add(email);
    rows.push({ full_name, email, role: role === "admin" ? "admin" : "teacher", sections, problem });
  }
  return { rows };
}
