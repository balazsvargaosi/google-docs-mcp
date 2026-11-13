import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
export function register(server) {
    server.addTool({
        name: 'insertPerson',
        description: 'Inserts a Google Docs person smart chip at a specific paragraph location using an email address.',
        parameters: DocumentIdParameter.extend({
            index: z
                .number()
                .int()
                .min(1)
                .describe('1-based character index within an existing paragraph where the person chip should be inserted.'),
            email: z.string().email().describe('Email address linked to the person smart chip.'),
            name: z
                .string()
                .optional()
                .describe('Optional display name hint when Google Docs resolves the person mention.'),
            tabId: z.string().optional().describe('Optional target tab ID.'),
        }),
        execute: async (args, { log }) => {
            const docs = await getDocsClient();
            log.info(`Inserting person chip into ${args.documentId} at index ${args.index}${args.tabId ? ` (tab: ${args.tabId})` : ''}`);
            try {
                if (args.tabId) {
                    const targetTab = await GDocsHelpers.getDocumentTab(docs, args.documentId, args.tabId);
                }
                const location = { index: args.index };
                if (args.tabId)
                    location.tabId = args.tabId;
                const request = {
                    insertPerson: {
                        location: location,
                        personProperties: {
                            email: args.email,
                            name: args.name,
                        },
                    },
                };
                await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
                return `Successfully inserted a person chip at index ${args.index}${args.tabId ? ` in tab ${args.tabId}` : ''}.`;
            }
            catch (error) {
                log.error(`Error inserting person chip into doc ${args.documentId}: ${error.message || error}`);
                if (error instanceof UserError)
                    throw error;
                throw new UserError(`Failed to insert person chip: ${error.message || 'Unknown error'}`);
            }
        },
    });
}
