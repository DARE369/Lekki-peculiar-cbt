"use client";

import { useTransition } from "react";

interface RemoveButtonProps {
  id: string;
  label: string;
  action: (fd: FormData) => Promise<void>;
}

export function RemoveButton({ id, label, action }: RemoveButtonProps) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Remove ${label}? The teacher will lose access to this class for this subject.`)) return;
        const fd = new FormData();
        fd.set("id", id);
        startTransition(() => action(fd));
      }}
      className="text-xs text-muted hover:text-danger disabled:opacity-50"
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
