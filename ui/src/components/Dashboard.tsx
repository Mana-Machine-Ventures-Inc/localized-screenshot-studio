import { Badge } from "./Badge";
import type { UploadJob } from "../types";

interface Props {
  job: UploadJob;
  onRetryFailed: () => void;
  onClose: () => void;
}

export function Dashboard({ job, onRetryFailed, onClose }: Props) {
  const total = job.items.length;
  const done = job.items.filter(
    (i) => i.state === "verified" || i.state === "failed",
  ).length;
  const verified = job.items.filter((i) => i.state === "verified").length;
  const failed = job.items.filter((i) => i.state === "failed").length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="col">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>
          Upload {job.kind} {job.dryRun && <span className="chip">DRY RUN</span>}
        </b>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {job.dryRun && (
        <div className="banner info">
          Dry run: the full pipeline is simulated (no calls to App Store
          Connect). Add API credentials to perform a real upload.
        </div>
      )}

      <div className="progress" style={{ margin: "8px 0" }}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="row" style={{ gap: 14, color: "var(--text-dim)" }}>
        <span>
          <b style={{ color: "var(--text)" }}>{verified}</b> verified
        </span>
        <span>
          <b style={{ color: "var(--bad)" }}>{failed}</b> failed
        </span>
        <span>
          {done}/{total}
        </span>
      </div>

      {failed > 0 && job.done && (
        <button className="danger" style={{ marginTop: 10 }} onClick={onRetryFailed}>
          Retry {failed} failed
        </button>
      )}

      <div className="section-title">Items</div>
      <div>
        {job.items.map((item, i) => (
          <div className="job-item" key={`${item.kind}-${item.cellId ?? item.locale}-${i}`}>
            <span className="chip">{item.kind === "metadata" ? "meta" : "shot"}</span>
            <span className="grow">
              {item.locale}
              {item.platform ? ` · ${item.platform}` : ""}
              {item.presetId ? ` · ${item.presetId}` : ""}
              {item.attempts > 1 ? ` · try ${item.attempts}` : ""}
            </span>
            {item.error && (
              <span className="error-text" title={item.error}>
                !
              </span>
            )}
            <Badge state={item.state} />
          </div>
        ))}
      </div>
    </div>
  );
}
