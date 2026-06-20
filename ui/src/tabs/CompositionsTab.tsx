import { useEffect, useMemo, useRef, useState } from "react";
import { api, renderUrl, type ProjectFont } from "../api";
import { FontPicker } from "../components/FontPicker";
import type {
  CompositorConfig,
  DevicePreset,
  ProjectConfig,
  ProjectSummary,
  ScreenComposition,
} from "../types";

interface Props {
  config: ProjectConfig;
  summary: ProjectSummary;
  presets: DevicePreset[];
  activePreset: string;
  reload: () => Promise<void>;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
}

export function CompositionsTab({
  config,
  summary,
  presets,
  activePreset,
  reload,
  selectedId,
  onSelect,
}: Props) {
  const screens = config.screens;
  const selected = screens.find((s) => s.id === selectedId) ?? screens[0];

  const defaultComp = useMemo<ScreenComposition>(
    () => ({
      mode: "device",
      background: config.compositor.background,
      headlineColor: config.compositor.headlineColor,
      headlineFont: config.compositor.headlineFont,
      headlineHeightFraction: config.compositor.headlineHeightFraction,
      headlineText: selected?.headline ?? {},
    }),
    [config.compositor, selected],
  );

  const [comp, setComp] = useState<ScreenComposition>(defaultComp);
  // Global headline typography — applies to every composition.
  const [typo, setTypo] = useState<CompositorConfig>(config.compositor);
  const [previewLocale, setPreviewLocale] = useState(config.baseLocale);
  const [stringsMap, setStringsMap] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [newHeadline, setNewHeadline] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [projectFonts, setProjectFonts] = useState<ProjectFont[]>([]);

  const stageWrapRef = useRef<HTMLDivElement>(null);
  const [wrap, setWrap] = useState({ w: 0, h: 0 });
  const compSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setComp(selected?.composition ?? defaultComp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const loadStrings = async () => {
    const r = await api.getStrings();
    if (!r.open) return;
    const m: Record<string, Record<string, string>> = {};
    for (const s of r.strings) m[s.key] = s.values;
    setStringsMap(m);
  };
  useEffect(() => {
    loadStrings().catch(() => {});
    api
      .getFonts()
      .then((r) => setProjectFonts(r.fonts))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setWrap({ w: el.clientWidth - 32, h: el.clientHeight - 32 }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!selected) {
    return (
      <div className="tab-content">
        <div className="empty-state">
          <p>Create a screen first, then compose it here.</p>
        </div>
      </div>
    );
  }

  const persistComp = (next: ScreenComposition) => {
    if (compSaveTimer.current) clearTimeout(compSaveTimer.current);
    compSaveTimer.current = setTimeout(() => {
      api.setComposition(selected.id, next).then(() => reload().catch(() => {}));
    }, 450);
  };

  const update = (patch: Partial<ScreenComposition>) => {
    const next = { ...comp, ...patch };
    setComp(next);
    persistComp(next);
  };

  const updateBg = (patch: Record<string, unknown>) => {
    const bg = { ...comp.background, ...patch } as ScreenComposition["background"];
    update({ background: bg });
  };

  const persistTypo = (next: CompositorConfig) => {
    if (typoSaveTimer.current) clearTimeout(typoSaveTimer.current);
    typoSaveTimer.current = setTimeout(() => {
      api.setCompositor(next).catch(() => {});
    }, 450);
  };
  const updateTypo = (patch: Partial<CompositorConfig>) => {
    const next = { ...typo, ...patch };
    setTypo(next);
    persistTypo(next);
  };

  const createHeadline = async () => {
    if (!newHeadline.trim()) return;
    setBusy("Creating headline");
    try {
      const res = await api.createHeadline(selected.id, newHeadline.trim());
      setNewHeadline("");
      setComp(res.screen.composition ?? comp);
      await loadStrings();
      await reload();
    } finally {
      setBusy(null);
    }
  };

  // --- preview geometry ---------------------------------------------------
  // Each screen is previewed at its own device preset, so an iPad frame is
  // genuinely larger and wider than an iPhone one.
  const presetFor = (presetIds: string[]) =>
    presets.find((p) => p.id === (presetIds[0] ?? activePreset)) ?? presets[0];
  const preset = presetFor(selected.presetIds);

  // Scale every device against the largest device in the project, so relative
  // sizes are preserved (the biggest device fills the available panel).
  const maxPointW = Math.max(
    1,
    ...screens.map((s) => presetFor(s.presetIds)?.pointWidth ?? 0),
  );
  const maxPointH = Math.max(
    1,
    ...screens.map((s) => presetFor(s.presetIds)?.pointHeight ?? 0),
  );
  const pxPerPoint = Math.min(wrap.w / maxPointW, wrap.h / maxPointH);
  const stageW = Math.max(0, (preset?.pointWidth ?? 393) * pxPerPoint);
  const stageH = Math.max(0, (preset?.pointHeight ?? 852) * pxPerPoint);

  const headlineAreaH = comp.headlineHeightFraction * stageH;
  const bottomPad = 0.04 * stageH;
  const sidePad = 0.08 * stageW;
  const availH = stageH - headlineAreaH - bottomPad;
  const availW = stageW - sidePad * 2;
  const fitScale = Math.min(availW / stageW, availH / stageH);
  const isDevice = comp.mode === "device";
  const deviceW = isDevice ? stageW * fitScale : stageW;
  const deviceH = isDevice ? stageH * fitScale : stageH;
  const deviceLeft = (stageW - deviceW) / 2;
  const deviceTop = isDevice ? headlineAreaH + (availH - deviceH) / 2 : 0;
  const bezel = isDevice ? Math.max(1, stageW * 0.012) : 0;
  const radius = isDevice ? deviceW * 0.085 : 0;
  // The /render document is a fixed pointWidth×pointHeight page; scale it to
  // fit inside the (bezel-inset) device area.
  const renderW = preset?.pointWidth ?? 393;
  const renderH = preset?.pointHeight ?? 852;
  const screenScale = renderW > 0 ? (deviceW - bezel * 2) / renderW : 1;

  const headline =
    (comp.headlineKey
      ? stringsMap[comp.headlineKey]?.[previewLocale] ??
        stringsMap[comp.headlineKey]?.[config.baseLocale]
      : comp.headlineText?.[previewLocale] ??
        comp.headlineText?.[config.baseLocale]) ?? "";

  const bgStyle: React.CSSProperties =
    comp.background.type === "solid"
      ? { background: comp.background.color }
      : {
          background: `linear-gradient(${comp.background.angle}deg, ${comp.background.from}, ${comp.background.to})`,
        };

  const fontPx = typo.headlineSizePct * stageW;

  return (
    <div className="tab-content comp-tab">
      <div className="toolbar">
        <div className="field inline">
          <label>Screen</label>
          <select
            value={selected.id}
            onChange={(e) => onSelect(e.target.value)}
          >
            {screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field inline">
          <label>Preview language</label>
          <select
            value={previewLocale}
            onChange={(e) => setPreviewLocale(e.target.value)}
          >
            {summary.locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {preset && (
          <span className="hint">
            {preset.label} · {preset.pixelWidth}×{preset.pixelHeight}
          </span>
        )}
        <div className="spacer" />
        {busy && <span className="hint">{busy}…</span>}
      </div>

      <div className="comp-body">
        <div className="comp-controls">
          <div className="section-title" style={{ marginTop: 0 }}>
            Layout
          </div>
          <div className="seg" style={{ width: "100%" }}>
            <button
              className={comp.mode === "passthrough" ? "on" : ""}
              style={{ flex: 1 }}
              onClick={() => update({ mode: "passthrough" })}
            >
              Pass-through
            </button>
            <button
              className={comp.mode === "device" ? "on" : ""}
              style={{ flex: 1 }}
              onClick={() => update({ mode: "device" })}
            >
              Device frame
            </button>
          </div>

          {comp.mode === "device" && (
            <>
              <div className="section-title">Background</div>
              <div className="seg" style={{ width: "100%" }}>
                <button
                  className={comp.background.type === "solid" ? "on" : ""}
                  style={{ flex: 1 }}
                  onClick={() =>
                    updateBg(
                      comp.background.type === "solid"
                        ? {}
                        : { type: "solid", color: "#1f6feb" },
                    )
                  }
                >
                  Solid
                </button>
                <button
                  className={comp.background.type === "gradient" ? "on" : ""}
                  style={{ flex: 1 }}
                  onClick={() =>
                    updateBg(
                      comp.background.type === "gradient"
                        ? {}
                        : { type: "gradient", from: "#0b1020", to: "#1f6feb", angle: 135 },
                    )
                  }
                >
                  Gradient
                </button>
              </div>

              {comp.background.type === "solid" ? (
                <div className="field">
                  <label>Color</label>
                  <input
                    type="color"
                    value={comp.background.color}
                    onChange={(e) => updateBg({ color: e.target.value })}
                  />
                </div>
              ) : (
                <div className="row" style={{ gap: 8 }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label>From</label>
                    <input
                      type="color"
                      value={comp.background.from}
                      onChange={(e) => updateBg({ from: e.target.value })}
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>To</label>
                    <input
                      type="color"
                      value={comp.background.to}
                      onChange={(e) => updateBg({ to: e.target.value })}
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Angle</label>
                    <input
                      type="number"
                      value={comp.background.angle}
                      onChange={(e) => updateBg({ angle: Number(e.target.value) })}
                    />
                  </div>
                </div>
              )}

              <div className="section-title">Headline source</div>
              <div className="field">
                <label>Powered by string</label>
                <select
                  value={comp.headlineKey ?? "__none__"}
                  onChange={(e) =>
                    update({
                      headlineKey:
                        e.target.value === "__none__" ? undefined : e.target.value,
                    })
                  }
                >
                  <option value="__none__">— none / literal —</option>
                  {summary.keys.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.key} · {k.base.slice(0, 28)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="add-row" style={{ padding: 0 }}>
                <input
                  placeholder="…or write new headline copy"
                  value={newHeadline}
                  onChange={(e) => setNewHeadline(e.target.value)}
                />
                <button
                  className="ghost"
                  onClick={() => void createHeadline()}
                  disabled={!!busy || !newHeadline.trim()}
                >
                  Create string
                </button>
              </div>

              <div className="field">
                <label>
                  Headline area ({Math.round(comp.headlineHeightFraction * 100)}%)
                </label>
                <input
                  type="range"
                  min={0.08}
                  max={0.32}
                  step={0.01}
                  value={comp.headlineHeightFraction}
                  onChange={(e) =>
                    update({ headlineHeightFraction: Number(e.target.value) })
                  }
                />
              </div>

              <div className="section-title">
                Headline style
                <span className="tag" style={{ marginLeft: 6 }}>
                  all compositions
                </span>
              </div>
              <FontPicker
                projectFonts={projectFonts}
                family={typo.headlineFont}
                weight={typo.headlineWeight}
                italic={typo.headlineStyle === "italic"}
                previewText={headline || "Headline preview"}
                onChange={({ family, weight, italic }) =>
                  updateTypo({
                    headlineFont: family,
                    headlineWeight: weight,
                    headlineStyle: italic ? "italic" : "normal",
                  })
                }
              />
              <div className="field">
                <label>Color</label>
                <input
                  type="color"
                  value={typo.headlineColor}
                  onChange={(e) => updateTypo({ headlineColor: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Size ({(typo.headlineSizePct * 100).toFixed(1)}% of width)</label>
                <input
                  type="range"
                  min={0.02}
                  max={0.1}
                  step={0.001}
                  value={typo.headlineSizePct}
                  onChange={(e) =>
                    updateTypo({ headlineSizePct: Number(e.target.value) })
                  }
                />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Tracking (em)</label>
                  <input
                    type="number"
                    step={0.01}
                    value={typo.headlineLetterSpacing}
                    onChange={(e) =>
                      updateTypo({ headlineLetterSpacing: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Line height</label>
                  <input
                    type="number"
                    step={0.02}
                    value={typo.headlineLineHeight}
                    onChange={(e) =>
                      updateTypo({ headlineLineHeight: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
            </>
          )}
          {comp.mode === "passthrough" && (
            <p className="hint">
              The screenshot is used as-is at full device resolution — no frame
              or headline.
            </p>
          )}
        </div>

        <div className="comp-preview" ref={stageWrapRef}>
          {stageW > 0 && (
            <div
              className="comp-stage"
              style={{ width: stageW, height: stageH, ...(isDevice ? bgStyle : {}) }}
            >
              {isDevice && headline && (
                <div
                  className="comp-headline"
                  style={{
                    height: headlineAreaH,
                    padding: `0 ${sidePad}px`,
                    color: typo.headlineColor,
                    fontFamily: typo.headlineFont,
                    fontWeight: typo.headlineWeight,
                    fontStyle: typo.headlineStyle ?? "normal",
                    fontSize: fontPx,
                    letterSpacing: `${typo.headlineLetterSpacing}em`,
                    lineHeight: typo.headlineLineHeight,
                  }}
                >
                  <span>{headline}</span>
                </div>
              )}
              <div
                className="comp-device"
                style={{
                  left: deviceLeft,
                  top: deviceTop,
                  width: deviceW,
                  height: deviceH,
                  borderRadius: radius,
                  padding: bezel,
                  background: isDevice ? "#0b0d12" : "transparent",
                }}
              >
                <div
                  className="comp-screen-clip"
                  style={{ borderRadius: Math.max(0, radius - bezel) }}
                >
                  <iframe
                    key={`${selected.id}-${previewLocale}-${preset?.id}`}
                    title="screen"
                    scrolling="no"
                    src={renderUrl(selected.id, previewLocale, preset?.id ?? activePreset)}
                    style={{
                      width: renderW,
                      height: renderH,
                      border: "none",
                      transform: `scale(${screenScale})`,
                      transformOrigin: "top left",
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
