import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import { findHeadings } from './structureHelpers.js';
import { HEADING_BODY_FIELDS, buildDocumentGetFields } from './tabFieldMasks.js';
export function register(server) {
    server.addTool({
        name: 'findSectionsByHeading',
        description: 'Finds heading-based sections in a Google Document and reports heading ranges plus the first table that follows each heading.',
        parameters: DocumentIdParameter.extend({
            headings: z
                .array(z.string().min(1))
                .min(1)
                .max(50)
                .describe('List of exact heading texts to locate in the document.'),
            tabId: z
                .string()
                .optional()
                .describe('The ID of the specific tab to inspect. If not specified, inspects the first tab or legacy document body.'),
        }),
        execute: async (args, { log }) => {
            const docs = await getDocsClient();
            log.info(`Finding sections by heading in ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}: ${args.headings.join(', ')}`);
            try {
                const res = await docs.documents.get({
                    documentId: args.documentId,
                    ...(args.tabId && { includeTabsContent: true }),
                    fields: buildDocumentGetFields(HEADING_BODY_FIELDS, args.tabId),
                });
                const sections = findHeadings(res.data, args.headings, args.tabId);
                return JSON.stringify({ sections }, null, 2);
            }
            catch (error) {
                log.error(`Error finding sections by heading in doc ${args.documentId}: ${error.message || error}`);
                if (error instanceof UserError)
                    throw error;
                if (error.code === 404)
                    throw new UserError(`Document not found (ID: ${args.documentId}).`);
                if (error.code === 403)
                    throw new UserError(`Permission denied for document (ID: ${args.documentId}).`);
                throw new UserError(`Failed to find sections by heading: ${error.message || 'Unknown error'}`);
            }
        },
    });
}
