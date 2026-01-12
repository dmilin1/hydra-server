import { z } from "zod";
import { authenticateRequest } from "../../middleware/auth";
import { corsHeaders } from "../../middleware/cors";
import { aiClient } from "../../utils/models";
import { ai_provider } from "../../utils/models";
import { generateText } from "ai";
import { db } from "../../db/db";

let MODEL_ID: string = ""

if (ai_provider == "groq") {
  MODEL_ID = 'llama-3.3-70b-versatile';
} else {
  MODEL_ID = process.env.OPENAI_FILTER_MODEL || "gpt-4.1-mini"
}

const makeSystemPrompt = (schemaDescription: string) =>
  `
You are a helpful assistant that generates SQLite queries from natural language descriptions. Your task is to:

1. Analyze the user's description of what data they want to retrieve
2. Generate a valid SQLite query that matches their request
3. Always include a LIMIT clause to prevent excessive data retrieval
4. Use proper SQLite syntax and functions
5. Return ONLY the SQL query, with no additional text or explanation
6. Format the query in a way that is easy to read and understand
7. Do not wrap the query in \`\`\`sql tags

The database has the following tables:
${schemaDescription}

Remember to:
- Always include a LIMIT clause
- Use proper table and column names
- Handle dates using SQLite's datetime functions
- Use proper JOIN syntax when needed
- Include appropriate WHERE clauses based on the description`.trim();

const generateQuerySchema = z.object({
  description: z.string(),
});

async function getDatabaseSchema() {
  // Get all tables
  const tables = db.$client
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];

  const schema: Record<string, { columns: string[] }> = {};

  for (const table of tables) {
    // Get column information for each table
    const columns = db.$client
      .query(`PRAGMA table_info(${table.name})`)
      .all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];

    // Format column information
    const columnDescriptions = columns.map((col) => {
      let desc = col.name;
      if (col.pk) desc += " (PRIMARY KEY)";
      if (col.notnull) desc += " (NOT NULL)";
      if (col.dflt_value) desc += ` (DEFAULT ${col.dflt_value})`;
      return desc;
    });

    schema[table.name] = { columns: columnDescriptions };
  }

  return schema;
}

export async function generateQuery(request: Request) {
  if (!(await authenticateRequest(request))) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  try {
    const body = await request.json();
    const { description } = generateQuerySchema.parse(body);

    // Get the current database schema
    const schema = await getDatabaseSchema();

    // Format schema for the prompt
    const schemaDescription = Object.entries(schema)
      .map(
        ([table, info]) =>
          `- ${table}: Contains columns: ${info.columns.join(", ")}`,
      )
      .join("\n");

    const systemPrompt = makeSystemPrompt(schemaDescription);

    // Generate the SQL query using Groq
    const { text: query } = await generateText({
      model: aiClient(MODEL_ID),
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: description,
        },
      ],
    });

    return Response.json({ query }, { headers: corsHeaders });
  } catch (error) {
    console.error("Error generating query:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
}
