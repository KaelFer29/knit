import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FollowupDraft } from "./FollowupDraft";

const box = () => screen.getByRole("textbox", { name: "Follow-up instruction" }) as HTMLTextAreaElement;
const send = () => screen.getByRole("button", { name: "Send to the orchestrator" }) as HTMLButtonElement;

describe("FollowupDraft", () => {
  it("shows what Claude wrote for the task, editable, and sends what is in the box", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<FollowupDraft taskId="T1" initial="Make the heading level 2." onSend={onSend} />);
    expect(screen.getByRole("region", { name: "Follow-up for T1" })).toBeTruthy();
    expect(box().value).toBe("Make the heading level 2.");
    await user.type(box(), " Keep the text.");
    await user.click(send());
    expect(onSend).toHaveBeenCalledWith("Make the heading level 2. Keep the text.");
  });

  it("cannot be sent empty", async () => {
    const user = userEvent.setup();
    render(<FollowupDraft taskId="T1" initial="x" onSend={vi.fn()} />);
    await user.clear(box());
    expect(send().disabled).toBe(true);
  });

  it("waits while it is sending, and says Cursor is working once it was sent, with a way to open Cursor", async () => {
    let finish: () => void = () => {};
    const onSend = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onOpenCursor = vi.fn();
    const user = userEvent.setup();
    render(<FollowupDraft taskId="T1" initial="Fix it" onSend={onSend} onOpenCursor={onOpenCursor} />);
    const button = send();
    await user.click(button);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Sending…");
    expect(box().disabled).toBe(true);
    finish();
    expect((await screen.findByRole("status")).textContent).toMatch(/Cursor is working on T1/);
    await user.click(screen.getByRole("button", { name: "Open Cursor" }));
    expect(onOpenCursor).toHaveBeenCalled();
  });

  it("shows why it failed, keeps the text and lets it be sent again", async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error("Task T1 has no recorded attempt with an agent session id")).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<FollowupDraft taskId="T1" initial="Fix it" onSend={onSend} />);
    await user.click(send());
    expect((await screen.findByRole("alert")).textContent).toContain("no recorded attempt");
    expect(box().value).toBe("Fix it");
    await user.click(send());
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});
