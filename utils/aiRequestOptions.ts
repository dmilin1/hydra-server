import { createHash } from "node:crypto";

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENCODE_GO_HOST = "opencode.ai";
const OPENCODE_GO_PATH = "/zen/go";

function isOpenCodeGoEndpoint(baseURL: string): boolean {
  try {
    const url = new URL(baseURL);
    return (
      url.hostname === OPENCODE_GO_HOST &&
      (url.pathname === OPENCODE_GO_PATH ||
        url.pathname.startsWith(`${OPENCODE_GO_PATH}/`))
    );
  } catch {
    return false;
  }
}

export function getAIRequestOptions(
  request: Request,
  operation: string,
  sessionContext: unknown,
): { headers?: Record<string, string> } {
  const baseURL = process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL;
  if (!isOpenCodeGoEndpoint(baseURL)) return {};

  // Preserve a caller-provided conversation ID when one is available.
  const providedSession = request.headers.get("x-opencode-session")?.trim();
  const sessionId =
    providedSession &&
    providedSession.length <= 256 &&
    /^[\x21-\x7e]+$/.test(providedSession)
      ? providedSession
      : createHash("sha256")
          .update(JSON.stringify(["hydra-server", operation, sessionContext]))
          .digest("hex");

  return {
    headers: {
      "x-opencode-session": sessionId,
      "user-agent": "hydra-server/1.0",
    },
  };
}
