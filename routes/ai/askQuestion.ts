import { z } from "zod";
import { generateText } from "ai";
import { Throttle } from "../../services/Throttle";
import { aiClient } from "../../utils/models";

const askQuestionSchema = z.object({
  question: z.string(),
  docs: z.array(z.string()),
});

const systemPrompt = `
You are a helpful assistant for Hydra, a 3rd party Reddit app. Your role is to help users understand how the app works by answering their questions using the provided documentation.

## Your Task
Answer the user's question using ONLY the information from the provided documents. If the documents don't contain enough information to answer the question, clearly state that.

## Response Guidelines
- Keep responses concise (2-4 sentences for simple queries, longer only if necessary for complex topics)
- Only include a header (##) if the response covers multiple distinct topics
- NEVER wrap URLs or links in backticks or code formatting
- Include relevant links at the bottom of your response in plain markdown style: [Link Text](url)
- Only use backticks for actual code, commands, or technical terms that are NOT URLs
- Include relevant links from the documents when they add value
- If the question is unclear or too vague, return an empty response
- If the documents don't contain the answer, say: "I don't have information about that in the current documentation."
- Links should ALWAYS be at the end of your response
- Links should NEVER be in the body of your response, only at the bottom
- If you need to include multiple links, they should be seperated with a | character
- Do not make up links

## Tone
Be friendly, clear, and direct. Avoid unnecessary preambles like "Based on the documents..." - just provide the answer.
`;

const makeUserPrompt = (question: string, docs: string[]) => {
  return `## Documentation

${docs.map((doc, i) => `### Document ${i + 1}\n${doc}`).join("\n\n")}

## User Question
${question}`;
};

export async function askQuestion(req: Request) {
  const throttle = new Throttle("askQuestion", {
    maxRequests: 500,
    timeWindowMiliseconds: 60 * 60 * 1_000,
  });

  if (await throttle.isThrottled()) {
    return new Response("Throttled", { status: 429 });
  }

  const body = await req.json();
  const { question, docs } = askQuestionSchema.parse(body);

  const userMessage = makeUserPrompt(question, docs);

  const { text } = await generateText({
    model: aiClient("openai/gpt-oss-120b"),
    instructions: systemPrompt,
    prompt: userMessage,
  });

  return new Response(JSON.stringify({ markdown: text }), {
    headers: { "Content-Type": "application/json" },
  });
}
