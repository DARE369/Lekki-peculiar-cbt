// Student exam terminal API. Students have no accounts: a registered lab computer (terminal
// token) identifies a student (short-lived student token), who then starts an attempt
// (attempt token). All database writes go through the exam_* SQL functions, which enforce
// the rules (open windows, device lock, deadlines, immutability).
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import {
  attemptFrom,
  error,
  json,
  readJson,
  requireTerminal,
  studentCards,
  studentFrom,
  type Terminal,
} from "@/lib/exam/server";
import { newTerminalToken, sha256, signAttempt, signStudent } from "@/lib/exam/tokens";

export const dynamic = "force-dynamic";

const START_ERRORS: Record<string, string> = {
  student_not_found: "We couldn't find your record. Ask your supervisor.",
  exam_not_found: "This exam is not available.",
  already_submitted: "You have already submitted this exam.",
  locked_other_terminal:
    "You already started this exam on another computer. Ask your supervisor to unlock it so you can continue here.",
  not_your_class: "This exam is for a different class.",
  exam_scheduled: "This exam hasn't opened yet.",
  exam_awaiting_start: "Please wait — your supervisor hasn't started the exam yet.",
  exam_paused: "The exam is paused. Please wait for your supervisor.",
  exam_closed: "This exam has closed.",
  attempt_not_found: "Exam session not found.",
  unanswered: "Please answer every question before submitting.",
};

const answersSchema = z
  .array(
    z.object({
      q: z.string().uuid(),
      s: z.string().regex(/^[A-F]$/).nullable(),
      f: z.boolean().optional(),
      at: z.string().datetime({ offset: true }),
    }),
  )
  .max(400);
const eventsSchema = z
  .array(z.object({ type: z.string().max(40), at: z.string().max(40).optional(), detail: z.record(z.string(), z.unknown()).optional() }))
  .max(200)
  .optional()
  .default([]);

export async function POST(req: Request, ctx: RouteContext<"/api/exam/[action]">) {
  const { action } = await ctx.params;
  if (action === "register") return register(req);

  const terminal = await requireTerminal(req);
  if (!terminal) return error("terminal", "This computer is not registered for exams.", 401);

  switch (action) {
    case "terminal":
      return terminalInfo(terminal);
    case "identify":
      return identify(req, terminal);
    case "classes":
      return classes(terminal);
    case "search":
      return search(req);
    case "session":
      return session(req, terminal);
    case "exams":
      return exams(req, terminal);
    case "start":
      return start(req, terminal);
    case "sync":
      return sync(req, terminal, false);
    case "submit":
      return sync(req, terminal, true);
    default:
      return error("not_found", "Unknown action", 404);
  }
}

async function register(req: Request) {
  const body = await readJson<{ code?: string; name?: string }>(req);
  const code = (body?.code ?? "").replace(/\D/g, "");
  const name = (body?.name ?? "").trim().slice(0, 60);
  if (code.length !== 8 || !name) return error("invalid", "Enter the 8-digit code and a name for this computer.");
  const db = createAdminClient();
  const { data: row } = await db
    .from("terminal_codes")
    .select("id, school_id, expires_at, created_by")
    .eq("code_hash", sha256(code))
    .maybeSingle();
  if (!row || Date.parse(row.expires_at) < Date.now()) return error("invalid", "That code is wrong or has expired.", 403);
  const token = newTerminalToken();
  const { data: t, error: e } = await db
    .from("lab_terminals")
    .insert({ school_id: row.school_id, name, token_hash: sha256(token), registered_by: row.created_by })
    .select("id, name")
    .single();
  if (e) return error("failed", e.message, 500);
  await db.from("audit_log").insert({ actor_id: row.created_by, action: "terminal.registered", entity: "lab_terminal", entity_id: t.id, detail: { name } });
  return json({ token, name: t.name });
}

async function terminalInfo(terminal: Terminal) {
  const db = createAdminClient();
  const { data: school } = await db.from("schools").select("name").eq("id", terminal.school_id).single();
  return json({ name: terminal.name, school: school?.name ?? "", server_now: new Date().toISOString() });
}

async function identify(req: Request, terminal: Terminal) {
  const body = await readJson<{ admission?: string }>(req);
  const input = (body?.admission ?? "").slice(0, 60);
  const db = createAdminClient();
  const { data } = await db.rpc("exam_lookup_admission", { p_school: terminal.school_id, p_input: input });
  const rows = (data ?? []) as { student_id: string; exact: boolean }[];
  const cards = await studentCards(rows.map((r) => r.student_id));
  return json({ exact: rows.some((r) => r.exact), students: cards });
}

