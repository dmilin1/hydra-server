import { z } from "zod";
import { verifySubscription } from "../../middleware/subscription";
import { aiClient } from "../../utils/models";
import { ai_provider } from "../../utils/models";
import { generateText } from "ai";
import { AIUsage } from "../../services/AIUsage";

const translateSchema = z.object({
  customerId: z.string(),
  type: z.enum(["post", "comment"]),
  sourceLanguage: z.string(),
  targetLanguage: z.string(),
  // Post-specific fields
  postTitle: z.string().optional(),
  postText: z.string().optional(),
  // Comment-specific field
  comment: z.string().optional(),
});

const systemPrompt = `You are a helpful assistant that translates text. Translate the given text accurately while preserving the original meaning, tone, and context. Only provide the translation without any additional explanations or formatting.`;

const LANGUAGE_NAMES: Record<string, string> = {
  auto: "automatically detected language",
  en: "English",
  "zh-Hant": "Chinese Traditional",
  "zh-Hans": "Chinese Simplified",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  ru: "Russian",
};

const getLangName = (code: string) => LANGUAGE_NAMES[code] ?? code;

const makeUserPrompt = (
  sourceLanguage: string,
  targetLanguage: string,
  type: "post" | "comment",
  postTitle?: string,
  postText?: string,
  comment?: string,
) => {
  const sourceLangName = getLangName(sourceLanguage);
  const targetLangName = getLangName(targetLanguage);

  if (type === "comment") {
    return `Translate the following comment from ${sourceLangName} to ${targetLangName}:\n\n${comment}`;
  }

  return `Translate the following Reddit post from ${sourceLangName} to ${targetLangName}:

Title: ${postTitle}

${postText ? `Post Content:\n${postText}` : ""}`;
};

let MODEL_ID: string = "";

if (ai_provider == "groq") {
  MODEL_ID = "openai/gpt-oss-20b";
} else {
  MODEL_ID = process.env.OPENAI_SUMMARY_MODEL || "gpt-4.1-mini";
}

export async function translate(req: Request) {
  const body = await req.json();
  const { customerId, type, sourceLanguage, targetLanguage, postTitle, postText, comment } =
    translateSchema.parse(body);

  const isSubscribed = await verifySubscription(customerId);
  if (!isSubscribed) {
    return new Response("Customer is not subscribed", { status: 403 });
  }

  const isOverLimit = AIUsage.isOverLimit(customerId);
  if (isOverLimit) {
    return new Response("Monthly usage limit exceeded", { status: 429 });
  }

  const { text, usage } = await generateText({
    model: aiClient(MODEL_ID),
    maxOutputTokens: 2_000,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: makeUserPrompt(sourceLanguage, targetLanguage, type, postTitle, postText, comment),
      },
    ],
  });

  await AIUsage.trackUsage(customerId, MODEL_ID, usage);

  return new Response(text, {
    headers: { "Content-Type": "application/json" },
  });
}
