"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { sendMagicLink, sendPasswordReset, signInWithPassword } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "link" | "reset">("password");
  const action = mode === "password" ? signInWithPassword : mode === "link" ? sendMagicLink : sendPasswordReset;
  return (
    <div>
      <ActionForm action={action} className="space-y-4" key={mode}>
        <input type="hidden" name="next" value={next} />
        <Field label="School email">
          <Input name="email" type="email" autoComplete="email" required placeholder="name@school.edu.ng" />
        </Field>
        {mode === "password" ? (
          <Field label="Password">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
        ) : null}
        <SubmitButton className="w-full" pendingText="Please wait…">
          {mode === "password" ? "Sign in" : mode === "link" ? "Email me a sign-in link" : "Email me a reset link"}
        </SubmitButton>
      </ActionForm>
      <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
        {mode !== "password" ? (
          <button className="text-brand hover:underline" onClick={() => setMode("password")}>
            Use password instead
          </button>
        ) : (
          <button className="text-brand hover:underline" onClick={() => setMode("link")}>
            Sign in with an email link
          </button>
        )}
        {mode !== "reset" ? (
          <button className="text-muted hover:underline" onClick={() => setMode("reset")}>
            Forgot password?
          </button>
        ) : null}
      </div>
    </div>
  );
}
