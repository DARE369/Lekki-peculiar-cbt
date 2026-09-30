import { expect, test, type Browser, type Page } from "@playwright/test";

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

async function signIn(browser: Browser, email: string, password: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("School email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return page;
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
  await page.getByRole("button", { name: "Add staff member" }).click();
  const msg = page.getByText(/Temporary password: (\S+)/);
  await expect(msg).toBeVisible();
  hodPassword = (await msg.textContent())!.match(/Temporary password: (\S+)/)![1];

  await page.getByLabel("Full name").fill("Mr Dixon");
  await page.getByLabel("School email").fill("dixon@lps.test");
  await page.getByLabel("Role").selectOption("teacher");
  await page.getByRole("button", { name: "Add staff member" }).click();
  const msg2 = page.getByText(/Mr Dixon added. Temporary password: (\S+)/);
  await expect(msg2).toBeVisible();
  teacherPassword = (await msg2.textContent())!.match(/Temporary password: (\S+)/)![1];
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

test("teacher requests a subject and the HOD approves", async ({ browser }) => {
  const teacher = await signIn(browser, "dixon@lps.test", teacherPassword);
  await teacher.goto("/teach/classes");
  await teacher.getByLabel("Subject").selectOption({ label: "Basic Science" });
  await teacher.getByLabel("Year 4 Gold").check();
  await teacher.getByRole("button", { name: "Send for approval" }).click();
  await expect(teacher.getByText("Awaiting approval")).toBeVisible();

  const hod = await signIn(browser, "hod@lps.test", hodPassword);
  await hod.goto("/admin/assignments");
  await hod.getByRole("button", { name: "Approve ticked" }).click();
  await expect(hod.getByText("No requests waiting")).toBeVisible();

  await teacher.goto("/teach/classes");
  await expect(teacher.getByRole("link", { name: /Year 4 Gold/ })).toBeVisible();
});

test("teacher uploads questions, builds a test and submits it", async ({ browser }) => {
  const page = await signIn(browser, "dixon@lps.test", teacherPassword);
  await page.goto("/teach/assessments/new");
  await page.getByLabel("Subject").selectOption({ label: "Basic Science (Elementary)" });
  await page.getByLabel("Year group").selectOption({ label: "Year 4" });
  await page.getByLabel("Title").fill("Basic Science Test 1");
  await page.getByLabel("Number of questions").fill("5");
  await page.getByLabel("Time allowed (minutes)").fill("20");
  await page.getByRole("button", { name: "Create and add questions" }).click();
  await expect(page.getByRole("heading", { name: /Basic Science Test 1/ })).toBeVisible();

  await page.getByRole("link", { name: "Upload into this test" }).click();
  const text = Array.from({ length: 6 }, (_, i) => `Question number ${i + 1}?\nA. one\nB. two\nC. three\nD. four\nANSWER: B\nTOPIC: Topic ${i % 2}`).join("\n\n");
  await page.getByPlaceholder(/What is 2 \+ 2/).fill(text);
  await page.getByRole("button", { name: "Check pasted questions" }).click();
  await expect(page.getByText("6 ready · 0 need fixing")).toBeVisible();
  await shot(page, "03-import-preview");
  await page.getByRole("button", { name: "Import 6 questions" }).click();
  await expect(page).toHaveURL(/\/teach\/assessments\/[0-9a-f-]+$/);
  await expect(page.getByText("Questions (6)")).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Waiting for approval")).toBeVisible();
  await shot(page, "04-submitted");
});

test("HOD approves, schedules and creates a lab registration code", async ({ browser }) => {
  const page = await signIn(browser, "hod@lps.test", hodPassword);
  await page.goto("/admin/approvals");
  await page.getByRole("link", { name: "Basic Science Test 1" }).click();
  await page.getByLabel("Year 4 Gold").check();
  const now = new Date(Date.now() + 3600_000 - 5 * 60_000); // Lagos local, 5 min ago
  const later = new Date(now.getTime() + 3 * 3600_000);
  await page.getByLabel("Opens (Lagos time)").fill(now.toISOString().slice(0, 16));
  await page.getByLabel("Closes (no new starts after this)").fill(later.toISOString().slice(0, 16));
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Approve & schedule" }).click();
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
  await hod.getByRole("link", { name: "Basic Science Test 1" }).click();
  hod.once("dialog", (d) => d.accept());
  await hod.getByRole("button", { name: /Start exam now/ }).click();
  await expect(hod.getByText(/Live — students in Year 4 Gold can start now/)).toBeVisible();

  await expect(pc.getByRole("button", { name: "Start" })).toBeVisible({ timeout: 20_000 });
  await pc.getByRole("button", { name: "Start" }).click();
  await pc.getByLabel(/I am Charles Okafor/).check();
  await pc.getByRole("button", { name: "Start exam" }).click();
  await expect(pc.getByText("Question 1 of 5")).toBeVisible();
  await shot(pc, "07-question");

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
  await expect(pc.getByText(/3\s*\/ 5/)).toBeVisible();
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
  await expect(hod.getByText("3/5")).toBeVisible();
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