async function classes(terminal: Terminal) {
  const db = createAdminClient();
  const { data } = await db
    .from("classes")
    .select("id, name, active, years!inner(level, sections!inner(school_id, cbt_enabled, name))")
    .eq("active", true)
    .eq("years.sections.school_id", terminal.school_id)
    .eq("years.sections.cbt_enabled", true);
  type Row = { id: string; name: string; years: { level: number; sections: { name: string } } };
  const list = ((data ?? []) as unknown as Row[])
    .map((c) => ({ id: c.id, name: c.name, level: c.years.level, section: c.years.sections.name }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return json({ classes: list });
}

async function search(req: Request) {
  const body = await readJson<{ classId?: string; q?: string }>(req);
  if (!body?.classId || !z.string().uuid().safeParse(body.classId).success) return error("invalid", "Choose your class.");
  const db = createAdminClient();
  const { data } = await db.rpc("exam_search_names", { p_class: body.classId, p_query: (body.q ?? "").slice(0, 60) });
  const ids = ((data ?? []) as { student_id: string }[]).map((r) => r.student_id);
  return json({ students: await studentCards(ids) });
}

async function session(req: Request, terminal: Terminal) {
  const body = await readJson<{ studentId?: string; method?: string }>(req);
  if (!body?.studentId || !z.string().uuid().safeParse(body.studentId).success) return error("invalid", "Choose a student.");
  const method = body.method === "name_search" ? "name_search" : "admission_no";
  const [card] = await studentCards([body.studentId]);
  if (!card) return error("student_not_found", START_ERRORS.student_not_found, 404);
  // Students must belong to this terminal's school.
  const db = createAdminClient();
  const { data: st } = await db.from("students").select("school_id").eq("id", body.studentId).single();
  if (st?.school_id !== terminal.school_id) return error("student_not_found", START_ERRORS.student_not_found, 404);
  const token = await signStudent({ sid: body.studentId, tid: terminal.id, m: method });
  const { data: available } = await db.rpc("exam_available", { p_student: body.studentId });
  return json({ token, student: card, exams: available ?? [], server_now: new Date().toISOString() });
}

async function exams(req: Request, terminal: Terminal) {
  const claims = await studentFrom(req, terminal);
  if (!claims) return error("expired", "Please log in again.", 401);
  const { data } = await createAdminClient().rpc("exam_available", { p_student: claims.sid });
  return json({ exams: data ?? [], server_now: new Date().toISOString() });
}

async function start(req: Request, terminal: Terminal) {
  const claims = await studentFrom(req, terminal);
  if (!claims) return error("expired", "Please log in again.", 401);
  const body = await readJson<{ windowId?: string }>(req);
  if (!body?.windowId || !z.string().uuid().safeParse(body.windowId).success) return error("invalid", "Choose an exam.");
  const { data, error: e } = await createAdminClient().rpc("exam_start", {
    p_student: claims.sid,
    p_window: body.windowId,
    p_terminal: terminal.id,
    p_method: claims.m,
  });
  if (e) return error("failed", "Could not start the exam. Try again.", 500);
  if (data?.error) return error(data.error, START_ERRORS[data.error] ?? "Could not start the exam.", 409);
  const token = await signAttempt({ aid: data.attempt.id, sid: claims.sid, tid: terminal.id }, data.attempt.deadline);
  return json({ token, ...data });
}

async function sync(req: Request, terminal: Terminal, submit: boolean) {
  const claims = await attemptFrom(req, terminal);
  if (!claims) return error("expired", "This exam session is not valid on this computer.", 401);
  const body = await readJson<{ answers?: unknown; events?: unknown; source?: string }>(req);
  const answers = answersSchema.safeParse(body?.answers ?? []);
  const events = eventsSchema.safeParse(body?.events ?? []);
  if (!answers.success || !events.success) return error("invalid", "Invalid data.");
  const db = createAdminClient();
  const { data, error: e } = submit
    ? await db.rpc("exam_submit", {
        p_attempt: claims.aid,
        p_answers: answers.data,
        p_events: events.data,
        p_source: body?.source === "timeout" ? "timeout" : "student",
      })
    : await db.rpc("exam_sync", { p_attempt: claims.aid, p_answers: answers.data, p_events: events.data });
  if (e) return error("failed", "Server error, will retry.", 500);
  if (data?.error) return error(data.error, START_ERRORS[data.error] ?? data.error, 409);
  return json({ ...data, server_now: data.server_now ?? new Date().toISOString() });
}
