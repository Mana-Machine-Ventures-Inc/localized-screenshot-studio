import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clamp, normalizeHex, parseHex, toHex } from "../color";
import type { ColorSwatchGroup } from "../projectColors";
import { hasSampleableSurface, sampleDisplayAt, warmSampleCache } from "../sampleDisplay";

interface Props {
  value: string;
  onChange: (hex: string) => void;
  /** optional label rendered next to the swatch trigger */
  title?: string;
  /** End a coalesced undo gesture (color drag / slider). */
  onGestureEnd?: () => void;
  /** Deduped project colors, grouped by role. */
  palette?: ColorSwatchGroup[];
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function hsvToHsl(h: number, s: number, v: number) {
  const l = v * (1 - s / 2);
  const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return { h: Math.round(h), s: Math.round(sl * 100), l: Math.round(l * 100) };
}

function hslToHsv(h: number, s: number, l: number) {
  s /= 100;
  l /= 100;
  const v = l + s * Math.min(l, 1 - l);
  const sv = v === 0 ? 0 : 2 * (1 - l / v);
  return { h, s: sv, v };
}

export function ColorPicker({ value, onChange, title, onGestureEnd, palette }: Props) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState(() => {
    const rgb = parseHex(value) ?? { r: 255, g: 255, b: 255 };
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
  });
  const [hexText, setHexText] = useState(value);
  const [hover, setHover] = useState<{ hex: string; x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const slRef = useRef<HTMLDivElement>(null);
  const endRef = useRef(onGestureEnd);
  endRef.current = onGestureEnd;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  // Sync from the controlled prop when it changes externally (not from our edits).
  useEffect(() => {
    const cur = (() => {
      const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
      return toHex(r, g, b).toLowerCase();
    })();
    if (value.toLowerCase() !== cur) {
      const rgb = parseHex(value);
      if (rgb) setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
      setHexText(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Sample on-screen Source / Frame images while the popover is open.
  useEffect(() => {
    if (!open) {
      setHover(null);
      document.body.classList.remove("cp-sampling");
      return;
    }
    document.body.classList.add("cp-sampling");
    warmSampleCache();

    const onMove = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) {
        setHover(null);
        return;
      }
      const hex = sampleDisplayAt(e.clientX, e.clientY);
      if (hex) {
        setHover({ hex, x: e.clientX, y: e.clientY });
        return;
      }
      if (hasSampleableSurface(e.clientX, e.clientY)) {
        const x = e.clientX;
        const y = e.clientY;
        requestAnimationFrame(() => {
          const again = sampleDisplayAt(x, y);
          if (again) setHover({ hex: again, x, y });
        });
        return;
      }
      setHover(null);
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      const hex = sampleDisplayAt(e.clientX, e.clientY);
      if (hex) {
        e.preventDefault();
        e.stopPropagation();
        const rgb = parseHex(hex);
        if (rgb) {
          const next = rgbToHsv(rgb.r, rgb.g, rgb.b);
          setHsv(next);
          setHexText(hex);
          changeRef.current(hex);
          endRef.current?.();
        }
        return;
      }
      setOpen(false);
      endRef.current?.();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      document.body.classList.remove("cp-sampling");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const hex = toHex(r, g, b);
  const hsl = hsvToHsl(hsv.h, hsv.s, hsv.v);
  const current = normalizeHex(hex);

  const commit = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const rgb = hsvToRgb(next.h, next.s, next.v);
    const h = toHex(rgb.r, rgb.g, rgb.b);
    setHexText(h);
    onChange(h);
  };

  const onSlPointer = (e: React.PointerEvent) => {
    const el = slRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const move = (cx: number, cy: number) => {
      const rect = el.getBoundingClientRect();
      const s = clamp((cx - rect.left) / rect.width, 0, 1);
      const v = clamp(1 - (cy - rect.top) / rect.height, 0, 1);
      commit({ h: hsv.h, s, v });
    };
    move(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onGestureEnd?.();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const setHsl = (patch: Partial<{ h: number; s: number; l: number }>) => {
    const next = { ...hsl, ...patch };
    commit(hslToHsv(clamp(next.h, 0, 360), clamp(next.s, 0, 100), clamp(next.l, 0, 100)));
  };

  const applyHexText = (text: string) => {
    setHexText(text);
    const rgb = parseHex(text);
    if (rgb) commit(rgbToHsv(rgb.r, rgb.g, rgb.b));
  };

  const pickSwatch = (swatch: string) => {
    applyHexText(swatch);
    onGestureEnd?.();
  };

  const pickScreen = async () => {
    const Eye = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!Eye) return;
    try {
      const res = await new Eye().open();
      applyHexText(res.sRGBHex);
      onGestureEnd?.();
    } catch {
      /* user cancelled */
    }
  };
  const hasEyeDropper = "EyeDropper" in window;

  const hueColor = (() => {
    const c = hsvToRgb(hsv.h, 1, 1);
    return toHex(c.r, c.g, c.b);
  })();

  const loupeStyle = hover
    ? {
        left: Math.min(hover.x + 16, window.innerWidth - 120),
        top: Math.min(hover.y + 16, window.innerHeight - 40),
      }
    : undefined;

  return (
    <div className="cp" ref={rootRef}>
      <button
        type="button"
        className="cp-trigger"
        onClick={() => setOpen((v) => !v)}
        title={title}
      >
        <span className="cp-swatch" style={{ background: hex }} />
        <span className="cp-hex">{hex.toUpperCase()}</span>
      </button>
      {open && (
        <div className="cp-pop">
          <div
            ref={slRef}
            className="cp-sl"
            style={{ background: hueColor }}
            onPointerDown={onSlPointer}
          >
            <div className="cp-sl-white" />
            <div className="cp-sl-black" />
            <div
              className="cp-sl-thumb"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>
          <input
            className="cp-hue"
            type="range"
            min={0}
            max={360}
            value={Math.round(hsv.h)}
            onChange={(e) => commit({ ...hsv, h: Number(e.target.value) })}
            onPointerUp={() => onGestureEnd?.()}
          />
          <div className="cp-fields">
            <label>
              H
              <input
                type="number"
                min={0}
                max={360}
                value={hsl.h}
                onChange={(e) => setHsl({ h: Number(e.target.value) })}
                onBlur={() => onGestureEnd?.()}
              />
            </label>
            <label>
              S
              <input
                type="number"
                min={0}
                max={100}
                value={hsl.s}
                onChange={(e) => setHsl({ s: Number(e.target.value) })}
                onBlur={() => onGestureEnd?.()}
              />
            </label>
            <label>
              L
              <input
                type="number"
                min={0}
                max={100}
                value={hsl.l}
                onChange={(e) => setHsl({ l: Number(e.target.value) })}
                onBlur={() => onGestureEnd?.()}
              />
            </label>
          </div>
          <div className="cp-hexrow">
            <input
              className="cp-hexinput"
              value={hexText}
              spellCheck={false}
              onChange={(e) => applyHexText(e.target.value)}
              onBlur={() => {
                setHexText(hex);
                onGestureEnd?.();
              }}
            />
            {hasEyeDropper && (
              <button
                type="button"
                className="cp-eyedrop"
                title="Pick a color from anywhere on screen"
                onClick={() => void pickScreen()}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m2 22 1-1h3l9-9" />
                  <path d="M3 21v-3l9-9" />
                  <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
                </svg>
              </button>
            )}
          </div>
          {palette && palette.length > 0 && (
            <div className="cp-palette">
              {palette.map((group) => (
                <div key={group.label} className="cp-palette-group">
                  <div className="cp-palette-label">{group.label}</div>
                  <div className="cp-palette-list">
                    {group.colors.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        className={`cp-palette-row${current === c.hex ? " on" : ""}`}
                        title={c.hex.toUpperCase()}
                        onClick={() => pickSwatch(c.hex)}
                      >
                        <span
                          className="cp-palette-swatch"
                          style={{ background: c.hex }}
                        />
                        <span className="cp-palette-name">{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="cp-sample-hint">Hover the screenshot to sample</p>
        </div>
      )}
      {open &&
        hover &&
        createPortal(
          <div className="cp-loupe" style={loupeStyle}>
            <span className="cp-loupe-swatch" style={{ background: hover.hex }} />
            {hover.hex.toUpperCase()}
          </div>,
          document.body,
        )}
    </div>
  );
}
