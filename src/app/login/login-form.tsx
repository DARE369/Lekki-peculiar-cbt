"use client";

import { useState } from "react";
import { KeyRound, Mail, RotateCcw } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, cn } from "@/components/ui";
import { sendMagicLink, sendPasswordReset, signInWithPassword } from "./actions";

type Mode = "password" | "link" | "reset";
const MODES: { value: Mode; label: string; Icon: typeof Mail }[] = [
  { value: "password", label: "Password", Icon: KeyRound },
  { value: "link", label: "Email link", Icon: Mail },
];

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>("password");
  const action = mode === "password" ? signInWithPassword : mode === "link" ? sendMagicLink : sendPasswordReset;
  return (
    <div>
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
