import { useEffect, useMemo, useRef, useState } from "react";
import { api, renderUrl, type ProjectFont } from "../api";
import { FontPicker } from "./FontPicker";
import { ColorPicker } from "./ColorPicker";
import { getComposition, getOverlay } from "../screens/variants";
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
  // Accumulate patches across debounce so Size then Area don't wipe each other.
  const pendingUniversal = useRef<Partial<CompositorConfig>>({});
  const pendingDevice = useRef<{
    headlineSizePct?: number;
    headlineHeightFraction?: number;
  }>({});

  useEffect(() => {
    setComp(getComposition(screen, variantPresetId) ?? defaultComp);
  }, [screen.id, variantPresetId, defaultComp, screen]);

  // Sync typography from the project when switching screens/variants, but skip
  // while local slider edits are still pending save — otherwise a reload after
  // Size would clobber an in-flight Area change (and vice versa).
  useEffect(() => {
    if (Object.keys(pendingUniversal.current).length) return;
    if (Object.keys(pendingDevice.current).length) return;
    setTypo(config.compositor);
  }, [screen.id, variantPresetId, config.compositor]);

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

  // Flush any pending typography saves if the panel unmounts mid-debounce.
  useEffect(() => {
    return () => {
      if (typoSaveTimer.current) clearTimeout(typoSaveTimer.current);
      if (deviceSaveTimer.current) clearTimeout(deviceSaveTimer.current);
      const uni = pendingUniversal.current;
      const dev = pendingDevice.current;
      if (Object.keys(uni).length) {
        pendingUniversal.current = {};
        void api.setCompositor(uni).catch(() => {});
      }
      if (Object.keys(dev).length) {
        pendingDevice.current = {};
        const cls = presets.find((p) => p.id === variantPresetId)?.platform ?? "ios";
        void api.setDeviceTypography(cls, dev).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const sampleTheme = async () => {
    setBusy("Sampling theme");
    try {
      const res = await api.applyScreenTheme(screen.id, variantPresetId);
      setComp((prev) => ({
        ...prev,
        background: res.theme.background,
        headlineColor: res.theme.headlineColor,
      }));
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const updateUniversal = (patch: Partial<CompositorConfig>) => {
    setTypo((prev) => ({ ...prev, ...patch }));
    pendingUniversal.current = { ...pendingUniversal.current, ...patch };
    if (typoSaveTimer.current) clearTimeout(typoSaveTimer.current);
    typoSaveTimer.current = setTimeout(() => {
      const toSave = pendingUniversal.current;
      pendingUniversal.current = {};
      api
        .setCompositor(toSave)
        .then(() => onChanged())
        .catch(() => {});
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
    pendingDevice.current = { ...pendingDevice.current, ...patch };
    if (deviceSaveTimer.current) clearTimeout(deviceSaveTimer.current);
    deviceSaveTimer.current = setTimeout(() => {
      const toSave = pendingDevice.current;
      pendingDevice.current = {};
      api
        .setDeviceTypography(deviceClass, toSave)
        .then(() => onChanged())
        .catch(() => {});
    }, 450);
  };

  const overlay = getOverlay(screen, variantPresetId);
  const isMac = preset?.platform === "macos";
  // Canvas is always the ASC preset size. Mac overlay HTML renders at plate
  // size; phone/iPad render at preset points.
  const canvasW = preset?.pointWidth ?? 393;
  const canvasH = preset?.pointHeight ?? 852;
  const iframeW =
    isMac && overlay ? Math.max(1, overlay.plateWidth) : canvasW;
  const iframeH =
    isMac && overlay ? Math.max(1, overlay.plateHeight) : canvasH;
  const pxPerPoint = Math.min(wrap.w / canvasW, wrap.h / canvasH, 1);
  const stageW = Math.max(0, canvasW * pxPerPoint);
  const stageH = Math.max(0, canvasH * pxPerPoint);

  const headline =
    (comp.headlineKey
      ? stringsMap[comp.headlineKey]?.[previewLocale] ??
        stringsMap[comp.headlineKey]?.[config.baseLocale]
      : comp.headlineText?.[previewLocale] ??
        comp.headlineText?.[config.baseLocale]) ?? "";

  const isDevice = comp.mode === "device";
  const showHeadline = Boolean(headline);
  // Pass-through: full-bleed shot; headline overlays the top band when present.
  // Device (phone/iPad): screenshot in a bezel below the headline.
  // Device (Mac): float the window shot centered — no bezel (chrome is in the image).
  const headlineAreaH =
    isDevice || showHeadline ? areaFraction * stageH : 0;
  const bottomPad = isDevice ? 0.04 * stageH : 0;
  // Headline horizontal inset — keep in sync with engine headlineSideInset().
  const sidePad = (isMac ? 0.03 : 0.07) * stageW;
  // Window float still uses a slightly wider gutter so chrome doesn't kiss the edge.
  const floatSidePad = (isMac ? 0.05 : 0.08) * stageW;
  const availH = stageH - (isDevice ? headlineAreaH : 0) - bottomPad;
  const availW = stageW - floatSidePad * 2;

  let screenW: number;
  let screenH: number;
  let bezel: number;
  let outerW: number;
  let outerH: number;
  let deviceLeft: number;
  let deviceTop: number;
  let screenScale: number;
  let innerRadius: number;
  let outerRadius: number;

  if (!isDevice) {
    bezel = 0;
    innerRadius = 0;
    outerRadius = 0;
    if (isMac) {
      // Match engine passthrough: stretch plate to fill the ASC canvas.
      screenW = stageW;
      screenH = stageH;
      outerW = stageW;
      outerH = stageH;
      deviceLeft = 0;
      deviceTop = 0;
      screenScale = 1; // overridden below with non-uniform scale via width/height
    } else {
      screenW = stageW;
      screenH = stageH;
      outerW = stageW;
      outerH = stageH;
      deviceLeft = 0;
      deviceTop = 0;
      screenScale = canvasW > 0 ? stageW / canvasW : 1;
    }
  } else if (isMac) {
    const fitScale = Math.min(availW / iframeW, availH / iframeH);
    screenW = iframeW * fitScale;
    screenH = iframeH * fitScale;
    bezel = 0;
    outerW = screenW;
    outerH = screenH;
    deviceLeft = (stageW - outerW) / 2;
    deviceTop = headlineAreaH + (availH - outerH) / 2;
    screenScale = fitScale;
    innerRadius = 0;
    outerRadius = 0;
  } else {
    const fitScale = Math.min(availW / stageW, availH / stageH);
    screenW = stageW * fitScale;
    screenH = stageH * fitScale;
    bezel = Math.max(1, Math.round(stageW * 0.012));
    outerW = screenW + bezel * 2;
    outerH = screenH + bezel * 2;
    deviceLeft = (stageW - outerW) / 2;
    deviceTop = headlineAreaH + (availH - outerH) / 2;
    screenScale = canvasW > 0 ? screenW / canvasW : 1;
    innerRadius = (preset?.cornerRadius ?? 24) * screenScale;
    outerRadius = innerRadius + bezel;
  }

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
            {isMac ? "Float window" : "Device frame"}
          </button>
        </div>
        {isDevice && isMac && (
          <p className="hint">
            Mac screenshots already include window chrome and shadow — we center
            the image on the canvas without adding a border.
          </p>
        )}

        {isDevice && (
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
            {hasOverlay && (
              <button
                type="button"
                className="ghost mini"
                style={{ marginTop: 6 }}
                disabled={!!busy}
                onClick={() => void sampleTheme()}
                title="Derive background + headline color from the screenshot"
              >
                {busy === "Sampling theme"
                  ? "Sampling…"
                  : "Sample from screenshot"}
              </button>
            )}
          </>
        )}

        {!isDevice && (
          <p className="hint">
            Screenshot fills the canvas. Optionally overlay App Store promo
            text on top — no background or device frame.
          </p>
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
            {showHeadline && (
              <div
                className="comp-headline"
                style={{
                  position: isDevice ? undefined : "absolute",
                  top: isDevice ? undefined : 0,
                  left: isDevice ? undefined : 0,
                  right: isDevice ? undefined : 0,
                  zIndex: isDevice ? undefined : 2,
                  height: headlineAreaH,
                  padding: `0 ${sidePad}px`,
                  color: comp.headlineColor,
                  fontFamily: typo.headlineFont,
                  fontWeight: typo.headlineWeight,
                  fontStyle: typo.headlineStyle ?? "normal",
                  fontSize: fontPx,
                  letterSpacing: `${typo.headlineLetterSpacing}em`,
                  lineHeight: typo.headlineLineHeight,
                  pointerEvents: "none",
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
                width: isDevice || isMac ? outerW : stageW,
                height: isDevice || isMac ? outerH : stageH,
                borderRadius: outerRadius,
                padding: bezel,
                background: isDevice && !isMac ? "#0b0d12" : "transparent",
                overflow: "hidden",
              }}
            >
              <div
                className="comp-screen-clip"
                style={{
                  borderRadius: innerRadius,
                  width: isMac && !isDevice ? "100%" : undefined,
                  height: isMac && !isDevice ? "100%" : undefined,
                  // Phone/iPad keep the dark fill inside the bezel; Mac must stay
                  // clear so window-shadow alpha blends onto the promo stage.
                  background: isDevice && !isMac ? "#0b0d12" : "transparent",
                }}
              >
                <iframe
                  key={`${screen.id}-${variantPresetId}-${previewLocale}`}
                  title="composed preview"
                  scrolling="no"
                  src={renderUrl(screen.id, previewLocale, variantPresetId)}
                  style={
                    isMac && !isDevice
                      ? {
                          width: iframeW,
                          height: iframeH,
                          border: "none",
                          background: "transparent",
                          // Stretch plate to fill canvas (matches sharp fit:"fill").
                          transform: `scale(${stageW / iframeW}, ${stageH / iframeH})`,
                          transformOrigin: "top left",
                        }
                      : {
                          width: iframeW,
                          height: iframeH,
                          border: "none",
                          background: isMac ? "transparent" : undefined,
                          transform: `scale(${screenScale})`,
                          transformOrigin: "top left",
                        }
                  }
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
