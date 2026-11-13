import { register as createSheetsComment } from './createSheetsComment.js';
import { register as createSheetsCellNote } from './createSheetsCellNote.js';
import { register as listSheetsComments } from './listSheetsComments.js';
import { register as getSheetsComment } from './getSheetsComment.js';
import { register as replyToSheetsComment } from './replyToSheetsComment.js';
import { register as resolveSheetsComment } from './resolveSheetsComment.js';
import { register as deleteSheetsComment } from './deleteSheetsComment.js';
export function registerSheetsCommentTools(server) {
    createSheetsComment(server);
    createSheetsCellNote(server);
    listSheetsComments(server);
    getSheetsComment(server);
    replyToSheetsComment(server);
    resolveSheetsComment(server);
    deleteSheetsComment(server);
}
