import { z } from "zod";
import { verifySubscription } from "../../middleware/subscription";
import { aiClient } from "../../utils/models";
import { ai_provider } from "../../utils/models";
import { generateText } from "ai";
import { AIUsage } from "../../services/AIUsage";

const summarizeCommentsSchema = z.object({
  customerId: z.string(),
  comments: z.array(z.string()),
  postTitle: z.string(),
  postAuthor: z.string(),
  postSummary: z.string(),
});

const systemPrompt = `You are a helpful assistant that summarizes Reddit comments. Provide a concise summary of the main points, ideas, and opinions expressed in the comments in one paragraph. Do not refer to the comments by number.`;

const makeUserPrompt = (
  postTitle: string,
  postAuthor: string,
  postSummary: string,
  comments: string[],
) => `
  Post Title: ${postTitle}
  Post Author: ${postAuthor}
  Post Summary: ${postSummary}
  Comments:
  ${comments.map((comment, index) => `${index + 1}. ${comment}`).join("\n")}
`;



// const MODEL_ID = process.env.OPENAI_SUMMARY_MODEL || 'openai/gpt-oss-20b'

let MODEL_ID: string = ""

if (ai_provider == "groq") {
  MODEL_ID = 'openai/gpt-oss-20b';
} else {
  MODEL_ID = process.env.OPENAI_SUMMARY_MODEL || "gpt-4.1-mini"
}

export async function summarizeComments(req: Request) {
  const body = await req.json();
  const { customerId, comments, postTitle, postAuthor, postSummary } =
    summarizeCommentsSchema.parse(body);
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
        content: makeUserPrompt(postTitle, postAuthor, postSummary, comments),
      },
    ],
  });

  await AIUsage.trackUsage(customerId, MODEL_ID, usage);

  return new Response(text, {
    headers: { "Content-Type": "application/json" },
  });
}
