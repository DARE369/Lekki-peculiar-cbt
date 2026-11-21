"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Button, Card, Input } from "@/components/ui";
import { confirmUploadDelete, previewUploadDelete, renameUpload } from "../actions";
import { makeTestFromQuestions } from "../bank-actions";

export interface UploadInfo {
  id: string;
  label: string;
  created_at: string;
  file_name: string | null;
  assessment_id: string | null;
  round_id: string | null;
  source_format?: string | null;
  testTitle: string | null;
  count: number;
  found_count: number;
  imported_count: number;
  linked_count: number;
  duplicate_count: number;
  removed_count: number;
  unreadable_count: number;
  issues: { code?: string; source: string; message: string; excerpt?: string }[];
}

type Preview = Awaited<ReturnType<typeof previewUploadDelete>>;

export function UploadPanel({ upload: u, subjectId, yearId, afterDeleteHref }: { upload: UploadInfo; subjectId: string; yearId: string; afterDeleteHref: string }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const when = new Date(u.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  function askDelete() {
    setError(null);
    start(async () => setPreview(await previewUploadDelete(u.id)));
  }
  function doDelete() {
    start(async () => {
      const res = await confirmUploadDelete(u.id);
      setPreview(null);
      if (res?.ok) router.push(afterDeleteHref);
      else setError(res?.error ?? "Couldn't delete this upload.");
    });
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {renaming ? (
            <ActionForm action={renameUpload} className="flex flex-wrap items-center gap-2" hideSuccess>
              <input type="hidden" name="id" value={u.id} />
              <Input name="label" defaultValue={u.label} maxLength={80} className="h-9 w-64" aria-label="Bank name" autoFocus />
              <SubmitButton size="sm">Save</SubmitButton>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </ActionForm>
          ) : (
            <h3 className="font-semibold">
              {u.label}{" "}
              <button type="button" onClick={() => setRenaming(true)} className="ml-1 text-xs font-medium text-brand hover:underline">
                Rename
              </button>
            </h3>
          )}
          <p className="mt-1 text-sm text-muted">
            {u.count} question{u.count === 1 ? "" : "s"} · {u.source_format === "manual" ? "made" : u.source_format === "earlier" ? "named" : "uploaded"} {when}
            {u.file_name ? ` from ${u.file_name}` : ""}
            {u.testTitle && u.assessment_id ? (
              <>
                {" "}· for{" "}
                <Link href={`/teach/assessments/${u.assessment_id}`} className="font-medium text-text underline-offset-2 hover:underline">
                  {u.testTitle}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {u.count > 0 ? (
            <Button
              size="sm"
              disabled={pending}
              loading={pending && !preview}
              onClick={() =>
                start(async () => {
                  const res = await makeTestFromQuestions({ bankId: u.id, subjectId, yearId });
                  if (res && !res.ok) setError(res.error);
                })
              }
            >
              Make a test from this bank
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={askDelete} disabled={pending || u.count === 0} className="text-danger hover:text-danger">
            Delete bank
          </Button>
        </div>
      </div>

      {u.found_count ? (
        <p className="mt-3 text-xs text-muted">
          In the file: {u.found_count} · saved {u.imported_count}
          {u.duplicate_count ? ` · ${u.duplicate_count} you already had` : ""}
          {u.removed_count ? ` · ${u.removed_count} removed before saving` : ""}
          {u.unreadable_count ? ` · ${u.unreadable_count} couldn't be read` : ""}
        </p>
      ) : null}

      {u.issues?.length ? (
        <details className="mt-3 rounded-lg border border-warning/30 bg-warning-soft/50 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-warning">
            {u.issues.length} question{u.issues.length === 1 ? "" : "s"} from this file weren&apos;t saved — see why
          </summary>
          <ul className="mt-2 space-y-1 pb-1 text-xs">
            {u.issues.map((i, k) => (
              <li key={k}>
                <span className="font-semibold">{i.source}</span>
                {i.excerpt ? <span className="text-muted"> (&ldquo;{i.excerpt}&rdquo;)</span> : null}: {i.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center animate-fade bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="del-upload-title">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-float animate-rise">
            <h2 id="del-upload-title" className="text-base font-semibold">
              Delete “{u.label}”?
            </h2>
            {preview.safe.length ? (
              <p className="mt-2 text-sm text-muted">
                {preview.safe.length} question{preview.safe.length === 1 ? "" : "s"} will be removed from your bank. Tests that already ran keep their own copy, so no results change.
              </p>
            ) : null}
            {preview.blocked.length ? (
              <p className="mt-2 text-sm text-warning">
                {preview.blocked.length} question{preview.blocked.length === 1 ? " is" : "s are"} in a live or upcoming exam and will be kept. The upload stays until those can be deleted too.
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPreview(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={doDelete} disabled={pending || preview.safe.length === 0}>
                {pending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
