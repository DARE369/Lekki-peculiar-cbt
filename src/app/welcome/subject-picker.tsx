"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/components/ui";

import type { PickerSection } from "@/lib/assignments";

/**
 * Subjects as cards; tap the classes you teach each one to. Approved choices are locked (shown with a tick).
 * Submits hidden "pick" inputs of the form subjectId:classId.
 */
export function SubjectPicker({ sections, initial, locked }: { sections: PickerSection[]; initial: string[]; locked: string[] }) {
  const [picked, setPicked] = useState(() => new Set([...initial, ...locked]));
  const lockedSet = useMemo(() => new Set(locked), [locked]);
  const [sectionId, setSectionId] = useState(() => {
    const withPicks = sections.find((sec) => sec.subjects.some((sub) => sec.classes.some((c) => picked.has(`${sub.id}:${c.id}`))));
    return (withPicks ?? sections[0])?.id ?? "";
  });
  const [query, setQuery] = useState("");
  const section = sections.find((x) => x.id === sectionId);

  function toggle(key: string) {
    if (lockedSet.has(key)) return;
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  }

  const subjectsChosen = new Set([...picked].map((k) => k.split(":")[0])).size;
  const q = query.trim().toLowerCase();
  const visible = (section?.subjects ?? []).filter((x) => !q || x.name.toLowerCase().includes(q));

  return (
    <div>
      {[...picked].map((k) => (
        <input key={k} type="hidden" name="pick" value={k} />
      ))}

      {sections.length > 1 ? (
        <div className="mb-5">
          <p className="mb-2 text-sm font-semibold">Which section?</p>
          <div className="grid grid-cols-2 gap-2" role="tablist">
            {sections.map((sec) => {
              const n = [...picked].filter((k) => sec.subjects.some((sub) => k.startsWith(`${sub.id}:`))).length;
              return (
                <button
                  key={sec.id}
                  type="button"
                  role="tab"
                  aria-selected={sec.id === sectionId}
                  onClick={() => setSectionId(sec.id)}
                  className={cn(
                    "rounded-xl border-2 px-4 py-3 text-left text-base font-semibold transition",
                    sec.id === sectionId ? "border-brand bg-brand-soft text-brand" : "border-border hover:border-brand/50",
                  )}
                >
                  {sec.name}
                  <span className="block text-xs font-medium text-muted">{n ? `${n} class${n === 1 ? "" : "es"} chosen` : "Nothing chosen yet"}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {section && section.classes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">
          The {section.name} classes haven&apos;t been set up yet. You can skip this step and add your subjects later under <strong>My classes</strong>.
        </p>
      ) : (
        <>
          {(section?.subjects.length ?? 0) > 8 ? (
            <label className="relative mb-3 block">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a subject…"
                aria-label="Find a subject"
                className="h-12 w-full rounded-xl border border-border bg-surface pr-3 pl-10 text-base outline-none focus:border-brand"
              />
            </label>
          ) : null}
          <ul className="space-y-3">
            {visible.map((sub) => {
              const count = section!.classes.filter((c) => picked.has(`${sub.id}:${c.id}`)).length;
              return (
                <li key={sub.id} className={cn("rounded-2xl border p-4 transition", count ? "border-brand bg-brand-soft/40" : "border-border")}>
                  <p className="flex items-center justify-between gap-2 text-base font-semibold">
                    {sub.name}
                    {count ? <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-bold text-white">{count}</span> : null}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`${sub.name} classes`}>
                    {section!.classes.map((c) => {
                      const key = `${sub.id}:${c.id}`;
                      const on = picked.has(key);
                      const isLocked = lockedSet.has(key);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${sub.name} — ${c.name}`}
                          title={isLocked ? "Already approved" : undefined}
                          onClick={() => toggle(key)}
                          className={cn(
                            "inline-flex min-h-11 items-center gap-1.5 rounded-xl border-2 px-4 text-sm font-semibold transition",
                            on ? "border-brand bg-brand text-white" : "border-border bg-surface hover:border-brand/60",
                            isLocked && "cursor-default opacity-80",
                          )}
                        >
                          {on ? <Check className="size-4" aria-hidden /> : null}
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
            {visible.length === 0 ? <li className="text-sm text-muted">No subject matches “{query}”.</li> : null}
          </ul>
        </>
      )}

      <p className="mt-5 rounded-xl bg-surface-2 px-4 py-3 text-sm" aria-live="polite">
        {picked.size
          ? `You've chosen ${picked.size} class${picked.size === 1 ? "" : "es"} across ${subjectsChosen} subject${subjectsChosen === 1 ? "" : "s"}.`
          : "Tap a class under each subject you teach."}
      </p>
    </div>
  );
}
