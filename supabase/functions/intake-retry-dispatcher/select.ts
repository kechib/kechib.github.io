// Due-job selection for intake-retry-dispatcher.
// Strict selection: only processing_failed jobs with a non-null next_attempt_at
// that has elapsed, and attempt_count still under max. No fallback query.

export type DueJob = {
  id: string;
  submission_id: string;
  status: string;
  attempt_count: number;
  max_attempts: number | null;
  next_attempt_at: string | null;
  last_error: string | null;
};

export const MAX_ATTEMPTS = 3;

export function clampLimit(raw: unknown, fallback: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return Math.min(Math.max(fallback, 1), 10);
  return Math.min(Math.max(Math.trunc(n), 1), 10);
}

/** Only processing_failed jobs with a due next_attempt under max are selectable. */
export function isDueJob(
  job: Pick<DueJob, "status" | "attempt_count" | "next_attempt_at" | "max_attempts">,
  nowIso: string,
): boolean {
  if (job.status !== "processing_failed") return false;
  if (job.next_attempt_at === null || job.next_attempt_at === undefined) return false;
  if (job.next_attempt_at > nowIso) return false;
  const max = job.max_attempts ?? MAX_ATTEMPTS;
  return (job.attempt_count ?? 0) < max;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = { from: (table: string) => any };

export async function selectDueJobs(
  supabase: SupabaseLike,
  nowIso: string,
  limit: number,
): Promise<{ jobs: DueJob[]; error: string | null }> {
  // deno-lint-ignore no-explicit-any
  const { data, error } = await (supabase.from("intake_processing_jobs") as any)
    .select("id, submission_id, status, attempt_count, max_attempts, next_attempt_at, last_error")
    .eq("status", "processing_failed")
    .not("next_attempt_at", "is", null)
    .lte("next_attempt_at", nowIso)
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("next_attempt_at", { ascending: true })
    .limit(limit) as { data: DueJob[] | null; error: { message: string } | null };

  if (error) return { jobs: [], error: error.message };
  const jobs = (data ?? []).filter((j) => isDueJob(j, nowIso));
  return { jobs, error: null };
}
