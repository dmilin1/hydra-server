import type { LanguageModelUsage } from "ai";
import { db } from "../db/db";
import { aiRequests } from "../db/schema";
import { and, eq, sql } from "drizzle-orm";

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

type ModelId = keyof typeof MODEL_COSTS;

const MODEL_COSTS = {
  "llama-3.1-8b-instant": {
    inputTokenCost: 0.05 / 1_000_000,
    outputTokenCost: 0.08 / 1_000_000,
  },
  "openai/gpt-oss-20b": {
    inputTokenCost: 0.1 / 1_000_000,
    outputTokenCost: 0.5 / 1_000_000,
  },
  "openai/gpt-4.1-mini": {
    inputTokenCost: 0.4 / 1_000_000,
    outputTokenCost: 1.6 / 1_000_000,
  },
  "openai/gpt-4.1": {
    inputTokenCost: 2.0 / 1_000_000,
    outputTokenCost: 8.0 / 1_000_000,
  },
  "others": { // catch-all for models not in the list
    inputTokenCost: 0.0 / 1_000_000,
    outputTokenCost: 0.0 / 1_000_000,
  },
};

const MONTHLY_COST_LIMIT = 2.0;

export class AIUsage {
  static async trackUsage(
    customerId: string,
    modelId: ModelId,
    usage: LanguageModelUsage,
  ) {
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format

    // Get model cost, or catch all
    const modelCost = MODEL_COSTS[modelId] || MODEL_COSTS.others;
    const spend =
      (usage.inputTokens ?? 0) * modelCost.inputTokenCost +
      (usage.outputTokens ?? 0) * modelCost.outputTokenCost;

    await db
      .insert(aiRequests)
      .values({
        customerId,
        month: currentMonth,
        requestCount: 1,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalSpent: spend,
      })
      .onConflictDoUpdate({
        target: [aiRequests.customerId, aiRequests.month],
        set: {
          requestCount: sql`${aiRequests.requestCount} + 1`,
          inputTokens: sql`${aiRequests.inputTokens} + ${usage.inputTokens}`,
          outputTokens: sql`${aiRequests.outputTokens} + ${usage.outputTokens}`,
          totalSpent: sql`${aiRequests.totalSpent} + ${spend}`,
        },
      });
  }

  static isOverLimit(customerId: string): boolean {
    const currentMonth = new Date().toISOString().slice(0, 7);

    const usage = db
      .select({
        totalSpent: aiRequests.totalSpent,
      })
      .from(aiRequests)
      .where(
        and(
          eq(aiRequests.customerId, customerId),
          eq(aiRequests.month, currentMonth),
        ),
      )
      .get();

    if (!usage) {
      return false;
    }

    return usage.totalSpent >= MONTHLY_COST_LIMIT;
  }
}
