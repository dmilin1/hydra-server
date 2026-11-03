import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";

type AIClient = ReturnType<typeof createGroq> | ReturnType<typeof createOpenAI>;
let aiClient: AIClient;

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

// Set default values
const openai_base_url: string =
  process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL;
const ai_provider: string = process.env.AI_PROVIDER || "groq";

if (ai_provider == "groq") {
  aiClient = createGroq({
    apiKey: process.env.GROQ_API_KEY,
  });
} else {
  aiClient = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: openai_base_url,
  });
}

// A custom OpenAI-compatible chat endpoint (such as OpenCode Go) does not
// necessarily offer embeddings. Don't send that provider's key to OpenAI.
const embeddingApiKey =
  process.env.OPENAI_EMBEDDING_API_KEY ||
  (openai_base_url === OPENAI_DEFAULT_BASE_URL
    ? process.env.OPENAI_API_KEY
    : undefined);
const embeddingClient = embeddingApiKey
  ? createOpenAI({
      apiKey: embeddingApiKey,
      baseURL: process.env.OPENAI_EMBEDDING_BASE_URL || OPENAI_DEFAULT_BASE_URL,
    }).embedding(EMBEDDING_MODEL)
  : null;

if (!aiClient) {
  throw new Error("Failed to initialize AI client");
}

export { aiClient, embeddingClient };
export { ai_provider };
