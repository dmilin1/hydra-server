import { afterEach, describe, expect, test } from "bun:test";
import { getAIRequestOptions } from "./aiRequestOptions";

const originalBaseURL = process.env.OPENAI_BASE_URL;

afterEach(() => {
  if (originalBaseURL === undefined) {
    delete process.env.OPENAI_BASE_URL;
  } else {
    process.env.OPENAI_BASE_URL = originalBaseURL;
  }
});

describe("getAIRequestOptions", () => {
  test("adds stable session and identifying user-agent headers for OpenCode Go", () => {
    process.env.OPENAI_BASE_URL = "https://opencode.ai/zen/go/v1";
    const request = new Request("http://localhost/ai");
    const context = { customerId: "customer-1", postTitle: "Example" };

    const first = getAIRequestOptions(request, "summarize-post", context);
    const retry = getAIRequestOptions(request, "summarize-post", context);
    const sessionId = first.headers?.["x-opencode-session"] ?? "";

    expect(sessionId).toBe(retry.headers?.["x-opencode-session"] ?? "");
    expect(sessionId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.headers?.["user-agent"]).toBe("hydra-server/1.0");
  });

  test("uses a caller-provided conversation ID", () => {
    process.env.OPENAI_BASE_URL = "https://opencode.ai/zen/go/v1";
    const request = new Request("http://localhost/ai", {
      headers: { "x-opencode-session": "conversation-123" },
    });

    expect(
      getAIRequestOptions(request, "ask-question", {}).headers?.[
        "x-opencode-session"
      ],
    ).toBe("conversation-123");
  });

  test("does not add Go headers for other providers", () => {
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";

    expect(
      getAIRequestOptions(new Request("http://localhost/ai"), "test", {}),
    ).toEqual({});
  });
});
