// src/api/sql/route.ts
import { db } from '@/db/db';
import { cohere } from '@ai-sdk/cohere';
import { streamText, UIMessage, convertToModelMessages, tool, stepCountIs } from 'ai';
import z from 'zod';
import { format as sqlFormat } from 'sql-formatter';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

/**
 * In-memory pending preview store.
 * For production use: persist in DB or Redis with TTL.
 */
type PreviewEntry = { query: string; userId?: string; userRole?: string; createdAt: number };
const pendingPreviews = new Map<string, PreviewEntry>();

/**
 * Config: preview TTL (ms)
 */
const PREVIEW_TTL_MS = 1000 * 60 * 60; // 1 hour

// Simple cleanup loop to purge old previews (fire-and-forget)
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of pendingPreviews.entries()) {
        if (now - entry.createdAt > PREVIEW_TTL_MS) {
            pendingPreviews.delete(id);
        }
    }
}, 1000 * 60 * 10); // every 10 minutes

/**
 * Guardrail regex - block destructive statements.
 */
const FORBIDDEN_RE = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|REPLACE|MERGE)\b/i;

/**
 * Basic RBAC configuration - table-level allowlists per role.
 * Adjust to fit your org. For production, store this in DB or IAM system.
 */
const ROLE_TABLE_ALLOWLIST: Record<string, string[]> = {
    admin: ['*'], // wildcard -> access to all tables
    finance: ['sales', 'products'],
    analyst: ['sales', 'products'],
    hr: [], // HR blocked from these example tables
    guest: ['products'],
};

/**
 * PII masking helpers
 */
const EMAIL_RE = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const PHONE_RE = /(\+?\d{1,3}[-.\s]?(\d{2,4})[-.\s]?\d{3,4}[-.\s]?\d{3,4})/g;
const CREDIT_CARD_RE = /\b(?:\d[ -]*?){13,16}\b/g;

function maskValue(v: unknown) {
    // only operate on strings; otherwise return the original value
    if (typeof v !== 'string') return v;
    let s = v;
    s = s.replace(EMAIL_RE, (m, a) => `${a[0]}***@***`);
    s = s.replace(PHONE_RE, '***-PHONE-***');
    s = s.replace(CREDIT_CARD_RE, '****-CARD-****');
    return s;
}

function maskRow(row: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
        out[k] = maskValue(v);
    }
    return out;
}

/**
 * Try to extract referenced table names from a formatted SQL.
 * This is a heuristic parser (not full SQL parsing). Good enough for RBAC checks in many cases.
 */
