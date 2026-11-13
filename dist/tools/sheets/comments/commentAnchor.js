/**
 * Shared helpers for resolving the cell location of a spreadsheet comment.
 *
 * A comment can carry its location in two ways:
 *  1. A real Drive `anchor` field (present on native/human-created comments).
 *  2. A click-through deep link in the comment body, of the form
 *     `#gid=<sheetId>&range=<A1>`, which is what `createSheetsComment` writes
 *     for API-created comments (the Drive API cannot natively anchor
 *     spreadsheet comments — see createSheetsComment.ts).
 *
 * Location-based filtering must understand both, otherwise comments created by
 * this server are invisible to cell/row/range filters.
 */
/**
 * Resolves a comment's cell location, preferring a real Drive anchor and
 * falling back to the deep link embedded in the comment body. Returns null when
 * neither source yields a location.
 */
export function extractCommentLocation(comment) {
    const fromAnchor = comment.anchor ? parseSheetsAnchor(comment.anchor) : null;
    if (fromAnchor)
        return fromAnchor;
    return comment.content ? parseDeepLink(comment.content) : null;
}
/**
 * Parses a Drive Sheets anchor JSON string into a cell location.
 * Anchor shape: `{ a: [{ sht: { sid, rng: { r, c } } }] }`.
 */
export function parseSheetsAnchor(anchorStr) {
    try {
        const anchor = JSON.parse(anchorStr);
        const actions = anchor.a;
        if (!actions || !Array.isArray(actions))
            return null;
        for (const action of actions) {
            if (action.sht) {
                const sid = action.sht.sid;
                const rng = action.sht.rng;
                if (sid !== undefined && rng) {
                    return { sheetId: sid, row: rng.r || 0, col: rng.c || 0 };
                }
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Parses a Sheets click-through deep link of the form
 * `#gid=<sheetId>&range=<A1>` out of free text. When the range spans multiple
 * cells, the top-left cell is used (matching the single-cell filter logic).
 */
function parseDeepLink(content) {
    const match = content.match(/#gid=(\d+)&range=([^&\s)]+)/);
    if (!match)
        return null;
    const sheetId = Number(match[1]);
    const decoded = decodeURIComponent(match[2]);
    // Strip an optional "Sheet!" prefix, then take the top-left cell of any range.
    const a1Range = decoded.includes('!') ? decoded.slice(decoded.lastIndexOf('!') + 1) : decoded;
    const topLeft = a1Range.split(':')[0];
    const cell = a1ToRowCol(topLeft);
    if (!cell)
        return null;
    return { sheetId, row: cell.row, col: cell.col };
}
/**
 * Converts an A1 cell reference (e.g. "B3") to zero-based row/col indices.
 * Returns null for malformed input.
 */
export function a1ToRowCol(a1) {
    const match = a1.trim().match(/^([A-Za-z]+)(\d+)$/);
    if (!match)
        return null;
    const colStr = match[1].toUpperCase();
    let col = 0;
    for (let i = 0; i < colStr.length; i++) {
        col = col * 26 + (colStr.charCodeAt(i) - 64);
    }
    return { row: parseInt(match[2], 10) - 1, col: col - 1 };
}
/**
 * Converts zero-based row/col indices back to an A1 cell reference.
 */
export function rowColToA1(row, col) {
    let colStr = '';
    let c = col;
    do {
        colStr = String.fromCharCode(65 + (c % 26)) + colStr;
        c = Math.floor(c / 26) - 1;
    } while (c >= 0);
    return `${colStr}${row + 1}`;
}
