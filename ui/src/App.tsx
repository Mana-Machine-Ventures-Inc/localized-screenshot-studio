import { useEffect, useState } from "react";
import { api, API_BASE, subscribeJob, type ProjectResponse } from "./api";
import type {
  DevicePreset,
  ProjectSummary,
  UploadJob,
  UploadJobItem,
} from "./types";
import { CredentialsModal } from "./components/CredentialsModal";
import { ProjectTab } from "./tabs/ProjectTab";
import { StringsTab } from "./tabs/StringsTab";
import { ScreensTab } from "./tabs/ScreensTab";
import { CompositionsTab } from "./tabs/CompositionsTab";
import { GenerateTab } from "./tabs/GenerateTab";
import { UploadTab } from "./tabs/UploadTab";

const TABS = [
  "Project",
  "Strings",
  "Screens",
  "Compositions",
  "Generate",
  "Upload",
] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [presets, setPresets] = useState<DevicePreset[]>([]);
  const [activePreset, setActivePreset] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [hasCreds, setHasCreds] = useState(false);
  const [showCreds, setShowCreds] = useState(false);
  const [job, setJob] = useState<UploadJob | null>(null);
  const [tab, setTab] = useState<Tab>("Project");
  const [tick, setTick] = useState(0);
  const [selectedScreenId, setSelectedScreenId] = useState<string>();

  const config = project?.open ? project.config : undefined;

  // Load the project's embedded fonts into the document so the in-app editor
  // canvas renders with the same typefaces as the server-side preview/output
  // (otherwise the source-locale editing view falls back to a system font and
  // looks different from every localized render).
  useEffect(() => {
    if (!project?.open) return;
    const id = "lss-project-fonts";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = `${API_BASE}/api/fonts.css?v=${tick}`;
  }, [project?.open, tick]);

  // Keep the shared screen selection valid across Screens/Compositions.
  useEffect(() => {
    if (!config) return;
    const ids = config.screens.map((s) => s.id);
    if (!selectedScreenId || !ids.includes(selectedScreenId)) {
      setSelectedScreenId(ids[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  async function reload() {
    const p = await api.getProject();
    setProject(p);
    if (p.open && p.data) setSummary(p.data);
    if (p.open && p.config && !activePreset) {
      setActivePreset(p.config.presetIds[0] ?? "iphone-6-9");
    }
    setTick((t) => t + 1);
  }

  useEffect(() => {
    api.getPresets().then(setPresets).catch(() => {});
    api
      .ascStatus()
      .then((s) => setHasCreds(s.hasCredentials))
      .catch(() => {});
    reload()
      .then(() => {
        // jump to the working tabs once a project is open
        setProject((p) => {
          if (p?.open) setTab("Screens");
          return p;
        });
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  const openProject = (path: string) =>
    run("Opening project", async () => {
      await api.openProject(path);
      await reload();
      setTab("Screens");
    });

  const setBaseLocale = (locale: string) =>
    run("Updating settings", async () => {
      await api.setSettings({ baseLocale: locale });
      await reload();
    });

  const setMetadata = (input: Parameters<typeof api.setMetadata>[0]) =>
    run("Saving metadata mapping", async () => {
      await api.setMetadata(input);
      await reload();
    });

  const saveCreds = (input: Parameters<typeof api.saveCredentials>[0]) =>
    run("Saving credentials", async () => {
      await api.saveCredentials(input);
      setShowCreds(false);
      const s = await api.ascStatus();
      setHasCreds(s.hasCredentials);
      await reload();
    });

  const startUpload = (opts: Parameters<typeof api.upload>[0], label: string) =>
    run(label, async () => {
      const { job: created } = await api.upload(opts);
      setJob(created);
      subscribeJob(created.id, (msg) => {
        if (msg.event === "snapshot") {
          setJob(msg.payload as UploadJob);
        } else if (msg.event === "item") {
          const item = msg.payload as UploadJobItem;
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  items: prev.items.map((it) =>
                    it.cellId === item.cellId &&
                    it.locale === item.locale &&
                    it.kind === item.kind &&
                    it.platform === item.platform
                      ? item
                      : it,
                  ),
                }
              : prev,
          );
        } else if (msg.event === "done") {
          setJob((prev) => (prev ? { ...prev, done: true } : prev));
          reload().catch(() => {});
        }
      });
    });

  const retryFailed = () => {
    if (!job) return;
    const cellIds = job.items
      .filter((i) => i.state === "failed" && i.cellId)
      .map((i) => i.cellId!) as string[];
    const locales = job.items
      .filter((i) => i.state === "failed" && i.kind === "metadata")
      .map((i) => i.locale);
    startUpload(
      {
        kind: job.kind,
        dryRun: job.dryRun,
        cellIds: cellIds.length ? cellIds : undefined,
        locales: locales.length ? locales : undefined,
      },
      "Retrying failed",
    );
  };

  if (!project) {
    return <div className="empty-state">Connecting to engine…</div>;
  }

  const open = project.open;
  const tabsDisabled = !open;

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          Localized <span>Screenshot</span> Studio
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={`tab ${t === tab ? "active" : ""}`}
              disabled={tabsDisabled && t !== "Project"}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        {busy && <span className="topbar-busy">{busy}…</span>}
        {summary && (
          <div className="app-meta">
            <b>{summary.appName}</b> · {summary.locales.length} locales
          </div>
        )}
      </div>

      {error && <div className="banner error-banner">{error}</div>}

      <div className="tab-host">
        {tab === "Project" && (
          <ProjectTab
            open={open}
            config={config}
            summary={summary}
            busy={busy}
            hasCreds={hasCreds}
            onOpenProject={openProject}
            onSetBaseLocale={setBaseLocale}
            onEditCredentials={() => setShowCreds(true)}
          />
        )}

        {tab === "Strings" && open && (
          <StringsTab reloadToken={tick} onChanged={() => reload().catch(() => {})} />
        )}

        {tab === "Screens" && open && config && summary && (
          <ScreensTab
            config={config}
            summary={summary}
            presets={presets}
            activePreset={activePreset}
            reload={reload}
            selectedId={selectedScreenId}
            onSelect={setSelectedScreenId}
          />
        )}

        {tab === "Compositions" && open && config && summary && (
          <CompositionsTab
            config={config}
            summary={summary}
            presets={presets}
            activePreset={activePreset}
            reload={reload}
            selectedId={selectedScreenId}
            onSelect={setSelectedScreenId}
          />
        )}

        {tab === "Generate" && open && config && summary && (
          <GenerateTab
            config={config}
            summary={summary}
            presets={presets}
            reload={reload}
          />
        )}

        {tab === "Upload" && open && config && summary && (
          <UploadTab
            config={config}
            summary={summary}
            hasCreds={hasCreds}
            busy={busy}
            job={job}
            onUpload={startUpload}
            onSetMetadata={setMetadata}
            onRetryFailed={retryFailed}
            onEditCredentials={() => setShowCreds(true)}
          />
        )}
      </div>

      {showCreds && (
        <CredentialsModal onClose={() => setShowCreds(false)} onSave={saveCreds} />
      )}
    </div>
  );
}
