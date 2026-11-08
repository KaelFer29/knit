import type { BoardModel, WireId } from "@board";
import type { StrandRequest } from "./geometry";

/** The task ids each wire carries, read from the board's wires. */
export function boardStrands(board: BoardModel): StrandRequest {
  const of = (id: WireId) => board.wires.find((w) => w.id === id)?.strands.map((s) => s.taskId) ?? [];
  return { plan: of("plan"), prompt: of("prompt"), result: of("result") };
}

/** The path a pulse travels: the strand with that id, or the first path of the wire when the id is a bare wire id. */
export function resolvePulsePath<T extends { id: string; wire: string }>(paths: readonly T[], wireId: string): T | undefined {
  return paths.find((p) => p.id === wireId) ?? paths.find((p) => p.wire === wireId);
}
