import { z } from 'zod';
import { getScriptClient } from '../../clients.js';
import { AppsScriptFileSchema, ensureManifest, mergeFiles, scriptUrl, toApiFiles, toUserError, } from './appsScriptShared.js';
export function register(server) {
    server.addTool({
        name: 'updateAppsScriptContent',
        description: 'Writes files into an existing Apps Script project. Default mode "merge" replaces same-named files and keeps the rest; mode "replace" makes the project contain exactly the files passed in. The manifest is preserved automatically.',
        parameters: z.strictObject({
            scriptId: z
                .string()
                .min(1)
                .describe('Script project ID - the long ID in the /projects/<scriptId>/ part of the Apps Script editor URL.'),
            files: z
                .array(AppsScriptFileSchema)
                .min(1)
                .describe('Files to write. Each one replaces the file of the same name.'),
            mode: z
                .enum(['merge', 'replace'])
                .default('merge')
                .describe('merge: keep files that are not in this call (default, safe). replace: delete every file not listed here.'),
        }),
        execute: async (args, { log }) => {
            const script = await getScriptClient();
            log.info(`Updating Apps Script project ${args.scriptId} (${args.mode}, ${args.files.length} file(s))`);
            try {
                const current = await script.projects.getContent({ scriptId: args.scriptId });
                const existing = current.data.files ?? [];
                const incoming = toApiFiles(args.files);
                const combined = args.mode === 'merge' ? mergeFiles(existing, incoming) : incoming;
                const payload = ensureManifest(combined, existing);
                const response = await script.projects.updateContent({
                    scriptId: args.scriptId,
                    requestBody: { files: payload },
                });
                const written = response.data.files ?? payload;
                const removed = args.mode === 'replace'
                    ? existing
                        .map((file) => file.name)
                        .filter((name) => name && !payload.some((file) => file.name === name))
                    : [];
                return JSON.stringify({
                    scriptId: args.scriptId,
                    url: scriptUrl(args.scriptId),
                    mode: args.mode,
                    filesInProject: written.length,
                    updated: incoming.map((file) => file.name),
                    ...(removed.length > 0 ? { removed } : {}),
                }, null, 2);
            }
            catch (error) {
                log.error(`Error updating Apps Script project: ${error.message || error}`);
                throw toUserError(error, 'updating the Apps Script project');
            }
        },
    });
}
