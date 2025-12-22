import { z } from "zod";
import { verifySubscription } from "../../middleware/subscription";
import { aiClient } from "../../utils/models";
import { ai_provider } from "../../utils/models";
import { generateObject } from "ai";
import { AIUsage } from "../../services/AIUsage";

let providerConfig = {};

if (ai_provider == 'groq') {
  providerConfig = {
    groq: {
      structuredOutputs: false,
    },
  };
} else {
  providerConfig = {
    openai: {
      structuredOutputs: false,
    },
  };
}
const postSchema = z.object({
  id: z.string(),
  subreddit: z.string(),
  title: z.string(),
  text: z.string().optional(),
});

type Post = z.infer<typeof postSchema>;

const filterPostsSchema = z.object({
  customerId: z.string(),
  filterDescription: z.string(),
  posts: z.array(postSchema),
});

const responseSchema = z.object({}).catchall(z.boolean());


const systemPrompt = `
You are a helpful assistant that filters Reddit posts based on a user's description. These are the posts a user does not want to see.
Your task is to:
1. Analyze each post and determine if it matches the filter description
2. Return a mapping of post IDs to boolean values

If the post does not have enough information to make a determination, return false for that post.

The boolean value should be true if the post matches (should be filtered out), false if it does not match the filter (should be kept)

Be thorough in your analysis and consider both the title and text of each post.

Your response should be a JSON object with the following format:
{
  "postId1": true,
  "postId2": false,
  "postId3": true,
  ...
}
`;

const makeUserPrompt = (filterDescription: string, posts: Post[]) => `
Filter Description: ${filterDescription}

Posts to analyze:
${posts
  .map(
    (post) => `
ID: ${post.id}
Subreddit: ${post.subreddit}
Title: ${post.title}
Text: ${post.text}
`,
  )
  .join("\n")}
`;

let MODEL_ID: string = ""

if (ai_provider == "groq") {
  MODEL_ID = 'llama-3.1-8b-instant';
} else {
  MODEL_ID = process.env.OPENAI_FILTER_MODEL || "gpt-4.1-mini"
}

export async function filterPosts(req: Request) {
  const body = await req.json();
  const { customerId, filterDescription, posts } =
    filterPostsSchema.parse(body);
  const isSubscribed = await verifySubscription(customerId);
  if (!isSubscribed) {
    return new Response("Customer is not subscribed", { status: 403 });
  }

  const isOverLimit = AIUsage.isOverLimit(customerId);
  if (isOverLimit) {
    return new Response("Monthly usage limit exceeded", { status: 429 });
  }

  // Generate the filtered posts using Groq


  const { object, usage } = await generateObject({
    model: aiClient(MODEL_ID),
    maxOutputTokens: 1_000,
    schema: responseSchema,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: makeUserPrompt(filterDescription, posts),
      },
    ],
    providerOptions: {
      ...providerConfig
    },
  });


  await AIUsage.trackUsage(customerId, MODEL_ID, usage);

  // Make sure the response is a mapping of post IDs to boolean values
  const filteredPosts = posts.reduce(
    (acc, post) => {
      acc[post.id] = object[post.id] ?? false;
      return acc;
    },
    {} as Record<string, boolean>,
  );

  return new Response(JSON.stringify(filteredPosts), {
    headers: { "Content-Type": "application/json" },
  });
}
