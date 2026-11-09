import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => cleanup());

// The suite runs every file in parallel; a page that appears after a fetch can take longer than the default 1 s on a loaded machine.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no `CSS.escape`, which user-event needs to move between the radios of a group.
const css = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS ?? {};
css.escape ??= (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
(globalThis as { CSS?: unknown }).CSS = css;
