import { useEffect, useMemo, useRef, useState } from "react";
import { api, renderUrl, type ProjectFont } from "../api";
import { FontPicker } from "./FontPicker";
import { ColorPicker } from "./ColorPicker";
import { getComposition } from "../screens/variants";
import type {
  CompositorConfig,
  DevicePreset,
  ProjectConfig,
  ProjectSummary,
  ScreenComposition,
  ScreenTemplate,
} from "../types";

interface Props {
  screen: ScreenTemplate;
  config: ProjectConfig;
  summary: ProjectSummary;
  presets: DevicePreset[];
  variantPresetId: string;
  previewLocale: string;
  onPreviewLocale: (locale: string) => void;
  onChanged: () => void;
  hasOverlay: boolean;
}

const DEVICE_CLASS_LABEL: Record<string, string> = {
  ios: "iPhone",
  ipados: "iPad",
  macos: "Mac",
};

export function CompositionPanel({
  screen,
  config,
  summary,
  presets,
  variantPresetId,
  previewLocale,
  onPreviewLocale,
  onChanged,
  hasOverlay,
}: Props) {
  const preset =
    presets.find((p) => p.id === variantPresetId) ?? presets[0];
  const deviceClass = preset?.platform ?? "ios";
  const deviceLabel = DEVICE_CLASS_LABEL[deviceClass] ?? deviceClass;

  const defaultComp = useMemo<ScreenComposition>(
    () => ({
      mode: "device",
      background: config.compositor.background,
      headlineColor: config.compositor.headlineColor,
      headlineFont: config.compositor.headlineFont,
      headlineHeightFraction: config.compositor.headlineHeightFraction,
      headlineText: screen.headline ?? {},
    }),
    [config.compositor, screen.headline],
  );

  const [comp, setComp] = useState<ScreenComposition>(
    getComposition(screen, variantPresetId) ?? defaultComp,
  );
  const [typo, setTypo] = useState<CompositorConfig>(config.compositor);
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
  const deviceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setComp(getComposition(screen, variantPresetId) ?? defaultComp);
    setTypo(config.compositor);
  }, [screen.id, variantPresetId, screen, defaultComp, config.compositor]);

  useEffect(() => {
    api
      .getStrings()
      .then((r) => {
        if (!r.open) return;
        const m: Record<string, Record<string, string>> = {};
        for (const s of r.strings) m[s.key] = s.values;
        setStringsMap(m);
      })
      .catch(() => {});
    api
      .getFonts()
      .then((r) => setProjectFonts(r.fonts))
      .catch(() => {});
  }, [screen.id]);

  useEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setWrap({ w: el.clientWidth - 24, h: el.clientHeight - 24 }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const persistComp = (next: ScreenComposition) => {
    if (compSaveTimer.current) clearTimeout(compSaveTimer.current);
    compSaveTimer.current = setTimeout(() => {
      api
        .setComposition(screen.id, next, variantPresetId)
        .then(() => onChanged())
        .catch(() => {});
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

  const updateUniversal = (patch: Partial<CompositorConfig>) => {
    setTypo((prev) => ({ ...prev, ...patch }));
    if (typoSaveTimer.current) clearTimeout(typoSaveTimer.current);
    typoSaveTimer.current = setTimeout(() => {
      api.setCompositor(patch).catch(() => {});
    }, 450);
  };

  const sizePct =
    typo.perDevice?.[deviceClass]?.headlineSizePct ?? typo.headlineSizePct;
  const areaFraction =
    typo.perDevice?.[deviceClass]?.headlineHeightFraction ??
    comp.headlineHeightFraction ??
    typo.headlineHeightFraction;

  const updateDevice = (patch: {
    headlineSizePct?: number;
    headlineHeightFraction?: number;
  }) => {
    setTypo((prev) => ({
      ...prev,
      perDevice: {
        ...prev.perDevice,
        [deviceClass]: { ...prev.perDevice?.[deviceClass], ...patch },
      },
    }));
    if (deviceSaveTimer.current) clearTimeout(deviceSaveTimer.current);
    deviceSaveTimer.current = setTimeout(() => {
      api.setDeviceTypography(deviceClass, patch).catch(() => {});
    }, 450);
  };

  const renderW = preset?.pointWidth ?? 393;
  const renderH = preset?.pointHeight ?? 852;
  const pxPerPoint = Math.min(wrap.w / renderW, wrap.h / renderH, 1);
  const stageW = Math.max(0, renderW * pxPerPoint);
  const stageH = Math.max(0, renderH * pxPerPoint);

  const isDevice = comp.mode === "device";
  const headlineAreaH = isDevice ? areaFraction * stageH : 0;
  const bottomPad = isDevice ? 0.04 * stageH : 0;
  const sidePad = 0.08 * stageW;
  const availH = stageH - headlineAreaH - bottomPad;
  const availW = stageW - sidePad * 2;
  const fitScale = isDevice ? Math.min(availW / stageW, availH / stageH) : 1;
  const screenW = stageW * fitScale;
  const screenH = stageH * fitScale;
  const bezel = isDevice ? Math.max(1, Math.round(stageW * 0.012)) : 0;
  const outerW = screenW + bezel * 2;
  const outerH = screenH + bezel * 2;
  const deviceLeft = (stageW - outerW) / 2;
  const deviceTop = isDevice ? headlineAreaH + (availH - outerH) / 2 : 0;
  const screenScale = renderW > 0 ? screenW / renderW : 1;
  const innerRadius = isDevice ? (preset?.cornerRadius ?? 24) * screenScale : 0;
  const outerRadius = isDevice ? innerRadius + bezel : 0;

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

  const fontPx = sizePct * stageW;

  const createHeadline = async () => {
    if (!newHeadline.trim()) return;
    setBusy("Creating headline");
    try {
      const res = await api.createHeadline(
        screen.id,
        newHeadline.trim(),
        undefined,
        variantPresetId,
      );
      setNewHeadline("");
      const updated = getComposition(res.screen, variantPresetId);
      if (updated) setComp(updated);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const resetComposition = async () => {
    setBusy("Resetting");
    try {
      await api.setComposition(screen.id, defaultComp, variantPresetId);
      setComp(defaultComp);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="composition-panel">
      <div className="composition-controls">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            Composition
          </div>
          <button
            className="ghost mini"
            disabled={!!busy}
            onClick={() => void resetComposition()}
          >
            Reset
          </button>
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
            <div className="section-title">
              Background
              <span className="tag scope-screen">this device</span>
            </div>
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
                      : {
                          type: "gradient",
                          from: "#0b1020",
                          to: "#1f6feb",
                          angle: 135,
                        },
                  )
                }
              >
                Gradient
              </button>
            </div>

            {comp.background.type === "solid" ? (
              <div className="field">
                <label>Color</label>
                <ColorPicker
                  value={comp.background.color}
                  onChange={(hex) => updateBg({ color: hex })}
                />
              </div>
            ) : (
              <div className="row" style={{ gap: 8 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>From</label>
                  <ColorPicker
                    value={comp.background.from}
                    onChange={(hex) => updateBg({ from: hex })}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>To</label>
                  <ColorPicker
                    value={comp.background.to}
                    onChange={(hex) => updateBg({ to: hex })}
                  />
                </div>
              </div>
            )}

            <div className="section-title">
              Headline
              <span className="tag scope-screen">this device</span>
            </div>
            <div className="field">
              <label>String key</label>
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
                    {k.key}
                  </option>
                ))}
              </select>
            </div>
            <div className="add-row" style={{ padding: 0 }}>
              <input
                placeholder="New headline copy"
                value={newHeadline}
                onChange={(e) => setNewHeadline(e.target.value)}
              />
              <button
                className="ghost"
                onClick={() => void createHeadline()}
                disabled={!!busy || !newHeadline.trim()}
              >
                Add
              </button>
            </div>
            <div className="field">
              <label>Headline color</label>
              <ColorPicker
                value={comp.headlineColor}
                onChange={(hex) => update({ headlineColor: hex })}
              />
            </div>

            <div className="section-title">
              Headline size
              <span className="tag scope-device">{deviceLabel}</span>
            </div>
            <div className="field">
              <label>Size ({(sizePct * 100).toFixed(1)}%)</label>
              <input
                type="range"
                min={0.02}
                max={0.1}
                step={0.001}
                value={sizePct}
                onChange={(e) =>
                  updateDevice({ headlineSizePct: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Area ({Math.round(areaFraction * 100)}%)</label>
              <input
                type="range"
                min={0.08}
                max={0.32}
                step={0.01}
                value={areaFraction}
                onChange={(e) =>
                  updateDevice({
                    headlineHeightFraction: Number(e.target.value),
                  })
                }
              />
            </div>

            <div className="section-title">
              Font
              <span className="tag scope-all">everywhere</span>
            </div>
            <FontPicker
              projectFonts={projectFonts}
              family={typo.headlineFont}
              weight={typo.headlineWeight}
              italic={typo.headlineStyle === "italic"}
              previewText={headline || "Headline"}
              onChange={({ family, weight, italic }) =>
                updateUniversal({
                  headlineFont: family,
                  headlineWeight: weight,
                  headlineStyle: italic ? "italic" : "normal",
                })
              }
            />
          </>
        )}
        {comp.mode === "passthrough" && (
          <p className="hint">Screenshot used as-is — no frame or headline.</p>
        )}
      </div>

      <div className="composition-preview" ref={stageWrapRef}>
        {!hasOverlay ? (
          <div className="empty-state compact">
            <p>Upload a screenshot for {preset?.label ?? "this device"} to preview.</p>
          </div>
        ) : stageW > 0 ? (
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
                  color: comp.headlineColor,
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
                width: isDevice ? outerW : stageW,
                height: isDevice ? outerH : stageH,
                borderRadius: outerRadius,
                padding: bezel,
                background: isDevice ? "#0b0d12" : "transparent",
              }}
            >
              <div
                className="comp-screen-clip"
                style={{ borderRadius: innerRadius }}
              >
                <iframe
                  key={`${screen.id}-${variantPresetId}-${previewLocale}`}
                  title="composed preview"
                  scrolling="no"
                  src={renderUrl(screen.id, previewLocale, variantPresetId)}
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
        ) : null}
      </div>
    </div>
  );
}
