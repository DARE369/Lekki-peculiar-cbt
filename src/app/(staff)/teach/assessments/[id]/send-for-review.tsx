"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui";
import { paperChecklist, submitForApproval, type PaperChecklist } from "../../actions";

/**
 * The last step for a teacher. Pressing Send first checks the test: things that must be fixed stop it;
 * things worth a second look are listed with "Send anyway".
 */
export function SendForReview({ id, summary }: { id: string; summary: string }) {
  const [check, setCheck] = useState<PaperChecklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  function send() {
    setError(null);
    start(async () => {
      const res = await submitForApproval(null, new FormData(form.current!));
      // On success the action redirects; anything returned is an error.
      if (res && !res.ok) setError(res.error);
    });
  }

  function review() {
    setError(null);
    start(async () => {
      const c = await paperChecklist(id);
      if (!c.blockers.length && !c.warnings.length) {
        setCheck(null);
        send();
      } else setCheck(c);
    });
  }

  return (
    <form ref={form} onSubmit={(e) => e.preventDefault()} className="space-y-4 p-5">
      <input type="hidden" name="id" value={id} />
      <div>
        <p className="text-base font-semibold">Ready to send for review?</p>
        <p className="mt-0.5 text-sm text-muted">{summary}</p>
      </div>
      {check?.blockers.length ? (
        <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm" role="alert">
          <p className="flex items-center gap-2 font-semibold text-danger">
            <OctagonAlert className="size-4" aria-hidden /> Fix {check.blockers.length === 1 ? "this" : "these"} first
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6">
            {check.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {check && !check.blockers.length && check.warnings.length ? (
        <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm" role="status">
          <p className="flex items-center gap-2 font-semibold text-warning">
            <AlertTriangle className="size-4" aria-hidden /> Worth checking before you send
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6">
            {check.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={send} disabled={pending}>
              {pending ? "Sending…" : "Send anyway"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setCheck(null)}>
              Go back and fix
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
      {!check || check.blockers.length ? (
        <Button onClick={review} disabled={pending}>
          {pending ? "Checking…" : "Send for review"}
        </Button>
      ) : null}
    </form>
  );
}
