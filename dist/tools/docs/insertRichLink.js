import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
export function register(server) {
    server.addTool({
        name: 'insertRichLink',
        description: 'Inserts a Google Docs rich link smart chip at a specific paragraph location. Use for Google resource links such as Drive files or Calendar events.',
        parameters: DocumentIdParameter.extend({
            index: z
                .number()
                .int()
                .min(1)
                .describe('1-based character index within an existing paragraph where the rich link should be inserted.'),
            uri: z.string().url().describe('URI of the Google resource for the rich link smart chip.'),
            mimeType: z
                .string()
                .optional()
                .describe('Optional MIME type of the linked resource, if known.'),
            title: z
                .string()
                .optional()
                .describe('Optional title hint. Google Docs may still resolve and display the canonical resource title.'),
            tabId: z.string().optional().describe('Optional target tab ID.'),
        }),
        execute: async (args, { log }) => {
            const docs = await getDocsClient();
            log.info(`Inserting rich link into ${args.documentId} at index ${args.index}${args.tabId ? ` (tab: ${args.tabId})` : ''}`);
            try {
                if (args.tabId) {
                    const targetTab = await GDocsHelpers.getDocumentTab(docs, args.documentId, args.tabId);
                }
                const location = { index: args.index };
                if (args.tabId)
                    location.tabId = args.tabId;
                const request = {
                    insertRichLink: {
                        location: location,
                        richLinkProperties: {
                            uri: args.uri,
                            mimeType: args.mimeType,
                            title: args.title,
                        },
                    },
                };
                await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
                return `Successfully inserted a rich link at index ${args.index}${args.tabId ? ` in tab ${args.tabId}` : ''}.`;
            }
            catch (error) {
                log.error(`Error inserting rich link into doc ${args.documentId}: ${error.message || error}`);
                if (error instanceof UserError)
                    throw error;
                throw new UserError(`Failed to insert rich link: ${error.message || 'Unknown error'}`);
            }
        },
    });
}
