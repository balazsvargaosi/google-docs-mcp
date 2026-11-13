/**
 * Parses MCP_STATELESS env var. Stateless mode disables httpStream session
 * tracking so the server survives serverless scale-to-zero without losing
 * MCP sessions.
 */
export function parseStatelessFlag(value) {
    const raw = (value ?? process.env.MCP_STATELESS ?? '').trim().toLowerCase();
    return raw === 'true' || raw === '1';
}
