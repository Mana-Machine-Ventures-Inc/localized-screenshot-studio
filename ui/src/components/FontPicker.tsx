import { useMemo } from "react";
import type { ProjectFont } from "../api";
import {
  ALL_WEIGHTS,
  buildFontOptions,
  matchFont,
  nearestWeight,
  primaryFamily,
  weightLabel,
} from "../fonts";

interface Props {
  projectFonts: ProjectFont[];
  family: string;
  weight: number;
  italic: boolean;
  onChange: (next: { family: string; weight: number; italic: boolean }) => void;
  previewText?: string;
}

/** Family + weight + italic picker, drawing on project + system font catalogs. */
export function FontPicker({
  projectFonts,
  family,
  weight,
  italic,
  onChange,
  previewText = "Aa Gg 123",
}: Props) {
  const options = useMemo(() => buildFontOptions(projectFonts), [projectFonts]);
  const current = matchFont(options, family);
  const project = options.filter((o) => o.source === "project");
  const system = options.filter((o) => o.source === "system");

  const weights = current?.weights ?? ALL_WEIGHTS;
  const weightChoices = weights.includes(weight)
    ? weights
    : [...weights, weight].sort((a, b) => a - b);
  const italicAvailable = current?.italic ?? true;

  const selectFamily = (id: string) => {
    const opt = options.find((o) => o.id === id);
    if (!opt) return;
    onChange({
      family: opt.family,
      weight: nearestWeight(opt.weights, weight),
      italic: italic && opt.italic,
    });
  };

  return (
    <div className="font-picker">
      <div className="field">
        <label>Font family</label>
        <select
          value={current?.id ?? "__custom__"}
          onChange={(e) => selectFamily(e.target.value)}
        >
          {!current && (
            <option value="__custom__">Custom · {primaryFamily(family)}</option>
          )}
          {project.length > 0 && (
            <optgroup label="Project fonts">
              {project.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="System fonts">
            {system.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Weight</label>
          <select
            value={weight}
            onChange={(e) =>
              onChange({ family, weight: Number(e.target.value), italic })
            }
          >
            {weightChoices.map((w) => (
              <option key={w} value={w}>
                {weightLabel(w)}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 64, flex: "0 0 auto" }}>
          <label>Italic</label>
          <button
            type="button"
            className={`italic-toggle${italic ? " on" : ""}`}
            disabled={!italicAvailable}
            title={
              italicAvailable
                ? "Toggle italic"
                : "Italic not available for this family"
            }
            onClick={() => onChange({ family, weight, italic: !italic })}
          >
            I
          </button>
        </div>
      </div>
      <div
        className="font-preview"
        style={{
          fontFamily: current?.family ?? family,
          fontWeight: weight,
          fontStyle: italic ? "italic" : "normal",
        }}
      >
        {previewText}
      </div>
    </div>
  );
}
