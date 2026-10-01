import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Download, FileSpreadsheet, Upload } from "lucide-react";
import { Logo } from "@/components/brand";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ThemeSwitcher } from "@/components/theme";
import { Field, Input, buttonClass, cn } from "@/components/ui";
import { needsOnboarding, requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { daysUntil, deadlineForSection, formatDeadline, getQuestionSettings } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { finishOnboarding, saveAbout, savePassword, saveSubjects } from "./actions";
import { SubjectPicker, type PickerSection } from "./subject-picker";

export const metadata: Metadata = { title: "Welcome" };

type Step = "about" | "password" | "subjects" | "upload" | "section";

export default async function WelcomePage(props: PageProps<"/welcome">) {
  const staff = await requireStaff();
  if (!needsOnboarding(staff)) redirect("/dashboard");
  const sp = await props.searchParams;
  const s = await getStructure();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const hasGoogle = Boolean(user?.identities?.some((i) => i.provider === "google"));

  const isHod = staff.role === "admin";
  const steps: Step[] = ["about"];
  // Kept in the list even after it's done, so the step count doesn't change mid-way.
  if (!hasGoogle) steps.push("password");
  steps.push(...(isHod ? (["section"] as Step[]) : (["subjects", "upload"] as Step[])));
  const step: Step = steps.includes(sp.step as Step) ? (sp.step as Step) : steps[0];
  const index = steps.indexOf(step);
  const next = steps[index + 1] ?? "";
  const prev = steps[index - 1];
  const firstName = staff.fullName.split(" ").find((w) => !/^(mr|mrs|ms|miss|dr|prof)\.?$/i.test(w)) ?? staff.fullName;

  return (
    <div className="min-h-screen bg-hero">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-5 pt-6">
        <Logo />
        <ThemeSwitcher compact />
      </header>
      <main className="mx-auto max-w-2xl px-5 pt-8 pb-16">
        <div className="mb-6">
          <p className="text-sm font-semibold text-muted">
            Step {index + 1} of {steps.length}
          </p>
          <div className="mt-2 flex gap-1.5" aria-hidden>
            {steps.map((x, i) => (
              <span key={x} className={cn("h-2 flex-1 rounded-full", i <= index ? "bg-brand" : "bg-border")} />
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6 shadow-card sm:p-8">
          {step === "about" ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Welcome, {firstName}!</h1>
              <p className="mt-2 text-base text-muted">
                Let&apos;s get you ready in a few short steps. First, check your name and give us a phone number.
              </p>
              <ActionForm action={saveAbout} className="mt-6 space-y-5">
                <input type="hidden" name="next" value={next} />
                <Field label="Your full name" hint="This is how your name appears on tests and reports.">
                  <Input name="full_name" defaultValue={staff.fullName} required className="h-12 text-base" autoComplete="name" />
                </Field>
                <Field label="Your phone number" hint="So the school can reach you about your questions and exams.">
                  <Input
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    defaultValue={staff.phone ?? ""}
                    placeholder="0803 123 4567"
                    required
                    className="h-12 text-base"
                    autoComplete="tel"
                  />
                </Field>
                <SubmitButton size="lg" className="w-full">
                  Continue
                </SubmitButton>
              </ActionForm>
            </>
          ) : null}

          {step === "password" ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Choose your password</h1>
              <p className="mt-2 text-base text-muted">
                You&apos;ll use it with your school email (<strong className="text-text">{staff.email}</strong>) to sign in next time.
              </p>
              {!staff.needsPassword ? (
                <Link
                  href={`/welcome?step=${next}`}
                  className="mt-4 block rounded-xl bg-surface-2 px-4 py-3 text-sm font-semibold text-brand hover:underline"
                >
                  You already have a password — keep it and continue →
                </Link>
              ) : null}
              <ActionForm action={savePassword} className="mt-6 space-y-5">
                <input type="hidden" name="next" value={next} />
                <Field label="New password" hint="At least 8 characters. Something you'll remember.">
                  <Input name="password" type="password" required minLength={8} className="h-12 text-base" autoComplete="new-password" />
                </Field>
                <Field label="Type it again">
                  <Input name="confirm" type="password" required minLength={8} className="h-12 text-base" autoComplete="new-password" />
                </Field>
                <SubmitButton size="lg" className="w-full">
                  Save password and continue
                </SubmitButton>
              </ActionForm>
            </>
          ) : null}

          {step === "subjects" ? <SubjectsStep staffId={staff.id} next={next} /> : null}
          {step === "upload" ? <UploadStep /> : null}
          {step === "section" ? <SectionStep sectionIds={staff.sectionIds} /> : null}

          {prev ? (
            <Link href={`/welcome?step=${prev}`} className="mt-5 block text-center text-sm font-medium text-muted hover:text-text hover:underline">
              ← Back
            </Link>
          ) : null}
        </div>

        <form action={signOut} className="mt-8 text-center">
          <button className="text-sm text-muted hover:text-text hover:underline">Not you? Sign out</button>
        </form>
      </main>
    </div>
  );

  async function SubjectsStep({ staffId, next }: { staffId: string; next: string }) {
    const { data: mine } = await supabase
      .from("teaching_assignments")
      .select("subject_id, class_id, status")
      .eq("teacher_id", staffId)
      .eq("session_id", s.currentSessionId ?? "");
    const sections: PickerSection[] = s.sections
      .filter((x) => x.cbt_enabled)
      .map((sec) => ({
        id: sec.id,
        name: sec.name,
        subjects: s.subjects.filter((x) => x.active && x.section_id === sec.id).map((x) => ({ id: x.id, name: x.name })),
        classes: s.classes.filter((c) => c.active && s.sectionOfClass(c.id)?.id === sec.id).map((c) => ({ id: c.id, name: c.name })),
      }));
    const key = (r: { subject_id: string; class_id: string }) => `${r.subject_id}:${r.class_id}`;
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">What do you teach?</h1>
        <p className="mt-2 text-base text-muted">
          Tap every class you teach under each subject. Your Head of Section will approve them — you can start uploading questions straight
          away.
        </p>
        <ActionForm action={saveSubjects} className="mt-6">
          <input type="hidden" name="next" value={next} />
          <SubjectPicker
            sections={sections}
            initial={(mine ?? []).filter((r) => r.status === "requested").map(key)}
            locked={(mine ?? []).filter((r) => r.status === "approved").map(key)}
          />
          <SubmitButton size="lg" className="mt-5 w-full">
            Continue
          </SubmitButton>
        </ActionForm>
        <Link href={`/welcome?step=${next}`} className="mt-4 block text-center text-sm text-muted hover:text-text hover:underline">
          Skip for now — I&apos;ll do this later under My classes
        </Link>
      </>
    );
  }

  async function UploadStep() {
    const settings = await getQuestionSettings();
    const { data: mine } = await supabase
      .from("teaching_assignments")
      .select("subject_id")
      .eq("teacher_id", staff.id)
      .eq("session_id", s.currentSessionId ?? "")
      .in("status", ["requested", "approved"]);
    const deadlines = [
      ...new Set((mine ?? []).map((r) => deadlineForSection(s.subjectById.get(r.subject_id)?.section_id, s, settings)).filter(Boolean)),
    ].sort() as string[];
    const deadline = deadlines[0] ?? settings.defaultDeadline;
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">How to upload your questions</h1>
        <p className="mt-2 text-base text-muted">It takes three simple steps. You can come back to this any time from your dashboard.</p>
        {deadline ? <DeadlineBox deadline={deadline} perSubject={settings.perSubject} /> : null}
        <ol className="mt-6 space-y-4">
          <HowStep n={1} icon={<Download className="size-5" />} title="Download the Excel template">
            <a href="/api/templates/questions.xlsx" className="font-semibold text-brand hover:underline">
              Download the question template (Excel)
            </a>
          </HowStep>
          <HowStep n={2} icon={<FileSpreadsheet className="size-5" />} title="Type your questions">
            One question per row: the question, options A to D, and the letter of the correct answer.
          </HowStep>
          <HowStep n={3} icon={<Upload className="size-5" />} title="Upload the file">
            Go to <strong>Question bank → Upload</strong>, choose the subject and year group, then pick your file. We check it before saving.
          </HowStep>
        </ol>
        <p className="mt-6 rounded-xl bg-surface-2 px-4 py-3 text-sm">
          We&apos;ll email you when your Head of Section approves your subjects and classes.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <form action={finishOnboarding}>
            <input type="hidden" name="to" value="/teach/questions/import" />
            <button className={buttonClass("primary", "lg", "w-full")}>Upload questions now</button>
          </form>
          <form action={finishOnboarding}>
            <input type="hidden" name="to" value="/dashboard" />
            <button className={buttonClass("secondary", "lg", "w-full")}>Go to my dashboard</button>
          </form>
        </div>
      </>
    );
  }

  async function SectionStep({ sectionIds }: { sectionIds: string[] }) {
    const settings = await getQuestionSettings();
    const { count } = await supabase.from("teaching_assignments").select("id", { count: "exact", head: true }).eq("status", "requested");
    const names = sectionIds.map((id) => s.sectionById.get(id)?.name).filter(Boolean);
    const deadline = deadlineForSection(sectionIds[0], s, settings);
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Your section{names.length > 1 ? "s" : ""}: {names.join(" & ") || "—"}</h1>
        <p className="mt-2 text-base text-muted">As Head of Section, you keep things moving for your teachers. Here&apos;s what to do:</p>
        {deadline ? <DeadlineBox deadline={deadline} perSubject={settings.perSubject} /> : null}
        <ol className="mt-6 space-y-4">
          <HowStep n={1} title="Approve your teachers' subjects">
            Open <strong>Teaching assignments</strong>, tick the requests and press <strong>Approve ticked</strong>. Each teacher gets an email.
            {count ? (
              <span className="mt-1 block font-semibold text-warning">
                {count} request{count === 1 ? " is" : "s are"} waiting now.
              </span>
            ) : null}
          </HowStep>
          <HowStep n={2} title="Follow upload progress">
            <strong>Staff progress</strong> shows who has signed in, chosen subjects and uploaded their questions.
          </HowStep>
          <HowStep n={3} title="Approve tests, then start exams">
            Review tests under <strong>Approvals</strong>. On exam day, press <strong>Start</strong> in <strong>Exams &amp; live monitor</strong>.
          </HowStep>
        </ol>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <form action={finishOnboarding}>
            <input type="hidden" name="to" value={count ? "/admin/assignments" : "/admin/progress"} />
            <button className={buttonClass("primary", "lg", "w-full")}>{count ? "Review requests now" : "See staff progress"}</button>
          </form>
          <form action={finishOnboarding}>
            <input type="hidden" name="to" value="/dashboard" />
            <button className={buttonClass("secondary", "lg", "w-full")}>Go to my dashboard</button>
          </form>
        </div>
      </>
    );
  }
}

function DeadlineBox({ deadline, perSubject }: { deadline: string; perSubject: number }) {
  const days = daysUntil(deadline);
  return (
    <div className="mt-5 flex gap-3 rounded-2xl border-l-4 border-accent bg-accent-soft px-4 py-3">
      <CalendarClock className="mt-0.5 size-5 shrink-0 text-[color:var(--warning)]" aria-hidden />
      <p className="text-sm leading-relaxed">
        Upload by <strong>{formatDeadline(deadline)}</strong>
        {days >= 0 ? ` (${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} left`})` : " (this date has passed)"}.
        <br />
        Aim for <strong>{perSubject} questions</strong> for each subject and year group you teach.
      </p>
    </div>
  );
}

function HowStep({ n, icon, title, children }: { n: number; icon?: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white" aria-hidden>
        {icon ?? n}
      </span>
      <div>
        <p className="text-base font-semibold">
          <span className="sr-only">Step {n}: </span>
          {title}
        </p>
        <div className="mt-0.5 text-sm leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  );
}
