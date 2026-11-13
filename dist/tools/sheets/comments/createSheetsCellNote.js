import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getSheetsClient } from '../../../clients.js';
import * as SheetsHelpers from '../../../googleSheetsApiHelpers.js';
export function register(server) {
    server.addTool({
        name: 'createSheetsCellNote',
        description: 'Creates or replaces a native Google Sheets cell note on a cell or range. Use this when the review text must be attached to a specific cell in the Sheets UI. This is a cell note, not a threaded Drive comment.',
        parameters: z.object({
            spreadsheetId: z
                .string()
                .describe('The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.'),
            range: z
                .string()
                .describe('A1 notation cell or range to attach the note to, e.g. "Sheet1!F94" or "F94".'),
            content: z.string().min(1).describe('The note content to attach to the target cell/range.'),
        }),
        execute: async (args, { log }) => {
            const sheets = await getSheetsClient();
            log.info(`Creating native cell note on ${args.range} in ${args.spreadsheetId}`);
            try {
                await SheetsHelpers.setCellNote(sheets, args.spreadsheetId, args.range, args.content);
                return `Cell note added successfully to range "${args.range}".`;
            }
            catch (error) {
                log.error(`Error creating sheets cell note: ${error.message || error}`);
                if (error instanceof UserError)
                    throw error;
                throw new UserError(`Failed to create cell note: ${error.message || 'Unknown error'}`);
            }
        },
    });
}
