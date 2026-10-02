# Deployment guide

The app runs on **Vercel** with **Supabase** (Postgres, Auth, Storage). Budget about 30 minutes.

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com). Pick the region closest to Lagos that Supabase offers (e.g. London). Save the database password somewhere safe.
2. Upgrade to the **Pro plan before the first real exam**: daily backups, no pausing on inactivity, more connections.
3. **Apply the database migrations** — pick one:
   - **Supabase CLI** (recommended):
     ```bash
     npx supabase login
     npx supabase link --project-ref <your-project-ref>
     npx supabase db push
     ```
   - **SQL editor**: open each file in `supabase/migrations/` **in filename order** and run it.

   This creates every table, the security rules, the exam functions, the default structure (Pre-School / Elementary / College, Years 1–12, Science/Art/Commerce tracks, the 2026/2027 session and common subjects) and the storage buckets.
4. **Authentication → Sign In / Providers → Email**: keep Email enabled and **turn off “Allow new users to sign up”**. Staff accounts are created only by the super admin.
5. **Authentication → URL Configuration**:
   - Site URL: your Vercel address, e.g. `https://lekki-cbt.vercel.app`
   - Redirect URLs: add `https://lekki-cbt.vercel.app/auth/callback` (and your custom domain's, if any)
6. **Email (optional but recommended)**: Supabase's built-in email is heavily rate-limited. For sign-in links, invitations and password resets, add custom SMTP under **Authentication → Emails → SMTP Settings** (e.g. Resend, Zoho Mail or the school's Google Workspace).
7. **Project Settings → API**: copy the Project URL, the anon/publishable key and the service_role/secret key for the next step.

## 2. Deploy on Vercel

