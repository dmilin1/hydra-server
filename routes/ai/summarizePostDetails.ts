import { z } from "zod";
import { verifySubscription } from "../../middleware/subscription";
import { aiClient } from "../../utils/models";
import { ai_provider } from "../../utils/models";
import { generateText } from "ai";
import { AIUsage } from "../../services/AIUsage";

const summarizePostDetailsSchema = z.object({
  customerId: z.string(),
  subreddit: z.string(),
  postTitle: z.string(),
  postAuthor: z.string(),
  postText: z.string(),
});

const systemPrompt = `You are a helpful assistant that summarizes Reddit posts. Provide a concise summary of the main points in one paragraph. If the user refers to themselves, use their username instead.`;

const makeUserPrompt = (
  subreddit: string,
  postTitle: string,
  postAuthor: string,
  postText: string,
) => `
  Subreddit: ${subreddit}
  Title: ${postTitle}
  Author: ${postAuthor}
  Text: ${postText}
`;

// const MODEL_ID = process.env.OPENAI_SUMMARY_MODEL || 'openai/gpt-oss-20b';

let MODEL_ID: string = ""

if (ai_provider == "groq") {
  MODEL_ID = 'openai/gpt-oss-20b';
} else {
  MODEL_ID = process.env.OPENAI_SUMMARY_MODEL || "gpt-4.1-mini"
}

export async function summarizePostDetails(req: Request) {
  const body = await req.json();
  const { customerId, subreddit, postTitle, postAuthor, postText } =
    summarizePostDetailsSchema.parse(body);
  const isSubscribed = await verifySubscription(customerId);
  if (!isSubscribed) {
    return new Response("Customer is not subscribed", { status: 403 });
  }

  const isOverLimit = AIUsage.isOverLimit(customerId);
  if (isOverLimit) {
    return new Response("Monthly usage limit exceeded", { status: 429 });
  }

  // Generate the summary using Groq
 
  const { text, usage } = await generateText({
    model: aiClient(MODEL_ID),
    maxOutputTokens: 1_000,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: makeUserPrompt(subreddit, postTitle, postAuthor, postText),
      },
    ],
  });

  await AIUsage.trackUsage(customerId, MODEL_ID, usage);

  return new Response(text, {
    headers: { "Content-Type": "application/json" },
  });
}
