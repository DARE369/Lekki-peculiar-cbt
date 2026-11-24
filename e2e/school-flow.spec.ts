import { expect, test, type Browser, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Walks the whole school workflow on a fresh database:
// setup → staff → class → students → questions → approval → lab PC → exam (with an outage) → reports.
test.describe.configure({ mode: "serial" });

const shots = process.env.E2E_SHOTS;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

const OWNER = { name: "School Owner", email: "owner@lps.test", password: "owner-password-123" };
let hodPassword = "";
let teacherPassword = "";
let terminalCode = "";

/** Passwords people chose at first sign-in (a temporary password can't be kept). */
const chosen = new Map<string, string>();

async function signIn(browser: Browser, email: string, givenPassword: string) {
  const password = chosen.get(email) ?? givenPassword;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("School email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Sign-in lands on /dashboard, which sends first-timers on to /welcome: wait until a page has settled.
  await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: /^(Welcome,|Good |Choose your password|About you)/ })).toBeVisible();
  if (/\/welcome/.test(page.url())) await quickOnboarding(page, password, email);
  await expect(page).toHaveURL(/\/dashboard/);
  return page;
}

/** A small Word document: question 1 with typed letters, question 2 using Word's automatic lettered list. */
async function wordFile() {
  const JSZip = (await import("jszip")).default;
  const p = (t: string, list?: boolean) =>
    `<w:p>${list ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : ""}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const body = [
    p("1. What is 2 + 3?"), p("A. 4"), p("B. 5"), p("C. 6"), p("ANSWER: B"), p(""),
    p("2. What is the capital of Nigeria?"), p("Kano", true), p("Abuja", true), p("Lagos", true), p("ANSWER: B"),
  ].join("");
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  zip.file(
    "word/numbering.xml",
    `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="upperLetter"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  );
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

