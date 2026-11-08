/**
 * Port: inspect and signal operating-system processes.
 *
 * Used to abort a run from outside its process. A pid taken from the database can be stale (the process died and the
 * number was reused by something unrelated), so callers must check `commandMatches` before sending any signal.
 * Every method is total: an unknown or exited process yields `false`, `undefined` or an empty list, never an exception.
 */
export interface ProcessControl {
  /** True when a process with this id exists and has not exited (a zombie counts as exited). */
  isAlive(pid: number): boolean;
  /** Arguments of the process, `undefined` when it is gone or cannot be read. */
  commandLine(pid: number): string[] | undefined;
  /** True when the process exists and its arguments, joined with single spaces, match `marker`. */
  commandMatches(pid: number, marker: RegExp): boolean;
  /** Process group id of the process, `undefined` when it is gone or cannot be read. */
  processGroupOf(pid: number): number | undefined;
  /** Process groups of every descendant of `pid` (not its own group), each listed once. */
  descendantGroups(pid: number): number[];
  /** Sends the signal to one process. False when it could not be delivered. */
  signal(pid: number, signal: NodeJS.Signals): boolean;
  /** Sends the signal to every process of a group. Refuses the caller's own group. False when not delivered. */
  signalGroup(pgid: number, signal: NodeJS.Signals): boolean;
}
