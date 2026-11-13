import { UserError } from 'fastmcp';
import { z } from 'zod';
import { google } from 'googleapis';
import { getAuthClient } from '../../../clients.js';
import { extractCommentLocation, rowColToA1 } from './commentAnchor.js';
export function register(server) {
    server.addTool({
        name: 'getSheetsComment',
        description: 'Gets a specific comment and its full reply thread from a Google Spreadsheet. Use listSheetsComments first to find the comment ID.',
        parameters: z.strictObject({
            spreadsheetId: z
                .string()
                .describe('The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.'),
            commentId: z.string().describe('The ID of the comment to retrieve.'),
        }),
        execute: async (args, { log }) => {
            log.info(`Getting comment ${args.commentId} from spreadsheet ${args.spreadsheetId}`);
            try {
                const authClient = await getAuthClient();
                const drive = google.drive({ version: 'v3', auth: authClient });
                const response = await drive.comments.get({
                    fileId: args.spreadsheetId,
                    commentId: args.commentId,
                    fields: 'id,content,anchor,quotedFileContent,author,createdTime,modifiedTime,resolved,replies(id,content,author,createdTime)',
                });
                const comment = response.data;
                const cellInfo = extractCommentLocation(comment);
                return JSON.stringify({
                    id: comment.id,
                    author: comment.author?.displayName || null,
                    content: comment.content,
                    cell: cellInfo ? rowColToA1(cellInfo.row, cellInfo.col) : null,
                    quotedText: comment.quotedFileContent?.value || null,
                    resolved: comment.resolved || false,
                    createdTime: comment.createdTime,
                    modifiedTime: comment.modifiedTime,
                    replies: (comment.replies || []).map((r) => ({
                        id: r.id,
                        author: r.author?.displayName || null,
                        content: r.content,
                        createdTime: r.createdTime,
                    })),
                }, null, 2);
            }
            catch (error) {
                log.error(`Error getting sheets comment: ${error.message || error}`);
                throw new UserError(`Failed to get comment: ${error.message || 'Unknown error'}`);
            }
        },
    });
}
