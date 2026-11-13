import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
function getContentSource(doc, tabId) {
    if (tabId) {
        const targetTab = GDocsHelpers.findTabById(doc, tabId);
        if (!targetTab?.documentTab?.body?.content) {
            return [];
        }
        return targetTab.documentTab.body.content;
    }
    if (doc.body?.content) {
        return doc.body.content;
    }
    if (doc.tabs?.[0]?.documentTab?.body?.content) {
        return doc.tabs[0].documentTab.body.content;
    }
    return [];
}
function extractParagraphText(paragraph) {
    return (paragraph?.elements
        ?.map((element) => element.textRun?.content ?? '')
        .join('')
        .replace(/\n+$/g, '') ?? '');
}
function extractCellText(content = []) {
    const parts = [];
    for (const element of content) {
        if (element.paragraph) {
            const text = extractParagraphText(element.paragraph);
            if (text)
                parts.push(text);
        }
        if (element.table?.tableRows) {
            for (const row of element.table.tableRows) {
                for (const cell of row.tableCells ?? []) {
                    const text = extractCellText(cell.content ?? []);
                    if (text)
                        parts.push(text);
                }
            }
        }
    }
    return parts.join('\n').trim();
}
function extractCellContentRange(content = []) {
    let minStart = null;
    let maxEnd = null;
    const visitContent = (elements) => {
        for (const element of elements) {
            for (const paragraphElement of element.paragraph?.elements ?? []) {
                const startIndex = paragraphElement.startIndex;
                if (typeof startIndex === 'number') {
                    minStart = minStart === null ? startIndex : Math.min(minStart, startIndex);
                }
                const endIndex = paragraphElement.endIndex;
                if (typeof endIndex === 'number') {
                    maxEnd = maxEnd === null ? endIndex : Math.max(maxEnd, endIndex);
                }
            }
            if (element.table?.tableRows) {
                for (const row of element.table.tableRows) {
                    for (const cell of row.tableCells ?? []) {
                        visitContent(cell.content ?? []);
                    }
                }
            }
        }
    };
    visitContent(content);
    return {
        contentStartIndex: minStart,
        contentEndIndex: maxEnd,
    };
}
function dimensionToPt(dimension) {
    if (!dimension?.magnitude || dimension.unit !== 'PT')
        return undefined;
    return dimension.magnitude;
}
function normalizeCellStyle(rowIndex, columnIndex, cell) {
    const style = cell.tableCellStyle;
    const firstParagraphHasBoldText = (cell.content ?? []).some((element) => (element.paragraph?.elements ?? []).some((paragraphElement) => paragraphElement.textRun?.textStyle?.bold));
    if (!style && !firstParagraphHasBoldText)
        return null;
    const contentAlignment = style?.contentAlignment === 'TOP' ||
        style?.contentAlignment === 'MIDDLE' ||
        style?.contentAlignment === 'BOTTOM' ||
        style?.contentAlignment === 'CONTENT_ALIGNMENT_UNSPECIFIED'
        ? style.contentAlignment
        : null;
    return {
        rowIndex,
        columnIndex,
        backgroundColor: style?.backgroundColor?.color?.rgbColor ?? undefined,
        contentAlignment,
        paddingTopPt: dimensionToPt(style?.paddingTop),
        paddingBottomPt: dimensionToPt(style?.paddingBottom),
        paddingLeftPt: dimensionToPt(style?.paddingLeft),
        paddingRightPt: dimensionToPt(style?.paddingRight),
        borderTop: style?.borderTop ?? undefined,
        borderBottom: style?.borderBottom ?? undefined,
        borderLeft: style?.borderLeft ?? undefined,
        borderRight: style?.borderRight ?? undefined,
        hasBoldText: firstParagraphHasBoldText || undefined,
    };
}
export function extractDocumentTables(doc, tabId) {
    const content = getContentSource(doc, tabId);
    const tables = [];
    const tabKey = tabId ?? 'body';
    for (const element of content) {
        if (!element.table?.tableRows)
            continue;
        const ordinal = tables.length;
        const cells = [];
        let columnCount = 0;
        element.table.tableRows.forEach((row, rowIndex) => {
            const rowCells = row.tableCells ?? [];
            columnCount = Math.max(columnCount, rowCells.length);
            rowCells.forEach((cell, columnIndex) => {
                const { contentStartIndex, contentEndIndex } = extractCellContentRange(cell.content ?? []);
                cells.push({
                    rowIndex,
                    columnIndex,
                    startIndex: cell.startIndex ?? null,
                    endIndex: cell.endIndex ?? null,
                    contentStartIndex,
                    contentEndIndex,
                    text: extractCellText(cell.content ?? []),
                });
            });
        });
        tables.push({
            tableId: `table:${tabKey}:${ordinal}`,
            ordinal,
            startIndex: element.startIndex ?? null,
            endIndex: element.endIndex ?? null,
            rowCount: element.table.tableRows.length,
            columnCount,
            cells,
        });
    }
    return tables;
}
export function getTableById(doc, tableId, tabId) {
    return extractDocumentTables(doc, tabId).find((table) => table.tableId === tableId) ?? null;
}
export function findTableNearestStartIndex(doc, insertionIndex, tabId) {
    const tables = extractDocumentTables(doc, tabId).filter((table) => typeof table.startIndex === 'number' && table.startIndex >= insertionIndex);
    if (tables.length === 0)
        return null;
    return tables.sort((a, b) => a.startIndex - b.startIndex)[0] ?? null;
}
export function extractTableSnapshot(doc, tableId, tabId) {
    const content = getContentSource(doc, tabId);
    const tabKey = tabId ?? 'body';
    let ordinal = 0;
    for (const element of content) {
        if (!element.table?.tableRows)
            continue;
        const currentTableId = `table:${tabKey}:${ordinal}`;
        ordinal++;
        if (currentTableId !== tableId)
            continue;
        const data = [];
        const rowStyles = [];
        const cellStyles = [];
        let pinnedHeaderRowsCount = 0;
        element.table.tableRows.forEach((row, rowIndex) => {
            const rowData = [];
            const rowStyle = row.tableRowStyle;
            if (rowStyle) {
                rowStyles.push({
                    rowIndex,
                    minRowHeightPt: dimensionToPt(rowStyle.minRowHeight),
                    preventOverflow: rowStyle.preventOverflow ?? undefined,
                    tableHeader: rowStyle.tableHeader ?? undefined,
                });
            }
            if ((rowStyle?.tableHeader ?? false) && pinnedHeaderRowsCount === rowIndex) {
                pinnedHeaderRowsCount++;
            }
            (row.tableCells ?? []).forEach((cell, columnIndex) => {
                rowData.push(extractCellText(cell.content ?? []));
                const cellStyle = normalizeCellStyle(rowIndex, columnIndex, cell);
                if (cellStyle)
                    cellStyles.push(cellStyle);
            });
            data.push(rowData);
        });
        const columnStyles = element.table.tableStyle?.tableColumnProperties?.map((column, columnIndex) => ({
            columnIndex,
            widthPt: dimensionToPt(column.width),
            widthType: column.widthType,
        })) ?? [];
        return {
            tableId: currentTableId,
            startIndex: element.startIndex ?? null,
            endIndex: element.endIndex ?? null,
            rowCount: element.table.rows ?? data.length,
            columnCount: element.table.columns ?? Math.max(...data.map((row) => row.length), 0),
            data,
            columnStyles,
            rowStyles,
            cellStyles,
            pinnedHeaderRowsCount,
        };
    }
    return null;
}
export function findHeadings(doc, headings, tabId) {
    const content = getContentSource(doc, tabId);
    const normalizedTargets = new Set(headings.map((heading) => heading.trim()));
    const tables = extractDocumentTables(doc, tabId);
    const results = [];
    let seenTables = 0;
    for (let index = 0; index < content.length; index++) {
        const element = content[index];
        if (element.table?.tableRows) {
            seenTables++;
            continue;
        }
        const namedStyleType = element.paragraph?.paragraphStyle?.namedStyleType;
        if (!namedStyleType || !namedStyleType.startsWith('HEADING_'))
            continue;
        const headingText = extractParagraphText(element.paragraph).trim();
        if (!normalizedTargets.has(headingText))
            continue;
        let tableIdFollowing;
        for (let nextIndex = index + 1; nextIndex < content.length; nextIndex++) {
            const nextElement = content[nextIndex];
            if (nextElement.table?.tableRows) {
                tableIdFollowing = tables[seenTables]?.tableId;
                break;
            }
            if (nextElement.paragraph) {
                const nextStyle = nextElement.paragraph.paragraphStyle?.namedStyleType;
                if (nextStyle?.startsWith('HEADING_'))
                    break;
            }
        }
        results.push({
            headingText,
            headingLevel: namedStyleType,
            startIndex: element.startIndex ?? null,
            endIndex: element.endIndex ?? null,
            tableIdFollowing,
        });
    }
    return results;
}
