"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/actions";
import { Alert, buttonClass } from "@/components/ui";

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  confirm,
  name,
  value,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  confirm?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}

/** A form bound to a server action returning ActionResult; shows the outcome inline. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  hideSuccess = false,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  hideSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state && !state.ok ? (
        <div className="mt-3">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      ) : null}
      {state?.ok && state.message && !hideSuccess ? (
        <div className="mt-3">
          <Alert tone="success">{state.message}</Alert>
        </div>
      ) : null}
    </form>
  );
}
