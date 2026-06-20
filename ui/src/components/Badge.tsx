import type { AssetState } from "../types";

const LABELS: Record<AssetState, string> = {
  pending: "Pending",
  generated: "Generated",
  captured: "Captured",
  composed: "Composed",
  approved: "Approved",
  uploading: "Uploading",
  committed: "Committed",
  verified: "Verified",
  failed: "Failed",
};

export function Badge({ state }: { state: AssetState }) {
  return (
    <span className={`badge s-${state}`}>
      <span className="dot" />
      {LABELS[state]}
    </span>
  );
}