/** First sign-in setup, taking the shortest path (the full flow has its own test). */
async function quickOnboarding(page: Page, password: string, email?: string) {
  for (let i = 0; i < 5; i++) {
    await page.waitForURL(/\/(welcome|dashboard)/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (/\/dashboard/.test(page.url())) return;
    const h1 = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
    if (h1.includes("Choose your password")) {
      const next = password.endsWith("-mine") ? password : `${password}-mine`;
      if (email) chosen.set(email, next);
      await page.getByLabel("New password").fill(next);
      await page.getByLabel("Type it again").fill(next);
      await page.getByRole("button", { name: "Save password and continue" }).click();
    } else if (await page.getByLabel("Your phone number").isVisible()) {
      await page.getByLabel("Your phone number").fill("0803 000 0000");
      await page.getByRole("button", { name: "Continue" }).click();
    } else if (h1.includes("What do you teach?")) {
      await page.getByRole("link", { name: /Skip for now/ }).click();
    } else {
      await page.getByRole("button", { name: "Go to my dashboard" }).click();
    }
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(h1);
  }
}

test("first-time setup creates the super admin", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("Setup code").fill(process.env.SETUP_SECRET ?? "local-setup");
  await page.getByLabel("Your full name").fill(OWNER.name);
  await page.getByLabel("School email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Create super administrator" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Good", { exact: false }).first()).toBeVisible();
});

test("super admin adds a Head of Section and a teacher", async ({ browser }) => {
  const page = await signIn(browser, OWNER.email, OWNER.password);
  await page.goto("/admin/staff");

  await page.getByLabel("Full name").fill("Mrs Elementary HOD");
  await page.getByLabel("School email").fill("hod@lps.test");
  await page.getByLabel("Role").selectOption("admin");
  await page.getByLabel("Elementary").check();
  await page.getByRole("checkbox", { name: "Grant make-up exams" }).check();
  await page.getByLabel("How should they sign in the first time?").selectOption("password");
  await page.getByRole("button", { name: "Add staff member" }).click();
  const msg = page.getByText(/Temporary password: (\S+)/);
  await expect(msg).toBeVisible();
  hodPassword = (await msg.textContent())!.match(/Temporary password: (\S+)/)![1];

  await page.getByLabel("Full name").fill("Mr Dixon");
  await page.getByLabel("School email").fill("dixon@lps.test");
  await page.getByLabel("Role").selectOption("teacher");
  await page.getByLabel("How should they sign in the first time?").selectOption("password");
  await page.getByRole("button", { name: "Add staff member" }).click();
  const msg2 = page.getByText(/Mr Dixon added. Temporary password: (\S+)/);
  await expect(msg2).toBeVisible();
  teacherPassword = (await msg2.textContent())!.match(/Temporary password: (\S+)/)![1];

  // A failed submission keeps what was typed (React would otherwise reset the form).
  await page.getByLabel("Full name").fill("Mr Dixon Again");
  await page.getByLabel("School email").fill("dixon@lps.test");
  await page.getByLabel("How should they sign in the first time?").selectOption("password");
  await page.getByRole("button", { name: "Add staff member" }).click();
  await expect(page.getByText(/already belongs to a staff member/)).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("Mr Dixon Again");
  await expect(page.getByLabel("School email")).toHaveValue("dixon@lps.test");
  await shot(page, "01-staff");
});

test("HOD sets up a class and students", async ({ browser }) => {
  const page = await signIn(browser, "hod@lps.test", hodPassword);
  await page.goto("/admin/classes");
  const elementary = page.locator("section", { has: page.getByRole("heading", { name: "Elementary" }) });
  await elementary.getByRole("combobox", { name: /^Year/ }).selectOption({ label: "Year 4" });
  await elementary.getByLabel("Class names").fill("Year 4 Gold");
  await elementary.getByRole("button", { name: "Add" }).first().click();
  await expect(elementary.getByText("Year 4 Gold").first()).toBeVisible();

  for (const [adm, first, last] of [
    ["LPS/2024/0137", "Charles", "Okafor"],
    ["LPS/2024/0138", "Amaka", "Bello"],
  ]) {
    await page.goto("/admin/students/new");
    await page.getByLabel("Admission number").fill(adm);
    await page.getByLabel("First name").fill(first);
    await page.getByLabel("Surname").fill(last);
    await page.getByLabel("Class").selectOption({ label: "Year 4 Gold" });
    await page.getByRole("button", { name: "Add student" }).click();
    await expect(page.getByRole("heading", { name: `${first} ${last}` })).toBeVisible();
  }
  await page.goto("/admin/students");
  await expect(page.getByText("Charles Okafor")).toBeVisible();
  await shot(page, "02-students");
});

test("HOD creates year classes and imports students from Excel", async ({ browser }) => {
  const page = await signIn(browser, "hod@lps.test", hodPassword);
  await page.goto("/admin/classes");
  const elementary = page.locator("section", { has: page.getByRole("heading", { name: "Elementary" }) });
  // Year 4 already has "Year 4 Gold", so only the other five years get a class.
  await elementary.getByRole("button", { name: "Create 5 year classes" }).click();
  await expect(elementary.getByText("Year 2 · 0")).toBeVisible();
  await expect(elementary.getByText("Year 6 · 0")).toBeVisible();
  await expect(elementary.getByText("No classes")).toHaveCount(0);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["Student_id", "Full_name", "Class", "parent_phone", "parent_email"]);
  ws.addRow(["LPS2026/01/501", "TOLU ADA BANKOLE", "Year 2", 2348000000000, "parent@example.com"]);
  ws.addRow(["LPS2026/01/502", "KEMI OKON", "Nursery", 2348000000001, ""]);
  const file = Buffer.from(await wb.xlsx.writeBuffer());

  await page.goto("/admin/students/import");
  await page.locator('input[type="file"]').setInputFiles({ name: "students.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file });
  await expect(page.getByText(/This class isn't set up yet: Nursery \(1\)/)).toBeVisible();
  await expect(page.getByText("Not imported (not used by the CBT): parent_phone, parent_email.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Bankole" })).toBeVisible();
  await page.getByRole("button", { name: "Import 1" }).click();
  await expect(page.getByText("Imported 1 students")).toBeVisible();
  await expect(page.getByText("Skipped — class not set up: Nursery (1).")).toBeVisible();
  await page.goto("/admin/students");
  await expect(page.getByRole("link", { name: "Tolu Ada Bankole" })).toBeVisible();
});

test("a teacher's subject with no other teacher is approved at once; the HOD is told and can undo", async ({ browser }) => {
  const teacher = await signIn(browser, "dixon@lps.test", teacherPassword);
  await teacher.goto("/teach/classes");
  await teacher.getByRole("button", { name: "Basic Science — Year 4 Gold" }).click();
  await teacher.getByRole("button", { name: "Save my subjects and classes" }).click();
  // Saving goes straight to what to do next.
  await expect(teacher).toHaveURL(/\/dashboard\?done=subjects/);
  await expect(teacher.getByText("Your subjects and classes are saved.")).toBeVisible();
  await expect(teacher.getByRole("link", { name: "Upload my questions" })).toBeVisible();
  // Nobody else teaches Basic Science in Year 4 Gold, so there is nothing to wait for.
  await teacher.goto("/teach/classes");
  await expect(teacher.getByText("Awaiting approval")).toHaveCount(0);
  await expect(teacher.getByRole("link", { name: /Year 4 Gold/ })).toBeVisible();

  // The Head of Section sees it in the one Approvals inbox, with nothing waiting and an undo.
  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/admin/approvals");
  const nav = hod.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Class assignments" })).toHaveCount(0);
  await expect(nav.getByText("Needs you", { exact: true })).toBeVisible();
  await hod.getByRole("navigation", { name: "Approvals" }).getByRole("link", { name: /Teaching requests/ }).click();
  await expect(hod.getByRole("navigation", { name: "Approvals" }).getByRole("link", { name: /Teaching requests/ })).toHaveAttribute("aria-current", "page");
  await expect(hod.getByText("No requests waiting")).toBeVisible();
  const auto = hod.locator("li", { hasText: "Mr Dixon · Basic Science · Year 4 Gold" });
  await expect(auto.getByRole("button", { name: "Remove" })).toBeVisible();
  await shot(hod, "05b-approvals-inbox-requests");
});

test("teacher uploads questions, builds a test and submits it", async ({ browser }) => {
  const page = await signIn(browser, "dixon@lps.test", teacherPassword);
  await page.goto("/teach/assessments/new");
  await page.getByLabel("Class").selectOption({ index: 1 });
  const science = await page.locator(`select[name="subject_id"] option`, { hasText: "Basic Science" }).first().getAttribute("value");
  await page.locator(`select[name="subject_id"]`).selectOption(science!);
  await page.getByLabel("Title").fill("Basic Science Test 1");
  await page.getByLabel("Number of questions").fill("5");
  await page.getByLabel("Time allowed (minutes)").fill("20");
  await page.getByRole("button", { name: "Create and add questions" }).click();
  await expect(page.getByRole("heading", { name: /Basic Science Test 1/ })).toBeVisible();

  await page.getByRole("link", { name: "Upload into this test" }).click();
  const text = Array.from({ length: 6 }, (_, i) => `Question number ${i + 1}?\nA. one\nB. two\nC. three\nD. four\nANSWER: B\nTOPIC: Topic ${i % 2}`).join("\n\n");
  // Pasting is the default; the text is checked as it arrives (no button to press).
  await expect(page.getByRole("button", { name: "Copy and paste" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Paste your questions").fill(text);
  await expect(page.getByText("6 questions found")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save 6 questions" })).toBeVisible();
  await shot(page, "03-import-preview");
  await page.getByRole("button", { name: "Save 6 questions" }).click();
  // The upload ends on a receipt that accounts for every question.
  const receipt = page.locator("#import-receipt");
  await expect(receipt.getByText("Saved as new questions")).toBeVisible();
  await expect(receipt.getByText("Total")).toBeVisible();
  await shot(page, "03b-import-receipt");
  await receipt.getByRole("link", { name: "Back to the test" }).click();
  await expect(page).toHaveURL(/\/teach\/assessments\/[0-9a-f-]+(\?.*)?$/);
  await expect(page.getByText("Questions (6)")).toBeVisible();
  // Settings save by themselves: a topic, and marks "out of 20".
  await page.getByRole("textbox", { name: /^Topic/ }).fill("Living things");
  await page.getByRole("textbox", { name: "Test is out of" }).fill("20");
  await expect(page.getByText(/Scores are out of 20/)).toBeVisible();
  await expect(page.getByText(/^Saved \d/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Test is out of" })).toHaveValue("20");

  // Students get a calculator by default; a teacher can switch it off for a test, and back on.
  await expect(page.getByLabel("Give students a calculator")).toBeChecked();
  await page.getByLabel("Give students a calculator").uncheck();
  await page.waitForTimeout(2000); // the panel saves by itself after a short pause
  await page.reload();
  await expect(page.getByLabel("Give students a calculator")).not.toBeChecked();
  await page.getByLabel("Give students a calculator").check();
  await page.waitForTimeout(2000);
  await page.reload();
  await expect(page.getByLabel("Give students a calculator")).toBeChecked();

  // Nothing left to check, so it goes straight off for review.
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page).toHaveURL(/\/dashboard\?done=submitted/);
  await expect(page.getByText("Your test was sent for approval.")).toBeVisible();
  await shot(page, "04-submitted");
});

test("HOD approves, schedules and creates a lab registration code", async ({ browser }) => {
  const page = await signIn(browser, "hod@lps.test", hodPassword);
  await page.goto("/admin/approvals");
  await page.getByRole("link", { name: "Basic Science Test 1" }).click();
  await page.waitForURL(/\/admin\/approvals\/[0-9a-f-]+$/);
  await page.getByLabel("Year 4 Gold").check();
  const now = new Date(Date.now() + 3600_000 - 5 * 60_000); // Lagos local, 5 min ago
  const later = new Date(now.getTime() + 3 * 3600_000);
  await page.getByLabel("Opens (Lagos time)").fill(now.toISOString().slice(0, 16));
  await page.getByLabel("Closes (no new starts after this)").fill(later.toISOString().slice(0, 16));
  // Exams start by themselves by default; this one is set to wait for an administrator.
  await expect(page.getByLabel("Start automatically at the opening time")).toBeChecked();
  await page.getByLabel("Start automatically at the opening time").uncheck();
  // A comment on one question goes to the teacher with the approval.
  await page.getByText("Comment on this question").first().click();
  await page.getByLabel("Comment on question 1").fill("Good question, keep this style");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/exams/);
  await expect(page.getByText("Waiting for admin to start")).toBeVisible();

  await page.goto("/admin/terminals");
  await page.getByRole("button", { name: "Create registration code" }).click();
  const code = page.getByText(/Registration code: (\d{4} \d{4})/);
  await expect(code).toBeVisible();
  terminalCode = (await code.textContent())!.match(/(\d{4} \d{4})/)![1];
});

test("students sit the exam on a lab computer, surviving an internet outage", async ({ browser }) => {
  const lab = await browser.newContext();
  const pc = await lab.newPage();
  await pc.goto("/exam");
  await pc.getByLabel("Registration code").fill(terminalCode);
  await pc.getByLabel("Name for this computer").fill("Lab 1 – PC 01");
  await pc.getByRole("button", { name: "Register" }).click();

  // Typo-tolerant admission number: different formatting, no leading zero.
  await pc.getByLabel("Admission number").fill("lps 2024 137");
  await pc.getByRole("button", { name: "Continue" }).click();
  await expect(pc.getByText("Is this you?")).toBeVisible();
  await expect(pc.getByText("Charles Okafor")).toBeVisible();
  await shot(pc, "05-is-this-you");
  await pc.getByRole("button", { name: "Yes, this is me" }).click();
  await expect(pc.getByText("Waiting for your supervisor to start")).toBeVisible();
  await shot(pc, "06-waiting");

  // The HOD starts the exam; the student's screen updates by itself.
  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/admin/exams");
  // An exam waiting for Start is called out at the top, with its own button.
  await expect(hod.getByText("1 exam is waiting for you to press Start")).toBeVisible();
  await shot(hod, "07b-exam-waiting-to-start");
  await hod.getByRole("link", { name: /^Start Basic Science Test 1/ }).click();
  hod.once("dialog", (d) => d.accept());
  await hod.getByRole("button", { name: /Start exam now/ }).click();
  await expect(hod.getByText(/Live — students in Year 4 Gold can start now/)).toBeVisible();

  await expect(pc.getByRole("button", { name: "Start" })).toBeVisible({ timeout: 20_000 });
  await pc.getByRole("button", { name: "Start" }).click();
  await pc.getByLabel(/I am Charles Okafor/).check();
  await pc.getByRole("button", { name: "Start exam" }).click();
  await expect(pc.getByText("Question 1 of 5")).toBeVisible();
  await shot(pc, "07-question");

  // The calculator: brackets, order of working, decimals, mistakes, keyboard, and it stays while moving between questions.
  await pc.getByRole("button", { name: "Open calculator" }).click();
  const sum = pc.getByLabel("Your sum");
  const press = async (...keys: string[]) => {
    for (const k of keys) await pc.getByRole("button", { name: k, exact: true }).click();
  };
  await press("Open bracket", "2", "Plus", "3", "Close bracket", "Multiply", "4");
  await expect(sum).toHaveValue("(2+3)×4");
  await expect(pc.getByText("= 20")).toBeVisible(); // live preview before pressing equals
  await press("Equals");
  await expect(sum).toHaveValue("20");
  await press("Divide", "8", "Equals"); // carries on from the answer
  await expect(sum).toHaveValue("2.5");
  await press("7"); // a number after an answer starts a new sum
  await expect(sum).toHaveValue("7");
  await press("Clear");
  await sum.fill("0.1+0.2");
  await sum.press("Enter");
  await expect(sum).toHaveValue("0.3"); // not 0.30000000000000004
  await press("Clear");
  await sum.fill("2+3*4");
  await sum.press("Enter");
  await expect(sum).toHaveValue("14"); // × before +
  await press("Clear");
  await sum.fill("5/0");
  await sum.press("Enter");
  await expect(pc.getByText("Can't divide by zero")).toBeVisible();
  await press("Clear");
  await sum.pressSequentially("b"); // letters are not part of a sum (and don't pick an answer)
  await expect(sum).toHaveValue("");
  await shot(pc, "36-calculator");
  // It keeps the working while the student moves between questions.
  await sum.fill("7×6");
  await pc.getByRole("button", { name: "Next →" }).click();
  await expect(pc.getByText("Question 2 of 5")).toBeVisible();
  await expect(sum).toHaveValue("7×6");
  await pc.getByRole("button", { name: "← Previous" }).click();
  await expect(pc.getByText("Question 1 of 5")).toBeVisible();
  await sum.press("Escape");
  await expect(pc.getByRole("dialog", { name: "Calculator" })).toHaveCount(0);

  // Answer two questions online. Options are shuffled, so pick by text: "two" is always correct.
  for (let i = 0; i < 2; i++) {
    await pc.getByRole("radio", { name: /two$/ }).click();
    await pc.getByRole("button", { name: "Next →" }).click();
  }
  await expect(pc.getByText("All answers saved")).toBeVisible({ timeout: 15_000 });

  // Internet goes down: keep answering, then reload the page with no network.
  await lab.setOffline(true);
  await pc.getByRole("radio", { name: /two$/ }).click();
  await pc.getByRole("button", { name: "Next →" }).click();
  await expect(pc.getByText("Offline — answers saved on this computer")).toBeVisible({ timeout: 15_000 });
  await shot(pc, "08-offline");
  await pc.reload();
  await expect(pc.getByRole("button", { name: "Continue exam" })).toBeVisible();
  await pc.getByRole("button", { name: "Continue exam" }).click();
  await expect(pc.getByText("3 of 5 answered")).toBeVisible();

  // Flag one, answer the rest wrongly ("one"), submit while still offline.
  await pc.getByRole("button", { name: /Flag for review/ }).click();
  await pc.getByRole("radio", { name: /one$/ }).click();
  await pc.getByRole("button", { name: "Next →" }).click();
  await pc.getByRole("radio", { name: /one$/ }).click();
  await pc.getByRole("button", { name: "Finish & submit" }).click();
  await expect(pc.getByText("Flagged for review:")).toBeVisible();
  await shot(pc, "09-review");
  await pc.getByRole("button", { name: "Submit now" }).click();
  await expect(pc.getByText("finished and saved on this computer")).toBeVisible();
  await shot(pc, "10-waiting-upload");

  // Network returns → submission uploads → score shown.
  await lab.setOffline(false);
  await expect(pc.getByText("Exam submitted")).toBeVisible({ timeout: 30_000 });
  // The test is marked out of 20: 3 of 5 right = 12 / 20 (60%).
  await expect(pc.getByText(/12\s*\/ 20/)).toBeVisible();
  await shot(pc, "11-result");
  await pc.getByRole("button", { name: /Finish — next student/ }).click();

  // Second student forgot their number: class → name → photo.
  await pc.getByRole("button", { name: "I don't know my number" }).click();
  await pc.getByRole("button", { name: "Year 4 Gold" }).click();
  await pc.getByLabel("Your name").fill("amak");
  await pc.getByRole("button", { name: /Amaka Bello/ }).click();
  await pc.getByRole("button", { name: "Yes, this is me" }).click();
  await expect(pc.getByRole("button", { name: "Start" })).toBeVisible();
  await shot(pc, "12-second-student");

  // Charles cannot sit it again.
  await pc.getByRole("button", { name: /Log out/ }).click();
  await pc.getByLabel("Admission number").fill("LPS-2024-0137");
  await pc.getByRole("button", { name: "Continue" }).click();
  await pc.getByRole("button", { name: "Yes, this is me" }).click();
  await expect(pc.getByText("Submitted ✓")).toBeVisible();

  // Monitor reflects it.
  await hod.reload();
  await expect(hod.getByText("12/20")).toBeVisible();
  await expect(hod.getByText("Name login").or(hod.getByText("Not started")).first()).toBeVisible();
  await shot(hod, "13-monitor");
});

test("teacher sees organised reports and can fix an answer key", async ({ browser }) => {
  const page = await signIn(browser, "dixon@lps.test", teacherPassword);
  await page.goto("/reports");
  await page.getByRole("link", { name: "Basic Science Test 1" }).click();
  await expect(page.getByRole("link", { name: "Charles Okafor" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "60%" })).toBeVisible();
  await shot(page, "14-results");

  await page.getByRole("link", { name: "Questions" }).click();
  await expect(page.getByText("Sorted hardest first")).toBeVisible();
  await shot(page, "15-item-analysis");

  // Charles answered "one" (the original key A) on two questions; make one of those keys A.
  const hardest = page.locator("tbody tr").first();
  await hardest.getByText("Fix answer key").click();
  await hardest.getByRole("combobox").selectOption("A");
  page.once("dialog", (d) => d.accept());
  await hardest.getByRole("button", { name: "Regrade" }).click();
  await expect(page.getByText(/regraded/)).toBeVisible();
  await page.getByRole("link", { name: "Students" }).click();
  await expect(page.getByRole("cell", { name: "80%" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "16/20" })).toBeVisible();

  await page.goto("/reports");
  await page.getByRole("link", { name: "Year 4 Gold" }).click();
  await expect(page.getByRole("columnheader", { name: "Basic Science" })).toBeVisible();
  await expect(page.getByText("Class average")).toBeVisible();
  await shot(page, "16-broadsheet");

  await page.getByRole("link", { name: /Charles Okafor/ }).click();
  await expect(page.getByText("Summary by subject")).toBeVisible();
  await page.getByText(/question missed or wrong/).click();
  await expect(page.getByText(/Correct: two/)).toBeVisible();
  await shot(page, "17-student");
});

test("super admin bulk adds staff and deletes one; staff with exam work can't be deleted", async ({ browser }) => {
  const page = await signIn(browser, OWNER.email, OWNER.password);
  await page.goto("/admin/staff");
  await page.getByRole("link", { name: "Bulk add staff" }).click();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Staff");
  ws.addRow(["Full Name", "Email", "Role", "Section"]);
  ws.addRow(["MRS GRACE EZE", "grace@lps.test", "Teacher", ""]);
  ws.addRow(["Mr Kunle Ade", "kunle@lps.test", "HOD", "College"]);
  ws.addRow(["Mr Dixon Again", "dixon@lps.test", "Teacher", ""]); // already on the staff list
  ws.addRow(["No Email", "", "Teacher", ""]);
  await page.getByLabel("Staff spreadsheet").setInputFiles({
    name: "staff.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  });
  await expect(page.getByText("Missing or invalid email")).toBeVisible();
  await page.getByLabel(/Temporary passwords/).check();
  await page.getByRole("button", { name: "Add 3 staff" }).click();
  await expect(page.getByText("Added 2 of 3.")).toBeVisible();
  await expect(page.getByText("Already on the staff list")).toBeVisible();
  const graceRow = page.getByRole("row", { name: /Mrs Grace Eze/ });
  const gracePassword = (await graceRow.locator("td").nth(3).innerText()).trim();
  expect(gracePassword).toMatch(/^\S{12}$/);

  // The new teacher can sign in with the temporary password.
  const grace = await signIn(browser, "grace@lps.test", gracePassword);
  await expect(grace.getByText("Mrs Grace Eze").first()).toBeVisible();
  await grace.context().close();

  // Kunle has no exam work, so he can be deleted.
  await page.goto("/admin/staff");
  await expect(page.getByRole("row", { name: /Mr Kunle Ade/ }).getByText("Head of Section")).toBeVisible();
  await page.getByRole("link", { name: "Mr Kunle Ade", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete Mr Kunle Ade" }).click();
  await expect(page.getByText("Mr Kunle Ade was deleted.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Mr Kunle Ade", exact: true })).toHaveCount(0);

  // Mr Dixon wrote questions and a test, so deleting him is refused.
  await page.getByRole("link", { name: "Mr Dixon", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /^Delete Mr Dixon/ }).click();
  await expect(page.getByText(/can't be deleted/)).toBeVisible();
});

test("bulk add emails each person an invitation with steps for their role", async ({ browser }) => {
  const page = await signIn(browser, OWNER.email, OWNER.password);
  await page.goto("/admin/staff/import");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Staff");
  ws.addRow(["Full Name", "Email", "Role", "Section"]);
  ws.addRow(["Mrs Ngozi Obi", "ngozi@lps.test", "Teacher", ""]);
  ws.addRow(["Mr Femi Lawal", "femi@lps.test", "Head of Section", "College"]);
  await page.getByLabel("Staff spreadsheet").setInputFiles({
    name: "staff.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  });
  await expect(page.getByLabel(/Email each person an invitation/)).toBeChecked();
  await page.getByRole("button", { name: "Add and invite 2 staff" }).click();
  await expect(page.getByText("Added 2 of 2.")).toBeVisible();
  await expect(page.getByText(/Invitations are on their way/)).toBeVisible();

  // Read what the auth server actually sent (decoding quoted-printable).
  const mailDir = "/var/tmp/sblogs/mail";
  const mailTo = (addr: string) => {
    const raw = readdirSync(mailDir)
      .map((f) => readFileSync(`${mailDir}/${f}`, "utf8"))
      .find((m) => new RegExp(`^To: .*${addr}`, "mi").test(m));
    if (!raw) throw new Error(`no email for ${addr}`);
    return raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  };
  const teacherMail = mailTo("ngozi@lps.test");
  expect(teacherMail).toContain("Dear Mrs Ngozi Obi,");
  expect(teacherMail).toContain("a <strong>Teacher</strong>");
  expect(teacherMail).toContain("<strong>My classes</strong>");
  expect(teacherMail).not.toContain("Teaching assignments");
  const hodMail = mailTo("femi@lps.test");
  expect(hodMail).toContain("<strong>Head of Section</strong> for <strong>College</strong>");
  expect(hodMail).toContain("<strong>Teaching assignments</strong>");

  // Accepting the invitation signs her in and shows the welcome note.
  const link = teacherMail.match(/href="([^"]+)"[^>]*>Accept invitation/)![1].replace(/&amp;/g, "&");
  const ctx = await browser.newContext();
  const ngozi = await ctx.newPage();
  await ngozi.goto(link);
  await expect(ngozi).toHaveURL(/\/welcome$/);
  await expect(ngozi.getByText("Welcome, Ngozi!")).toBeVisible();
  await expect(ngozi.getByRole("heading", { name: "Choose your password" })).toBeVisible();
  await ctx.close();
});

test("a new teacher is guided through setup, uploads while waiting, and is emailed on approval", async ({ browser }) => {
  // Super admin: a deadline and a small target, then a new teacher with a temporary password.
  const owner = await signIn(browser, OWNER.email, OWNER.password);
  // Settings lists what still needs setting up; deadlines are one click away.
  await owner.goto("/admin/settings");
  await expect(owner.getByText(/things? to set up/)).toBeVisible();
  await owner.getByRole("link", { name: /Question deadlines: not set/ }).click();
  await expect(owner.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Question deadlines" })).toHaveAttribute("aria-current", "page");
  const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await owner.getByLabel("Elementary").fill(due);
  await owner.getByRole("button", { name: "Save deadlines" }).click();
  await expect(owner.getByText("Deadlines saved.")).toBeVisible();
  await owner.goto("/admin/progress");
  // The super admin sees what's still missing before inviting staff.
  await expect(owner.getByText(/^(Before you|Ready to) invite staff$/)).toBeVisible();
  await expect(owner.getByText("Question deadline set")).toBeVisible();
  // Someone already teaches Mathematics in Year 5, so Ada's request for it will need the Head of Section.
  await owner.goto("/admin/assignments");
  await owner.getByLabel("Teacher").selectOption({ label: "Mrs Elementary HOD" });
  await owner.getByLabel("Subject").selectOption({ label: "Mathematics (Elementary)" });
  await owner.getByLabel("Year 5", { exact: true }).check();
  await owner.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(owner.getByText(/Assigned|assigned/).first()).toBeVisible();
  await owner.goto("/admin/staff");
  await owner.getByLabel("Full name").fill("Mrs Ada Bello");
  await owner.getByLabel("School email").fill("ada@lps.test");
  await owner.getByLabel("How should they sign in the first time?").selectOption("password");
  await owner.getByRole("button", { name: "Add staff member" }).click();
  const msg = owner.getByText(/Mrs Ada Bello added. Temporary password: (\S+)/);
  await expect(msg).toBeVisible();
  const temp = (await msg.textContent())!.match(/Temporary password: (\S+)/)![1];

  // First sign-in goes straight to the setup screens.
  const ctx = await browser.newContext();
  const ada = await ctx.newPage();
  await ada.goto("/login");
  await ada.getByLabel("School email").fill("ada@lps.test");
  await ada.getByLabel("Password").fill(temp);
  await ada.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(ada).toHaveURL(/\/welcome/);
  await expect(ada.getByText("Welcome, Ada!")).toBeVisible();
  await expect(ada.getByText("Step 1 of 4")).toBeVisible();
  // Password first, with the email in the form so the browser can save the login.
  await expect(ada.getByRole("heading", { name: "Choose your password" })).toBeVisible();
  await expect(ada.locator('input[autocomplete="username"]')).toHaveValue("ada@lps.test");
  await ada.getByLabel("New password").fill("ada-pass-1");
  await ada.getByLabel("Type it again").fill("ada-pass-2");
  await ada.getByRole("button", { name: "Save password and continue" }).click();
  await expect(ada.getByText("The two passwords are not the same.")).toBeVisible();
  await ada.getByLabel("New password").fill("ada-pass-1");
  await ada.getByLabel("Type it again").fill("ada-pass-1");
  await ada.getByRole("button", { name: "Save password and continue" }).click();

  await expect(ada.getByRole("heading", { name: "About you" })).toBeVisible();
  await ada.getByLabel("Your phone number").fill("0803 555 1234");
  await ada.getByRole("button", { name: "Continue" }).click();

  await expect(ada.getByRole("heading", { name: "What do you teach?" })).toBeVisible();
  await expect(ada.getByText("Step 3 of 4")).toBeVisible();
  await ada.getByRole("tab", { name: /Elementary/ }).click();
  await ada.getByRole("button", { name: "Mathematics — Year 4 Gold" }).click();
  await ada.getByRole("button", { name: "Mathematics — Year 5" }).click();
  await ada.getByRole("button", { name: "English Language — Year 5" }).click();
  await expect(ada.getByText("You've chosen 3 classes across 2 subjects.")).toBeVisible();
  await shot(ada, "18-onboarding-subjects");
  await ada.getByRole("button", { name: "Continue" }).click();

  await expect(ada.getByRole("heading", { name: "How to upload your questions" })).toBeVisible();
  await expect(ada.getByText("Upload your questions and build your tests by")).toBeVisible();
  await ada.getByRole("button", { name: "Go to my dashboard" }).click();
  await expect(ada).toHaveURL(/\/dashboard/);

  // Dashboard checklist: Year 4 Gold was approved at once; Year 5 Mathematics waits (another teacher has it), but uploading is allowed.
  const checklist = ada.locator("div", { has: ada.getByRole("heading", { name: "Your subjects and classes" }) }).first();
  await expect(ada.getByText("You haven't been assigned any classes yet")).toHaveCount(0);
  await expect(checklist.getByText("Deadline:")).toBeVisible();
  await expect(checklist.getByText("Waiting for approval — you can still upload").first()).toBeVisible();
  await checklist.locator("li", { hasText: "Year 4" }).getByRole("link", { name: "Upload questions" }).click();
  await expect(ada.getByLabel("Year group")).toHaveValue(/.+/);
  const text = Array.from({ length: 3 }, (_, i) => `Ada question ${i + 1}?\nA. one\nB. two\nC. three\nD. four\nANSWER: A`).join("\n\n");
  await ada.getByLabel("Paste your questions").fill(text);
  await ada.getByRole("button", { name: "Save 3 questions" }).click();
  await expect(ada.getByText("Saved as new questions")).toBeVisible();
  await ada.goto("/dashboard");
  await expect(checklist.locator("li", { hasText: "Year 4" }).getByText("questions uploaded")).toContainText("3");
  await expect(ada.getByText(/\/ 40|of 40/)).toHaveCount(0);
  await shot(ada, "19-dashboard-checklist");

  // Staff progress shows her phone and where she is.
  await owner.goto("/admin/progress");
  const row = owner.getByRole("row", { name: /Mrs Ada Bello/ });
  await expect(row.getByText("08035551234")).toBeVisible();
  await expect(row.getByText("Adding questions")).toBeVisible();
  await expect(row.getByText("awaiting approval").first()).toBeVisible();

  // Head of Section approves the clash; Ada gets an email about it.
  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/admin/assignments");
  await hod.getByRole("button", { name: "Approve ticked" }).click();
  await expect(hod.getByText("No requests waiting")).toBeVisible();
  const mailDir = "/var/tmp/sblogs/mail";
  await expect
    .poll(() => readdirSync(mailDir).some((f) => /^To: .*ada@lps\.test/mi.test(readFileSync(`${mailDir}/${f}`, "utf8"))), { timeout: 15_000 })
    .toBe(true);
  const raw = readdirSync(mailDir)
    .map((f) => readFileSync(`${mailDir}/${f}`, "utf8"))
    .filter((m) => /^To: .*ada@lps\.test/mi.test(m))
    .join("\n")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  expect(raw).toMatch(/Subject: .*approved/i);
  expect(raw).toContain("Dear Mrs Ada Bello");
  expect(raw).toContain("Mathematics");
  expect(raw).toContain("Year 5");

  await ada.goto("/dashboard");
  await expect(ada.getByText("Waiting for approval — you can still upload")).toHaveCount(0);

  // New test: class first, then only the subjects she teaches in that class.
  await ada.goto("/teach/assessments/new");
  const classSelect = ada.getByRole("combobox", { name: /^Class/ });
  await expect(classSelect.locator("option:not([disabled])")).toHaveText([/Year 4 Gold/, /Year 5/]);
  await classSelect.selectOption({ label: (await classSelect.locator("option", { hasText: "Year 4 Gold" }).textContent())! });
  const subjectSelect = ada.locator(`select[name="subject_id"]`);
  await expect(subjectSelect.locator("option:not([disabled])")).toHaveText([/Mathematics/]); // English is for Year 5 only
  await subjectSelect.selectOption((await subjectSelect.locator("option", { hasText: "Mathematics" }).getAttribute("value"))!);
  await expect(ada.getByLabel("Year 4 Gold")).toBeChecked();
  await ada.getByRole("button", { name: /^Exam mock/ }).click();
  await expect(ada.getByLabel("Number of questions")).toHaveValue("40");
  await ada.getByRole("button", { name: "45 min" }).click();
  await expect(ada.getByLabel("Time allowed (minutes)")).toHaveValue("45");
  await ada.getByRole("button", { name: "Create and add questions" }).click();
  await expect(ada.getByText("Mathematics · Year 4 Gold · Exam mock · 40 questions · 45 minutes")).toBeVisible();

  // Upload a Word file: typed letters in question 1, Word's automatic A/B/C list in question 2.
  await ada.getByRole("link", { name: "Upload into this test" }).click();
  await ada.getByRole("button", { name: "Word document", exact: true }).click();
  await ada.getByLabel("Choose a Word document file").setInputFiles({
    name: "maths.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await wordFile(),
  });
  await expect(ada.getByRole("button", { name: "Save 2 questions" })).toBeVisible();
  await expect(ada.getByText("A. Kano")).toBeVisible(); // automatic lettering came through
  await ada.getByRole("button", { name: "Edit question 1" }).click();
  await ada.getByLabel("Correct answer").selectOption("C");
  await ada.getByRole("button", { name: "Done" }).click();
  await expect(ada.getByText("C. 6 ✓")).toBeVisible();
  await ada.getByRole("button", { name: "Remove question 2" }).click();
  await ada.getByRole("button", { name: "Save 1 question" }).click();
  await expect(ada.getByText("Removed by you before saving")).toBeVisible();
  await ada.getByRole("link", { name: "Back to the test" }).click();
  await expect(ada).toHaveURL(/\/teach\/assessments\/[0-9a-f-]+(\?.*)?$/);
  await expect(ada.getByText("Questions (1)")).toBeVisible();
  // ...and it can still be edited after saving.
  await ada.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(ada.getByRole("heading", { name: "Edit question" })).toBeVisible();
  await ada.getByRole("link", { name: "Back to test" }).click();
  await ctx.close();
});

test("staff can start Google sign-in; non-staff Google accounts are turned away", async ({ page }) => {
  await page.goto("/login");
  const toGoogle = page.waitForRequest((r) => r.url().startsWith("https://accounts.google.com/"));
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const googleUrl = new URL((await toGoogle).url());
  expect(googleUrl.searchParams.get("client_id")).toBe("local-test.apps.googleusercontent.com");
  expect(googleUrl.searchParams.get("prompt")).toBe("select_account");

  // What Supabase sends back when sign-ups are off and the Google account isn't a staff account.
  await page.goto("/auth/callback?error=access_denied&error_description=Signups+not+allowed+for+this+instance");
  await expect(page).toHaveURL(/\/login\?error=not-staff/);
  await expect(page.getByText("That Google account isn't on the staff list.")).toBeVisible();
});

test("links from Supabase emails (invite, magic link, reset) sign the person in", async ({ page }) => {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  // Same kind of link Supabase emails by default: /auth/v1/verify → redirect with the session in the #fragment.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: OWNER.email,
    options: { redirectTo: "http://localhost:3000/auth/callback?next=/account" },
  });
  expect(error).toBeNull();
  // The local auth server leaves out the /auth/v1 prefix that hosted Supabase includes.
  const link = data.properties!.action_link.replace(/:54321\/verify/, ":54321/auth/v1/verify");
  await page.goto(link);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(OWNER.email).first()).toBeVisible();

  // The same link a second time is refused with a clear message.
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page.getByText("This link has expired or was already used.")).toBeVisible();
});

test("forgot password sends a branded email whose link opens the new-password form", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("School email").fill(OWNER.email);
  // The previous test emailed this person a moment ago; the auth server allows one email per second.
  await page.waitForTimeout(1500);
  const sentAfter = Date.now();
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByText(/a reset link is on its way/)).toBeVisible();

  const mailDir = "/var/tmp/sblogs/mail";
  let mail = "";
  await expect(async () => {
    const f = readdirSync(mailDir)
      .filter((x) => Number(x.split("-")[0]) >= sentAfter - 1000)
      .map((x) => readFileSync(`${mailDir}/${x}`, "utf8"))
      .find((m) => new RegExp(`^To: .*${OWNER.email}`, "mi").test(m));
    expect(f).toBeTruthy();
    mail = f!.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }).toPass({ timeout: 10_000 });
  expect(mail).toContain("Choose your password");
  expect(mail).toContain("Warm regards,");

  const link = mail.match(/href="([^"]+)"[^>]*>Set my password/)![1].replace(/&amp;/g, "&");
  await page.goto(link);
  // The reset link opens its own page (not the account page) to choose the new password.
  await expect(page).toHaveURL(/\/auth\/set-password$/);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
});

test("a teacher pastes JSON copied from ChatGPT, with smart quotes and chatter, and it just works", async ({ browser }) => {
  const page = await signIn(browser, "dixon@lps.test", teacherPassword);
  await page.goto("/teach/questions/import");
  const messy = [
    "Sure! Here are your questions:",
    "```json",
    "[",
    "  { “question”: “What is 5 × 5?”, “options”: [“A. 20”, “B. 25”, “C. 30”, “D. 35”], “answer”: “B”, “difficulty”: “easy”, },",
    "  { “question”: “Name the capital of Nigeria.”, “options”: [“Lagos”, “Abuja”, “Kano”], “correctAnswer”: “Abuja” }",
    "]",
    "```",
    "I hope this helps!",
  ].join("\n");
  await page.getByLabel("Paste your questions").fill(messy);
  await expect(page.getByText("Reading as JSON")).toBeVisible();
  await expect(page.getByText("2 questions found")).toBeVisible();
  await expect(page.getByText("We tidied up your text:")).toBeVisible();
  await expect(page.getByText("B. 25 ✓")).toBeVisible();
  await expect(page.getByText("B. Abuja ✓")).toBeVisible();
  // The AI instructions button gives a ready-made prompt.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy instructions for the AI" }).click();
  await expect(page.getByRole("button", { name: /Copied/ })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Reply with ONLY a JSON list");
  await page.getByRole("button", { name: "Save 2 questions" }).click();
  await expect(page.getByText("Saved as new questions")).toBeVisible();

  // Uploading the same questions again: they are recognised before saving, not silently dropped.
  await page.getByRole("button", { name: "Upload more" }).click();
  await page.getByLabel("Paste your questions").fill(messy);
  await expect(page.getByText(/Already in .*added/).first()).toBeVisible();
  await page.getByRole("button", { name: "Save 2 questions" }).click();
  await expect(page.getByText("Already in your bank, not saved again")).toBeVisible();

  // The upload is its own set in the bank, with its questions.
  await page.getByRole("link", { name: "See this bank" }).click();
  await expect(page.getByRole("button", { name: "Delete bank" })).toBeVisible();
  await shot(page, "21-bank-by-upload");
});

test("each teacher belongs to one section, and Heads of Section only see their own section's staff", async ({ browser }) => {
  const owner = await signIn(browser, OWNER.email, OWNER.password);
  await owner.goto("/admin/staff");
  // A College teacher, added with the section chosen.
  await owner.getByLabel("Full name").fill("Mr Collins College");
  await owner.getByLabel("School email").fill("collins@lps.test");
  await owner.locator('select[name="home_section"]').selectOption({ label: "College" });
  await owner.getByLabel("How should they sign in the first time?").selectOption("password");
  await owner.getByRole("button", { name: "Add staff member" }).click();
  await expect(owner.getByText(/Mr Collins College added/)).toBeVisible();
  await expect(owner.getByRole("row", { name: /Mr Collins College/ }).getByText("College", { exact: true })).toBeVisible();

  // Teachers with no section can be placed from the list.
  await owner.goto("/admin/staff?section=none");
  const row = owner.getByRole("row", { name: /Mrs Ngozi Obi/ });
  await row.getByRole("combobox").selectOption({ label: "Elementary" });
  await row.getByRole("button", { name: "Save" }).click();
  // Once saved, she drops out of the "No section yet" list.
  await expect(owner.getByRole("row", { name: /Mrs Ngozi Obi/ })).toHaveCount(0);
  await owner.goto("/admin/staff");
  await expect(owner.getByRole("row", { name: /Mrs Ngozi Obi/ }).getByText("Elementary", { exact: true })).toBeVisible();

  // The Elementary Head of Section sees Elementary staff — and nobody from College.
  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/admin/team");
  await expect(hod.getByRole("heading", { name: "My staff" })).toBeVisible();
  await expect(hod.getByText("Mr Dixon")).toBeVisible();
  await expect(hod.getByText("Mrs Ngozi Obi")).toBeVisible();
  await expect(hod.getByText("Mr Collins College")).toHaveCount(0);
  await expect(hod.getByText("Mr Femi Lawal")).toHaveCount(0);
  // View only: no edit links, and the staff management page is closed to them.
  await expect(hod.getByRole("link", { name: "Mr Dixon" })).toHaveCount(0);
  await hod.goto("/admin/staff");
  await expect(hod).toHaveURL(/\/dashboard/);
  await hod.goto("/admin/progress");
  await expect(hod.getByText("Mr Collins College")).toHaveCount(0);
  await expect(hod.getByText("Mrs Ada Bello")).toBeVisible();
});

test("the super admin can change a person's role, section and permissions after adding them", async ({ browser }) => {
  const owner = await signIn(browser, OWNER.email, OWNER.password);
  await owner.goto("/admin/staff");
  // Every row has an Edit button.
  await owner.getByRole("link", { name: "Edit Mr Dixon" }).click();
  await expect(owner.getByRole("heading", { name: "Mr Dixon" })).toBeVisible();

  // Teacher → Head of Section for Elementary, with permissions.
  await owner.getByLabel("Role").selectOption("admin");
  await owner.getByLabel("Elementary").check();
  await owner.getByRole("checkbox", { name: "Give extra time" }).check();
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await expect(owner.getByText("Access updated.")).toBeVisible();
  await owner.reload();
  await expect(owner.getByLabel("Role")).toHaveValue("admin");
  await expect(owner.getByLabel("Elementary")).toBeChecked();
  await expect(owner.getByRole("checkbox", { name: "Give extra time" })).toBeChecked();

  // The list reflects it, and he now sees the Administration menu.
  await owner.goto("/admin/staff");
  const row = owner.getByRole("row", { name: /Mr Dixon/ });
  await expect(row.getByText("Head of Section")).toBeVisible();
  await expect(row.getByText("Give extra time")).toBeVisible();

  // Change a permission, then put him back to a teacher in Elementary.
  await owner.getByRole("link", { name: "Edit Mr Dixon" }).click();
  await owner.getByRole("checkbox", { name: "Give extra time" }).uncheck();
  await owner.getByRole("checkbox", { name: "Start / pause / close exams" }).check();
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await expect(owner.getByText("Access updated.")).toBeVisible();
  await owner.getByLabel("Role").selectOption("teacher");
  await owner.locator('select[name="home_section"]').selectOption({ label: "Elementary" });
  // The earlier "Access updated." is still on screen, so wait for this save's own response.
  await Promise.all([
    owner.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/admin/staff/")),
    owner.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await owner.goto("/admin/staff");
  const back = owner.getByRole("row", { name: /Mr Dixon/ });
  await expect(back.getByText("Teacher")).toBeVisible();
  await expect(back.getByText("Elementary", { exact: true })).toBeVisible();
});

test("bulk approval: approve, approve with a note and send back; a flagged test is corrected; super admin sees the school", async ({ browser }) => {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Four submitted tests for Dixon's class (set up directly; the teacher screens are covered elsewhere).
  const { data: dixon } = await db.from("staff").select("id").eq("email", "dixon@lps.test").single();
  const { data: elem } = await db.from("sections").select("id").eq("code", "ELEM").single();
  const { data: subject } = await db.from("subjects").select("id").eq("section_id", elem!.id).eq("name", "Basic Science").single();
  const { data: year } = await db.from("years").select("id").eq("section_id", elem!.id).eq("level", 4).single();
  const { data: term } = await db.from("terms").select("id").eq("is_current", true).single();
  const { data: gold } = await db.from("classes").select("id").eq("name", "Year 4 Gold").single();
  const opts = [{ key: "A", text: "one" }, { key: "B", text: "two" }, { key: "C", text: "three" }];
  const make = async (title: string, take: number, minutes: number) => {
    // Each test gets its own questions, so the "same questions as another test" warning stays out of the way.
    const { data: qs } = await db
      .from("questions")
      .insert(Array.from({ length: 12 }, (_, i) => ({ subject_id: subject!.id, owner_id: dixon!.id, year_id: year!.id, body: `${title} question ${i + 1}?`, options: opts, answer: ["A", "B", "C"][i % 3], topic: "Bulk" })))
      .select("id");
    const { data: a } = await db
      .from("assessments")
      .insert({ subject_id: subject!.id, year_id: year!.id, term_id: term!.id, title, type: "test", status: "pending_approval", question_count: 5, duration_minutes: minutes, created_by: dixon!.id, submitted_at: new Date().toISOString(), class_ids: [gold!.id] })
      .select("id")
      .single();
    await db.from("assessment_questions").insert(qs!.slice(0, take).map((q, i) => ({ assessment_id: a!.id, question_id: q.id, position: i })));
    return a!.id as string;
  };
  const good = await make("Bulk Good", 12, 8);
  const warn = await make("Bulk Warn", 12, 2); // two minutes for five questions: rushed
  const broken = await make("Bulk Broken", 3, 8); // fewer questions than needed
  const back = await make("Bulk Back", 12, 8);

  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/admin/approvals");
  await expect(hod.getByRole("heading", { name: "Approvals" })).toBeVisible();
  // Grouped by class: the class heading holds all four, and each shows how ready it is.
  const focusGold = async () => {
    const value = await hod.locator('select[aria-label="Show one group"] option', { hasText: "Year 4 Gold" }).first().getAttribute("value");
    await hod.getByLabel("Show one group").selectOption(value!);
  };
  await focusGold();
  const row = (title: string) => hod.locator("li", { has: hod.getByText(title, { exact: true }) });
  await expect(row("Bulk Good").getByText("Ready", { exact: true })).toBeVisible();
  await expect(row("Bulk Warn").getByText("Has warnings")).toBeVisible();
  await expect(row("Bulk Broken").getByText("Needs fixing")).toBeVisible();
  await row("Bulk Warn").getByText(/1 warning/).click();
  await expect(row("Bulk Warn").getByText(/seconds per question/)).toBeVisible();
  await row("Bulk Broken").getByText(/1 problem/).click();
  await expect(row("Bulk Broken").getByText(/Only 3 questions, but the test needs 5/)).toBeVisible();
  await shot(hod, "20-bulk-review");

  // Ready tests are chosen for approval already; warnings wait for a decision; broken ones can't be approved.
  await expect(hod.getByLabel("Decision for Bulk Good")).toHaveValue("approve");
  await expect(hod.getByLabel("Decision for Bulk Warn")).toHaveValue("none");
  await expect(hod.getByLabel("Decision for Bulk Broken").locator('option[value="approve"]')).toBeDisabled();

  // Three plain choices; "approve but flag" is gone.
  await expect(hod.getByLabel("Decision for Bulk Warn").locator('option[value="flag"]')).toHaveCount(0);
  // The questions can be read right here, without opening the test.
  await row("Bulk Good").getByText("Show the 12 questions").click();
  await expect(row("Bulk Good").getByText("Bulk Good question 1?")).toBeVisible();
  await hod.getByLabel("Decision for Bulk Warn").selectOption("approve_note");
  await hod.getByLabel("Decision for Bulk Back").selectOption("send_back");
  await hod.getByLabel("Decision for Bulk Broken").selectOption("send_back");
  // A note-approval and a send-back each need their note: the screen says so instead of submitting.
  await hod.getByRole("button", { name: "Review and finish" }).click();
  await expect(hod.getByText("Write the note for the teacher, or choose Approve.")).toBeVisible();
  await hod.getByLabel("Approval note for Bulk Warn").fill("Allow more time next round");
  await hod.getByLabel("What to change in Bulk Back").fill("Add some harder questions");
  await hod.getByLabel("What to change in Bulk Broken").fill("Add at least five questions");
  await hod.getByRole("button", { name: "Review and finish" }).click();
  await expect(hod.getByText("Check before you finish")).toBeVisible();
  await expect(hod.getByText("Approve (2)")).toBeVisible();
  await expect(hod.getByText("Note: Allow more time next round")).toBeVisible();
  await expect(hod.getByText("Send back (2)")).toBeVisible();
  await hod.getByRole("button", { name: /^Confirm: 2 approved, 2 sent back/ }).click();
  await expect(hod.getByText("4 tests reviewed.")).toBeVisible();

  const status = async (id: string) => (await db.from("assessments").select("status, flag_status, flag_category, paper").eq("id", id).single()).data!;
  expect((await status(good)).status).toBe("approved");
  const noted = await status(warn);
  expect([noted.status, noted.flag_status]).toEqual(["approved", null]);
  expect(noted.paper).not.toBeNull();
  expect((await status(broken)).status).toBe("changes_requested");
  expect((await status(back)).status).toBe("changes_requested");

  // One email to the teacher covering everything.
  const mailDir = "/var/tmp/sblogs/mail";
  let mail = "";
  await expect(async () => {
    const found = readdirSync(mailDir)
      .map((f) => readFileSync(`${mailDir}/${f}`, "utf8"))
      .find((m) => /^To: .*dixon@lps\.test/im.test(m) && m.includes("reviewed"));
    expect(found).toBeTruthy();
    mail = found!.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }).toPass({ timeout: 15_000 });
  expect(mail).toContain("Bulk Good");
  expect(mail).toContain("Allow more time next round");
  expect(mail).toContain("Add at least five questions");

  // Tests flagged before this change still work: the teacher corrects, the Head of Section accepts.
  await db.from("assessments").update({ flag_status: "open", flag_category: "typos", flag_note: "Fix the typo in question 3", flagged_at: new Date().toISOString(), amending: true }).eq("id", warn);

  // The teacher sees it on the dashboard, corrects the test and sends the corrections.
  const teacher = await signIn(browser, "dixon@lps.test", teacherPassword);
  await teacher.goto("/dashboard");
  const card = teacher.locator("li", { has: teacher.getByText("Bulk Warn", { exact: true }) });
  await expect(card.getByText("Typing or formatting mistakes")).toBeVisible();
  await expect(card.getByText("Fix the typo in question 3")).toBeVisible();
  // "Needs changes" already opened it for fixing: one click to the test, edit, send.
  await card.getByRole("link", { name: "Fix this test" }).click();
  await expect(teacher.getByText("You are correcting this test")).toBeVisible();
  await expect(teacher.getByText("Questions (12)")).toBeVisible();
  await teacher.getByRole("button", { name: /^Remove/ }).first().click();
  await expect(teacher.getByText("Questions (11)")).toBeVisible();
  // The approved version is untouched until the corrections are accepted.
  expect((await db.from("assessments").select("paper").eq("id", warn).single()).data!.paper.questions).toHaveLength(12);
  await teacher.getByRole("button", { name: "Send corrections" }).click();
  await expect(teacher).toHaveURL(/\/dashboard\?done=corrected/);
  await expect(teacher.getByText("Your corrections were sent.")).toBeVisible();

  // The Head of Section accepts them: the new questions are frozen and the flag is resolved.
  await hod.goto("/admin/approvals");
  await focusGold();
  const flaggedRow = hod.locator("li", { has: hod.getByText("Bulk Warn", { exact: true }) });
  await expect(flaggedRow.getByText("The teacher has sent corrections.")).toBeVisible();
  await flaggedRow.getByRole("button", { name: "Accept the corrections" }).click();
  await expect(hod.getByText("Done.")).toBeVisible();
  const done = await status(warn);
  expect([done.status, done.flag_status]).toEqual(["approved", "resolved"]);
  expect(done.paper.questions).toHaveLength(11);

  // The super admin has no Teaching menu, and a school-wide dashboard.
  const owner = await signIn(browser, OWNER.email, OWNER.password);
  await owner.goto("/dashboard");
  await expect(owner.getByRole("navigation", { name: "Main" }).getByText("Teaching", { exact: true })).toHaveCount(0);
  await expect(owner.getByRole("link", { name: "New test or exam" })).toHaveCount(0);
  await expect(owner.getByText("Needs your attention")).toBeVisible();
  await expect(owner.getByText("Test coverage by class")).toBeVisible();
  await expect(owner.getByText("Awaiting approval", { exact: true }).first()).toBeVisible();
  await expect(owner.getByText("Year 4 Gold").first()).toBeVisible();
  await shot(owner, "21-school-dashboard");
});

test("rounds: a teacher starts a paper from the term grid, uploads into it, and finds it under its round", async ({ browser }) => {
  const page = await signIn(browser, "dixon@lps.test", teacherPassword);
  await page.goto("/teach/papers");
  await expect(page.getByRole("heading", { name: "This term's papers" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "2nd CA" })).toBeVisible();
  const row = page.getByRole("row", { name: /Basic Science/ });
  await row.getByRole("button", { name: "Start paper" }).first().click();
  await expect(page.getByRole("heading", { name: /Basic Science — 2nd CA/ })).toBeVisible();
  await shot(page, "22-paper-from-grid");

  await page.getByRole("link", { name: "Upload into this test" }).click();
  // The round comes from the paper and can't be changed here.
  await expect(page.getByLabel("Which round are these for?")).toBeDisabled();
  const text = ["Second CA question one?\nA. yes\nB. no\nANSWER: A", "Second CA question two?\nA. yes\nB. no\nANSWER: B"].join("\n\n");
  await page.getByLabel("Paste your questions").fill(text);
  await page.getByRole("button", { name: "Save 2 questions" }).click();
  await page.locator("#import-receipt").getByRole("link", { name: "Back to the test" }).click();
  await expect(page.getByText("Questions (2)")).toBeVisible();

  // In the bank they sit under 2nd CA, apart from the 1st CA questions.
  await page.goto("/teach/questions");
  await page.getByRole("navigation", { name: "Rounds" }).getByRole("link", { name: /2nd CA/ }).click();
  await expect(page.getByText("Second CA question one?")).toBeVisible();
  await expect(page.getByText("Question number 1?")).toHaveCount(0);
  await shot(page, "23-bank-by-round");

  // Back on the grid, the cell shows the paper's progress.
  await page.goto("/teach/papers");
  await expect(page.getByRole("row", { name: /Basic Science/ }).getByText(/2 of \d+ questions/)).toBeVisible();
});

test("Heads of Section manage their rounds and can look up problems by reference", async ({ browser }) => {
  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/admin/rounds");
  await expect(hod.getByRole("heading", { name: "Rounds", level: 1 })).toBeVisible();
  await hod.getByLabel("Name", { exact: true }).fill("Elementary quiz");
  await hod.getByRole("button", { name: "Add round" }).click();
  await expect(hod.getByText('"Elementary quiz" added.')).toBeVisible();
  await expect(hod.getByText(/Elementary quiz/).first()).toBeVisible();

  await hod.goto("/admin/problems");
  await expect(hod.getByRole("heading", { name: "Problems" })).toBeVisible();
  await hod.getByLabel("Find a reference code").fill("ZZZZZZ");
  await hod.getByRole("button", { name: "Find" }).click();
  await expect(hod.getByText("No error with reference ZZZZZZ")).toBeVisible();
});

test("questions first: select all in a bank, make a test from it, top it up from another bank, and send with the checklist", async ({ browser }) => {
  const page = await signIn(browser, "dixon@lps.test", teacherPassword);
  await page.goto("/teach/questions");
  // A bank made by hand: select every question in the 2nd CA round and move them into a named bank.
  await page.getByRole("navigation", { name: "Rounds" }).getByRole("link", { name: /2nd CA/ }).click();
  await expect(page.getByRole("navigation", { name: "Rounds" }).getByRole("link", { name: /2nd CA/ })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: /^Select all \d+/ }).click();
  await expect(page.getByText(/^All \d+ selected$/)).toBeVisible();
  await page.getByRole("button", { name: "Deselect all" }).first().click();
  await expect(page.getByText("Tick questions to act on them")).toBeVisible();
  await page.getByRole("button", { name: /^Select all \d+/ }).click();
  await page.getByRole("button", { name: "Move to bank" }).click();
  await page.getByPlaceholder("e.g. 2nd CA revision").fill("Second CA set A");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText(/now in “Second CA set A”/)).toBeVisible();

  // Set a topic on them all at once.
  await page.getByRole("navigation", { name: "Banks" }).getByRole("link", { name: /Second CA set A/ }).click();
  await expect(page.getByRole("navigation", { name: "Banks" }).getByRole("link", { name: /Second CA set A/ })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: /^Select all \d+/ }).click();
  await page.getByRole("button", { name: "Set topic" }).click();
  await page.getByLabel("New topic").fill("Revision");
  await page.getByRole("button", { name: "Set topic" }).last().click();
  await expect(page.getByText(/Topic “Revision” set on/)).toBeVisible();

  // Make a test straight from the bank: it opens with the questions already in.
  await page.getByRole("button", { name: "Make a test from this bank" }).click();
  await expect(page.getByText(/^Test made from \d+ question/)).toBeVisible();
  await shot(page, "24-test-from-bank");

  // Top it up: choose another bank, take 3 at random, then remove one.
  const before = Number((await page.getByRole("heading", { name: /^Questions \(\d+\)/ }).textContent())!.match(/\d+/)![0]);
  const add = page.locator("#add-questions");
  const from = add.getByLabel("Add questions from");
  await from.selectOption((await from.locator("option", { hasText: "Basic Science Test 1" }).first().getAttribute("value"))!);
  await add.getByLabel("How many at random").fill("3");
  await add.getByRole("button", { name: "at random" }).click();
  await expect(add.getByText(/^Added 3 questions at random/)).toBeVisible();
  await expect(page.getByRole("heading", { name: `Questions (${before + 3})` })).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: `Questions (${before + 2})` })).toBeVisible();

  // Choosing Exam after typing your own numbers asks first.
  await page.getByLabel("Questions per student").fill("4");
  await page.getByLabel("Type").selectOption("exam");
  await expect(page.getByText(/Use the exam defaults \(40 questions, 60 min\)/)).toBeVisible();
  await page.getByRole("button", { name: "Keep mine" }).click();
  await expect(page.getByLabel("Questions per student")).toHaveValue("4");
  await expect(page.getByText(/^Saved \d/)).toBeVisible();

  // Send: no topic on the test and default marks, so it lists what's worth checking first.
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByText("Worth checking before you send")).toBeVisible();
  await expect(page.getByText(/Marks are still the default/)).toBeVisible();
  await page.getByRole("button", { name: "Send anyway" }).click();
  await expect(page).toHaveURL(/\/dashboard\?done=submitted/);
});

test("exam calendar dates approved tests; comments on questions go back to the teacher, who marks them fixed", async ({ browser, request }) => {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: dixon } = await db.from("staff").select("id").eq("email", "dixon@lps.test").single();
  const { data: elem } = await db.from("sections").select("id").eq("code", "ELEM").single();
  const { data: subject } = await db.from("subjects").select("id").eq("section_id", elem!.id).eq("name", "Basic Science").single();
  const { data: year } = await db.from("years").select("id, name").eq("section_id", elem!.id).eq("level", 4).single();
  const { data: term } = await db.from("terms").select("id").eq("is_current", true).single();
  const { data: gold } = await db.from("classes").select("id").eq("name", "Year 4 Gold").single();
  const { data: round } = await db.from("ca_round_configs").select("id, label").eq("is_active", true).order("sort_order").limit(1).single();
  const opts = [{ key: "A", text: "one" }, { key: "B", text: "two" }, { key: "C", text: "three" }];
  const make = async (title: string) => {
    const { data: qs } = await db
      .from("questions")
      .insert(Array.from({ length: 6 }, (_, i) => ({ subject_id: subject!.id, owner_id: dixon!.id, year_id: year!.id, body: `${title} question ${i + 1}?`, options: opts, answer: "A", topic: "Cal" })))
      .select("id");
    const { data: a } = await db
      .from("assessments")
      .insert({ subject_id: subject!.id, year_id: year!.id, term_id: term!.id, title, type: "test", status: "pending_approval", question_count: 5, duration_minutes: 20, created_by: dixon!.id, submitted_at: new Date().toISOString(), class_ids: [gold!.id], round_id: round!.id, sequence_label: round!.label })
      .select("id")
      .single();
    await db.from("assessment_questions").insert(qs!.map((q, i) => ({ assessment_id: a!.id, question_id: q.id, position: i + 1 })));
    return a!.id as string;
  };
  const toFix = await make("Calendar Fix Me");
  const toDate = await make("Calendar Date Me");

  // The Head of Section sets the round's days for Year 4 once.
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/admin/calendar");
  await hod.getByLabel(`${round!.label} opens for ${year!.name}`).fill(`${day}T09:00`);
  await hod.getByLabel(`${round!.label} closes for ${year!.name}`).fill(`${day}T11:00`);
  await hod.getByRole("button", { name: `Save ${round!.label} dates` }).click();
  await expect(hod.getByText(/Tests in this round will be dated automatically/)).toBeVisible();
  await shot(hod, "25-exam-calendar");

  // A comment on one question, then Needs changes: no separate note needed.
  await hod.goto(`/admin/approvals/${toFix}`);
  await hod.getByText("Comment on this question").nth(1).click();
  await hod.getByLabel("Comment on question 2").fill("Two answers are correct here");
  await hod.getByRole("button", { name: "Needs changes" }).click();
  await expect(hod).toHaveURL(/\/admin\/approvals(\/[0-9a-f-]+\?next=1|\?done=1)/);
  expect((await db.from("assessments").select("status").eq("id", toFix).single()).data!.status).toBe("changes_requested");

  // The other test: the dates are already filled in from the calendar; approving dates it.
  await hod.goto(`/admin/approvals/${toDate}`);
  await expect(hod.getByText(/Dates are filled in from the exam calendar/)).toBeVisible();
  await expect(hod.getByLabel("Opens (Lagos time)")).toHaveValue(`${day}T09:00`);
  hod.once("dialog", (d) => d.accept());
  await hod.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(hod).toHaveURL(/\/admin\/exams/);
  const { data: windows } = await db.from("exam_windows").select("class_id, starts_at, auto_start").eq("assessment_id", toDate);
  expect(windows).toHaveLength(1);
  expect([windows![0].class_id, windows![0].auto_start, new Date(windows![0].starts_at).toISOString()]).toEqual([gold!.id, true, new Date(`${day}T08:00:00Z`).toISOString()]);

  // The teacher's email names the question; the test page highlights it and shows where it stands.
  const mailDir = "/var/tmp/sblogs/mail";
  await expect(async () => {
    const found = readdirSync(mailDir)
      .map((f) => readFileSync(`${mailDir}/${f}`, "utf8").replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))))
      .find((m) => /^To: .*dixon@lps\.test/im.test(m) && m.includes("Calendar Fix Me") && m.includes("Two answers are correct here"));
    expect(found).toContain("Question 2");
  }).toPass({ timeout: 15_000 });
  const teacher = await signIn(browser, "dixon@lps.test", teacherPassword);
  await teacher.goto(`/teach/assessments/${toFix}`);
  await expect(teacher.getByRole("list", { name: "Progress" }).getByText("Changes asked for")).toBeVisible();
  await expect(teacher.getByText(/1 question has a comment/)).toBeVisible();
  await expect(teacher.getByText("Head of Section: Two answers are correct here")).toBeVisible();
  await shot(teacher, "26-question-comment");
  await teacher.getByRole("button", { name: "Mark fixed" }).click();
  await expect(teacher.getByRole("button", { name: "Reopen" })).toBeVisible();
  expect((await db.from("review_comments").select("resolved_at").eq("assessment_id", toFix).single()).data!.resolved_at).not.toBeNull();
  await teacher.goto(`/teach/assessments/${toDate}`);
  await expect(teacher.getByRole("list", { name: "Progress" }).getByText(/^Exam set for/)).toBeVisible();

  // The daily summary can only be triggered by the scheduler.
  expect((await request.get("/api/cron/digest")).status()).toBe(401);
});

