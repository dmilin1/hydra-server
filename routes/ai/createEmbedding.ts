import { z } from "zod";
import { embed } from "ai";
import { Throttle } from "../../services/Throttle";
import { embeddingClient } from "../../utils/models";

const embeddingRequestSchema = z.object({
  text: z.string(),
});

export async function createEmbedding(req: Request) {
  if (!embeddingClient) {
    return new Response(
      "Embeddings are not configured. Set OPENAI_EMBEDDING_API_KEY and, if needed, OPENAI_EMBEDDING_BASE_URL.",
      { status: 503 },
    );
  }

  const throttle = new Throttle("createEmbedding", {
    maxRequests: 1_000,
    timeWindowMiliseconds: 60 * 60 * 1_000,
  });

  if (await throttle.isThrottled()) {
    return new Response("Throttled", { status: 429 });
  }

  const body = await req.json();
  const { text } = embeddingRequestSchema.parse(body);

  const { embedding } = await embed({
    model: embeddingClient,
    value: text,
  });

  return new Response(JSON.stringify(embedding), {
    headers: { "Content-Type": "application/json" },
  });
}
