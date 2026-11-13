import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import { getTableById } from './structureHelpers.js';
import { TABLE_CONTENT_INDEXED_BODY_FIELDS, buildDocumentGetFields } from './tabFieldMasks.js';
export function register(server) {
    server.addTool({
        name: 'getTableStructure',
        description: 'Returns detailed structure for a table in a Google Document, including row/column counts and extracted cell text.',
        parameters: DocumentIdParameter.extend({
            tableId: z
                .string()
                .min(1)
                .describe('The MCP table ID returned by listDocumentTables, for example "table:body:0".'),
            tabId: z
                .string()
                .optional()
                .describe('The ID of the specific tab to inspect. If not specified, inspects the first tab or legacy document body.'),
        }),
        execute: async (args, { log }) => {
            const docs = await getDocsClient();
            log.info(`Getting table structure for ${args.tableId} in ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`);
            try {
                const res = await docs.documents.get({
                    documentId: args.documentId,
                    ...(args.tabId && { includeTabsContent: true }),
                    fields: buildDocumentGetFields(TABLE_CONTENT_INDEXED_BODY_FIELDS, args.tabId),
                });
                const table = getTableById(res.data, args.tableId, args.tabId);
                if (!table) {
                    throw new UserError(`Table "${args.tableId}" not found in document.`);
                }
                return JSON.stringify(table, null, 2);
            }
            catch (error) {
                log.error(`Error getting table structure for ${args.tableId} in doc ${args.documentId}: ${error.message || error}`);
                if (error instanceof UserError)
                    throw error;
                if (error.code === 404)
                    throw new UserError(`Document not found (ID: ${args.documentId}).`);
                if (error.code === 403)
                    throw new UserError(`Permission denied for document (ID: ${args.documentId}).`);
                throw new UserError(`Failed to get table structure: ${error.message || 'Unknown error'}`);
            }
        },
    });
}
