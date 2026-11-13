import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
const FindElementParameters = DocumentIdParameter.extend({
    textQuery: z
        .string()
        .min(1)
        .optional()
        .describe('Exact text to locate. Returns one result per occurrence with its document index range.'),
    elementType: z
        .enum(['paragraph', 'table', 'list', 'image'])
        .optional()
        .describe('List structural elements of this type. Only "paragraph" and "table" are supported; "list" and "image" are rejected.'),
});
export function register(server) {
    server.addTool({
        name: 'findElement',
        description: 'Locates elements in a Google Document. With textQuery, returns the document index range (startIndex/endIndex) of every non-overlapping occurrence of the text — use each as a range for deleteRange or the text-styling tools, or its startIndex as an insertText location. With elementType "paragraph" or "table", lists those elements with their ranges and a text preview. Limitations: searches the first tab only (on multi-tab documents, tabs 2+ are not searched); paragraph listing covers top-level body paragraphs only, not paragraphs inside table cells (textQuery does search inside cells, but only one level deep — text in a table nested inside a table cell is not searched). At least one of textQuery or elementType is required.',
        parameters: FindElementParameters,
        execute: async (args, { log }) => {
            const docs = await getDocsClient();
            log.info(`findElement in doc ${args.documentId}: textQuery=${args.textQuery ?? 'none'}, elementType=${args.elementType ?? 'none'}`);
            try {
                const found = await GDocsHelpers.findElements(docs, args.documentId, {
                    textQuery: args.textQuery,
                    elementType: args.elementType,
                });
                if (found.length === 0) {
                    return `No matching elements found (textQuery=${args.textQuery ?? 'none'}, elementType=${args.elementType ?? 'none'}).`;
                }
                return JSON.stringify({ count: found.length, elements: found }, null, 2);
            }
            catch (error) {
                log.error(`Error in findElement for doc ${args.documentId}: ${error.message || error}`);
                if (error instanceof UserError)
                    throw error;
                throw new UserError(`Failed to find elements: ${error.message || 'Unknown error'}`);
            }
        },
    });
}
