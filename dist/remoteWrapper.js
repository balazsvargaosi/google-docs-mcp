import { AsyncLocalStorage } from 'node:async_hooks';
import { getAuthSession, requireAuth, UserError } from 'fastmcp';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { logger } from './logger.js';
export const requestClients = new AsyncLocalStorage();
const allowedDomains = (process.env.ALLOWED_DOMAINS || '').split(',').filter(Boolean);
function checkDomain(idToken) {
    if (allowedDomains.length === 0)
        return true;
    if (!idToken)
        return false;
    const payload = idToken.split('.')[1];
    if (!payload)
        return false;
    try {
        const { hd } = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return hd ? allowedDomains.includes(hd) : false;
    }
    catch {
        return false;
    }
}
export function createClients(accessToken, refreshToken) {
    const auth = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    auth.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
    });
    return {
        accessToken,
        auth,
        docs: google.docs({ version: 'v1', auth }),
        sheets: google.sheets({ version: 'v4', auth }),
        drive: google.drive({ version: 'v3', auth }),
        script: google.script({ version: 'v1', auth }),
        gmail: google.gmail({ version: 'v1', auth }),
        calendar: google.calendar({ version: 'v3', auth }),
    };
}
const wrappedServers = new WeakSet();
/**
 * Wraps server.addTool() so that in remote (httpStream) mode every tool
 * automatically gets: auth enforcement, domain restriction, and per-request
 * Google API clients via AsyncLocalStorage. Zero changes to tool files.
 */
export function wrapServerForRemote(server) {
    if (wrappedServers.has(server))
        return;
    wrappedServers.add(server);
    const previousAddTool = server.addTool.bind(server);
    server.addTool = (toolDef) => {
        const originalExecute = toolDef.execute;
        previousAddTool({
            ...toolDef,
            canAccess: toolDef.canAccess
                ? (auth) => requireAuth(auth) && toolDef.canAccess(auth)
                : requireAuth,
            execute: async (args, context) => {
                const { accessToken, refreshToken, idToken } = getAuthSession(context.session);
                if (!checkDomain(idToken)) {
                    throw new UserError('Your Google account domain is not allowed on this server.');
                }
                const clients = createClients(accessToken, refreshToken);
                return requestClients.run(clients, () => originalExecute(args, context));
            },
        });
    };
    if (allowedDomains.length > 0) {
        logger.info(`Remote mode: domain restriction active for [${allowedDomains.join(', ')}]`);
    }
}
