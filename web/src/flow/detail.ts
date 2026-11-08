import type { ReactNode } from "react";
import type { AgentId } from "../identity/agents";

/** What a disclosure widget is about to show detail for. */
export type DetailTarget = { kind: "agent"; id: AgentId } | { kind: "task"; taskId: string };

/**
 * The slot a later task fills with attempts, timelines and checks. It is called only while the widget is
 * open, so closed blocks cost nothing. Returning nothing leaves the tidy empty state in place.
 */
export type RenderDetail = (target: DetailTarget) => ReactNode;
