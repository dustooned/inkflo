// Vendored from 2Dope src/core/history.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Every change goes through a command. That gives undo/redo now, and autosave, scripting and
 * replay later (the same pattern the Craft apps use).
 */
export interface Command {
  label: string;
  do(): void;
  undo(): void;
  /**
   * Drawings whose pixels this command reads or writes. Their pixels must be live (not parked,
   * see core/residency.ts) before the command runs again.
   */
  drawings?: { id: string }[];
}

export class History {
  private done: Command[] = [];
  private undone: Command[] = [];
  onChange: () => void = () => {};

  constructor(private readonly limit = 200) {}

  /** Record a command. Pass `applied = false` to run it now. */
  push(cmd: Command, applied = true): void {
    if (!applied) cmd.do();
    this.done.push(cmd);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
    this.onChange();
  }

  /** The command `undo()` would run next. */
  peekUndo(): Command | null {
    return this.done[this.done.length - 1] ?? null;
  }

  /** The command `redo()` would run next. */
  peekRedo(): Command | null {
    return this.undone[this.undone.length - 1] ?? null;
  }

  undo(): Command | null {
    const cmd = this.done.pop();
    if (!cmd) return null;
    cmd.undo();
    this.undone.push(cmd);
    this.onChange();
    return cmd;
  }

  redo(): Command | null {
    const cmd = this.undone.pop();
    if (!cmd) return null;
    cmd.do();
    this.done.push(cmd);
    this.onChange();
    return cmd;
  }

  /**
   * Make the last `n` recorded commands one undo step (an action built from smaller edits).
   * Undo runs them backwards; redo runs them in order.
   */
  combine(n: number, label: string): void {
    if (n < 2 || n > this.done.length) return;
    const parts = this.done.splice(this.done.length - n, n);
    const ids = new Map(parts.flatMap((c) => c.drawings ?? []).map((d) => [d.id, d]));
    this.done.push({
      label,
      drawings: [...ids.values()],
      do: () => { for (const c of parts) c.do(); },
      undo: () => { for (const c of [...parts].reverse()) c.undo(); },
    });
    this.onChange();
  }

  /** Forget all undo/redo (used when a different project is loaded). */
  clear(): void {
    this.done = [];
    this.undone = [];
    this.onChange();
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }
}
