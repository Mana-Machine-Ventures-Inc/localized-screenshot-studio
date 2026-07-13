import { useEffect, useMemo, useRef, useState } from "react";
import { api, overlayImageUrl, type ProjectFont } from "../api";
import { getOverlay } from "../screens/variants";
import { FontPicker } from "./FontPicker";
import { ColorPicker } from "./ColorPicker";
import type {
  DevicePreset,
  ProjectSummary,
  ScreenTemplate,
  SlotAlign,
  SlotVAlign,
  TextSlot,
} from "../types";

interface Props {
  screen: ScreenTemplate;
  presets: DevicePreset[];
  summary: ProjectSummary;
  initialPreset: string;
  /** Which device variant's overlay to edit. */
  variantPresetId?: string;
  /** Hide the device picker (parent manages variants). */
  hideDevicePicker?: boolean;
  onChanged: () => void;
  /** Render inside a tab (fills parent) instead of as a full-screen overlay. */
  embedded?: boolean;
  onClose?: () => void;
  /** shared preview language (persists across tabs). */
  previewLocale?: string;
  onPreviewLocale?: (locale: string) => void;
}

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type DragOp =
  | {
      type: "move";
      startX: number;
      startY: number;
      starts: Record<string, TextSlot["box"]>;
    }
  | {
      type: "resize";
      id: string;
      handle: Handle;
      startX: number;
      startY: number;
      startBox: TextSlot["box"];
    };

const ALIGNS: SlotAlign[] = ["left", "center", "right"];
const VALIGNS: SlotVAlign[] = ["top", "middle", "bottom"];

const HANDLES: { dir: Handle; cursor: string }[] = [
  { dir: "nw", cursor: "nwse-resize" },
  { dir: "n", cursor: "ns-resize" },
  { dir: "ne", cursor: "nesw-resize" },
  { dir: "e", cursor: "ew-resize" },
  { dir: "se", cursor: "nwse-resize" },
  { dir: "s", cursor: "ns-resize" },
  { dir: "sw", cursor: "nesw-resize" },
  { dir: "w", cursor: "ew-resize" },
];

const MIN_W = 0.02;
const MIN_H = 0.01;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function resizeBox(
  b: TextSlot["box"],
  handle: Handle,
  dnx: number,
  dny: number,
): TextSlot["box"] {
  let { x, y, w, h } = b;
  const right = b.x + b.w;
  const bottom = b.y + b.h;
  if (handle.includes("e")) w = clamp(b.w + dnx, MIN_W, 1 - b.x);
  if (handle.includes("s")) h = clamp(b.h + dny, MIN_H, 1 - b.y);
  if (handle.includes("w")) {
    x = clamp(b.x + dnx, 0, right - MIN_W);
    w = right - x;
  }
  if (handle.includes("n")) {
    y = clamp(b.y + dny, 0, bottom - MIN_H);
    h = bottom - y;
  }
  return { x, y, w, h };
}

