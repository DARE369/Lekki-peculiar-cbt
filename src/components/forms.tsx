"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/actions";
import { Alert, buttonClass } from "@/components/ui";

/** Pending state of the surrounding ActionForm (which submits without React's automatic form reset). */
const ActionPending = createContext(false);

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
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent" | "soft";
  size?: "sm" | "md" | "lg";
  className?: string;
  confirm?: string;
  name?: string;
  value?: string;
}) {
  const { pending: formPending } = useFormStatus();
  const actionPending = useContext(ActionPending);
  const pending = formPending || actionPending;
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
      {pending ? (
        <>
          <svg className="mr-2 size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {pendingText ?? "Working…"}
        </>
      ) : children}
    </button>
  );
}

/**
 * A form bound to a server action returning ActionResult; shows the outcome inline.
 *
 * Submits through onSubmit rather than <form action>, because React resets a form's fields
 * after every action — which wiped what people had typed whenever something failed. Fields are
 * now kept on error and cleared only on success when resetOnSuccess is set.
 */
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
  const [state, dispatch, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        // Include the clicked button's name/value (e.g. "decision=approve").
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => dispatch(fd));
      }}
    >
      <ActionPending.Provider value={pending}>
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
      </ActionPending.Provider>
    </form>
  );
}
