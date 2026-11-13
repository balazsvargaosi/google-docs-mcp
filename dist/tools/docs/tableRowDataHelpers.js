import { UserError } from 'fastmcp';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
export function buildReplaceTableCellContentRequests(cell, nextValue, tabId) {
    const requests = [];
    const insertionIndex = cell.contentStartIndex ?? cell.startIndex;
    if (insertionIndex == null) {
        throw new UserError(`Cell [row=${cell.rowIndex}, col=${cell.columnIndex}] does not have a writable insertion index.`);
    }
    if (cell.text &&
        cell.contentStartIndex !== null &&
        cell.contentEndIndex !== null &&
        cell.contentEndIndex - 1 > cell.contentStartIndex) {
        const range = {
            startIndex: cell.contentStartIndex,
            endIndex: cell.contentEndIndex - 1,
        };
        if (tabId)
            range.tabId = tabId;
        requests.push({
            deleteContentRange: { range: range },
        });
    }
    if (nextValue) {
        const location = { index: insertionIndex };
        if (tabId)
            location.tabId = tabId;
        requests.push({
            insertText: {
                location: location,
                text: nextValue,
            },
        });
    }
    return requests;
}
export function buildReplaceTableRowRequests(table, rowIndex, values, tabId) {
    if (rowIndex < 0 || rowIndex >= table.rowCount) {
        throw new UserError(`Row index ${rowIndex} is out of bounds for table ${table.tableId} with ${table.rowCount} rows.`);
    }
    if (values.length > table.columnCount) {
        throw new UserError(`Received ${values.length} values for table ${table.tableId}, but the table only has ${table.columnCount} columns.`);
    }
    return table.cells
        .filter((cell) => cell.rowIndex === rowIndex)
        .sort((a, b) => b.columnIndex - a.columnIndex)
        .flatMap((cell) => buildReplaceTableCellContentRequests(cell, values[cell.columnIndex] ?? '', tabId));
}
export async function replaceTableRowData(docs, documentId, table, rowIndex, values, tabId) {
    const requests = buildReplaceTableRowRequests(table, rowIndex, values, tabId);
    if (requests.length === 0)
        return;
    await GDocsHelpers.executeBatchUpdate(docs, documentId, requests);
}
