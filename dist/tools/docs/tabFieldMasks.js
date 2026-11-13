export const TAB_ID_PROPERTIES = 'tabProperties(tabId)';
export const TAB_LIST_PROPERTIES = 'tabProperties(tabId,title,index,parentTabId)';
/**
 * Builds a tabs field mask that includes childTabs recursion (3 levels deep) so that
 * findTabById() can locate tabs nested at any depth.
 *
 * @param documentTabFields - the documentTab(...) subfields needed, e.g. 'documentTab(body(content(endIndex)))'
 */
export function buildTabsFieldMask(documentTabFields) {
    const child3 = `childTabs(${TAB_ID_PROPERTIES},${documentTabFields})`;
    const child2 = `childTabs(${TAB_ID_PROPERTIES},${documentTabFields},${child3})`;
    const child1 = `childTabs(${TAB_ID_PROPERTIES},${documentTabFields},${child2})`;
    return `tabs(${TAB_ID_PROPERTIES},${documentTabFields},${child1})`;
}
const BODY_RANGE = 'documentTab(body(content(startIndex,endIndex)))';
const BODY_END = 'documentTab(body(content(endIndex)))';
export const TAB_BODY_RANGE_FIELDS = buildTabsFieldMask(BODY_RANGE);
export const TAB_BODY_END_INDEX_FIELDS = buildTabsFieldMask(BODY_END);
const TAB_LIST_CHILD_FIELDS = `childTabs(${TAB_LIST_PROPERTIES},childTabs(${TAB_LIST_PROPERTIES},childTabs(${TAB_LIST_PROPERTIES})))`;
export const TAB_LIST_FIELDS = `title,tabs(${TAB_LIST_PROPERTIES},${TAB_LIST_CHILD_FIELDS})`;
export const TAB_LIST_WITH_CONTENT_FIELDS = `title,tabs(${TAB_LIST_PROPERTIES},${TAB_LIST_CHILD_FIELDS},documentTab(body(content(endIndex))))`;
export const TAB_FIELD_MASKS = {
    TAB_BODY_RANGE_FIELDS,
    TAB_BODY_END_INDEX_FIELDS,
    TAB_LIST_FIELDS,
    TAB_LIST_WITH_CONTENT_FIELDS,
};
// ── Shared body-level field strings for document.get calls ──────────────────
// Used to build conditional field masks: body fields for legacy (no tabId),
// or buildTabsFieldMask(`documentTab(${...})`) when a tabId is provided.
/** Minimal table index fields — rows/cells start+endIndex only. */
export const TABLE_INDEX_BODY_FIELDS = 'body(content(startIndex,endIndex,table(tableRows(tableCells(startIndex,endIndex)))))';
/** Table fields with basic cell text (no content indices). */
export const TABLE_CONTENT_BASIC_BODY_FIELDS = 'body(content(startIndex,endIndex,table(tableRows(tableCells(startIndex,endIndex,content(paragraph(elements(textRun(content)))))))))';
/** Table fields with full content + element indices (needed for in-cell editing). */
export const TABLE_CONTENT_INDEXED_BODY_FIELDS = 'body(content(startIndex,endIndex,table(tableRows(tableCells(startIndex,endIndex,content(startIndex,endIndex,paragraph(elements(startIndex,endIndex,textRun(content)))))))))';
/** Heading + table fields for section-by-heading lookups. */
export const HEADING_BODY_FIELDS = 'body(content(startIndex,endIndex,paragraph(paragraphStyle(namedStyleType),elements(textRun(content))),table(tableRows(tableCells(startIndex,endIndex,content(paragraph(elements(textRun(content)))))))))';
/** Smart chip fields (date, person, richLink) in body + table cells. */
export const SMART_CHIP_BODY_FIELDS = 'body(content(paragraph(elements(startIndex,endIndex,dateElement(dateId,dateElementProperties),richLink(richLinkId,richLinkProperties),person(personId,personProperties))),table(tableRows(tableCells(content(paragraph(elements(startIndex,endIndex,dateElement(dateId,dateElementProperties),richLink(richLinkId,richLinkProperties),person(personId,personProperties)))))))))';
/**
 * Returns the correct fields string for a documents.get call.
 * When tabId is set, wraps bodyFields in a tabs field mask.
 * When tabId is absent, returns bodyFields directly (legacy body mode).
 */
export function buildDocumentGetFields(bodyFields, tabId) {
    return tabId ? buildTabsFieldMask(`documentTab(${bodyFields})`) : bodyFields;
}
