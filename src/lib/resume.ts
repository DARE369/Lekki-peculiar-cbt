/**
 * How long after an exam closes a student may still be let back in. After that the results stand,
 * old requests count as expired, and a make-up exam is the way to give someone another go.
 * The database enforces the same limit (migration 20261018000100_resume_time_limit.sql).
 */
export const RESUME_GRACE_HOURS = 24;

/** Exams that ended before this time can no longer be continued. */
export function resumeCutoffIso(now = Date.now()) {
  return new Date(now - RESUME_GRACE_HOURS * 3600_000).toISOString();
}

export function canStillResume(w: { ends_at: string }, now = Date.now()) {
  return Date.parse(w.ends_at) > now - RESUME_GRACE_HOURS * 3600_000;
}
