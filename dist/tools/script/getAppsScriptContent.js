import { z } from 'zod';
import { getScriptClient } from '../../clients.js';
import { scriptUrl, toUserError } from './appsScriptShared.js';
export function register(server) {
    server.addTool({
        name: 'getAppsScriptContent',
        description: 'Reads the files of an Apps Script project. Use it before updateAppsScriptContent to see what is already there, or to review code that is currently deployed.',
        parameters: z.strictObject({
            scriptId: z
                .string()
                .min(1)
                .describe('Script project ID - the long ID in the /projects/<scriptId>/ part of the Apps Script editor URL. This is not the spreadsheet ID.'),
            versionNumber: z
                .number()
                .int()
                .positive()
                .optional()
                .describe('Read a specific saved version instead of the current draft.'),
            includeSource: z
                .boolean()
                .default(true)
                .describe('Set to false to list file names and types without their content.'),
        }),
        execute: async (args, { log }) => {
            const script = await getScriptClient();
            log.info(`Reading Apps Script project ${args.scriptId}`);
            try {
                const response = await script.projects.getContent({
                    scriptId: args.scriptId,
                    ...(args.versionNumber ? { versionNumber: args.versionNumber } : {}),
                });
                const files = (response.data.files ?? []).map((file) => ({
                    name: file.name,
                    type: file.type,
                    ...(args.includeSource ? { source: file.source } : { lines: countLines(file.source) }),
                }));
                return JSON.stringify({
                    scriptId: args.scriptId,
                    url: scriptUrl(args.scriptId),
                    ...(args.versionNumber ? { versionNumber: args.versionNumber } : {}),
                    fileCount: files.length,
                    files,
                }, null, 2);
            }
            catch (error) {
                log.error(`Error reading Apps Script project: ${error.message || error}`);
                throw toUserError(error, 'reading the Apps Script project');
            }
        },
    });
}
function countLines(source) {
    if (!source)
        return 0;
    return source.split('\n').length;
}
