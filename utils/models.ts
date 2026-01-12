import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from '@ai-sdk/openai';

type AIClient = ReturnType<typeof createGroq> | ReturnType<typeof createOpenAI>;
let aiClient: AIClient;

// Set default values
const openai_base_url: string = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
const ai_provider: string = process.env.AI_PROVIDER || 'groq'

if (ai_provider == 'groq') {
  aiClient = createGroq({
    apiKey: process.env.GROQ_API_KEY,
  })
} else {
  aiClient = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: openai_base_url,
  })
}

if (!aiClient) {
  throw new Error("Failed to initialize AI client");
}

export { aiClient };
export { ai_provider };