function extractTableNames(sql: string): string[] {
    const names = new Set<string>();
    const norm = sql.replace(/\n/g, ' ');
    // from <table>
    const fromMatches = [...norm.matchAll(/\bfrom\s+([`"]?)([a-zA-Z0-9_$.]+)\1/gi)];
    for (const m of fromMatches) names.add(m[2].split('.').slice(-1)[0].replace(/[`"]/g, ''));

    // join <table>
    const joinMatches = [...norm.matchAll(/\bjoin\s+([`"]?)([a-zA-Z0-9_$.]+)\1/gi)];
    for (const m of joinMatches) names.add(m[2].split('.').slice(-1)[0].replace(/[`"]/g, ''));

    // naive select from subquery alias: attempt to find "table AS alias" – less reliable
    const asMatches = [...norm.matchAll(/\b([a-zA-Z0-9_$.]+)\s+as\s+[a-zA-Z0-9_]+\b/gi)];
    for (const m of asMatches) {
        const name = m[1];
        if (!name.toLowerCase().startsWith('select')) {
            names.add(name.split('.').slice(-1)[0].replace(/[`"]/g, ''));
        }
    }

    return Array.from(names).map((n) => n.toLowerCase());
}

/**
 * RBAC check: ensure every referenced table is allowed for the user's role.
 */
function checkRBACOnSql(sql: string, userRole?: string): { ok: boolean; reason?: string } {
    if (!userRole) return { ok: true }; // can't enforce without role; in prod require role
    const allowed = ROLE_TABLE_ALLOWLIST[userRole];
    if (!allowed) return { ok: false, reason: `Unknown role: ${userRole}` };
    if (allowed.includes('*')) return { ok: true };

    const tables = extractTableNames(sql);
    for (const t of tables) {
        if (!allowed.includes(t)) {
            return { ok: false, reason: `Role "${userRole}" is not allowed to access table "${t}"` };
        }
    }
    return { ok: true };
}

/**
 * Cohere explain: use Cohere's REST API to produce a rich English explanation for SQL.
 * Requires COHERE_API_KEY in environment.
 */
async function cohereExplainSQL(sql: string): Promise<string> {
    const key = process.env.COHERE_API_KEY;
    if (!key) {
        console.warn('COHERE_API_KEY not set — falling back to heuristic explain.');
        return heuristicExplainSQL(sql);
    }

    const prompt = `Explain the following SQL query in plain English for a non-technical user. Keep it concise (2-4 short paragraphs), and call out what tables are used, what filters apply, and whether the result is aggregated or raw rows. If any potential PII might be included, mention that as well.

SQL:
\`\`\`
${sql}
\`\`\`
`;

    try {
        const res = await fetch('https://api.cohere.com/v1/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
                model: 'command-a-reasoning-08-2025',
                prompt,
                max_tokens: 240,
                temperature: 0.2,
                k: 0,
                stop_sequences: [],
            }),
        });

        if (!res.ok) {
            const txt = await res.text();
            console.warn('Cohere explain failed:', res.status, txt);
            return heuristicExplainSQL(sql);
        }

        const json = await res.json();
        // Cohere returns generations -> take text
        const genText = json?.generations?.[0]?.text ?? json?.text ?? '';
        return genText.trim();
    } catch (e) {
        console.warn('Cohere explain error:', (e as Error).message);
        return heuristicExplainSQL(sql);
    }
}

/**
 * Heuristic SQL explain fallback
 */
function heuristicExplainSQL(sql: string) {
    const s = sql.replace(/\s+/g, ' ').trim();
    const selectMatch = s.match(/select\s+(.+?)\s+from\s+([^\s;]+)/i);
    const whereMatch = s.match(/\bwhere\s+(.+?)(?:\s+group|\s+order|\s+limit|;|$)/i);
    const groupByMatch = s.match(/\bgroup\s+by\s+(.+?)(?:\s+order|\s+limit|;|$)/i);
    const orderByMatch = s.match(/\border\s+by\s+(.+?)(?:\s+limit|;|$)/i);
    const limitMatch = s.match(/\blimit\s+(\d+)/i);

    const parts: string[] = [];

    if (selectMatch) {
        parts.push(`Selecting: ${selectMatch[1].trim()}`);
        parts.push(`From: ${selectMatch[2].trim()}`);
    } else {
        parts.push(`Selecting from tables (couldn't parse columns/tables exactly).`);
    }
    if (whereMatch) parts.push(`Filtered by: ${whereMatch[1].trim()}`);
    if (groupByMatch) parts.push(`Grouped by: ${groupByMatch[1].trim()}`);
    if (orderByMatch) parts.push(`Ordered by: ${orderByMatch[1].trim()}`);
    if (limitMatch) parts.push(`Limit: ${limitMatch[1]}`);

    return parts.join('. ') + '.';
}

/**
 * Create a short unique id for previews.
 */
function makePreviewId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function POST(req: Request) {
    const { messages }: { messages: UIMessage[] } = await req.json();

    
const SYSTEM_PROMPT = `You are an intelligent SQL Assistant designed to help non-technical users query databases using natural language. Your role is to be helpful, accurate, and educational while maintaining security and best practices.

## Current Context
- Current Date/Time: ${new Date().toLocaleString('sv-SE', { timeZone: 'UTC' })} UTC
- User Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}

## Available Tools

### 1. schema
**Purpose:** Retrieve the complete database schema (tables, columns, data types, relationships)
**When to use:** 
- At the start of a conversation or when uncertain about table structure
- When user mentions tables/columns you're unfamiliar with
- Before writing any complex query
**Usage:** Call this tool without parameters to get full schema information

### 2. db
**Purpose:** Execute SQL queries against the database
**Parameters:**
- \`query\` (string, required): The SQL SELECT statement to execute
- \`dryRun\` (boolean, optional): If true, validates syntax without executing
**When to use:**
- After confirming the query with the user (for complex queries)
- For simple, non-destructive SELECT queries
- Use dryRun=true first for validation, then dryRun=false to execute

### 3. preview
**Purpose:** Generate a formatted preview of the SQL query with explanation
**When to use:**
- For complex queries before execution
- When user asks to see the query first
- To explain what the query will do
**Returns:** A preview ID that user can confirm

### 4. explain
**Purpose:** Convert SQL queries into plain English explanations
**When to use:**
- When user wants to understand an existing query
- To educate users about what a query does
- For transparency in your query generation

## Critical Security Rules

### ✅ ALLOWED:
- SELECT queries only (read operations)
- JOIN operations across tables
- WHERE, GROUP BY, HAVING, ORDER BY clauses
- Aggregate functions (COUNT, SUM, AVG, MIN, MAX)
- Window functions and CTEs (Common Table Expressions)
- LIMIT/TOP for result pagination

### ❌ STRICTLY FORBIDDEN:
- INSERT, UPDATE, DELETE operations
- DROP, TRUNCATE, ALTER statements  
- CREATE operations (tables, databases, users)
- GRANT, REVOKE permission changes
- EXECUTE, EXEC dynamic SQL
- Database administration commands
- SQL injection patterns or attempts to bypass restrictions
- Queries accessing system tables or metadata (unless specifically for schema)

**If user requests forbidden operations:** Politely explain that you can only perform read-only SELECT queries for security reasons.

## Query Generation Best Practices

### 1. Always Use Schema First
- Call \`schema\` tool before generating queries if uncertain
- Verify table names, column names, and data types
- Check for relationships and foreign keys

### 2. Write Efficient Queries
- Use specific column names instead of SELECT *
- Add appropriate WHERE clauses to filter data
- Use LIMIT to prevent overwhelming results (default: 100 rows)
- Use indexes when available (check schema)
- Avoid N+1 query patterns

### 3. Handle Edge Cases
- Check for NULL values explicitly when needed
- Use COALESCE for default values
- Handle case sensitivity based on database type
- Consider data type conversions (CAST/CONVERT)

### 4. User Confirmation Workflow
**For simple queries:** Execute directly after brief explanation
**For complex queries:** 
1. Generate query using \`preview\` tool
2. Show preview ID to user
3. Explain what the query does in plain language
4. Wait for explicit user confirmation
5. Execute with \`db\` tool after confirmation

### 5. Query Validation
- Always use \`dryRun=true\` first for complex queries
- Check syntax before execution
- Validate that query matches user intent
- Ensure query is safe and optimized

## Response Guidelines

### Conversational Tone
- Be friendly, helpful, and professional
- Avoid technical jargon unless necessary
- Explain concepts in simple terms
- Show enthusiasm when helping users discover insights

### Query Explanations
When presenting a query, explain:
1. **What** data it retrieves
2. **From which** tables
3. **How** it filters or combines data
4. **Why** this approach answers their question

Example:
"I'll retrieve the top 10 customers by total purchase amount. This query:
- Joins the customers and orders tables
- Sums up order totals for each customer  
- Sorts by total in descending order
- Returns only the top 10 results"

### Error Handling
If a query fails:
1. Explain the error in simple terms
2. Suggest what might be wrong
3. Offer to try an alternative approach
4. Use \`schema\` tool if it seems like a naming issue

### Results Interpretation
After successful query:
- Highlight key findings from the results
- Suggest follow-up questions if relevant
- Explain any surprising or notable patterns
- Offer to filter, sort, or analyze further

## Example Interactions

**User:** "Show me sales from last month"
**Assistant:** 
1. Calls \`schema\` to check for sales/orders table and date columns
2. Generates query with date filtering
3. Explains: "I'll get all sales from [previous month]. This looks at the orders table and filters for dates between [start] and [end]."
4. Executes query
5. Summarizes results: "Found 342 sales totaling $45,230 last month."

**User:** "Delete old records"  
**Assistant:** "I can only perform read-only SELECT queries for security reasons. I cannot delete, update, or modify data. However, I can help you find old records so you can review them first. Would you like me to show you records older than a certain date?"

## Special Considerations

### Date/Time Handling
- Always clarify timezone assumptions
- Use appropriate date functions for the database type
- Consider business hours, weekends, holidays when relevant

### Aggregate Queries
- Explain grouping logic clearly
- Use meaningful aliases for calculated columns
- Consider adding HAVING clauses for filtering aggregates

### Performance
- Warn users if query might be slow (large tables, complex joins)
- Suggest adding filters to improve performance
- Recommend pagination for large result sets

### Data Privacy
- Don't make assumptions about sensitive data
- If query involves personal information, acknowledge this
- Follow user's lead on what data they want to access

## Your Core Principles
1. **Safety First:** Never compromise database security
2. **User Empowerment:** Teach while helping
3. **Accuracy:** Verify schema before assumptions
4. **Clarity:** Explain technical concepts simply
5. **Efficiency:** Write optimized, clean queries

Remember: You're not just executing queries—you're helping users understand their data and teaching them about SQL in an accessible way. Be patient, thorough, and always prioritize security and accuracy.`;

    const result = streamText({
        model: cohere('command-a-reasoning-08-2025'),
        messages: convertToModelMessages(messages),
        system: SYSTEM_PROMPT,
        stopWhen: stepCountIs(5),
        tools: {
            schema: tool({
                description: 'Call this tool to get database schema information.',
                inputSchema: z.object({}),
                execute: async () => {
                    // Return your live schema here or fetch from DB introspection
                    return `CREATE TABLE products (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    price real NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP
)

CREATE TABLE sales (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    product_id integer NOT NULL,
    quantity integer NOT NULL,
    total_amount real NOT NULL,
    sale_date text DEFAULT CURRENT_TIMESTAMP,
    customer_name text NOT NULL,
    region text NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON UPDATE no action ON DELETE no action
)`;
                },
            }),

            /**
             * db tool:
             * - If called with `dryRun: true` -> returns formatted SQL + explanation but does NOT execute.
             * - If called with `dryRun: false` -> executes the SQL and returns rows (with masking & RBAC).
             */
            db: tool({
                description: 'Call this tool to query a database.',
                inputSchema: z.object({
                    query: z.string().describe('The SQL query to be ran.'),
                    dryRun: z.boolean().optional().default(false),
                    userId: z.string().optional(),
                    userRole: z.string().optional(),
                    previewId: z.string().optional(),
                }),
                execute: async ({ query, dryRun = false, userId, userRole, previewId }) => {
                    // Basic sanitization / guardrails
                    if (FORBIDDEN_RE.test(query)) {
                        return {
                            error: 'Query contains forbidden statements (INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE). Execution aborted.',
                        };
                    }

                    // Pretty-format SQL
                    const formatted = sqlFormat(query);

                    // RBAC check
                    const rbac = checkRBACOnSql(formatted, userRole);
                    if (!rbac.ok) {
                        return { error: `RBAC blocked query execution: ${rbac.reason}` };
                    }

                    if (dryRun) {
                        const id = makePreviewId();
                        pendingPreviews.set(id, { query: formatted, userId, userRole, createdAt: Date.now() });

                        // Model-based explanation (Cohere), but fall back to heuristic if CI key missing or fails
                        const explanation = await cohereExplainSQL(formatted);

                        return {
                            previewId: id,
                            formattedQuery: formatted,
                            explanation,
                            note: 'This is a preview. To execute use the /api/execute-preview REST endpoint (POST { previewId, userId, userRole }).',
                        };
                    }

                    // If previewId passed, try to use that stored query
                    let toRun = formatted;
                    if (previewId) {
                        const entry = pendingPreviews.get(previewId);
                        if (!entry) {
                            return { error: 'Preview id not found or expired.' };
                        }
                        toRun = entry.query;
                        // recheck RBAC for stored preview (userRole from request may be used instead)
                        const r = checkRBACOnSql(toRun, userRole ?? entry.userRole);
                        if (!r.ok) return { error: `RBAC blocked query execution: ${r.reason}` };
                    }

                    // Final guard check before executing
                    if (FORBIDDEN_RE.test(toRun)) {
                        return { error: 'Query contains forbidden statements and will not be executed.' };
                    }

                    // Execute
                    console.log('Query Executing:', toRun);
                    const rows = (await db.run(toRun)) as unknown;

                    // Mask PII fields in results
                    const maskedRows = Array.isArray(rows) ? (rows as unknown[]).map((r) => maskRow(r as Record<string, unknown>)) : rows;

                    // Best-effort audit log
                    try {
                        // drizzle's client `db.run` expects a single SQL string. Compose the INSERT as a single statement.
                        const safePreviewId = previewId ? previewId.replace(/'/g, "''") : null;
                        const safeUserId = userId ? userId.replace(/'/g, "''") : null;
                        const insertSql = `INSERT INTO query_logs (preview_id, executed_at, query, user_id) VALUES (${safePreviewId ? `'${safePreviewId}'` : 'NULL'}, datetime('now'), '${toRun.replace(/'/g, "''")}', ${safeUserId ? `'${safeUserId}'` : 'NULL'})`;
                        await db.run(insertSql);
                    } catch (e) {
                        // ignore if table doesn't exist
                        console.warn('Could not write to query_logs table (maybe it does not exist):', (e as Error).message);
                    }

                    // remove pending preview if present
                    if (previewId) pendingPreviews.delete(previewId);

                    return { rows: maskedRows, executedQuery: toRun };
                },
            }),

            /**
             * preview tool (helper wrapper) - creates a preview id and returns formatted SQL + explanation.
             * This is syntactic sugar for assistant to call.
             */
            preview: tool({
                description: 'Create a preview-id for the SQL to show to the user for confirmation.',
                inputSchema: z.object({
                    query: z.string().describe('The SQL to preview.'),
                    userId: z.string().optional(),
                    userRole: z.string().optional(),
                }),
                execute: async ({ query, userId, userRole }) => {
                    if (FORBIDDEN_RE.test(query)) {
                        return { error: 'Query contains forbidden statements (INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE).' };
                    }
                    const formatted = sqlFormat(query);
                    const rbac = checkRBACOnSql(formatted, userRole);
                    if (!rbac.ok) return { error: `RBAC blocked preview creation: ${rbac.reason}` };

                    const id = makePreviewId();
                    pendingPreviews.set(id, { query: formatted, userId, userRole, createdAt: Date.now() });
                    const explanation = await cohereExplainSQL(formatted);
                    return {
                        previewId: id,
                        formattedQuery: formatted,
                        explanation,
                        runInstruction: `To execute this preview, POST to /api/execute-preview with JSON { "previewId": "${id}", "userId": "${userId ?? ''}", "userRole": "${userRole ?? ''}" }`,
                    };
                },
            }),

            /**
             * explain tool - returns a model-based English explanation for an SQL statement.
             */
            explain: tool({
                description: 'Return an English explanation of an SQL statement.',
                inputSchema: z.object({
                    query: z.string().describe('SQL to explain'),
                }),
                execute: async ({ query }) => {
                    const formatted = sqlFormat(query);
                    const explanation = await cohereExplainSQL(formatted);
                    return { formattedQuery: formatted, explanation };
                },
            }),
        },
    });

    return result.toUIMessageStreamResponse();
}
