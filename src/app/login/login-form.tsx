"use client";

import { useState } from "react";
import { KeyRound, Mail, RotateCcw } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, buttonClass, cn } from "@/components/ui";
import { sendMagicLink, sendPasswordReset, signInWithGoogle, signInWithPassword } from "./actions";

type Mode = "password" | "link" | "reset";
const MODES: { value: Mode; label: string; Icon: typeof Mail }[] = [
  { value: "password", label: "Password", Icon: KeyRound },
  { value: "link", label: "Email link", Icon: Mail },
];

function GoogleButton({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  return (
    <form action={signInWithGoogle} onSubmit={() => setPending(true)}>
      <input type="hidden" name="next" value={next} />
      <button type="submit" disabled={pending} className={buttonClass("secondary", "lg", "w-full gap-3")}>
        <svg viewBox="0 0 48 48" aria-hidden className="!size-5">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {pending ? "Opening Google…" : "Continue with Google"}
      </button>
    </form>
  );
}

export function LoginForm({ next, google = false }: { next: string; google?: boolean }) {
  const [mode, setMode] = useState<Mode>("password");
  const action = mode === "password" ? signInWithPassword : mode === "link" ? sendMagicLink : sendPasswordReset;
  return (
    <div>
      {google && mode !== "reset" ? (
        <>
          <GoogleButton next={next} />
          <div className="my-6 flex items-center gap-3 text-xs font-medium tracking-wide text-muted uppercase">
            <span className="h-px flex-1 bg-border" /> or use your email <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
      {mode !== "reset" ? (
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1" role="tablist" aria-label="Sign-in method">
          {MODES.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-colors",
                mode === value ? "bg-surface text-text shadow-soft" : "text-muted hover:text-text",
              )}
            >
              <Icon className="size-4" aria-hidden /> {label}
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-6 flex items-center gap-2 text-sm font-semibold">
          <RotateCcw className="size-4 text-brand" aria-hidden /> Reset your password
        </div>
      )}
      <ActionForm action={action} className="space-y-4" key={mode}>
        <input type="hidden" name="next" value={next} />
        <Field label="School email">
          <Input name="email" type="email" autoComplete="email" required placeholder="name@peculiarschools.com" className="h-11" />
        </Field>
        {mode === "password" ? (
          <Field label="Password">
            <Input name="password" type="password" autoComplete="current-password" required className="h-11" />
          </Field>
        ) : null}
        <SubmitButton className="w-full" size="lg" pendingText="Please wait…">
          {mode === "password" ? "Sign in" : mode === "link" ? "Email me a sign-in link" : "Email me a reset link"}
        </SubmitButton>
      </ActionForm>
      <div className="mt-5 text-center text-sm">
        {mode === "reset" ? (
          <button className="font-semibold text-brand hover:underline" onClick={() => setMode("password")}>
            Back to sign in
          </button>
        ) : (
          <button className="text-muted hover:text-text hover:underline" onClick={() => setMode("reset")}>
            Forgot password?
          </button>
        )}
      </div>
    </div>
  );
}