export function OverlayEditor({
  screen,
  presets,
  summary,
  initialPreset,
  onChanged,
  embedded,
  onClose,
  previewLocale: previewLocaleProp,
  onPreviewLocale,
  variantPresetId,
  hideDevicePicker,
}: Props) {
  const activePreset =
    variantPresetId ?? screen.presetIds[0] ?? initialPreset;
  const overlay = getOverlay(screen, activePreset)!;
  const sourceLocale = overlay.sourceLocale;

  const [slots, setSlots] = useState<TextSlot[]>(overlay.slots);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    overlay.slots[0] ? [overlay.slots[0].id] : [],
  );
  const [marquee, setMarquee] = useState<{
    l: number;
    t: number;
    w: number;
    h: number;
  } | null>(null);
  const [localPreviewLocale, setLocalPreviewLocale] = useState(sourceLocale);
  const previewLocale = previewLocaleProp || localPreviewLocale;
  const [presetId, setPresetId] = useState(activePreset);
  useEffect(() => {
    setPresetId(activePreset);
    setSlots(getOverlay(screen, activePreset)?.slots ?? []);
  }, [screen.id, activePreset, screen]);
  const [onion, setOnion] = useState(false);
  const [eyedropper, setEyedropper] = useState(false);
  const [plateBust, setPlateBust] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string>();
  // Localized string values (key -> locale -> text). The slot geometry and
  // typography are canonical/shared; only the displayed text changes by locale.
  const [localized, setLocalized] = useState<
    Record<string, Record<string, string>>
  >({});
  const [projectFonts, setProjectFonts] = useState<ProjectFont[]>([]);

  useEffect(() => {
    api
      .getFonts()
      .then((r) => setProjectFonts(r.fonts))
      .catch(() => {});
  }, []);

  const samplerRef = useRef<{
    ctx: CanvasRenderingContext2D;
    w: number;
    h: number;
  } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const dragRef = useRef<DragOp | null>(null);
  const marqueeRef = useRef<{
    x0: number;
    y0: number;
    additive: boolean;
    base: string[];
  } | null>(null);
  const slotsRef = useRef<TextSlot[]>(slots);
  slotsRef.current = slots;
  const dimsRef = useRef({ w: 0, h: 0 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const keyMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const k of summary.keys) m[k.key] = k.base;
    return m;
  }, [summary.keys]);

  const isRtl = ["ar", "he", "fa", "ur"].some((l) => previewLocale.startsWith(l));

  // Pull localized string values so the canvas can show the right text for any
  // language while keeping a single canonical layout.
  useEffect(() => {
    let cancelled = false;
    api
      .getStrings()
      .then((r) => {
        if (cancelled) return;
        const m: Record<string, Record<string, string>> = {};
        for (const s of r.strings) m[s.key] = s.values;
        setLocalized(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [plateBust]);

  // Fit the plate within the available canvas area.
  const plateRatio = overlay.plateWidth / overlay.plateHeight;
  const scale = Math.min(
    box.w / overlay.plateWidth,
    box.h / overlay.plateHeight,
  );
  const dispW = overlay.plateWidth * (isFinite(scale) ? scale : 0);
  const dispH = overlay.plateHeight * (isFinite(scale) ? scale : 0);
  dimsRef.current = { w: dispW, h: dispH };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth - 24, h: el.clientHeight - 24 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scheduleSave = (next: TextSlot[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(next), 650);
  };

  const save = async (next?: TextSlot[]) => {
    setSaving(true);
    try {
      await api.updateOverlay(screen.id, { slots: next ?? slots, presetId: activePreset });
      setPlateBust(Date.now());
      onChanged();
    } catch (e) {
      setInfo(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  const patchSlot = (id: string, patch: Partial<TextSlot>) => {
    setSlots((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, ...patch } : s));
      scheduleSave(next);
      return next;
    });
  };

  const patchType = (id: string, patch: Partial<TextSlot["type"]>) => {
    setSlots((prev) => {
      const next = prev.map((s) =>
        s.id === id ? { ...s, type: { ...s.type, ...patch } } : s,
      );
      scheduleSave(next);
      return next;
    });
  };

  const patchMask = (id: string, patch: Partial<TextSlot["mask"]>) => {
    setSlots((prev) => {
      const next = prev.map((s) =>
        s.id === id ? { ...s, mask: { ...s.mask, ...patch } } : s,
      );
      scheduleSave(next);
      return next;
    });
  };

  const resolveText = (slot: TextSlot): string => {
    if (slot.linkedKey) {
      const vals = localized[slot.linkedKey];
      const loc = vals?.[previewLocale];
      if (loc && loc.trim()) return loc;
      // Fall back to the source/base value, then OCR text, then the key so the
      // slot is never blank.
      const base = vals?.[sourceLocale] ?? keyMap[slot.linkedKey];
      if (base && base.trim()) return base;
      return slot.detectedText || slot.linkedKey;
    }
    return slot.literal ?? slot.detectedText ?? "";
  };

  // --- selection ----------------------------------------------------------
  const selectOnly = (id: string) => setSelectedIds([id]);
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const deleteSlots = (ids: string[]) => {
    if (!ids.length) return;
    const drop = new Set(ids);
    setSlots((prev) => {
      const next = prev.filter((s) => !drop.has(s.id));
      scheduleSave(next);
      return next;
    });
    setSelectedIds((prev) => prev.filter((id) => !drop.has(id)));
  };

  // Delete / Backspace removes the current selection (in any language).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (!selectedIds.length) return;
      e.preventDefault();
      deleteSlots(selectedIds);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  // --- drag / resize ------------------------------------------------------
  const startMove = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey || e.metaKey) {
      toggleSelect(id);
      return;
    }
    let moveIds = selectedIds;
    if (!selectedIds.includes(id)) {
      moveIds = [id];
      setSelectedIds([id]);
    }
    const starts: Record<string, TextSlot["box"]> = {};
    for (const s of slots) if (moveIds.includes(s.id)) starts[s.id] = { ...s.box };
    dragRef.current = { type: "move", startX: e.clientX, startY: e.clientY, starts };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const startResize = (e: React.PointerEvent, id: string, handle: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedIds([id]);
    const slot = slots.find((s) => s.id === id);
    if (!slot) return;
    dragRef.current = {
      type: "resize",
      id,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startBox: { ...slot.box },
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const onPointerMove = (e: PointerEvent) => {
    const op = dragRef.current;
    if (!op) return;
    const { w, h } = dimsRef.current;
    if (!w || !h) return;
    const dnx = (e.clientX - op.startX) / w;
    const dny = (e.clientY - op.startY) / h;
    if (op.type === "move") {
      setSlots((prev) =>
        prev.map((s) => {
          const sb = op.starts[s.id];
          if (!sb) return s;
          return {
            ...s,
            box: {
              ...s.box,
              x: clamp(sb.x + dnx, 0, 1 - s.box.w),
              y: clamp(sb.y + dny, 0, 1 - s.box.h),
            },
          };
        }),
      );
    } else {
      setSlots((prev) =>
        prev.map((s) =>
          s.id === op.id ? { ...s, box: resizeBox(op.startBox, op.handle, dnx, dny) } : s,
        ),
      );
    }
  };

  const onPointerUp = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    if (dragRef.current) {
      dragRef.current = null;
      setSlots((prev) => {
        scheduleSave(prev);
        return prev;
      });
    }
  };

  // --- marquee selection on empty canvas ----------------------------------
  const onStagePointerDown = (e: React.PointerEvent) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const additive = e.shiftKey || e.metaKey;
    marqueeRef.current = {
      x0: e.clientX,
      y0: e.clientY,
      additive,
      base: additive ? selectedIds : [],
    };
    if (!additive) setSelectedIds([]);
    setMarquee({ l: e.clientX - rect.left, t: e.clientY - rect.top, w: 0, h: 0 });
    window.addEventListener("pointermove", onMarqueeMove);
    window.addEventListener("pointerup", onMarqueeUp);
  };

  const onMarqueeMove = (e: PointerEvent) => {
    const m = marqueeRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!m || !rect) return;
    const cx = clamp(e.clientX, rect.left, rect.right);
    const cy = clamp(e.clientY, rect.top, rect.bottom);
    const minX = Math.min(m.x0, cx);
    const minY = Math.min(m.y0, cy);
    const maxX = Math.max(m.x0, cx);
    const maxY = Math.max(m.y0, cy);
    setMarquee({
      l: minX - rect.left,
      t: minY - rect.top,
      w: maxX - minX,
      h: maxY - minY,
    });
    const nx0 = (minX - rect.left) / rect.width;
    const ny0 = (minY - rect.top) / rect.height;
    const nx1 = (maxX - rect.left) / rect.width;
    const ny1 = (maxY - rect.top) / rect.height;
    const hits = slotsRef.current
      .filter(
        (s) =>
          s.box.x < nx1 &&
          s.box.x + s.box.w > nx0 &&
          s.box.y < ny1 &&
          s.box.y + s.box.h > ny0,
      )
      .map((s) => s.id);
    setSelectedIds(m.additive ? Array.from(new Set([...m.base, ...hits])) : hits);
  };

  const onMarqueeUp = () => {
    window.removeEventListener("pointermove", onMarqueeMove);
    window.removeEventListener("pointerup", onMarqueeUp);
    marqueeRef.current = null;
    setMarquee(null);
  };

  // --- eyedropper: sample a pixel from the original source image ----------
  // Invalidate the cached canvas when the underlying image changes.
  useEffect(() => {
    samplerRef.current = null;
  }, [plateBust]);

  const ensureSampler = async () => {
    if (samplerRef.current) return samplerRef.current;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = overlayImageUrl(screen.id, "source", activePreset, plateBust);
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(img, 0, 0);
    samplerRef.current = { ctx, w: img.naturalWidth, h: img.naturalHeight };
    return samplerRef.current;
  };

  const toHex = (n: number) => n.toString(16).padStart(2, "0");

  const pickColorAt = async (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || !selected) {
      setEyedropper(false);
      return;
    }
    const nx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    try {
      const s = await ensureSampler();
      const x = clamp(Math.round(nx * s.w), 0, s.w - 1);
      const y = clamp(Math.round(ny * s.h), 0, s.h - 1);
      const [r, g, b] = s.ctx.getImageData(x, y, 1, 1).data;
      const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      patchMask(selected.id, { color: hex, mode: "solid" });
    } catch (err) {
      setInfo(String(err instanceof Error ? err.message : err));
    } finally {
      setEyedropper(false);
    }
  };

  const addSlot = async () => {
    const id = `slot-${Date.now().toString(36)}`;
    const box = { x: 0.3, y: 0.45, w: 0.4, h: 0.06 };
    const newSlot: TextSlot = {
      id,
      box,
      literal: "New text",
      detectedText: "New text",
      mask: { mode: "none", color: "#ffffff", padding: 0.004, radius: 4 },
      type: {
        fontFamily: `-apple-system, system-ui, sans-serif`,
        fontWeight: 600,
        fontSizePct: 0.03,
        color: "#ffffff",
        align: "center",
        valign: "middle",
        lineHeight: 1.1,
        letterSpacing: 0,
        autoFit: "shrink",
        maxLines: 1,
      },
    };
    setSlots((prev) => [...prev, newSlot]);
    setSelectedIds([id]);
    // Sample the real background so the new slot is legible by default.
    let sampled: { background: string; textColor: string } | undefined;
    try {
      sampled = await api.sampleColors(screen.id, box, activePreset);
    } catch {
      /* keep defaults */
    }
    setSlots((prev) => {
      const next = prev.map((s) =>
        s.id === id && sampled
          ? {
              ...s,
              type: { ...s.type, color: sampled!.textColor },
              mask: { ...s.mask, color: sampled!.background },
            }
          : s,
      );
      scheduleSave(next);
      return next;
    });
  };

  const sampleSelected = async () => {
    if (!selected) return;
    try {
      const { background, textColor } = await api.sampleColors(
        screen.id,
        selected.box,
        activePreset,
      );
      setSlots((prev) => {
        const next = prev.map((s) =>
          s.id === selected.id
            ? {
                ...s,
                type: { ...s.type, color: textColor },
                mask: { ...s.mask, color: background },
              }
            : s,
        );
        scheduleSave(next);
        return next;
      });
    } catch (e) {
      setInfo(String(e instanceof Error ? e.message : e));
    }
  };

  const switchPreview = (locale: string) => {
    // Language is purely a display asset over one canonical layout — switching
    // never changes geometry, so there's nothing to persist here.
    if (onPreviewLocale) onPreviewLocale(locale);
    else setLocalPreviewLocale(locale);
  };

  const rebuild = async () => {
    await save();
    await api.rebuildPlate(screen.id, activePreset);
    setPlateBust(Date.now());
  };

  const selected =
    selectedIds.length === 1
      ? slots.find((s) => s.id === selectedIds[0])
      : undefined;

  return (
    <div className={embedded ? "overlay-embed" : "editor-overlay"}>
      <div className="editor-header">
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <b>{screen.name}</b>
          <span className="hint">overlay · source {sourceLocale}</span>
          {saving && <span className="hint">saving…</span>}
          {info && <span className="error-text">{info}</span>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="hint">Language</label>
          <select
            value={previewLocale}
            onChange={(e) => switchPreview(e.target.value)}
          >
            {summary.locales.map((l) => (
              <option key={l} value={l}>
                {l === sourceLocale ? `${l} (source)` : l}
              </option>
            ))}
          </select>
          {!hideDevicePicker && (
            <select
              value={presetId}
              onChange={(e) => {
                const v = e.target.value;
                setPresetId(v);
              }}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <button
            className={onion ? "primary" : "ghost"}
            onClick={() => setOnion((v) => !v)}
          >
            Onion skin
          </button>
          <button className="ghost" onClick={() => void rebuild()}>
            Rebuild plate
          </button>
          {onClose && (
            <button className="primary" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>

      <div className="editor-body overlay-body">
        {/* Canvas */}
        <div className="overlay-canvas" ref={canvasRef}>
          <div
            ref={stageRef}
            className="overlay-stage"
            style={{ width: dispW, height: dispH }}
            onPointerDown={onStagePointerDown}
          >
              <img
                className="overlay-plate"
                src={overlayImageUrl(screen.id, "plate", activePreset, plateBust)}
                alt="plate"
                draggable={false}
              />
              {onion && (
                <img
                  className="overlay-onion"
                  src={overlayImageUrl(screen.id, "source", activePreset, plateBust)}
                  alt="source"
                  draggable={false}
                />
              )}
              {slots.map((s) => {
                const fontPx = Math.max(6, s.type.fontSizePct * dispH);
                const isSel = selectedSet.has(s.id);
                return (
                  <div
                    key={s.id}
                    className={`overlay-slot ${isSel ? "sel" : ""}`}
                    style={{
                      left: `${s.box.x * 100}%`,
                      top: `${s.box.y * 100}%`,
                      width: `${s.box.w * 100}%`,
                      height: `${s.box.h * 100}%`,
                      justifyContent:
                        s.type.align === "left"
                          ? "flex-start"
                          : s.type.align === "right"
                            ? "flex-end"
                            : "center",
                      alignItems:
                        s.type.valign === "top"
                          ? "flex-start"
                          : s.type.valign === "bottom"
                            ? "flex-end"
                            : "center",
                    }}
                    onPointerDown={(e) => startMove(e, s.id)}
                  >
                    <span
                      style={{
                        fontFamily: s.type.fontFamily,
                        fontWeight: s.type.fontWeight,
                        fontStyle: s.type.fontStyle ?? "normal",
                        fontSize: fontPx,
                        lineHeight: s.type.lineHeight,
                        letterSpacing: `${s.type.letterSpacing}em`,
                        color: s.type.color,
                        textAlign: s.type.align,
                        direction: isRtl ? "rtl" : "ltr",
                        whiteSpace: s.type.autoFit === "wrap" ? "normal" : "nowrap",
                      }}
                    >
                      {resolveText(s)}
                    </span>
                    {isSel &&
                      HANDLES.map((hh) => (
                        <span
                          key={hh.dir}
                          className={`overlay-h h-${hh.dir}`}
                          style={{ cursor: hh.cursor }}
                          onPointerDown={(e) => startResize(e, s.id, hh.dir)}
                        />
                      ))}
                  </div>
                );
              })}
              {marquee && (
                <div
                  className="overlay-marquee"
                  style={{
                    left: marquee.l,
                    top: marquee.t,
                    width: marquee.w,
                    height: marquee.h,
                  }}
                />
              )}
            {eyedropper && (
              <div className="overlay-eyedropper" onPointerDown={pickColorAt} />
            )}
          </div>
        </div>

        {/* Right rail */}
        <div className="overlay-rail">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="section-title" style={{ margin: 0 }}>
              Text slots ({slots.length})
              {selectedIds.length > 1 ? ` · ${selectedIds.length} selected` : ""}
            </div>
            <button className="ghost" onClick={() => void addSlot()}>
              + Add
            </button>
          </div>
          <div className="hint">
            Drag a box or ⇧/⌘-click to multi-select · Delete removes selection.
          </div>
          <div className="slot-list">
            {slots.map((s) => (
              <div
                key={s.id}
                className={`slot-row ${selectedSet.has(s.id) ? "sel" : ""}`}
                onClick={(e) =>
                  e.shiftKey || e.metaKey ? toggleSelect(s.id) : selectOnly(s.id)
                }
              >
                <div className="slot-row-text">
                  {resolveText(s) || s.detectedText || "(empty)"}
                </div>
                <span
                  className={`slot-badge ${s.linkedKey ? "ok" : "warn"}`}
                  title={s.linkedKey ?? "no key linked"}
                >
                  {s.linkedKey ? "linked" : "literal"}
                </span>
              </div>
            ))}
            {!slots.length && (
              <div className="hint">No text detected. Add a slot manually.</div>
            )}
          </div>

          {selectedIds.length > 1 && (
            <div className="slot-editor">
              <div className="section-title" style={{ marginTop: 0 }}>
                {selectedIds.length} slots selected
              </div>
              <button
                className="danger"
                style={{ width: "100%" }}
                onClick={() => deleteSlots(selectedIds)}
              >
                Delete {selectedIds.length} slots
              </button>
            </div>
          )}

          {selected && (
            <div className="slot-editor">
              <div className="section-title">Selected slot</div>
              {selected.detectedText && (
                <div className="hint">Detected: “{selected.detectedText}”</div>
              )}

              <div className="field">
                <label>Text source</label>
                <select
                  value={selected.linkedKey ?? "__literal__"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__literal__") {
                      patchSlot(selected.id, {
                        linkedKey: undefined,
                        literal: selected.literal ?? resolveText(selected),
                      });
                    } else {
                      patchSlot(selected.id, { linkedKey: v });
                    }
                  }}
                >
                  <option value="__literal__">— literal text —</option>
                  {summary.keys.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.key} · {k.base.slice(0, 28)}
                    </option>
                  ))}
                </select>
              </div>
              {!selected.linkedKey && (
                <div className="field">
                  <label>Literal text</label>
                  <input
                    value={selected.literal ?? ""}
                    onChange={(e) =>
                      patchSlot(selected.id, { literal: e.target.value })
                    }
                  />
                </div>
              )}

              <FontPicker
                projectFonts={projectFonts}
                family={selected.type.fontFamily}
                weight={selected.type.fontWeight}
                italic={selected.type.fontStyle === "italic"}
                previewText={resolveText(selected) || "Aa Gg 123"}
                onChange={({ family, weight, italic }) =>
                  patchType(selected.id, {
                    fontFamily: family,
                    fontWeight: weight,
                    fontStyle: italic ? "italic" : "normal",
                  })
                }
              />

              <div className="field">
                <label>Size ({(selected.type.fontSizePct * 100).toFixed(1)}% of height)</label>
                <input
                  type="range"
                  min={0.01}
                  max={0.14}
                  step={0.001}
                  value={selected.type.fontSizePct}
                  onChange={(e) =>
                    patchType(selected.id, {
                      fontSizePct: Number(e.target.value),
                    })
                  }
                />
              </div>

              <div className="row" style={{ gap: 8 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Color</label>
                  <ColorPicker
                    value={selected.type.color}
                    onChange={(hex) => patchType(selected.id, { color: hex })}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Align</label>
                  <div className="seg">
                    {ALIGNS.map((a) => (
                      <button
                        key={a}
                        className={selected.type.align === a ? "on" : ""}
                        onClick={() => patchType(selected.id, { align: a })}
                      >
                        {a[0].toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>V-align</label>
                  <div className="seg">
                    {VALIGNS.map((a) => (
                      <button
                        key={a}
                        className={selected.type.valign === a ? "on" : ""}
                        onClick={() => patchType(selected.id, { valign: a })}
                      >
                        {a[0].toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="row" style={{ gap: 8 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Line height</label>
                  <input
                    type="number"
                    step={0.05}
                    value={selected.type.lineHeight}
                    onChange={(e) =>
                      patchType(selected.id, {
                        lineHeight: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Tracking (em)</label>
                  <input
                    type="number"
                    step={0.01}
                    value={selected.type.letterSpacing}
                    onChange={(e) =>
                      patchType(selected.id, {
                        letterSpacing: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Auto-fit</label>
                  <select
                    value={selected.type.autoFit}
                    onChange={(e) =>
                      patchType(selected.id, {
                        autoFit: e.target.value as TextSlot["type"]["autoFit"],
                      })
                    }
                  >
                    <option value="shrink">shrink</option>
                    <option value="wrap">wrap</option>
                    <option value="none">none</option>
                  </select>
                </div>
              </div>

              <div className="section-title">Mask (covers original)</div>
              <div className="row" style={{ gap: 8 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Mode</label>
                  <select
                    value={selected.mask.mode}
                    onChange={(e) =>
                      patchMask(selected.id, {
                        mode: e.target.value as "solid" | "none",
                      })
                    }
                  >
                    <option value="solid">solid</option>
                    <option value="none">none</option>
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Fill</label>
                  <ColorPicker
                    value={selected.mask.color}
                    onChange={(hex) => patchMask(selected.id, { color: hex })}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Radius</label>
                  <input
                    type="number"
                    value={selected.mask.radius}
                    onChange={(e) =>
                      patchMask(selected.id, { radius: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <button
                className="ghost"
                style={{ width: "100%", marginTop: 6 }}
                onClick={() => void sampleSelected()}
              >
                Sample colors from image
              </button>
              <button
                className={eyedropper ? "primary" : "ghost"}
                style={{ width: "100%", marginTop: 6 }}
                onClick={() => setEyedropper((v) => !v)}
              >
                {eyedropper
                  ? "Click the image to pick a color…"
                  : "Pick background color from image"}
              </button>
              <button
                className="ghost"
                style={{ width: "100%", marginTop: 6 }}
                onClick={() => deleteSlots([selected.id])}
              >
                Delete slot
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
