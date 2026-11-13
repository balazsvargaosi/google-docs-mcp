import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
export function register(server) {
    server.addTool({
        name: 'renameTab',
        description: 'Renames a tab in a Google Docs document. Use listDocumentTabs to get tab IDs first.',
        parameters: DocumentIdParameter.extend({
            tabId: z
                .string()
                .describe('The ID of the tab to rename. Use listDocumentTabs to get tab IDs.'),
            newTitle: z.string().min(1).describe('The new title for the tab.'),
        }),
        execute: async (args, { log }) => {
            const docs = await getDocsClient();
            log.info(`Renaming tab ${args.tabId} to "${args.newTitle}" in doc ${args.documentId}`);
            try {
                // Verify the tab exists
                const targetTab = await GDocsHelpers.getDocumentTab(docs, args.documentId, args.tabId);
                await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
                    {
                        updateDocumentTabProperties: {
                            tabProperties: {
                                tabId: args.tabId,
                                title: args.newTitle,
                            },
                            fields: 'title',
                        },
                    },
                ]);
                return `Successfully renamed tab "${args.tabId}" to "${args.newTitle}".`;
            }
            catch (error) {
                log.error(`Error renaming tab in doc ${args.documentId}: ${error.message || error}`);
                if (error instanceof UserError)
                    throw error;
                if (error.code === 404)
                    throw new UserError(`Document not found (ID: ${args.documentId}).`);
                if (error.code === 403)
                    throw new UserError(`Permission denied for document (ID: ${args.documentId}).`);
                throw new UserError(`Failed to rename tab: ${error.message || 'Unknown error'}`);
            }
        },
    });
}