test("settings: one place for setup, and auto-approval can be switched off per section", async ({ browser }) => {
  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/dashboard");
  const nav = hod.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(hod.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  const tabs = hod.getByRole("navigation", { name: "Settings" });
  await expect(tabs.getByRole("link", { name: "Rounds" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Exam calendar" })).toBeVisible();
  // The super admin's pages are not offered to a Head of Section.
  await expect(tabs.getByRole("link", { name: "School year & terms" })).toHaveCount(0);
  await shot(hod, "27-settings");

  // Rounds is a settings page: the sidebar keeps Settings highlighted there.
  await tabs.getByRole("link", { name: "Rounds" }).click();
  await expect(hod.getByRole("heading", { name: "Rounds", level: 1 })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");

  // Turn automatic approval off for Elementary: it saves as soon as it is switched.
  await tabs.getByRole("link", { name: "Approval rules" }).click();
  const sw = hod.getByRole("switch", { name: "Approve automatically in Elementary" });
  await expect(sw).toBeChecked();
  await sw.uncheck({ force: true });
  await expect(hod.getByText("Saved. Every request will now wait for you.")).toBeVisible();
  await hod.reload();
  await expect(hod.getByRole("switch", { name: "Approve automatically in Elementary" })).not.toBeChecked();
  await shot(hod, "28-approval-rules");

  // A new request now waits, even without a clash.
  const teacher = await signIn(browser, "dixon@lps.test", teacherPassword);
  await teacher.goto("/teach/classes");
  await teacher.getByRole("button", { name: "Basic Science — Year 6" }).click();
  await teacher.getByRole("button", { name: "Save my subjects and classes" }).click();
  await expect(teacher).toHaveURL(/\/dashboard\?done=subjects/);
  await teacher.goto("/teach/classes");
  await expect(teacher.getByText("Awaiting approval")).toBeVisible();
  await hod.goto("/admin/assignments");
  await expect(hod.getByText("Waiting for you (1)")).toBeVisible();

  // Back on, for the rest of the school.
  await hod.goto("/admin/settings/approvals");
  await hod.getByRole("switch", { name: "Approve automatically in Elementary" }).check({ force: true });
  await expect(hod.getByText(/Saved. Requests without a clash/)).toBeVisible();
});

test("one switch on the live exam screen hides results from students and brings them back", async ({ browser }) => {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: a } = await db.from("assessments").select("id, settings").eq("title", "Basic Science Test 1").single();
  const { data: win } = await db.from("exam_windows").select("id").eq("assessment_id", a!.id).limit(1).single();
  const { data: attempt } = await db.from("attempts").select("id").eq("assessment_id", a!.id).eq("status", "submitted").limit(1).single();
  const before = (a!.settings as { show_result?: string }).show_result ?? "score";
  const shown = async () => (await db.rpc("_exam_result", { p_attempt: attempt!.id })).data as { show: string; score?: number | null };
  expect((await shown()).show).toBe(before);

  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto(`/admin/exams/${win!.id}`);
  const sw = hod.getByRole("switch", { name: "Show students their results" });
  await expect(sw).toBeChecked();
  await shot(hod, "29-results-switch-on");
  await sw.uncheck({ force: true });
  await expect(hod.getByText("Saved. Students now see a congratulations message instead of their score.")).toBeVisible();
  // A student who finished now gets no score at all, only the message.
  expect(await shown()).toEqual({ status: "submitted", show: "none" });
  await hod.reload();
  await expect(hod.getByRole("switch", { name: "Show students their results" })).not.toBeChecked();
  await expect(hod.getByText(/Off: after submitting, students see a congratulations message/)).toBeVisible();
  await shot(hod, "30-results-switch-off");

  await hod.getByRole("switch", { name: "Show students their results" }).check({ force: true });
  await expect(hod.getByText("Saved. Students will see their score after submitting.")).toBeVisible();
  expect((await shown()).show).toBe(before);
});

test("school-wide results setting beats each exam's switch; only the super admin can change it", async ({ browser }) => {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: a } = await db.from("assessments").select("id").eq("title", "Basic Science Test 1").single();
  const { data: win } = await db.from("exam_windows").select("id").eq("assessment_id", a!.id).limit(1).single();
  const { data: attempt } = await db.from("attempts").select("id").eq("assessment_id", a!.id).eq("status", "submitted").limit(1).single();
  const shown = async () => ((await db.rpc("_exam_result", { p_attempt: attempt!.id })).data as { show: string }).show;
  const own = await shown();

  // A Head of Section sees the school-wide setting but cannot change it.
  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/admin/exams");
  await expect(hod.getByText("Results for students, school-wide")).toBeVisible();
  await expect(hod.getByText("Only the super admin can change this.")).toBeVisible();
  await expect(hod.getByRole("button", { name: "Hide for everyone" })).toHaveCount(0);

  const owner = await signIn(browser, OWNER.email, OWNER.password);
  await owner.goto("/admin/exams");
  await owner.getByRole("button", { name: "Hide for everyone" }).click();
  await expect(owner.getByText(/For every exam in the school, students now see only a congratulations message/)).toBeVisible();
  expect(await shown()).toBe("none");
  await shot(owner, "31-school-wide-hide");

  // The exam's own switch is now locked, and says why.
  await hod.goto(`/admin/exams/${win!.id}`);
  await expect(hod.getByRole("switch", { name: "Show students their results" })).toBeDisabled();
  await expect(hod.getByText(/Set school-wide to hidden for every exam, so this switch is locked/)).toBeVisible();

  // Show for everyone beats an exam that hides itself.
  await owner.goto("/admin/exams");
  await owner.getByRole("button", { name: "Show for everyone" }).click();
  await expect(owner.getByText(/For every exam in the school, students now see their score/)).toBeVisible();
  expect(await shown()).not.toBe("none");

  // Back to each exam deciding: the exam is exactly as it was.
  await owner.goto("/admin/exams");
  await owner.getByRole("button", { name: "Each exam decides" }).click();
  await expect(owner.getByText("Saved. Each exam decides what its students see.")).toBeVisible();
  expect(await shown()).toBe(own);
  await hod.reload();
  await expect(hod.getByRole("switch", { name: "Show students their results" })).toBeEnabled();
});

test("switching the term by mistake loses nothing: the teacher is told, and switching back restores the papers", async ({ browser }) => {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const countAll = async (table: string) => (await db.from(table).select("id", { count: "exact", head: true })).count;
  const before = { tests: await countAll("assessments"), questions: await countAll("questions"), links: await countAll("assessment_questions") };

  const owner = await signIn(browser, OWNER.email, OWNER.password);
  await owner.goto("/admin/school");
  await expect(owner.getByText(/First Term · current · \d+ tests?/)).toBeVisible();
  // Switching asks first, and says nothing is deleted.
  let asked = "";
  owner.once("dialog", (d) => {
    asked = d.message();
    return d.accept();
  });
  await owner.getByRole("button", { name: /^Second Term · 0 tests/ }).click();
  await expect(owner.getByText(/Second Term · current/)).toBeVisible();
  expect(asked).toContain("Nothing is deleted or moved");

  // The teacher sees an explanation instead of an apparently empty term.
  const teacher = await signIn(browser, "dixon@lps.test", teacherPassword);
  await teacher.goto("/teach/papers");
  await expect(teacher.getByText("No papers in this term yet")).toBeVisible();
  await expect(teacher.getByText(/Your earlier papers are safe: \d+ in .*First Term/)).toBeVisible();
  await shot(teacher, "32-papers-wrong-term");

  // Nothing was deleted or moved.
  expect({ tests: await countAll("assessments"), questions: await countAll("questions"), links: await countAll("assessment_questions") }).toEqual(before);

  // Switch back: the papers are all there again.
  owner.once("dialog", (d) => d.accept());
  await owner.getByRole("button", { name: /^First Term · \d+ tests?/ }).click();
  await expect(owner.getByText(/First Term · current/)).toBeVisible();
  await teacher.goto("/teach/papers");
  await expect(teacher.getByText("No papers in this term yet")).toHaveCount(0);
  await expect(teacher.getByRole("columnheader", { name: "2nd CA" })).toBeVisible();
});

test("Needs a date: tests grouped by subject or year group, side by side, with their details, scheduled together", async ({ browser }) => {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: dixon } = await db.from("staff").select("id").eq("email", "dixon@lps.test").single();
  const { data: elem } = await db.from("sections").select("id").eq("code", "ELEM").single();
  const { data: maths } = await db.from("subjects").select("id").eq("section_id", elem!.id).eq("name", "Mathematics").single();
  const { data: english } = await db.from("subjects").select("id").eq("section_id", elem!.id).eq("name", "English Language").single();
  const { data: y4 } = await db.from("years").select("id").eq("section_id", elem!.id).eq("level", 4).single();
  const { data: y5 } = await db.from("years").select("id").eq("section_id", elem!.id).eq("level", 5).single();
  const { data: gold } = await db.from("classes").select("id").eq("name", "Year 4 Gold").single();
  const { data: five } = await db.from("classes").select("id").eq("name", "Year 5").single();
  const { data: term } = await db.from("terms").select("id").eq("is_current", true).single();
  const { data: rounds } = await db.from("ca_round_configs").select("id, label").eq("is_active", true).order("sort_order").limit(2);
  const make = async (title: string, subject: string, year: string, cls: string, round: { id: string; label: string }, questions: number, minutes: number) => {
    const { data: a } = await db
      .from("assessments")
      .insert({ subject_id: subject, year_id: year, term_id: term!.id, title, type: "test", status: "approved", paper: { questions: [] }, question_count: questions, duration_minutes: minutes, created_by: dixon!.id, class_ids: [cls], round_id: round.id, sequence_label: round.label })
      .select("id")
      .single();
    return a!.id as string;
  };
  const alpha = await make("Needs Date Alpha", maths!.id, y4!.id, gold!.id, rounds![0], 12, 25);
  const beta = await make("Needs Date Beta", maths!.id, y4!.id, gold!.id, rounds![1], 40, 60);
  const gamma = await make("Needs Date Gamma", english!.id, y5!.id, five!.id, rounds![0], 10, 15);

  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/admin/exams?view=drafts");
  // By subject (the default): one group per subject.
  await expect(hod.getByRole("heading", { name: "Mathematics", level: 2 })).toBeVisible();
  await expect(hod.getByRole("heading", { name: "English Language", level: 2 })).toBeVisible();
  const card = (title: string) => hod.locator("article", { has: hod.getByRole("heading", { name: title }) });
  // Each card says what the test is: round, questions, time, teacher.
  await expect(card("Needs Date Alpha").getByText(rounds![0].label, { exact: true })).toBeVisible();
  await expect(card("Needs Date Alpha").getByText("12", { exact: true })).toBeVisible();
  await expect(card("Needs Date Alpha").getByText("25 minutes")).toBeVisible();
  await expect(card("Needs Date Alpha").getByText("Mr Dixon")).toBeVisible();
  await expect(card("Needs Date Beta").getByText(rounds![1].label, { exact: true })).toBeVisible();
  await expect(card("Needs Date Beta").getByText("60 minutes")).toBeVisible();
  // Side by side, not stacked.
  const a = (await card("Needs Date Alpha").boundingBox())!;
  const b = (await card("Needs Date Beta").boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(b.x).toBeGreaterThan(a.x + a.width - 2);
  await shot(hod, "33-needs-a-date");

  // By year group: the same tests, grouped by year, each card naming its subject.
  await hod.getByRole("navigation", { name: "Group tests" }).getByRole("link", { name: "By year group" }).click();
  await expect(hod.getByRole("heading", { name: "Year 4", level: 2 })).toBeVisible();
  await expect(hod.getByRole("heading", { name: "Year 5", level: 2 })).toBeVisible();
  await expect(card("Needs Date Alpha").getByText("Mathematics")).toBeVisible();
  await shot(hod, "34-needs-a-date-by-year");
  await hod.getByRole("navigation", { name: "Group tests" }).getByRole("link", { name: "By subject" }).click();

  // One date for the whole Mathematics group.
  const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const maths_form = hod.locator('form[id^="schedule-"]', { hasText: "Schedule Mathematics" });
  await maths_form.getByLabel("Opens (Lagos time)").fill(`${day}T09:00`);
  await maths_form.getByLabel("Closes (no new starts after this)").fill(`${day}T11:00`);
  await maths_form.getByRole("button", { name: "Schedule Mathematics" }).click();
  // The group is gone from the list once scheduled, so the confirmation is a banner above it.
  await expect(hod.getByText("Scheduled 2 classes.")).toBeVisible();
  await expect(hod).toHaveURL(/scheduled=2/);
  for (const id of [alpha, beta]) {
    const { data: w } = await db.from("exam_windows").select("class_id, auto_start").eq("assessment_id", id);
    expect(w).toEqual([{ class_id: gold!.id, auto_start: true }]);
  }
  // They leave the list; the other subject is still waiting.
  await expect(card("Needs Date Alpha")).toHaveCount(0);
  await expect(card("Needs Date Gamma")).toBeVisible();

  // "I'll press Start myself" is respected.
  const eng_form = hod.locator('form[id^="schedule-"]', { hasText: "Schedule English Language" });
  await eng_form.getByLabel("Opens (Lagos time)").fill(`${day}T09:00`);
  await eng_form.getByLabel("Closes (no new starts after this)").fill(`${day}T11:00`);
  await eng_form.getByLabel("I'll press Start myself").check();
  await eng_form.getByRole("button", { name: "Schedule English Language" }).click();
  await expect(hod.getByText("Scheduled 1 class.")).toBeVisible();
  expect((await db.from("exam_windows").select("auto_start").eq("assessment_id", gamma)).data).toEqual([{ auto_start: false }]);
});

test("a student whose screen says everything is answered can still submit, even if the server missed some answers", async ({ browser }) => {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  // This exam makes students answer every question before they can submit (as exams do).
  const { data: a } = await db.from("assessments").select("id, settings").eq("title", "Basic Science Test 1").single();
  await db.from("assessments").update({ settings: { ...(a!.settings as object), require_all_answered: true, allow_calculator: false } }).eq("id", a!.id);

  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/admin/terminals");
  await hod.getByRole("button", { name: "Create registration code" }).click();
  const code = (await hod.getByText(/Registration code: (\d{4} \d{4})/).textContent())!.match(/(\d{4} \d{4})/)![1];

  const lab = await browser.newContext();
  const pc = await lab.newPage();
  await pc.goto("/exam");
  await pc.getByLabel("Registration code").fill(code);
  await pc.getByLabel("Name for this computer").fill("Lab 1 – PC 02");
  await pc.getByRole("button", { name: "Register" }).click();
  await pc.getByLabel("Admission number").fill("LPS-2024-0138");
  await pc.getByRole("button", { name: "Continue" }).click();
  await pc.getByRole("button", { name: "Yes, this is me" }).click();
  await pc.getByRole("button", { name: "Start" }).click();
  await pc.getByLabel(/I am Amaka Bello/).check();
  await pc.getByRole("button", { name: "Start exam" }).click();
  await expect(pc.getByText("Question 1 of 5")).toBeVisible();
  // The teacher switched the calculator off for this test, so there isn't one.
  await expect(pc.getByRole("button", { name: "Open calculator" })).toHaveCount(0);

  for (let i = 0; i < 4; i++) {
    await pc.getByRole("radio", { name: /two$/ }).click();
    await pc.getByRole("button", { name: "Next →" }).click();
  }
  await pc.getByRole("radio", { name: /two$/ }).click();
  await expect(pc.getByText("All answers saved")).toBeVisible({ timeout: 15_000 });

  // What a rejected, out-of-order update leaves behind: the server holds a blank, stamped "just now", so the
  // student's own (older-looking) answers lose. The screen still says 5 of 5 and "All answers saved".
  const { data: attempt } = await db.from("attempts").select("id").eq("assessment_id", a!.id).eq("status", "in_progress").single();
  const { data: rows } = await db.from("attempt_answers").select("question_id").eq("attempt_id", attempt!.id).limit(2);
  expect(rows).toHaveLength(2);
  for (const r of rows!) {
    await db.from("attempt_answers").update({ selected: null, answered_at: new Date(Date.now() + 1000).toISOString() }).eq("attempt_id", attempt!.id).eq("question_id", r.question_id);
  }
  await pc.waitForTimeout(2500);

  await pc.getByRole("button", { name: "Finish & submit" }).click();
  await expect(pc.getByText("5 of 5 answered")).toBeVisible();
  await pc.getByRole("button", { name: "Submit now" }).click();
  // It used to stop here with "Please answer every question before submitting." and no way forward.
  await expect(pc.getByText("Exam submitted")).toBeVisible({ timeout: 30_000 });
  const { data: saved } = await db.from("attempt_answers").select("selected").eq("attempt_id", attempt!.id);
  expect(saved).toHaveLength(5);
  expect(saved!.every((r) => r.selected)).toBe(true);
  await lab.close();
});

test("Exams screen: quick controls change several classes' exams at once, only for the classes chosen", async ({ browser }) => {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: a } = await db.from("assessments").select("id").eq("title", "Basic Science Test 1").single();
  const win = async () => (await db.from("exam_windows").select("id, status, extra_minutes, focus_penalty_minutes, ends_at").eq("assessment_id", a!.id).single()).data!;
  const test = async () => ((await db.from("assessments").select("settings").eq("id", a!.id).single()).data!.settings as { show_result?: string }).show_result;
  const before = await win();
  const resultsBefore = (await test()) ?? "score";

  const owner = await signIn(browser, OWNER.email, OWNER.password);
  await owner.goto("/admin/exams");
  await expect(owner.getByText("Quick controls")).toBeVisible();
  await shot(owner, "35-quick-controls");

  // Choosing classes decides what is affected: with Year 4 Gold switched off, nothing is.
  await owner.getByRole("checkbox", { name: "Year 4 Gold" }).uncheck();
  await expect(owner.getByText("0 exams selected")).toBeVisible();
  await expect(owner.getByRole("button", { name: /^Add 10 minutes to 0 exams/ })).toBeDisabled();
  await owner.getByRole("checkbox", { name: "Year 4 Gold" }).check();
  await expect(owner.getByText("1 exam selected")).toBeVisible();

  // Extra time for everyone chosen: needs a reason, adds the minutes to the exam.
  await owner.getByLabel("Extra minutes").fill("10");
  await expect(owner.getByRole("button", { name: /^Add 10 minutes to 1 exam/ })).toBeDisabled(); // no reason yet
  await owner.getByLabel("Reason for extra time").fill("Power cut 10:20");
  owner.once("dialog", (d) => d.accept());
  await owner.getByRole("button", { name: /^Add 10 minutes to 1 exam/ }).click();
  await expect(owner.getByText("Added 10 minutes to 1 exam.")).toBeVisible();
  const after = await win();
  expect(after.extra_minutes).toBe(before.extra_minutes + 10);
  expect(Date.parse(after.ends_at)).toBeGreaterThan(Date.parse(before.ends_at));

  // Results shown to students: hide, then show again.
  await owner.getByRole("button", { name: /^Hide results/ }).click();
  await expect(owner.getByText(/Results hidden for 1 test/)).toBeVisible();
  expect(await test()).toBe("none");
  await owner.getByRole("button", { name: /^Show results/ }).click();
  await expect(owner.getByText(/Results shown for 1 test/)).toBeVisible();
  expect(await test()).toBe(resultsBefore);

  // Leaving the exam screen: set a penalty.
  await owner.getByLabel("Focus penalty minutes").fill("5");
  await owner.getByRole("button", { name: /^Apply to 1 exam/ }).click();
  await expect(owner.getByText("Focus penalty set to 5 minutes for 1 exam.")).toBeVisible();
  expect((await win()).focus_penalty_minutes).toBe(5);

  // Pause new starts, then resume.
  await owner.getByRole("button", { name: /^Pause new starts \(1\)/ }).click();
  await expect(owner.getByText("Paused 1 exam.")).toBeVisible();
  expect((await win()).status).toBe("paused");
  await owner.getByRole("button", { name: /^Resume \(1\)/ }).click();
  await expect(owner.getByText("Resumed 1 exam.")).toBeVisible();
  expect((await win()).status).toBe("live");

  // The same setting on a single exam's own page used to say "saved" without changing anything.
  const winId = (await win()).id;
  await owner.goto(`/admin/exams/${winId}`);
  await owner.getByLabel("Penalty (minutes, 0 = off)").fill("7");
  const penaltyForm = owner.locator("form", { has: owner.getByLabel("Penalty (minutes, 0 = off)") });
  await penaltyForm.getByRole("button", { name: "Save" }).click();
  await expect(penaltyForm.getByText("Focus penalty set to 7 minutes.")).toBeVisible();
  expect((await win()).focus_penalty_minutes).toBe(7);
  await owner.goto("/admin/exams");

  // With results set school-wide, the per-group buttons step aside and say why.
  await owner.getByRole("button", { name: "Hide for everyone" }).click();
  await expect(owner.getByText(/For every exam in the school, students now see only a congratulations message/)).toBeVisible();
  await expect(owner.getByRole("button", { name: /^Hide results/ })).toBeDisabled();
  await expect(owner.getByText(/Set school-wide to hidden for every exam, which overrides this/)).toBeVisible();
  await owner.getByRole("button", { name: "Each exam decides" }).click();
  await expect(owner.getByText("Saved. Each exam decides what its students see.")).toBeVisible();
});
