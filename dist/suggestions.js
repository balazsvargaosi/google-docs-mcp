import { UserError } from 'fastmcp';
const COMMENTS_VIEW_MODE_INCLUDED = 'COMMENTS_VIEW_MODE_INCLUDED';
const COMMENT_UPDATE_ALL_SAVED = 'ALL_SAVED';
const COMMENT_UPDATE_NONE_REQUESTED = 'NO_UPDATES_REQUESTED';
// Request keys the Docs API rejects when WriteControl.writeMode is SUGGEST.
// Source: "Unsupported requests in suggest mode" in the API how-to guide.
const SUGGEST_MODE_UNSUPPORTED_REQUEST_KEYS = new Set([
    'addDocumentTab',
    'deleteTab',
    'updateDocumentTabProperties',
    'createNamedRange',
    'deleteNamedRange',
    'deleteNamedRangeByName',
    'updateTableColumnProperties',
    'createHeader',
    'createFooter',
]);
/**
 * Client-side validation for suggest mode. Returns an actionable error
 * message, or null when the batch looks suggestible. This avoids opaque
 * API 400s for operations the API refuses as suggestions.
 */
export function validateSuggestModeRequests(requests) {
    const problems = [];
    requests.forEach((req, i) => {
        const keys = Object.keys(req);
        for (const key of keys) {
            if (SUGGEST_MODE_UNSUPPORTED_REQUEST_KEYS.has(key)) {
                problems.push(`request ${i} ('${key}') cannot run in suggest mode`);
            }
            if (key === 'updateDocumentStyle') {
                const style = req.updateDocumentStyle?.documentStyle ?? {};
                // Direct check on the raw keys (camelCase from googleapis).
                const rawBad = Object.keys(style).filter((k) => ['documentMode', 'useEvenPageHeaderFooter', 'useFirstPageHeaderFooter'].includes(k));
                if (rawBad.length > 0) {
                    problems.push(`request ${i} ('updateDocumentStyle') sets ${rawBad.join(', ')}, which cannot be suggested`);
                }
            }
        }
    });
    if (problems.length === 0)
        return null;
    return (`suggestMode=true but this batch includes operations the Docs API cannot apply as suggestions: ` +
        problems.join('; ') +
        `. Remove them or run with suggestMode=false.`);
}
function isCommentsViewModeError(error) {
    const status = error?.code ?? error?.response?.status;
    if (status !== 400)
        return false;
    const text = JSON.stringify(error?.response?.data ?? error?.message ?? '').toLowerCase();
    return text.includes('comments_view_mode') || text.includes('commentsviewmode');
}
/** Render commentUpdateState for a suggest-mode response. Advisory, never a gate. */
export function describeCommentUpdateState(commentState, opts) {
    if (commentState === COMMENT_UPDATE_ALL_SAVED) {
        return ' Applied as suggested edits (comment_update_state: ALL_SAVED).';
    }
    if (commentState === COMMENT_UPDATE_NONE_REQUESTED && opts?.allNoops) {
        return ' No suggestion updates were required (comment_update_state: NO_UPDATES_REQUESTED, nothing matched).';
    }
    const rendered = commentState ?? 'MISSING';
    return (` WARNING: the API did not confirm suggestion threads were saved (comment_update_state: ${rendered}). ` +
        `The edits may be LIVE rather than pending. Verify with listSuggestions, and undo in the Docs UI (Edit > Undo) if they were not meant to be live.`);
}
/** Summarize per-request suggestionResponses IDs. */
export function describeSuggestionResponses(responses) {
    if (!responses || responses.length === 0)
        return '';
    const buckets = {
        created: new Set(),
        updated: new Set(),
        deleted: new Set(),
        accepted: new Set(),
        rejected: new Set(),
    };
    const fields = {
        createdSuggestionIds: 'created',
        updatedSummarySuggestionIds: 'updated',
        deletedSuggestionIds: 'deleted',
        acceptedSuggestionIds: 'accepted',
        rejectedSuggestionIds: 'rejected',
    };
    for (const r of responses) {
        for (const [field, label] of Object.entries(fields)) {
            for (const id of r?.[field] ?? [])
                buckets[label].add(id);
        }
    }
    const parts = Object.entries(buckets)
        .filter(([, ids]) => ids.size > 0)
        .map(([label, ids]) => `${label}: ${ids.size}`);
    return parts.length > 0 ? ` Suggestion results: ${parts.join(', ')}.` : '';
}
const CHANGE_MAPS = {
    suggestedTextStyleChanges: 'style',
    suggestedParagraphStyleChanges: 'paragraph-style',
    suggestedBulletChanges: 'bullet',
    suggestedPositionedObjectIds: 'positioned-object',
    suggestedTableRowStyleChanges: 'table-row-style',
    suggestedTableCellStyleChanges: 'table-cell-style',
    suggestedDocumentStyleChanges: 'document-style',
    suggestedNamedStylesChanges: 'named-styles',
    suggestedListPropertiesChanges: 'list-properties',
    suggestedInlineObjectPropertiesChanges: 'inline-object-properties',
    suggestedPositionedObjectPropertiesChanges: 'positioned-object-properties',
};
function collectMarkers(node, acc, tabId, preview = '', accumulate = false) {
    if (!node || typeof node !== 'object')
        return;
    const entryFor = (sid) => {
        let e = acc.get(sid);
        if (!e) {
            e = { types: new Set(), textPreview: '', tabId };
            acc.set(sid, e);
        }
        return e;
    };
    const contributed = new Set();
    const applyPreview = (sid) => {
        if (!preview || contributed.has(sid))
            return;
        contributed.add(sid);
        const e = entryFor(sid);
        if (accumulate)
            e.textPreview += preview;
        else if (!e.textPreview)
            e.textPreview = preview;
    };
    for (const [field, label] of [
        ['suggestedInsertionIds', 'insertion'],
        ['suggestedDeletionIds', 'deletion'],
    ]) {
        for (const sid of node[field] ?? []) {
            entryFor(sid).types.add(label);
            applyPreview(sid);
        }
    }
    const single = node.suggestedInsertionId;
    if (typeof single === 'string' && single) {
        entryFor(single).types.add('insertion');
        applyPreview(single);
    }
    for (const [field, label] of Object.entries(CHANGE_MAPS)) {
        const map = node[field];
        if (map && typeof map === 'object') {
            for (const sid of Object.keys(map)) {
                entryFor(sid).types.add(label);
                applyPreview(sid);
            }
        }
    }
}
function collectFromElements(elements, acc, tabId) {
    for (const el of elements ?? []) {
        if (el.sectionBreak)
            collectMarkers(el.sectionBreak, acc, tabId);
        if (el.tableOfContents) {
            collectMarkers(el.tableOfContents, acc, tabId);
            collectFromElements(el.tableOfContents.content ?? [], acc, tabId);
        }
        if (el.paragraph) {
            const text = (el.paragraph.elements ?? [])
                .map((pe) => Object.values(pe).find((v) => v?.content)?.content ?? '')
                .join('');
            collectMarkers(el.paragraph, acc, tabId, text);
            for (const pe of el.paragraph.elements ?? []) {
                for (const sub of Object.values(pe)) {
                    if (sub && typeof sub === 'object') {
                        collectMarkers(sub, acc, tabId, sub.content ?? '', true);
                    }
                }
            }
        }
        if (el.table) {
            collectMarkers(el.table, acc, tabId);
            for (const row of el.table.tableRows ?? []) {
                collectMarkers(row, acc, tabId);
                for (const cell of row.tableCells ?? []) {
                    collectMarkers(cell, acc, tabId);
                    collectFromElements(cell.content ?? [], acc, tabId);
                }
            }
        }
    }
}
function collectFromSegmentMap(map, acc, tabId) {
    for (const seg of Object.values(map ?? {})) {
        collectFromElements(seg?.content ?? [], acc, tabId);
    }
}
/** Fetch open suggestions: inline markers enriched with thread metadata. */
export async function fetchDocSuggestions(docs, documentId, opts) {
    const includeThreads = opts?.includeThreads ?? true;
    let doc;
    try {
        const res = await docs.documents.get({
            documentId,
            includeTabsContent: true,
            suggestionsViewMode: 'SUGGESTIONS_INLINE',
            ...(includeThreads ? { commentsViewMode: COMMENTS_VIEW_MODE_INCLUDED } : {}),
        });
        doc = res.data;
    }
    catch (error) {
        if (includeThreads && isCommentsViewModeError(error)) {
            // Older projects or restricted access: retry without thread metadata.
            const res = await docs.documents.get({
                documentId,
                includeTabsContent: true,
                suggestionsViewMode: 'SUGGESTIONS_INLINE',
            });
            doc = res.data;
            const markersOnly = collectMarkersOnly(doc);
            return { suggestions: markersOnly, previewDegraded: true };
        }
        throw error;
    }
    const markers = new Map();
    const collectContainer = (container, tabId) => {
        collectMarkers(container, markers, tabId);
        collectFromElements(container?.body?.content ?? [], markers, tabId);
        for (const seg of ['headers', 'footers', 'footnotes']) {
            collectFromSegmentMap(container?.[seg], markers, tabId);
        }
        for (const rm of ['lists', 'inlineObjects', 'positionedObjects']) {
            for (const res of Object.values((container?.[rm] ?? {}))) {
                collectMarkers(res, markers, tabId);
            }
        }
    };
    collectContainer(doc);
    const walkTabs = (tab) => {
        if (tab?.documentTab)
            collectContainer(tab.documentTab, tab?.tabProperties?.tabId);
        for (const child of tab?.childTabs ?? [])
            walkTabs(child);
    };
    for (const tab of doc?.tabs ?? [])
        walkTabs(tab);
    const threads = doc?.suggestions;
    if (!Array.isArray(threads)) {
        // Markers only (threads absent in response).
        const out = new Map();
        for (const [sid, m] of markers) {
            out.set(sid, { types: [...m.types], textPreview: m.textPreview, tabId: m.tabId });
        }
        return { suggestions: out, previewDegraded: true };
    }
    const out = new Map();
    for (const t of threads) {
        if (t?.status !== 'OPEN' || typeof t?.suggestionId !== 'string')
            continue;
        const m = markers.get(t.suggestionId);
        const author = t?.headPost?.author?.displayName ??
            (t?.headPost?.author?.anonymous ? 'Anonymous' : undefined);
        out.set(t.suggestionId, {
            types: m ? [...m.types] : [],
            textPreview: t?.summaryText ?? m?.textPreview ?? '',
            tabId: m?.tabId,
            author,
            createTime: t?.headPost?.createTime,
        });
    }
    return { suggestions: out, previewDegraded: false };
}
function collectMarkersOnly(doc) {
    const markers = new Map();
    const collectContainer = (container, tabId) => {
        collectMarkers(container, markers, tabId);
        collectFromElements(container?.body?.content ?? [], markers, tabId);
    };
    collectContainer(doc);
    for (const tab of doc?.tabs ?? []) {
        if (tab?.documentTab)
            collectContainer(tab.documentTab, tab?.tabProperties?.tabId);
    }
    const out = new Map();
    for (const [sid, m] of markers) {
        out.set(sid, { types: [...m.types], textPreview: m.textPreview, tabId: m.tabId });
    }
    return out;
}
/** Wrap a suggest-mode batchUpdate outcome with the advisory state sentence. */
export function suggestModeNote(commentState, suggestionResponses, opts) {
    return (describeCommentUpdateState(commentState, opts) +
        describeSuggestionResponses(suggestionResponses));
}
export function toUserError(error, fallback) {
    if (error instanceof UserError)
        throw error;
    throw new UserError(`${fallback}: ${error?.message ?? 'Unknown error'}`);
}
