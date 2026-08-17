import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { hasOverlay } from "../screens/variants";
import type {
  DevicePreset,
  ProjectConfig,
  ProjectSummary,
  StringEntry,
} from "../types";

interface Props {
  config: ProjectConfig;
  summary: ProjectSummary;
  presets: DevicePreset[];
  hasCreds: boolean;
  hasOpenAI: boolean;
  reloadToken: number;
  onNavigate: (tab: string) => void;
  onEditCredentials: () => void;
  onEditOpenAI: () => void;
}

interface NextStep {
  label: string;
  action: () => void;
  tone: "do" | "ok";
}

export function OverviewTab({
  config,
  summary,
  presets,
  hasCreds,
  hasOpenAI,
  reloadToken,
  onNavigate,
  onEditCredentials,
  onEditOpenAI,
}: Props) {
  const [strings, setStrings] = useState<StringEntry[]>([]);
  const baseLocale = summary.baseLocale;
  const locales = summary.locales;
  const nonBase = locales.filter((l) => l !== baseLocale);

  useEffect(() => {
    api
      .getStrings()
      .then((r) => r.open && setStrings(r.strings))
      .catch(() => {});
  }, [reloadToken]);

  // --- translation coverage ----------------------------------------------
  const { totalMissing, fullyTranslated } = useMemo(() => {
    let missing = 0;
    const localeMissing = new Map<string, number>(nonBase.map((l) => [l, 0]));
    for (const s of strings) {
      if (!(s.values[baseLocale]?.trim() ?? "")) continue;
      for (const l of nonBase) {
        if (!(s.values[l]?.trim() ?? "")) {
          missing += 1;
          localeMissing.set(l, (localeMissing.get(l) ?? 0) + 1);
        }
      }
    }
    const full = nonBase.filter((l) => (localeMissing.get(l) ?? 0) === 0).length;
    return { totalMissing: missing, fullyTranslated: full };
  }, [strings, nonBase, baseLocale]);

  // --- screens & images ---------------------------------------------------
  const screens = config.screens;
  const screensWithImage = screens.filter((s) => hasOverlay(s)).length;
  const screensWithout = screens.length - screensWithImage;

  // --- generation ---------------------------------------------------------
  const cells = config.cells;
  const composed = cells.filter((c) => c.composedPath).length;

  // --- upload ledger (current binary) ------------------------------------
  const uploads = config.uploads ?? [];
  const composedIds = new Set(cells.filter((c) => c.composedPath).map((c) => c.id));
  const uploadedThisBuild = uploads.filter(
    (u) =>
      u.version === summary.marketingVersion &&
      u.build === summary.buildNumber &&
      composedIds.has(u.cellId),
  ).length;

  // --- device targeting ---------------------------------------------------
  const presetLabel = (id: string) => presets.find((p) => p.id === id)?.label ?? id;
  const projectPresets = config.presetIds ?? [];

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  // --- prioritized next steps --------------------------------------------
  const steps: NextStep[] = [];
  if (screens.length === 0) {
    steps.push({ label: "Add your first screenshot", action: () => onNavigate("Screens"), tone: "do" });
  }
  if (screensWithout > 0) {
    steps.push({
      label: `Add images to ${screensWithout} screen${screensWithout > 1 ? "s" : ""}`,
      action: () => onNavigate("Screens"),
      tone: "do",
    });
  }
  if (totalMissing > 0 && !hasOpenAI) {
    steps.push({
      label: "Add an OpenAI API key for AI translation",
      action: onEditOpenAI,
      tone: "do",
    });
  }
  if (totalMissing > 0) {
    steps.push({
      label: `Translate ${totalMissing} missing string${totalMissing > 1 ? "s" : ""}`,
      action: () => onNavigate("Strings"),
      tone: "do",
    });
  }
  if (screensWithImage > 0 && composed < cells.length) {
    steps.push({
      label: `Generate ${cells.length - composed} screenshot${cells.length - composed > 1 ? "s" : ""}`,
      action: () => onNavigate("Generate"),
      tone: "do",
    });
  }
  if (!hasCreds) {
    steps.push({ label: "Add App Store Connect credentials", action: onEditCredentials, tone: "do" });
  }
  if (hasCreds && composed > 0 && uploadedThisBuild < composed) {
    steps.push({ label: "Upload to App Store Connect", action: () => onNavigate("Upload"), tone: "do" });
  }
  if (!steps.length) {
    steps.push({ label: "Everything's ready for this build", action: () => onNavigate("Upload"), tone: "ok" });
  }

  return (
    <div className="tab-content overview-tab">
      <div className="overview-head">
        <div>
          <h1 className="overview-title">{summary.appName}</h1>
          <p className="hint" style={{ margin: 0 }}>
            {summary.bundleId ?? "—"} · version {summary.marketingVersion ?? "—"} ·
            build {summary.buildNumber ?? "—"}
          </p>
        </div>
        <div className="app-meta">
          {locales.length} locales · {projectPresets.length} device
          {projectPresets.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="next-steps">
        <div className="section-title" style={{ marginTop: 0 }}>
          Next steps
        </div>
        <div className="next-step-list">
          {steps.map((s, i) => (
            <button
              key={i}
              className={`next-step ${s.tone}`}
              onClick={s.action}
            >
              <span className="next-step-dot" />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overview-grid">
        <StatCard
          title="Translations"
          onClick={() => onNavigate("Strings")}
          value={`${fullyTranslated}/${nonBase.length}`}
          unit="languages complete"
          pct={pct(fullyTranslated, nonBase.length)}
          footer={
            totalMissing > 0
              ? `${totalMissing} string${totalMissing > 1 ? "s" : ""} missing`
              : "All translations present"
          }
          good={totalMissing === 0}
        />
        <StatCard
          title="Screens"
          onClick={() => onNavigate("Screens")}
          value={`${screensWithImage}/${screens.length || 0}`}
          unit="have screenshots"
          pct={pct(screensWithImage, screens.length)}
          footer={
            screensWithout > 0
              ? `${screensWithout} awaiting an image`
              : screens.length
                ? "Every screen has an image"
                : "No screens yet"
          }
          good={screens.length > 0 && screensWithout === 0}
        />
        <StatCard
          title="Generated"
          onClick={() => onNavigate("Generate")}
          value={`${composed}/${cells.length}`}
          unit="composed images"
          pct={pct(composed, cells.length)}
          footer={
            cells.length && composed >= cells.length
              ? "All composed"
              : `${cells.length - composed} to render`
          }
          good={cells.length > 0 && composed >= cells.length}
        />
        <StatCard
          title="Uploaded"
          onClick={() => onNavigate("Upload")}
          value={`${uploadedThisBuild}/${composed}`}
          unit="live for this build"
          pct={pct(uploadedThisBuild, composed)}
          footer={
            hasCreds
              ? composed && uploadedThisBuild >= composed
                ? "Up to date on App Store Connect"
                : "Pending upload"
              : "Credentials not set"
          }
          good={hasCreds && composed > 0 && uploadedThisBuild >= composed}
        />
      </div>

      <div className="overview-grid">
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            Devices
          </div>
          {projectPresets.length ? (
            <div className="chips">
              {projectPresets.map((id) => (
                <span key={id} className="chip">
                  {presetLabel(id)}
                </span>
              ))}
            </div>
          ) : (
            <p className="hint">No devices selected.</p>
          )}
          <button
            className="ghost"
            style={{ marginTop: 10 }}
            onClick={() => onNavigate("Project")}
          >
            Manage devices &amp; settings
          </button>
        </div>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            OpenAI
          </div>
          <div className="kv">
            <span>API key</span>
            <b style={{ color: hasOpenAI ? "var(--good)" : "var(--warn)" }}>
              {hasOpenAI ? "configured" : "not set"}
            </b>
          </div>
          <button className="ghost" style={{ marginTop: 10 }} onClick={onEditOpenAI}>
            {hasOpenAI ? "Update API key" : "Add API key"}
          </button>
        </div>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            App Store Connect
          </div>
          <div className="kv">
            <span>Credentials</span>
            <b style={{ color: hasCreds ? "var(--good)" : "var(--warn)" }}>
              {hasCreds ? "configured" : "not set"}
            </b>
          </div>
          <div className="kv">
            <span>Target version</span>
            <b>{config.asc?.versionString ?? "auto (editable)"}</b>
          </div>
          <button className="ghost" style={{ marginTop: 10 }} onClick={onEditCredentials}>
            {hasCreds ? "Update credentials" : "Add credentials"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  unit,
  pct,
  footer,
  good,
  onClick,
}: {
  title: string;
  value: string;
  unit: string;
  pct: number;
  footer: string;
  good: boolean;
  onClick: () => void;
}) {
  return (
    <button className="card stat-card" onClick={onClick}>
      <div className="stat-title">{title}</div>
      <div className="stat-value">
        {value} <span className="stat-unit">{unit}</span>
      </div>
      <div className="progress" style={{ margin: "10px 0 6px" }}>
        <span
          style={{
            width: `${pct}%`,
            background: good ? "var(--good)" : undefined,
          }}
        />
      </div>
      <div className={`stat-footer ${good ? "ok" : ""}`}>{footer}</div>
    </button>
  );
}
