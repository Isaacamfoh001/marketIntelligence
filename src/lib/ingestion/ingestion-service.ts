// ---------------------------------------------------------------------------
// Reusable ingestion service.
//
// Every data mutation flows through an IngestionRun, providing a full audit
// trail.  The service manages the lifecycle: create → start → complete/fail.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";

export interface RunContext {
  dataSourceId: string;
  triggeredBy?: string;
  artifactName?: string;
  checksum?: string;
}

export interface StartRunResult {
  runId: string;
}

export interface CompleteRunResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
}

/**
 * Create an ingestion run in PENDING status, then immediately transition
 * to RUNNING.
 */
export async function startRun(ctx: RunContext): Promise<StartRunResult> {
  const run = await getPrisma().ingestionRun.create({
    data: {
      dataSourceId: ctx.dataSourceId,
      status: "RUNNING",
      triggeredBy: ctx.triggeredBy ?? "api",
      artifactName: ctx.artifactName ?? null,
      checksum: ctx.checksum ?? null,
    },
  });
  return { runId: run.id };
}

/**
 * Mark a run as COMPLETED with final counts.
 */
export async function completeRun(
  runId: string,
  counts: { recordsRead: number; recordsAccepted: number; recordsRejected: number },
): Promise<CompleteRunResult> {
  const run = await getPrisma().ingestionRun.update({
    where: { id: runId },
    data: {
      status: "SUCCESS",
      completedAt: new Date(),
      recordsRead: counts.recordsRead,
      recordsAccepted: counts.recordsAccepted,
      recordsRejected: counts.recordsRejected,
    },
  });
  return {
    runId: run.id,
    status: "SUCCESS",
    recordsRead: run.recordsRead ?? 0,
    recordsAccepted: run.recordsAccepted ?? 0,
    recordsRejected: run.recordsRejected ?? 0,
  };
}

/**
 * Mark a run as FAILED, preserving error detail and counts collected
 * so far.
 */
export async function failRun(
  runId: string,
  error: string,
  counts?: { recordsRead: number; recordsAccepted: number; recordsRejected: number },
): Promise<CompleteRunResult> {
  const run = await getPrisma().ingestionRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorMessage: error,
      recordsRead: counts?.recordsRead ?? 0,
      recordsAccepted: counts?.recordsAccepted ?? 0,
      recordsRejected: counts?.recordsRejected ?? 0,
    },
  });
  return {
    runId: run.id,
    status: "FAILED",
    recordsRead: run.recordsRead ?? 0,
    recordsAccepted: run.recordsAccepted ?? 0,
    recordsRejected: run.recordsRejected ?? 0,
  };
}
