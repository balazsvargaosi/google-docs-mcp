import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import { extractSmartChips } from './smartChipHelpers.js';
import { SMART_CHIP_BODY_FIELDS, buildDocumentGetFields } from './tabFieldMasks.js';
export function register(server) {
    server.addTool({
        name: 'listSmartChips',
        description: 'Lists smart chips in a Google Document, including date elements, person mentions, and rich links.',
        parameters: DocumentIdParameter.extend({
            tabId: z
                .string()
                .optional()
                .describe('The ID of the specific tab to inspect. If not specified, inspects the first tab or legacy document body.'),
        }),
        execute: async (args, { log }) => {
            const docs = await getDocsClient();
            log.info(`Listing smart chips for ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`);
            try {
                const res = await docs.documents.get({
                    documentId: args.documentId,
                    ...(args.tabId && { includeTabsContent: true }),
                    fields: buildDocumentGetFields(SMART_CHIP_BODY_FIELDS, args.tabId),
                });
                const chips = extractSmartChips(res.data, args.tabId);
                return JSON.stringify({ smartChips: chips }, null, 2);
            }
            catch (error) {
                log.error(`Error listing smart chips for doc ${args.documentId}: ${error.message || error}`);
                if (error instanceof UserError)
                    throw error;
                if (error.code === 404)
                    throw new UserError(`Document not found (ID: ${args.documentId}).`);
                if (error.code === 403)
                    throw new UserError(`Permission denied for document (ID: ${args.documentId}).`);
                throw new UserError(`Failed to list smart chips: ${error.message || 'Unknown error'}`);
            }
        },
    });
}
