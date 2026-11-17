// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { AssistantRuntime } from "@assistant-ui/core";
import { ExportedMessageRepository } from "@assistant-ui/core";
import { AssistantRuntimeProvider } from "@assistant-ui/core/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantTransportOptions } from "./types";
import { useAssistantTransportRuntime } from "./useAssistantTransportRuntime";

type State = { delivered: boolean };

function Harness({ options, onRuntime }: {
  options: AssistantTransportOptions<State>;
  onRuntime: (runtime: AssistantRuntime) => void;
}) {
  const runtime = useAssistantTransportRuntime(options);
  useEffect(() => onRuntime(runtime), [onRuntime, runtime]);
  return <AssistantRuntimeProvider runtime={runtime}>{null}</AssistantRuntimeProvider>;
}

const acknowledgedState = `aui-state:${JSON.stringify([
  { type: "set", path: [], value: { delivered: true } },
])}\n`;
const finish = 'd:{"finishReason":"stop","usage":{"promptTokens":0,"completionTokens":0}}\n';

function setup(options: Partial<AssistantTransportOptions<State>> = {}) {
  let runtime: AssistantRuntime;
  render(<Harness
    onRuntime={(value) => { runtime = value; }}
    options={{
      initialState: { delivered: false },
      api: "/api/chat",
      headers: {},
      converter(state, metadata) {
        const repository = ExportedMessageRepository.fromArray(
          state.delivered
            ? [
                { id: "delivered", role: "user", content: "Draft" },
                { id: "reply", role: "assistant", content: "Answer" },
              ]
            : metadata.pendingCommands.length
              ? [{ id: "queued", role: "user", content: "Draft" }]
              : [],
        );
        return {
          messages: repository.messages.map(({ message }) => message),
          messageRepository: repository,
          isRunning: metadata.isSending,
        };
      },
      ...options,
    }}
  />);
  return () => runtime;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("assistant transport snapshots", () => {
  it("replaces a queued user message with its server version without creating a branch", async () => {
    const response = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn(() => response.promise));
    const runtime = setup({ requireFinish: true });
    await waitFor(() => expect(runtime().threads.getState().mainThreadId).toBeTruthy());

    await act(async () => runtime().thread.append("Draft"));
    await waitFor(() => expect(runtime().thread.getState().messages[0]?.id).toBe("queued"));
    response.resolve(new Response(acknowledgedState + finish));
    await waitFor(() => {
      expect(runtime().thread.getState().isRunning).toBe(false);
      expect(runtime().thread.getState().messages.map(({ id }) => id)).toEqual(["delivered", "reply"]);
      expect(runtime().thread.getMessageById("delivered").getState().branchCount).toBe(1);
    });
  });

  it.each([true, false])("only requires a stream finish when enabled (%s)", async (requireFinish) => {
    const onCancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(acknowledgedState)));
    const runtime = setup({ requireFinish, onCancel });
    await waitFor(() => expect(runtime().threads.getState().mainThreadId).toBeTruthy());
    await act(async () => runtime().thread.append("Draft"));
    await waitFor(() => expect(runtime().thread.getState().messages.at(-1)?.id).toBe("reply"));
    await waitFor(() => expect(runtime().thread.getState().isRunning).toBe(false));
    if (requireFinish) {
      expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ message: "The assistant response ended before completion." }),
      }));
    } else {
      expect(onCancel).not.toHaveBeenCalled();
    }
  });
});