1. Vercel → **Add New… → Project** → import `DARE369/Lekki-peculiar-cbt`.
2. Framework: Next.js (auto-detected). No build settings to change.
3. Add the environment variables from [`.env.example`](../.env.example):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key |
   | `EXAM_TOKEN_SECRET` | output of `openssl rand -base64 48` |
   | `SETUP_SECRET` | any code you choose, used once on `/setup` |

   (If you use Vercel's Supabase integration, the first three are filled in for you.)
4. Deploy. Production deploys follow the repository's production branch (`main` by default) — merge the work branch into `main`, or deploy the branch as a Preview to try it first.

## 3. First sign-in

1. Open `https://<your-app>/setup`, enter the `SETUP_SECRET`, your name, school email and a password. This creates the **super admin**; the page then locks itself.
2. **Sessions & terms**: check the current term.
3. **Staff & permissions**: add the Elementary and College Heads of Section (role *Head of Section*, pick their section). Default permissions cover approving, starting exams, extra time, unlocking computers, students, teaching assignments and lab computers. **Make-ups and voiding are off by default** — tick them for the people you trust with exceptions.
4. Add teachers (a temporary password is shown to pass on, or an invitation email if SMTP is set up).

## 4. School data (Heads of Section)

1. **Classes & subjects**: add the arms for each year (e.g. `Year 7 Gold, Year 7 Blue`), set tracks for Senior College classes, adjust subjects.
2. **Students → Import from spreadsheet**: CSV with `Admission No, First Name, Surname, Other Names, Gender, Class` (template on the page). Re-importing updates existing students, which is also how to move classes at the start of a session.
3. **Students → Upload photos in bulk**: a `.zip` of photos named by admission number (`LPS-2024-0137.jpg`). Photos are shrunk in the browser before upload.
4. Teachers pick what they teach under **My classes**; approve under **Teaching assignments** (or assign directly).

## 5. The computer lab

1. **Lab computers → Create registration code**.
2. On every lab PC, open `https://<your-app>/exam`, enter the code and a name like `Lab 1 – PC 14`. Set that page as the browser's home page. Only registered PCs can open exams.
3. Load `/exam` once on each PC while the internet is working so the page is cached for offline use.
4. Recommended: Chrome in kiosk mode (`chrome --kiosk https://<your-app>/exam`) and a **4G/5G MiFi as a backup uplink**. A full sitting of 60 students moves only a few megabytes.

## 6. Exam-day checklist (Head of Section)

- [ ] Test approved and scheduled for each class (**Approvals**)
- [ ] Lab PCs on `/exam` before students arrive
- [ ] Students seated and logged in — they wait on “Waiting for your supervisor to start”
- [ ] **Exams → open the exam → ▶ Start exam now**
- [ ] Watch the live monitor: *Offline* rows are still safe (answers are on the PC); *Re-login* means someone tried another PC
- [ ] Power cut? **Extra time for everyone** once power is back
- [ ] A PC dies? Move the student to another PC, then open their row → **Unlock re-login**
- [ ] Absent students → **Make-up exam** with a new time slot
- [ ] Students who submit while offline see “saved on this computer” — **don't switch those PCs off** until the monitor shows them *Submitted*

## Sign in with Google (optional)

Staff whose school email is a Google Workspace account can use **Continue with Google** on the sign-in page. Only people already added under **Staff & permissions** get in — the Google email must match their staff email. Any other Google account is turned away and nothing is kept for it.

1. **Google Cloud Console** (signed in as a Workspace admin) → create a project → **APIs & Services → OAuth consent screen**: user type **Internal** (only peculiarschools.com accounts can use it), app name "Peculiar CBT", support email.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**. Under **Authorised redirect URIs** add `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase shows the exact URL on its Google provider page). Copy the **Client ID** and **Client secret**.
3. **Supabase → Authentication → Sign In / Providers → Google**: switch on, paste the Client ID and secret, save.
4. **Supabase → Authentication → Sign In / Providers**: switch **off** "Allow new users to sign up". Staff accounts are still created by the app; this just stops strangers from creating accounts.
5. **Supabase → Authentication → URL Configuration**: Redirect URLs must include `https://<your-site>/auth/callback` (it is already needed for invites).
6. Optional: on Vercel set `GOOGLE_HOSTED_DOMAIN=peculiarschools.com` so the Google account chooser prefers school accounts.

The button appears on the sign-in page by itself within about five minutes of switching the provider on. Passwords and email links keep working alongside it.

## Staff invitation email

Bulk add (Staff & permissions → Bulk add staff) and single add can email each person an invitation. The email is Supabase's **Invite user** email, so its wording is set in Supabase:

1. **Supabase → Authentication → Email Templates → Invite user.**
2. Subject: `The CBT Application is now live — your invitation from Lekki Peculiar School`
3. Message body: clear the box first (Source tab → Ctrl+A → Delete), then paste the contents of [`docs/email-templates/invite.min.html`](email-templates/invite.min.html) (compact copy, ~9,400 characters; Supabase allows 50,000). The readable version for editing is [`invite.html`](email-templates/invite.html). It greets the person by name, says their role (and section for Heads of Section) and lists the next steps for that role. Edit the wording freely; keep the `{{ ... }}` parts.
4. **Authentication → URL Configuration → Site URL** must be the live address (e.g. `https://lekki-peculiar-cbt.vercel.app`); the email's fallback link uses it.
5. **Authentication → Rate Limits → "Rate limit for sending emails"**: raise it (e.g. to 100 per hour) before inviting all staff at once. If the limit is hit, bulk add stops sending and lists who still needs an invite — upload the same file again later; people already added are skipped.
6. Optional: **Authentication → Sign In / Providers → Email → Email OTP Expiration** controls how long the button works (up to 86400 seconds = 24 hours). After it expires, staff use **Forgot password?** or **Continue with Google**.
7. **Reset password** and **Magic link** templates (same page): paste [`reset-password.html`](email-templates/reset-password.html) (subject `Set your password — Peculiar CBT`) and [`magic-link.html`](email-templates/magic-link.html) (subject `Your sign-in link — Peculiar CBT`). These are sent by **Forgot password?**, **Email me a sign-in link** and **Resend invitation** for someone already registered; without them staff get Supabase's plain three-line email.
8. **Authentication → URL Configuration → Redirect URLs**: add `https://<your-site>/**` so links can return to `/auth/callback?next=…`.

Before inviting, open **Staff progress** as super admin: the **Before you invite staff** card lists anything still missing (current term, classes, subjects, Heads of Section, deadlines, app email settings).

## Staff onboarding, deadlines and approval emails

- **First sign-in setup.** Every new teacher and Head of Section is guided through a few screens on first sign-in: confirm name, phone number, choose a password (skipped for Google sign-in), then teachers pick their subjects and classes and see how to upload questions. Super admins skip it.
- **Upload while waiting.** Teachers can add questions as soon as they've chosen a subject; building tests still needs the Head of Section's approval.
- **Deadlines.** Administration → **Staff progress**: the super admin sets the whole-school deadline (there is no fixed number of questions — teachers decide); a section date (Elementary / College) overrides it. Heads of Section can set their own section's date. Teachers see the deadline and their progress on the dashboard.
- **Staff progress** also lists who hasn't signed in (with **Resend invitation**), who is still setting up, and each teacher's questions per subject.
- **Approval emails.** When subjects/classes are approved or declined, and when a test is approved or sent back, the teacher gets an email. These come from the app, so add these on **Vercel → Settings → Environment Variables** (same Google mailbox and app password as Supabase SMTP), then redeploy:

  | Name | Value |
  |---|---|
  | `SMTP_HOST` | `smtp.gmail.com` |
  | `SMTP_PORT` | `465` |
  | `SMTP_USER` | `peace.denise@peculiarschools.com` |
  | `SMTP_PASS` | the 16-letter app password |
  | `SMTP_FROM` | `Lekki Peculiar School <peace.denise@peculiarschools.com>` (optional) |

  Without them the app works normally and simply doesn't send these emails.
- **Database update.** Run `supabase/migrations/20261002000100_onboarding.sql` then `supabase/migrations/20261003000100_assessment_classes.sql` `supabase/migrations/20261004000100_mock_test.sql`, `supabase/migrations/20261005000100_restore_subjects.sql` (brings back every retired subject) and `supabase/migrations/20261006000100_staff_sections.sql` (teachers belong to one section; Heads of Section only see their own section's staff) in the Supabase SQL editor (or `npx supabase db push`) **before** deploying this version.

## Maintenance

- **New session**: *Sessions & terms → New session*, then set the current term. Old results stay organised under their term.
- **Backups**: Supabase Pro takes daily backups; for extra safety download CSVs from Reports at the end of each term.
- **Updating the database**: new files in `supabase/migrations/` are applied with `npx supabase db push`.

## Branding

- **Colours:** the `BRAND` block at the top of `src/app/globals.css` (light and dark values, plus the fixed hero-panel blues and gold).
- **Name, vision, core values, crest:** `src/lib/brand.ts`. Put the crest image in `public/brand/` and set `logoSrc` (e.g. `/brand/crest.png`); until then a monogram is drawn in the brand colours.
- **Theme:** every user can switch Light / Dark / System (sidebar, sign-in page, exam screen). “System” follows the device setting live.

## Sections and who can see whom

Every teacher belongs to one section (Elementary or College). Choose it when adding a teacher (single add, or the **Section** column in a bulk file); for teachers already added, use the quick **Choose…** box on **Staff & permissions** (filter: *No section yet*). A teacher who hasn't been placed is placed automatically when they first pick subjects. Teachers can only pick subjects from their own section.

Heads of Section see only the staff of their own section(s), in **My staff** (view only: name, email, phone, status) and **Staff progress**. The super admin sees everyone and is the only one who can change staff details or access.

## Pasting questions

**Upload questions → Copy and paste** reads JSON or plain text as you paste it, and tidies the usual damage from copying (curly quotation marks, ```json code fences, chat text around the questions, missing or extra commas, cut-off text). **Copy instructions for the AI** gives teachers a ready-made prompt for ChatGPT whose answer can be pasted straight back.
