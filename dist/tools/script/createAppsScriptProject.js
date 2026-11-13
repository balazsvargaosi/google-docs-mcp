import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getScriptClient } from '../../clients.js';
import { AppsScriptFileSchema, ensureManifest, scriptUrl, toApiFiles, toUserError, } from './appsScriptShared.js';
export function register(server) {
    server.addTool({
        name: 'createAppsScriptProject',
        description: 'Creates an Apps Script project, optionally bound to a Doc, Sheet, Slides or Form so its triggers and custom menus run inside that file. Optionally writes the initial files in the same call. Requires the Apps Script API to be enabled at https://script.google.com/home/usersettings.',
        parameters: z.strictObject({
            title: z.string().min(1).describe('Title of the new script project.'),
            parentId: z
                .string()
                .optional()
                .describe('File ID of the Doc, Sheet, Slides or Form to bind the project to (a container-bound script). Omit to create a standalone project in Drive.'),
            files: z
                .array(AppsScriptFileSchema)
                .optional()
                .describe('Initial files to write after the project is created. A manifest is added automatically when the list has none.'),
        }),
        execute: async (args, { log }) => {
            const script = await getScriptClient();
            log.info(`Creating Apps Script project "${args.title}"${args.parentId ? ` bound to ${args.parentId}` : ' (standalone)'}`);
            let scriptId;
            try {
                const created = await script.projects.create({
                    requestBody: {
                        title: args.title,
                        ...(args.parentId ? { parentId: args.parentId } : {}),
                    },
                });
                if (!created.data.scriptId) {
                    throw new UserError('Project was created but the API returned no scriptId.');
                }
                scriptId = created.data.scriptId;
            }
            catch (error) {
                if (error instanceof UserError)
                    throw error;
                log.error(`Error creating Apps Script project: ${error.message || error}`);
                throw toUserError(error, 'creating the Apps Script project');
            }
            let filesWritten;
            if (args.files && args.files.length > 0) {
                try {
                    // A freshly created project already carries a default manifest; keep it
                    // unless the caller supplied one of their own.
                    const current = await script.projects.getContent({ scriptId });
                    const existing = current.data.files ?? [];
                    const payload = ensureManifest(toApiFiles(args.files), existing);
                    await script.projects.updateContent({
                        scriptId,
                        requestBody: { files: payload },
                    });
                    filesWritten = payload.length;
                }
                catch (error) {
                    log.warn(`Project created but writing files failed: ${error.message || error}`);
                    return JSON.stringify({
                        scriptId,
                        url: scriptUrl(scriptId),
                        filesWritten: 0,
                        warning: `Project created, but writing the initial files failed: ${error.message || error}. Retry with updateAppsScriptContent.`,
                    }, null, 2);
                }
            }
            return JSON.stringify({
                scriptId,
                url: scriptUrl(scriptId),
                bound: Boolean(args.parentId),
                ...(filesWritten !== undefined ? { filesWritten } : {}),
            }, null, 2);
        },
    });
}
