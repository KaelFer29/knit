import type { FileContent, FilesApi, TreeEntry } from "./api";

const f = (path: string, size: number): TreeEntry => ({ name: path.split("/").pop()!, path, kind: "file", size });
const d = (path: string): TreeEntry => ({ name: path.split("/").pop()!, path, kind: "directory" });

const DIRS: Record<string, Record<string, TreeEntry[]>> = {
  repo: {
    "": [d("src"), d("docs"), f("README.md", 1280), f("package.json", 912), f("logo.png", 20480)],
    src: [d("src/billing"), f("src/index.ts", 340)],
    "src/billing": [f("src/billing/webhook.ts", 1180), f("src/billing/webhook.test.ts", 760)],
    docs: [f("docs/overview.md", 2048)],
  },
  T1: {
    "": [d("src"), f("NOTES.md", 210)],
    src: [f("src/webhook.ts", 640)],
  },
};

const TEXT: Record<string, string> = {
  "README.md": "# Billing service\n\nHandles payment webhooks.\n",
  "package.json": '{\n  "name": "billing",\n  "version": "1.0.0"\n}\n',
  "src/index.ts": 'export { handleWebhook } from "./billing/webhook";\n',
  "src/billing/webhook.ts":
    'export function handleWebhook(body: string): { ok: boolean } {\n  const event = JSON.parse(body);\n  return { ok: event.type === "invoice.paid" };\n}\n',
  "src/billing/webhook.test.ts": 'import { expect, it } from "vitest";\n\nit("accepts a paid invoice", () => {\n  expect(true).toBe(true);\n});\n',
  "docs/overview.md": "# Overview\n\nSee the README.\n",
  "NOTES.md": "Work in progress.\n",
  "src/webhook.ts": "export const todo = true;\n",
};

/** In-memory explorer for `?view=files&demo=1` and for tests of the screens. */
export function demoFilesApi(): FilesApi {
  return {
    roots: async () => [
      { id: "repo", label: "Repository" },
      { id: "T1", label: "T1 Add webhook handler" },
    ],
    list: async (root, path) => {
      const entries = DIRS[root]?.[path];
      if (!entries) throw new Error("Path not found");
      return entries;
    },
    read: async (_root, path): Promise<FileContent> => {
      if (path === "logo.png") return { kind: "binary", path, size: 20480 };
      const text = TEXT[path];
      if (text === undefined) throw new Error("Path not found");
      return { kind: "text", path, size: text.length, text };
    },
  };
}
