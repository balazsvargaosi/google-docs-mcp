import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import { extractDocumentTables } from './structureHelpers.js';
import { TABLE_CONTENT_BASIC_BODY_FIELDS, buildDocumentGetFields } from './tabFieldMasks.js';
export function register(server) {
    server.addTool({
        name: 'listDocumentTables',
        description: 'Lists tables in a Google Document with stable MCP table IDs, ranges, and dimensions. Use this before table-specific editing tools.',
        parameters: DocumentIdParameter.extend({
            tabId: z
                .string()
                .optional()
                .describe('The ID of the specific tab to inspect. If not specified, inspects the first tab or legacy document body.'),
        }),
        execute: async (args, { log }) => {
            const docs = await getDocsClient();
            log.info(`Listing document tables for ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`);
            try {
                const res = await docs.documents.get({
                    documentId: args.documentId,
                    ...(args.tabId && { includeTabsContent: true }),
                    fields: buildDocumentGetFields(TABLE_CONTENT_BASIC_BODY_FIELDS, args.tabId),
                });
                const tables = extractDocumentTables(res.data, args.tabId).map((table) => ({
                    tableId: table.tableId,
                    startIndex: table.startIndex,
                    endIndex: table.endIndex,
                    rowCount: table.rowCount,
                    columnCount: table.columnCount,
                }));
                return JSON.stringify({ tables }, null, 2);
            }
            catch (error) {
                log.error(`Error listing tables for doc ${args.documentId}: ${error.message || error}`);
                if (error instanceof UserError)
                    throw error;
                if (error.code === 404)
                    throw new UserError(`Document not found (ID: ${args.documentId}).`);
                if (error.code === 403)
                    throw new UserError(`Permission denied for document (ID: ${args.documentId}).`);
                throw new UserError(`Failed to list document tables: ${error.message || 'Unknown error'}`);
            }
        },
    });
}
