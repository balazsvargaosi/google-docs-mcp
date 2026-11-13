import { UserError } from 'fastmcp';
import { z } from 'zod';
import { google } from 'googleapis';
import { getAuthClient, getSheetsClient } from '../../../clients.js';
import { extractCommentLocation, a1ToRowCol, rowColToA1 } from './commentAnchor.js';
export function register(server) {
    server.addTool({
        name: 'listSheetsComments',
        description: 'Lists all comments in a Google Spreadsheet. Filter by sheet name, specific row(s), specific cell, or a cell range. Returns comment IDs needed for getSheetsComment, replyToSheetsComment, resolveSheetsComment, or deleteSheetsComment.',
        parameters: z.strictObject({
            spreadsheetId: z
                .string()
                .describe('The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.'),
            sheetName: z
                .string()
                .optional()
                .describe('Optional: filter comments to only this sheet/tab name.'),
            row: z
                .number()
                .int()
                .min(1)
                .optional()
                .describe('Optional: filter to comments on this specific row number (1-based, e.g., 5 for row 5).'),
            rows: z
                .array(z.number().int().min(1))
                .optional()
                .describe('Optional: filter to comments on any of these row numbers (1-based, e.g., [3, 5, 12]). Ignored if "row" is set.'),
            cell: z
                .string()
                .optional()
                .describe('Optional: filter to comments on this specific cell in A1 notation (e.g., "B3"). Overrides row/rows filters.'),
            range: z
                .string()
                .optional()
                .describe('Optional: filter to comments within this A1 range (e.g., "A1:D10", "B:B" for entire column B). Overrides row/rows/cell filters.'),
            includeResolved: z
                .boolean()
                .optional()
                .default(false)
                .describe('If true, include resolved comments. Defaults to false.'),
        }),
        execute: async (args, { log }) => {
            log.info(`Listing comments for spreadsheet ${args.spreadsheetId}`);
            try {
                const authClient = await getAuthClient();
                const drive = google.drive({ version: 'v3', auth: authClient });
                const comments = [];
                let pageToken;
                do {
                    const response = await drive.comments.list({
                        fileId: args.spreadsheetId,
                        fields: 'comments(id,content,anchor,quotedFileContent,author,createdTime,modifiedTime,resolved,replies(id,content,author,createdTime)),nextPageToken',
                        pageSize: 100,
                        ...(pageToken ? { pageToken } : {}),
                    });
                    comments.push(...(response.data.comments || []));
                    pageToken = response.data.nextPageToken || undefined;
                } while (pageToken);
                let sheetGidMap = {};
                const needSheetMeta = args.sheetName || args.row || args.rows || args.cell || args.range;
                if (needSheetMeta) {
                    const sheetsClient = await getSheetsClient();
                    const meta = await sheetsClient.spreadsheets.get({
                        spreadsheetId: args.spreadsheetId,
                        fields: 'sheets.properties',
                    });
                    for (const sheet of meta.data.sheets || []) {
                        const props = sheet.properties;
                        if (props?.sheetId !== undefined && props?.title) {
                            sheetGidMap[String(props.sheetId)] = props.title;
                        }
                    }
                }
                const rangeFilter = args.range ? parseA1Range(args.range) : null;
                const cellFilter = args.cell ? a1ToRowCol(args.cell) : null;
                const rowSet = args.row
                    ? new Set([args.row - 1])
                    : args.rows
                        ? new Set(args.rows.map((r) => r - 1))
                        : null;
                const result = comments
                    .filter((c) => {
                    if (!args.includeResolved && c.resolved)
                        return false;
                    const cellInfo = extractCommentLocation(c);
                    if (args.sheetName && cellInfo) {
                        const resolvedName = sheetGidMap[String(cellInfo.sheetId)];
                        if (resolvedName && resolvedName !== args.sheetName)
                            return false;
                    }
                    if (!cellInfo)
                        return !rangeFilter && !cellFilter && !rowSet;
                    if (rangeFilter) {
                        return (cellInfo.row >= rangeFilter.startRow &&
                            cellInfo.row <= rangeFilter.endRow &&
                            cellInfo.col >= rangeFilter.startCol &&
                            cellInfo.col <= rangeFilter.endCol);
                    }
                    if (cellFilter) {
                        return cellInfo.row === cellFilter.row && cellInfo.col === cellFilter.col;
                    }
                    // Guard: a malformed cell arg yields a null cellFilter; fall through
                    // means no cell constraint applied, which matches prior behavior.
                    if (rowSet) {
                        return rowSet.has(cellInfo.row);
                    }
                    return true;
                })
                    .map((comment) => {
                    const cellInfo = extractCommentLocation(comment);
                    let cellRef = null;
                    let sheetTitle = null;
                    if (cellInfo) {
                        cellRef = rowColToA1(cellInfo.row, cellInfo.col);
                        if (Object.keys(sheetGidMap).length > 0) {
                            sheetTitle = sheetGidMap[String(cellInfo.sheetId)] || null;
                        }
                    }
                    return {
                        id: comment.id,
                        author: comment.author?.displayName || null,
                        content: comment.content,
                        cell: cellRef,
                        sheetName: sheetTitle,
                        quotedText: comment.quotedFileContent?.value || null,
                        resolved: comment.resolved || false,
                        createdTime: comment.createdTime,
                        modifiedTime: comment.modifiedTime,
                        replyCount: comment.replies?.length || 0,
                    };
                });
                return JSON.stringify({ comments: result, total: result.length }, null, 2);
            }
            catch (error) {
                log.error(`Error listing sheets comments: ${error.message || error}`);
                throw new UserError(`Failed to list spreadsheet comments: ${error.message || 'Unknown error'}`);
            }
        },
    });
}
function parseA1Range(range) {
    const stripped = range.includes('!') ? range.split('!')[1] : range;
    const parts = stripped.split(':');
    const colOnly = /^[A-Za-z]+$/;
    const rowOnly = /^\d+$/;
    const parseCorner = (s) => {
        if (colOnly.test(s)) {
            const upper = s.toUpperCase();
            let c = 0;
            for (let i = 0; i < upper.length; i++)
                c = c * 26 + (upper.charCodeAt(i) - 64);
            return { row: null, col: c - 1 };
        }
        if (rowOnly.test(s)) {
            return { row: parseInt(s, 10) - 1, col: null };
        }
        const rc = a1ToRowCol(s);
        return rc ? { row: rc.row, col: rc.col } : { row: null, col: null };
    };
    if (parts.length === 1) {
        const p = parseCorner(parts[0]);
        return {
            startRow: p.row ?? 0,
            endRow: p.row ?? 999999,
            startCol: p.col ?? 0,
            endCol: p.col ?? 999999,
        };
    }
    const start = parseCorner(parts[0]);
    const end = parseCorner(parts[1]);
    return {
        startRow: start.row ?? 0,
        endRow: end.row ?? 999999,
        startCol: start.col ?? 0,
        endCol: end.col ?? 999999,
    };
}
