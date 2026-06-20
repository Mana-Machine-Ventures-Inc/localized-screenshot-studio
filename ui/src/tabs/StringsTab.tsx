import { useEffect, useMemo, useRef, useState } from "react";
import { api, type LocalizeResponse } from "../api";
import type { StringEntry } from "../types";

interface Props {
  reloadToken: number;
  onChanged: () => void;
}

export function StringsTab({ reloadToken, onChanged }: Props) {
  const [baseLocale, setBaseLocale] = useState("en");
  const [locales, setLocales] = useState<string[]>([]);
  const [strings, setStrings] = useState<StringEntry[]>([]);
  const [target, setTarget] = useState("");
  const [search, setSearch] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [localizing, setLocalizing] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, LocalizeResponse>>({});
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const cancelBulk = useRef(false);

  const load = async () => {
    const r = await api.getStrings();
    if (!r.open) return;
    setBaseLocale(r.baseLocale);
    setLocales(r.locales);
    setStrings(r.strings);
    setTarget((t) => t || r.baseLocale);
  };

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  /** Non-base locales that have a source value but no translation yet. */
  const missingFor = (s: StringEntry): string[] => {
    if (!(s.values[baseLocale]?.trim() ?? "")) return [];
    return locales.filter(
      (l) => l !== baseLocale && !(s.values[l]?.trim() ?? ""),
    );
  };

  const isMissing = (s: StringEntry) =>
    target !== baseLocale &&
    (s.values[baseLocale]?.trim() ?? "") !== "" &&
    !(s.values[target]?.trim() ?? "");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return strings.filter((s) => {
      if (missingOnly && !isMissing(s)) return false;
      if (!q) return true;
      return (
        s.key.toLowerCase().includes(q) ||
        (s.values[baseLocale] ?? "").toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strings, search, missingOnly, target, baseLocale]);

  const missingCount = useMemo(
    () => strings.filter(isMissing).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strings, target, baseLocale],
  );

  const keysWithMissing = useMemo(
    () => strings.filter((s) => missingFor(s).length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strings, locales, baseLocale],
  );

  const saveValue = async (key: string, value: string) => {
    if (target === baseLocale) {
      // Editing the source of truth wipes downstream translations so they are
      // re-flagged as missing; reload to pull the cleared values.
      await api.setBaseString(key, value);
      await load();
      onChanged();
      return;
    }
    setStrings((prev) =>
      prev.map((s) =>
        s.key === key ? { ...s, values: { ...s.values, [target]: value } } : s,
      ),
    );
    await api.setString(key, target, value);
    onChanged();
  };

  const addString = async () => {
    if (!newKey.trim()) return;
    setBusy(true);
    try {
      await api.addString(newKey.trim(), newValue);
      setNewKey("");
      setNewValue("");
      setAdding(false);
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const removeString = async (key: string) => {
    if (!window.confirm(`Delete “${key}” from the studio?`)) return;
    await api.deleteString(key);
    setResults((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
    await load();
    onChanged();
  };

  const localizeRow = async (key: string, targets?: string[]) => {
    setLocalizing((p) => ({ ...p, [key]: true }));
    try {
      const r = await api.localizeString(key, targets);
      setResults((p) => ({ ...p, [key]: r }));
      await load();
      onChanged();
    } catch (e) {
      setResults((p) => ({
        ...p,
        [key]: {
          key,
          baseLocale,
          baseValue: "",
          engine: "none",
          results: {},
          saved: [],
          // surface the failure in the panel
          ...({ error: String(e instanceof Error ? e.message : e) } as object),
        } as LocalizeResponse,
      }));
    } finally {
      setLocalizing((p) => ({ ...p, [key]: false }));
    }
  };

  const localizeAllMissing = async () => {
    const keys = keysWithMissing.map((s) => s.key);
    if (!keys.length) return;
    cancelBulk.current = false;
    setBulk({ done: 0, total: keys.length });
    try {
      for (let i = 0; i < keys.length; i++) {
        if (cancelBulk.current) break;
        const key = keys[i];
        setLocalizing((p) => ({ ...p, [key]: true }));
        try {
          const r = await api.localizeString(key);
          setResults((p) => ({ ...p, [key]: r }));
        } catch {
          /* keep going; row stays missing */
        } finally {
          setLocalizing((p) => ({ ...p, [key]: false }));
        }
        setBulk({ done: i + 1, total: keys.length });
      }
      await load();
      onChanged();
    } finally {
      setBulk(null);
    }
  };

  const dismissResult = (key: string) =>
    setResults((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });

  return (
    <div className="tab-content">
      <div className="toolbar">
        <div className="field inline">
          <label>Language</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
                {l === baseLocale ? " (default)" : ""}
              </option>
            ))}
          </select>
        </div>
        <input
          className="search"
          placeholder="Search keys or text…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {target !== baseLocale && (
          <button
            className={missingOnly ? "primary" : "ghost"}
            onClick={() => setMissingOnly((v) => !v)}
          >
            Missing ({missingCount})
          </button>
        )}
        <div className="spacer" />
        {bulk ? (
          <div className="gen-progress">
            <div className="progress">
              <span
                style={{
                  width: `${bulk.total ? (bulk.done / bulk.total) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="hint">
              localizing {bulk.done}/{bulk.total}
            </span>
            <button
              className="mini danger"
              onClick={() => (cancelBulk.current = true)}
            >
              Stop
            </button>
          </div>
        ) : (
          <button
            className="ghost"
            onClick={() => void localizeAllMissing()}
            disabled={!keysWithMissing.length}
            title="Generate every missing translation with AI"
          >
            Localize all missing ({keysWithMissing.length})
          </button>
        )}
        <button className="primary" onClick={() => setAdding((v) => !v)}>
          + New string
        </button>
      </div>

      {adding && (
        <div className="card add-row">
          <div className="field" style={{ flex: 1 }}>
            <label>Key</label>
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="screenshot_1_herotext"
            />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>Value ({baseLocale})</label>
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Crunch numbers, beautifully"
            />
          </div>
          <button className="primary" onClick={addString} disabled={busy || !newKey.trim()}>
            Add
          </button>
        </div>
      )}

      <div className="strings-table">
        <div className="strings-head">
          <div className="c-key">Key</div>
          <div className="c-base">Default ({baseLocale})</div>
          <div className="c-target">
            {target === baseLocale ? "Value" : target}
          </div>
          <div className="c-actions">Status</div>
        </div>
        <div className="strings-body">
          {filtered.map((s) => {
            const miss = missingFor(s);
            const res = results[s.key];
            const isBusy = localizing[s.key];
            return (
              <div key={s.key}>
                <div className="strings-row">
                  <div className="c-key mono" title={s.key}>
                    {s.key}
                    {s.added && <span className="tag">studio</span>}
                  </div>
                  <div className="c-base">{s.values[baseLocale] ?? ""}</div>
                  <div className="c-target">
                    <input
                      defaultValue={s.values[target] ?? ""}
                      key={`${s.key}-${target}-${s.values[target] ?? ""}`}
                      onBlur={(e) => {
                        if (e.target.value !== (s.values[target] ?? "")) {
                          void saveValue(s.key, e.target.value);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </div>
                  <div className="c-actions">
                    {miss.length > 0 ? (
                      <button
                        className="primary mini"
                        disabled={isBusy || !!bulk}
                        onClick={() => void localizeRow(s.key, miss)}
                        title={`Generate ${miss.join(", ")}`}
                      >
                        {isBusy
                          ? "Translating…"
                          : `Add ${miss.length} localisation${miss.length > 1 ? "s" : ""}`}
                      </button>
                    ) : (
                      <span className="slot-badge ok">complete</span>
                    )}
                    {s.edited && <span className="slot-badge">edited</span>}
                    <button
                      className="mini icon-btn"
                      title="Delete string"
                      onClick={() => void removeString(s.key)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {res && (
                  <LocalizeResultPanel
                    res={res}
                    onDismiss={() => dismissResult(s.key)}
                  />
                )}
              </div>
            );
          })}
          {!filtered.length && (
            <div className="hint" style={{ padding: 16 }}>
              No strings match.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LocalizeResultPanel({
  res,
  onDismiss,
}: {
  res: LocalizeResponse & { error?: string };
  onDismiss: () => void;
}) {
  const entries = Object.entries(res.results);
  const savedCount = res.saved?.length ?? 0;
  return (
    <div className="localize-result">
      <div className="localize-result-head">
        <span>
          AI localization · {res.engine === "openai" ? res.model : "unavailable"}
          {" · "}
          {savedCount}/{entries.length} saved
        </span>
        <button className="mini icon-btn" onClick={onDismiss} title="Dismiss">
          ✕
        </button>
      </div>
      {res.error && <div className="error-text">{res.error}</div>}
      {!entries.length && !res.error && (
        <div className="hint">Nothing to translate.</div>
      )}
      <div className="localize-result-grid">
        {entries.map(([locale, r]) => (
          <div
            key={locale}
            className={`localize-cell ${r.value ? "ok" : "bad"}`}
          >
            <span className="locale-tag">{locale}</span>
            <span className="localize-text">{r.value ?? r.error}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
