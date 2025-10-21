// src/api/execute-preview/route.ts
import { db } from '@/db/db';

// IMPORTANT: this file expects the same `pendingPreviews` map available in memory.
// Since Node/Edge functions are isolated, in production you should persist previews in Redis or DB.
// For simplicity we re-create an import pattern: if you run both files in same server process, they can share module-level memory.
// If your environment isolates modules, replace the in-memory store with a DB/Redis-backed table.

import type { PreviewEntry } from '@/lib/preview-types';

// *** To keep this standalone for your repo, we'll recreate a minimal local store fallback. ***
// If you already have the `pendingPreviews` map in another module, import it instead.
// For demonstration, we create a fallback Map and try to read from globalThis.

declare global {
    // attach to global to share across modules in same process
    var __PENDING_PREVIEWS__: Map<string, PreviewEntry> | undefined;
}

if (!globalThis.__PENDING_PREVIEWS__) globalThis.__PENDING_PREVIEWS__ = new Map<string, PreviewEntry>();
const pendingPreviews = globalThis.__PENDING_PREVIEWS__ as Map<string, PreviewEntry>;

/**
 * Guardrail regex - must be consistent
 */
const FORBIDDEN_RE = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|REPLACE|MERGE)\b/i;

/**
 * Role allowlist (recreate same config here or centralize to shared module in production)
 */
const ROLE_TABLE_ALLOWLIST: Record<string, string[]> = {
    admin: ['*'],
    finance: ['sales', 'products'],
    analyst: ['sales', 'products'],
    hr: [],
    guest: ['products'],
};

function extractTableNames(sql: string): string[] {
    const names = new Set<string>();
    const norm = sql.replace(/\n/g, ' ');
    const fromMatches = [...norm.matchAll(/\bfrom\s+([`"]?)([a-zA-Z0-9_$.]+)\1/gi)];
    for (const m of fromMatches) names.add(m[2].split('.').slice(-1)[0].replace(/[`"]/g, ''));
    const joinMatches = [...norm.matchAll(/\bjoin\s+([`"]?)([a-zA-Z0-9_$.]+)\1/gi)];
    for (const m of joinMatches) names.add(m[2].split('.').slice(-1)[0].replace(/[`"]/g, ''));
    return Array.from(names).map((n) => n.toLowerCase());
}

function checkRBACOnSql(sql: string, userRole?: string): { ok: boolean; reason?: string } {
    if (!userRole) return { ok: true };
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
 * PII masking
 */
const EMAIL_RE = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const PHONE_RE = /(\+?\d{1,3}[-.\s]?(\d{2,4})[-.\s]?\d{3,4}[-.\s]?\d{3,4})/g;
const CREDIT_CARD_RE = /\b(?:\d[ -]*?){13,16}\b/g;

function maskValue(v: unknown) {
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

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { previewId, userId, userRole } = body as { previewId?: string; userId?: string; userRole?: string };

        if (!previewId) return new Response(JSON.stringify({ error: 'previewId required' }), { status: 400 });

        const entry = pendingPreviews.get(previewId);
        if (!entry) return new Response(JSON.stringify({ error: 'Preview not found or expired' }), { status: 404 });

        const sql = entry.query as string;

        // Final guardrails
        if (FORBIDDEN_RE.test(sql)) {
            return new Response(JSON.stringify({ error: 'Preview contains forbidden statements' }), { status: 400 });
        }

        // RBAC check
        const rbac = checkRBACOnSql(sql, userRole ?? entry.userRole);
        if (!rbac.ok) {
            return new Response(JSON.stringify({ error: `RBAC blocked execution: ${rbac.reason}` }), { status: 403 });
        }

        // Execute
    const rows = (await db.run(sql)) as unknown;
    const maskedRows = Array.isArray(rows) ? (rows as unknown[]).map((r) => maskRow(r as Record<string, unknown>)) : rows;

        // Best-effort audit log
        try {
            const safePreviewId = previewId ? previewId.replace(/'/g, "''") : null;
            const safeUserId = userId ? userId.replace(/'/g, "''") : null;
            const insertSql = `INSERT INTO query_logs (preview_id, executed_at, query, user_id) VALUES (${safePreviewId ? `'${safePreviewId}'` : 'NULL'}, datetime('now'), '${sql.replace(/'/g, "''")}', ${safeUserId ? `'${safeUserId}'` : 'NULL'})`;
            await db.run(insertSql);
        } catch (e) {
            console.warn('Could not write audit log:', (e as Error).message);
        }

        // remove preview (one-time)
        pendingPreviews.delete(previewId);

        return new Response(JSON.stringify({ ok: true, rows: maskedRows, executedQuery: sql }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message || 'unknown error' }), { status: 500 });
    }
}
