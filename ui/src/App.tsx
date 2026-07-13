import { useEffect, useState } from "react";
import { api, API_BASE, subscribeJob, type ProjectResponse } from "./api";
import type {
  DevicePreset,
  ProjectSummary,
  UploadJob,
  UploadJobItem,
} from "./types";
import { CredentialsModal } from "./components/CredentialsModal";
import { OverviewTab } from "./tabs/OverviewTab";
import { ProjectTab } from "./tabs/ProjectTab";
import { StringsTab } from "./tabs/StringsTab";
import { ScreensTab } from "./tabs/ScreensTab";
import { GenerateTab } from "./tabs/GenerateTab";
import { UploadTab } from "./tabs/UploadTab";

const TABS = [
  "Overview",
  "Project",
  "Strings",
  "Screens",
  "Generate",
  "Upload",
] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [presets, setPresets] = useState<DevicePreset[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [hasCreds, setHasCreds] = useState(false);
  const [showCreds, setShowCreds] = useState(false);
  const [job, setJob] = useState<UploadJob | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [tick, setTick] = useState(0);
  const [connectFailed, setConnectFailed] = useState(false);
  const [connectTick, setConnectTick] = useState(0);
  const [selectedScreenId, setSelectedScreenId] = useState<string>();
  // Preview language shared across Strings/Screens/Compositions so a string can
  // be followed from edit → screen → composed without re-picking it each tab.
  const [previewLocale, setPreviewLocale] = useState<string>("");

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

  // With no project open, the only usable tab is Project — never strand the
  // user on a blank Overview/Strings/etc.
  useEffect(() => {
    if (project && !project.open && tab !== "Project") setTab("Project");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.open]);

  // Default the shared preview language to the project's base locale once known.
  useEffect(() => {
    if (!previewLocale && summary?.locales?.length) {
      setPreviewLocale(summary.baseLocale ?? summary.locales[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  async function reload() {
    const p = await api.getProject();
    setProject(p);
    if (p.open && p.data) setSummary(p.data);
    setTick((t) => t + 1);
  }

  // Connect to the engine, retrying while it's still booting (it can start a
  // moment after the UI in `npm run dev`). Never leave the user stuck on a
  // dead "Connecting…" screen — fall back to a manual retry.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    setConnectFailed(false);
    const connect = async () => {
      try {
        await reload();
        if (cancelled) return;
        api.getPresets().then(setPresets).catch(() => {});
        api
          .ascStatus()
          .then((s) => setHasCreds(s.hasCredentials))
          .catch(() => {});
        // land on the Overview dashboard once a project is open
        setProject((p) => {
          if (p?.open) setTab("Overview");
          return p;
        });
      } catch {
        if (cancelled) return;
        attempts += 1;
        if (attempts < 30) timer = setTimeout(connect, 1000);
        else setConnectFailed(true);
      }
    };
    void connect();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectTick]);

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
      setTab("Overview");
    });

  const setBaseLocale = (locale: string) =>
    run("Updating settings", async () => {
      await api.setSettings({ baseLocale: locale });
      await reload();
    });

  const setProjectDevices = (presetIds: string[]) =>
    run("Updating devices", async () => {
      await api.setSettings({ presetIds });
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

  const cancelUpload = () => {
    if (!job || job.done) return;
    // If the engine still knows the job, it returns the (now cancelling) job and
    // the SSE stream will finish it. If it doesn't (e.g. the engine restarted
    // and the job is stale), clear it locally so the UI stops blocking uploads.
    api
      .cancelJob(job.id)
      .then((res) => setJob(res.job))
      .catch(() => setJob(null));
  };

  const closeJob = () => setJob(null);

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
    return (
      <div className="connect-screen">
        <div className="connect-card">
          <div className="brand">
            Localized <span>Screenshot</span> Studio
          </div>
          {connectFailed ? (
            <>
              <p>
                Couldn't reach the engine
                {API_BASE ? (
                  <>
                    {" "}
                    at <code>{API_BASE}</code>
                  </>
                ) : null}
                .
              </p>
              <p className="hint">
                Make sure it's running — it starts automatically with{" "}
                <code>npm run dev</code>.
              </p>
              <button className="primary" onClick={() => setConnectTick((t) => t + 1)}>
                Retry
              </button>
            </>
          ) : (
            <p>Connecting to engine…</p>
          )}
        </div>
      </div>
    );
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
        {tab === "Overview" && open && config && summary && (
          <OverviewTab
            config={config}
            summary={summary}
            presets={presets}
            hasCreds={hasCreds}
            reloadToken={tick}
            onNavigate={(t) => setTab(t as Tab)}
            onEditCredentials={() => setShowCreds(true)}
          />
        )}

        {tab === "Project" && (
          <ProjectTab
            open={open}
            config={config}
            summary={summary}
            presets={presets}
            busy={busy}
            hasCreds={hasCreds}
            onOpenProject={openProject}
            onSetBaseLocale={setBaseLocale}
            onSetDevices={setProjectDevices}
            onSetMetadata={setMetadata}
            onEditCredentials={() => setShowCreds(true)}
          />
        )}

        {tab === "Strings" && open && (
          <StringsTab
            reloadToken={tick}
            onChanged={() => reload().catch(() => {})}
            previewLocale={previewLocale}
            onPreviewLocale={setPreviewLocale}
          />
        )}

        {tab === "Screens" && open && config && summary && (
          <ScreensTab
            config={config}
            summary={summary}
            presets={presets}
            reload={reload}
            selectedId={selectedScreenId}
            onSelect={setSelectedScreenId}
            previewLocale={previewLocale}
            onPreviewLocale={setPreviewLocale}
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
            presets={presets}
            hasCreds={hasCreds}
            busy={busy}
            job={job}
            onUpload={startUpload}
            onRetryFailed={retryFailed}
            onCancel={cancelUpload}
            onCloseJob={closeJob}
            onEditCredentials={() => setShowCreds(true)}
            onGoToSettings={() => setTab("Project")}
          />
        )}
      </div>

      {showCreds && (
        <CredentialsModal onClose={() => setShowCreds(false)} onSave={saveCreds} />
      )}
    </div>
  );
}
