"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Input } from "@/components/ui";
import { makeTestFromQuestions, nameEarlierGroup } from "../bank-actions";

/**
 * Questions from one earlier upload (before banks had names). Nothing about them changes until the teacher
 * names the bank or makes a test from them.
 */
export function EarlierGroupPanel({
  ids,
  from,
  suggestedName,
  subjectId,
  yearId,
  namedHref,
}: {
  ids: string[];
  from: string;
  suggestedName: string;
  subjectId: string;
  yearId: string;
  namedHref: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(suggestedName);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const when = new Date(from).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
  return (
    <Card className="p-4 sm:p-5">
      <p className="font-semibold">Uploaded {when}, not named yet</p>
      <p className="mt-1 text-sm text-muted">
        {ids.length} question{ids.length === 1 ? "" : "s"} added together before banks had names. Give this bank a name so it&apos;s easy to find, or make a test from it now.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="block text-xs text-muted">Bank name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-9 w-80 max-w-full" />
        </label>
        <Button
          size="md"
          disabled={busy || !name.trim()}
          onClick={() =>
            start(async () => {
              const res = await nameEarlierGroup({ ids, name, subjectId, yearId });
              if (res?.ok) {
                router.push(namedHref);
                router.refresh();
              } else setError(res && !res.ok ? res.error : "Couldn't name it.");
            })
          }
        >
          Name this bank
        </Button>
        <Button
          size="md"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const res = await makeTestFromQuestions({ ids, subjectId, yearId });
              if (res && !res.ok) setError(res.error);
            })
          }
        >
          Make a test from these
        </Button>
      </div>
      {error ? (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
    </Card>
  );
}
