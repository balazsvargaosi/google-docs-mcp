import { UserError } from 'fastmcp';
import { z } from 'zod';
import { google } from 'googleapis';
import { getAuthClient, getSheetsClient } from '../../../clients.js';
const CreateSheetsCommentParameters = z
    .object({
    spreadsheetId: z
        .string()
        .describe('The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.'),
    content: z.string().min(1).describe('The text content of the comment.'),
    sheetName: z
        .string()
        .optional()
        .describe('Optional sheet/tab name for cell or range anchors that do not already include a sheet prefix.'),
    cell: z
        .string()
        .optional()
        .describe('Optional target cell in A1 notation (for example "B3" or "Sheet1!B3"). Used to quote the cell content and build a click-through link to that cell.'),
    range: z
        .string()
        .optional()
        .describe('Optional target range in A1 notation (for example "B3:D5" or "Sheet1!B3:D5"). The click-through link targets the full range.'),
    includeCellLink: z
        .boolean()
        .optional()
        .default(true)
        .describe('When a cell or range is given, appends a direct Google Sheets click-through URL (with gid and range) to the comment content so users can jump to the target cell/range. Defaults to true because the Drive API cannot natively anchor spreadsheet comments in the Sheets UI. Has no effect when no cell/range is provided.'),
})
    .refine((data) => !(data.cell && data.range), {
    message: 'Provide either cell or range, not both.',
    path: ['range'],
})
    .refine((data) => {
    if (!data.cell && !data.range) {
        return true;
    }
    if (data.sheetName) {
        return true;
    }
    return hasSheetPrefix(data.cell ?? data.range ?? '');
}, {
    message: 'sheetName is required when cell or range does not include a sheet prefix.',
    path: ['sheetName'],
});
export function register(server) {
    server.addTool({
        name: 'createSheetsComment',
        description: 'Creates a new comment in a Google Spreadsheet. When you target a specific cell or range, a click-through link to that location is added to the comment body by default (includeCellLink), letting users jump to the cell. Note: the Drive API cannot natively anchor spreadsheet comments to a cell in the Sheets UI, so the comment itself appears under "All comments" — the click-through link is the supported way to navigate to the target.',
        parameters: CreateSheetsCommentParameters,
        execute: async (args, { log }) => {
            log.info(`Creating spreadsheet comment in ${args.spreadsheetId}`);
            try {
                const authClient = await getAuthClient();
                const drive = google.drive({ version: 'v3', auth: authClient });
                const sheets = await getSheetsClient();
                let quotedText;
                let locationLabel;
                let cellUrl;
                if (args.cell || args.range) {
                    const parsedLocation = parseLocation(args.cell ?? args.range ?? '', args.sheetName);
                    const sheetId = await resolveSheetId(sheets, args.spreadsheetId, parsedLocation.sheetName);
                    quotedText = await readRangeText(sheets, args.spreadsheetId, `${quoteSheetName(parsedLocation.sheetName)}!${parsedLocation.a1Range}`);
                    locationLabel = `${parsedLocation.sheetName}!${parsedLocation.a1Range}`;
                    cellUrl = buildCellUrl(args.spreadsheetId, sheetId, parsedLocation.a1Range);
                }
                const content = args.includeCellLink && cellUrl
                    ? `${args.content}\n\n→ ${locationLabel}: ${cellUrl}`
                    : args.content;
                const response = await drive.comments.create({
                    fileId: args.spreadsheetId,
                    fields: 'id,quotedFileContent,createdTime',
                    requestBody: {
                        content,
                        ...(quotedText
                            ? {
                                quotedFileContent: {
                                    value: quotedText,
                                    mimeType: 'text/plain',
                                },
                            }
                            : {}),
                    },
                });
                const linkNote = args.includeCellLink && cellUrl
                    ? ` A click-through link to ${locationLabel} was added to the comment body so users can jump to the target cell.`
                    : locationLabel
                        ? ` Target location: ${locationLabel}.`
                        : '';
                return (`Comment added successfully. Comment ID: ${response.data.id}.` +
                    linkNote +
                    ' Note: the Drive API cannot natively anchor spreadsheet comments to a cell in the Sheets UI; use the click-through link to navigate to the location.');
            }
            catch (error) {
                log.error(`Error creating sheets comment: ${error.message || error}`);
                const errorDetails = error.response?.data?.error?.message || error.message || 'Unknown error';
                throw new UserError(`Failed to create spreadsheet comment: ${errorDetails}`);
            }
        },
    });
}
function buildCellUrl(spreadsheetId, sheetId, a1Range) {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}&range=${encodeURIComponent(a1Range)}`;
}
function hasSheetPrefix(value) {
    return value.includes('!');
}
function parseLocation(value, fallbackSheetName) {
    const bangIndex = value.lastIndexOf('!');
    const rawSheetName = bangIndex >= 0 ? unquoteSheetName(value.slice(0, bangIndex)) : fallbackSheetName;
    const a1Range = bangIndex >= 0 ? value.slice(bangIndex + 1) : value;
    if (!rawSheetName) {
        throw new UserError('Could not determine the target sheet name for the spreadsheet comment.');
    }
    // Validate the start cell is a well-formed A1 reference (fail early on bad input).
    const startCell = a1Range.split(':')[0];
    validateA1Cell(startCell);
    return {
        sheetName: rawSheetName,
        a1Range,
    };
}
function validateA1Cell(a1) {
    const match = a1.trim().match(/^([A-Za-z]+)(\d+)$/);
    if (!match) {
        throw new UserError(`Invalid A1 cell reference: ${a1}`);
    }
}
function unquoteSheetName(sheetName) {
    const trimmed = sheetName.trim();
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1).replace(/''/g, "'");
    }
    return trimmed;
}
function quoteSheetName(sheetName) {
    return `'${sheetName.replace(/'/g, "''")}'`;
}
async function resolveSheetId(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)',
    });
    for (const sheet of response.data.sheets || []) {
        const props = sheet.properties;
        if (props?.title === sheetName && props.sheetId != null) {
            return props.sheetId;
        }
    }
    throw new UserError(`Sheet "${sheetName}" was not found in spreadsheet ${spreadsheetId}.`);
}
async function readRangeText(sheets, spreadsheetId, range) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: 'FORMATTED_VALUE',
    });
    const values = response.data.values || [];
    if (values.length === 0) {
        return undefined;
    }
    const lines = values
        .map((row) => row
        .map((cell) => String(cell))
        .join('\t')
        .trimEnd())
        .filter((line) => line.length > 0);
    return lines.length > 0 ? lines.join('\n') : undefined;
}
