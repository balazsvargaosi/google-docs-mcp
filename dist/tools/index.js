import { registerDocsTools } from './docs/index.js';
import { registerDriveTools } from './drive/index.js';
import { registerSheetsTools } from './sheets/index.js';
import { registerUtilsTools } from './utils/index.js';
import { registerGmailTools } from './gmail/index.js';
import { registerCalendarTools } from './calendar/index.js';
import { registerScriptTools } from './script/index.js';
export const TOOL_GROUPS = [
    'docs',
    'drive',
    'sheets',
    'utils',
    'gmail',
    'calendar',
    'script',
];
const TOOL_GROUP_SET = new Set(TOOL_GROUPS);
export function parseEnabledToolGroups(raw = process.env.MCP_TOOL_GROUPS) {
    if (!raw?.trim())
        return [...TOOL_GROUPS];
    const requested = raw
        .split(',')
        .map((group) => group.trim().toLowerCase())
        .filter(Boolean);
    if (requested.length === 0 || requested.includes('all')) {
        return [...TOOL_GROUPS];
    }
    const unknown = requested.filter((group) => !TOOL_GROUP_SET.has(group));
    if (unknown.length > 0) {
        throw new Error(`Unknown MCP_TOOL_GROUPS value(s): ${unknown.join(', ')}. Valid groups: ${TOOL_GROUPS.join(', ')}`);
    }
    const selected = new Set(requested);
    return TOOL_GROUPS.filter((group) => selected.has(group));
}
/**
 * Registers all tools with the FastMCP server.
 */
export function registerAllTools(server, enabledGroups = parseEnabledToolGroups()) {
    for (const group of enabledGroups) {
        switch (group) {
            case 'docs':
                registerDocsTools(server);
                break;
            case 'drive':
                registerDriveTools(server);
                break;
            case 'sheets':
                registerSheetsTools(server);
                break;
            case 'utils':
                registerUtilsTools(server);
                break;
            case 'gmail':
                registerGmailTools(server);
                break;
            case 'calendar':
                registerCalendarTools(server);
                break;
            case 'script':
                registerScriptTools(server);
                break;
        }
    }
}
