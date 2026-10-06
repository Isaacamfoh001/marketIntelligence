// ---------------------------------------------------------------------------
// Evidence snapshots (M9.2). When an analyst links a Korbly observation, what it said AT THAT
// MOMENT is frozen into the evidence row. Source rows are upserted when a publisher revises a figure,
// so a bare pointer could silently change the meaning of past research; the snapshot cannot. The
// pointer (kind + id) survives only so Korbly can truthfully say "the source has since been revised".
// ---------------------------------------------------------------------------

import type { EvidenceRefKind } from "./evidence";

export interface SnapshotSource {
  name: string;
  provider: string;
  ingestionRunId: string;
  /** ISO timestamp Korbly retrieved the observation. */
  retrievedAt: string;
  acquisitionMethod: string | null;
}

export interface EvidenceSnapshot {
  version: 1;
  refKind: EvidenceRefKind;
  /** "CPI inflation — YoY", "Treasury bill auction rate — 91-day". */
  datasetLabel: string;
  /** The headline figure as it was displayed, units included: "23.80%". */
  displayValue: string;
  unit: string;
  /** The data's own date (YYYY-MM-DD). */
  observationDate: string;
  /** Other facts on the same observation, in display order. */
  details: { label: string; value: string }[];
  source: SnapshotSource;
  /** Data quality AT LINK TIME. Linking never improves it. */
  quality: { recency: "CURRENT" | "STALE"; ageDaysAtLink: number; note: string | null };
  /** Canonical string of the figures; equal fingerprints ⇒ the source has not changed since. */
  fingerprint: string;
  capturedAt: string;
}

export interface SnapshotArgs {
  refKind: EvidenceRefKind;
  datasetLabel: string;
  displayValue: string;
  unit: string;
  observationDate: string;
  details?: { label: string; value: string }[];
  source: SnapshotSource;
  fingerprint: string;
  stale: boolean;
  qualityNote?: string | null;
  now: Date;
}

export function buildSnapshot(a: SnapshotArgs): EvidenceSnapshot {
  const age = Math.max(0, Math.floor((a.now.getTime() - new Date(`${a.observationDate}T00:00:00.000Z`).getTime()) / 86_400_000));
  return {
    version: 1,
    refKind: a.refKind,
    datasetLabel: a.datasetLabel,
    displayValue: a.displayValue,
    unit: a.unit,
    observationDate: a.observationDate,
    details: a.details ?? [],
    source: a.source,
    quality: { recency: a.stale ? "STALE" : "CURRENT", ageDaysAtLink: age, note: a.qualityNote ?? null },
    fingerprint: a.fingerprint,
    capturedAt: a.now.toISOString(),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const formatDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** The evidence title for a linked observation — derived from the snapshot, never typed. */
export const snapshotTitle = (s: Pick<EvidenceSnapshot, "datasetLabel" | "displayValue" | "observationDate">) => `${s.datasetLabel}: ${s.displayValue} (${formatDay(s.observationDate)})`;

/** Defensive read of a stored JSON snapshot. Returns null when it is not a version-1 snapshot. */
export function readSnapshot(raw: unknown): EvidenceSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<EvidenceSnapshot>;
  if (s.version !== 1 || typeof s.datasetLabel !== "string" || typeof s.displayValue !== "string" || typeof s.observationDate !== "string" || !s.source || !s.quality || typeof s.fingerprint !== "string") return null;
  return s as EvidenceSnapshot;
}
