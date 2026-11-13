import { register as replaceDocumentWithMarkdown } from './replaceDocumentWithMarkdown.js';
import { register as appendMarkdownToGoogleDoc } from './appendMarkdownToGoogleDoc.js';
import { register as replaceRangeWithMarkdown } from './replaceRangeWithMarkdown.js';
export function registerUtilsTools(server) {
    replaceDocumentWithMarkdown(server);
    appendMarkdownToGoogleDoc(server);
    replaceRangeWithMarkdown(server);
}
