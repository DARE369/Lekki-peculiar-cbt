"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import JSZip from "jszip";
import { Alert } from "@/components/ui";
import { normalizeAdmission } from "@/lib/import/students";
import { photoUploadUrl, setPhotoPath } from "@/app/(staff)/admin/students/actions";

/** Shrinks a photo to a passport-sized JPEG so lab computers load it quickly. */
async function resize(file: Blob, max = 480): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/jpeg", 0.85),
  );
}

async function uploadOne(studentId: string, file: Blob) {
  const target = await photoUploadUrl(studentId);
  if ("error" in target) throw new Error(target.error);
  const body = await resize(file);
  const res = await fetch(target.url, { method: "PUT", headers: { "content-type": "image/jpeg" }, body });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  const saved = await setPhotoPath(studentId, target.path);
  if (saved && !saved.ok) throw new Error(saved.error);
}

export function SinglePhotoUpload({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
        {busy ? "Uploading…" : "Upload photo"}
        <input
          type="file"
          accept="image/*"
          capture="user"
          className="sr-only"
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            setError(null);
            try {
              await uploadOne(studentId, f);
              router.refresh();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

/**
 * Bulk photos: a .zip (or many selected images) whose file names are admission numbers,
 * e.g. "LPS-2024-0137.jpg". Slashes aren't allowed in file names, so dashes/underscores are fine.
 */
export function BulkPhotoUpload({ students }: { students: { id: string; admission_key: string }[] }) {
  const router = useRouter();
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const byKey = new Map(students.map((s) => [s.admission_key, s.id]));

  async function run(files: { name: string; blob: () => Promise<Blob> }[]) {
    const matched: { id: string; name: string; blob: () => Promise<Blob> }[] = [];
    const unmatched: string[] = [];
    for (const f of files) {
      const base = f.name.split("/").pop()!.replace(/\.[^.]+$/, "");
      const id = byKey.get(normalizeAdmission(base));
      if (id) matched.push({ id, name: f.name, blob: f.blob });
      else unmatched.push(f.name);
    }
    setLog(unmatched.length ? [`No student found for: ${unmatched.slice(0, 30).join(", ")}${unmatched.length > 30 ? "…" : ""}`] : []);
    setProgress({ done: 0, total: matched.length });
    let failures = 0;
    for (const [i, m] of matched.entries()) {
      try {
        await uploadOne(m.id, await m.blob());
      } catch (e) {
        failures++;
        setLog((l) => [...l, `${m.name}: ${(e as Error).message}`]);
      }
      setProgress({ done: i + 1, total: matched.length });
    }
    setLog((l) => [`Uploaded ${matched.length - failures} of ${matched.length} photos.`, ...l]);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-ink">
          Choose .zip of photos
          <input
            type="file"
            accept=".zip"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const zip = await JSZip.loadAsync(f);
              const entries = Object.values(zip.files).filter((z) => !z.dir && /\.(jpe?g|png|webp)$/i.test(z.name) && !z.name.startsWith("__MACOSX"));
              await run(entries.map((z) => ({ name: z.name, blob: () => z.async("blob") })));
            }}
          />
        </label>
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2">
          …or select image files
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={async (e) => {
              const list = [...(e.target.files ?? [])];
              e.target.value = "";
              await run(list.map((f) => ({ name: f.name, blob: async () => f })));
            }}
          />
        </label>
      </div>
      {progress ? (
        <div>
          <div className="h-2 overflow-hidden rounded bg-surface-2">
            <div className="h-full bg-brand transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {progress.done} / {progress.total}
          </p>
        </div>
      ) : null}
      {log.length ? (
        <Alert tone={log.some((l) => l.includes(":")) ? "warning" : "success"}>
          {log.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </Alert>
      ) : null}
    </div>
  );
}
