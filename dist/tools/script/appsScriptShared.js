import { UserError } from 'fastmcp';
import { z } from 'zod';
/** File types supported by an Apps Script project. */
export const AppsScriptFileTypeSchema = z.enum(['SERVER_JS', 'HTML', 'JSON']);
export const AppsScriptFileSchema = z.strictObject({
    name: z
        .string()
        .min(1)
        .describe('File name without extension, e.g. "Code" or "appsscript". The manifest file must be named "appsscript".'),
    type: AppsScriptFileTypeSchema.optional().describe('File type. Inferred from the name when omitted: "appsscript" becomes JSON, names ending in .html become HTML, everything else becomes SERVER_JS.'),
    source: z.string().describe('Full file content.'),
});
export const MANIFEST_FILE_NAME = 'appsscript';
/** Minimal manifest used when a project has none and the caller did not supply one. */
export const DEFAULT_MANIFEST_SOURCE = JSON.stringify({
    timeZone: 'Etc/GMT',
    dependencies: {},
    exceptionLogging: 'STACKDRIVER',
    runtimeVersion: 'V8',
}, null, 2);
/** Strips a trailing extension so callers may pass either "Code" or "Code.gs". */
function stripExtension(name) {
    return name.replace(/\.(gs|js|html|json)$/i, '');
}
/** Derives the Apps Script file type from a file name when the caller omitted it. */
export function inferFileType(name) {
    const lower = name.toLowerCase();
    if (stripExtension(lower) === MANIFEST_FILE_NAME)
        return 'JSON';
    if (lower.endsWith('.html'))
        return 'HTML';
    return 'SERVER_JS';
}
/** Normalises caller input into the shape the Apps Script API expects. */
export function toApiFiles(files) {
    return files.map((file) => ({
        name: stripExtension(file.name),
        type: file.type ?? inferFileType(file.name),
        source: file.source,
    }));
}
/**
 * Merges incoming files over the files already in the project.
 * Files with the same name are replaced; every other existing file is kept.
 */
export function mergeFiles(existing, incoming) {
    const byName = new Map();
    for (const file of existing) {
        if (file.name)
            byName.set(file.name, file);
    }
    for (const file of incoming) {
        if (file.name)
            byName.set(file.name, file);
    }
    return [...byName.values()];
}
/**
 * The API rejects an update whose payload has no manifest, so fall back to the
 * project's current manifest and finally to a minimal default.
 */
export function ensureManifest(files, existing) {
    if (files.some((file) => file.name === MANIFEST_FILE_NAME))
        return files;
    const currentManifest = existing.find((file) => file.name === MANIFEST_FILE_NAME);
    return [
        currentManifest ?? {
            name: MANIFEST_FILE_NAME,
            type: 'JSON',
            source: DEFAULT_MANIFEST_SOURCE,
        },
        ...files,
    ];
}
/** Turns raw Google API failures into messages that say what to do next. */
export function toUserError(error, action) {
    const message = error?.message ?? String(error);
    const status = error?.code ?? error?.response?.status;
    if (status === 403 && /Apps Script API/i.test(message)) {
        return new UserError('The Apps Script API is turned off for this Google account. Enable it at https://script.google.com/home/usersettings and try again.');
    }
    if (status === 403) {
        return new UserError(`Permission denied while ${action}. The account needs edit access to the project, and the OAuth token needs the script.projects scope - re-authorize if the token predates that scope.`);
    }
    if (status === 404) {
        return new UserError(`Not found while ${action}. Check the script ID - it is the long ID in the /projects/<scriptId>/ part of the Apps Script editor URL, not the spreadsheet ID.`);
    }
    if (status === 400 && /parent/i.test(message)) {
        return new UserError('Invalid parentId. It must be the file ID of an existing Doc, Sheet, Slides or Form that the account can edit.');
    }
    return new UserError(`Failed while ${action}: ${message || 'Unknown error'}`);
}
/** Editor URL for a script project. */
export function scriptUrl(scriptId) {
    return `https://script.google.com/d/${scriptId}/edit`;
}
