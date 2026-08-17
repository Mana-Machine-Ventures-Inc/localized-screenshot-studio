import { useCallback, useMemo, useRef, useState } from "react";

export type HistoryCommand = {
  undo: () => void;
  redo: () => void;
};

/**
 * Linear undo/redo stack. Rapid edits that share a `coalesceKey` (a color
 * drag, a slider) collapse into one step: the first undo target is kept and
 * only the redo target moves forward.
 */
export function useCommandHistory(limit = 80) {
  const [rev, bump] = useState(0);
  const past = useRef<HistoryCommand[]>([]);
  const future = useRef<HistoryCommand[]>([]);
  const open = useRef<{ key: string; cmd: HistoryCommand } | null>(null);
  const applying = useRef(false);

  const notify = () => bump((n) => n + 1);

  const push = useCallback((cmd: HistoryCommand, coalesceKey?: string) => {
    if (applying.current) return;
    if (coalesceKey && open.current?.key === coalesceKey) {
      open.current.cmd.redo = cmd.redo;
      return;
    }
    past.current.push(cmd);
    if (past.current.length > limit) past.current.shift();
    future.current = [];
    open.current = coalesceKey ? { key: coalesceKey, cmd } : null;
    notify();
  }, [limit]);

  const endGesture = useCallback(() => {
    open.current = null;
  }, []);

  const clear = useCallback(() => {
    past.current = [];
    future.current = [];
    open.current = null;
    notify();
  }, []);

  const undo = useCallback(() => {
    open.current = null;
    const cmd = past.current.pop();
    if (!cmd) return;
    applying.current = true;
    try {
      cmd.undo();
    } finally {
      applying.current = false;
    }
    future.current.push(cmd);
    notify();
  }, []);

  const redo = useCallback(() => {
    open.current = null;
    const cmd = future.current.pop();
    if (!cmd) return;
    applying.current = true;
    try {
      cmd.redo();
    } finally {
      applying.current = false;
    }
    past.current.push(cmd);
    notify();
  }, []);

  return useMemo(
    () => ({
      push,
      endGesture,
      clear,
      undo,
      redo,
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
    }),
    [push, endGesture, clear, undo, redo, rev],
  );
}

export type CommandHistory = ReturnType<typeof useCommandHistory>;

/** True when the event target is a text field that should keep native undo. */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return type !== "range" && type !== "checkbox" && type !== "radio";
  }
  return false;
}
