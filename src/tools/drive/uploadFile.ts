import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { drive_v3 } from 'googleapis';
import { getDriveClient } from '../../clients.js';
import { ensureReadableWithinUploadRoots, parseUploadRoots } from './savePathGuard.js';

const isRemote = process.env.MCP_TRANSPORT === 'httpStream';

const GOOGLE_DOC = 'application/vnd.google-apps.document';
const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_SLIDES = 'application/vnd.google-apps.presentation';

const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/** Source MIME types Drive can convert on import, and the Google type they become. */
const CONVERSION_TARGETS: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': GOOGLE_DOC,
  'application/vnd.oasis.opendocument.text': GOOGLE_DOC,
  'application/rtf': GOOGLE_DOC,
  'text/plain': GOOGLE_DOC,
  'text/markdown': GOOGLE_DOC,
  'text/html': GOOGLE_DOC,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': GOOGLE_SHEET,
  'application/vnd.oasis.opendocument.spreadsheet': GOOGLE_SHEET,
  'text/csv': GOOGLE_SHEET,
  'text/tab-separated-values': GOOGLE_SHEET,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': GOOGLE_SLIDES,
  'application/vnd.oasis.opendocument.presentation': GOOGLE_SLIDES,
};

export function guessMimeType(fileName: string): string {
  return EXTENSION_TO_MIME[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

/** Google Workspace type a file of `mimeType` converts to, or undefined if Drive cannot convert it. */
export function conversionTarget(mimeType: string): string | undefined {
  return CONVERSION_TARGETS[mimeType];
}

const UploadFileParameters = z.strictObject({
  filePath: z
    .string()
    .min(1)
    .describe(
      'Local file to upload. Must be inside the allowed upload directories ' +
        '(the working directory, or GOOGLE_DOCS_MCP_UPLOAD_ROOTS).'
    ),
  name: z
    .string()
    .min(1)
    .optional()
    .describe('Name of the file in Drive. Defaults to the local file name.'),
  parentFolderId: z
    .string()
    .optional()
    .describe('Folder ID to upload into. If omitted, uploads to the Drive root.'),
  mimeType: z
    .string()
    .optional()
    .describe('MIME type of the local file. Guessed from the extension if omitted.'),
  convertToGoogleFormat: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, Drive converts the file on import: .docx/.odt/.rtf/.txt/.md/.html -> Google Doc, ' +
        '.xlsx/.ods/.csv/.tsv -> Google Sheet, .pptx/.odp -> Google Slides. ' +
        'Leave false to keep the file as is (for example PDFs).'
    ),
});

export function register(server: FastMCP) {
  server.addTool({
    name: 'uploadFile',
    description:
      'Uploads a local file to Google Drive (any type: PDF, docx, images, ...). ' +
      'Optionally places it in a folder and optionally converts Office/text files to a native ' +
      'Google Doc, Sheet or Slides. Always creates a new file (never overwrites); search first ' +
      'if you need to avoid duplicates. Returns the new file id and its web link. ' +
      'Local stdio mode only; reads are confined to GOOGLE_DOCS_MCP_UPLOAD_ROOTS (default: working directory).',
    parameters: UploadFileParameters,
    execute: async (args, { log }) => {
      if (isRemote) {
        throw new UserError(
          'uploadFile is only available in local (stdio) mode: the server cannot read your local files.'
        );
      }

      let realPath: string;
      try {
        realPath = ensureReadableWithinUploadRoots(args.filePath, parseUploadRoots());
      } catch (boundaryError: any) {
        throw new UserError(boundaryError?.message || String(boundaryError));
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(realPath);
      } catch {
        throw new UserError(`File not found: ${args.filePath}`);
      }
      if (!stat.isFile()) throw new UserError(`Not a regular file: ${args.filePath}`);

      const fileName = args.name ?? path.basename(args.filePath);
      const sourceMime = args.mimeType ?? guessMimeType(fileName);

      const requestBody: drive_v3.Schema$File = { name: fileName };
      if (args.parentFolderId) requestBody.parents = [args.parentFolderId];

      if (args.convertToGoogleFormat) {
        const target = conversionTarget(sourceMime);
        if (!target) {
          throw new UserError(
            `Drive cannot convert "${sourceMime}" to a Google format. ` +
              `Set convertToGoogleFormat to false to upload it as is.`
          );
        }
        requestBody.mimeType = target;
      }

      log.info(
        `Uploading ${realPath} (${stat.size} bytes) as "${fileName}"` +
          (args.parentFolderId ? ` into ${args.parentFolderId}` : '') +
          (requestBody.mimeType ? ` converted to ${requestBody.mimeType}` : '')
      );

      try {
        const drive = await getDriveClient();
        const response = await drive.files.create({
          requestBody,
          media: { mimeType: sourceMime, body: fs.createReadStream(realPath) },
          fields: 'id,name,mimeType,size,parents,webViewLink',
          supportsAllDrives: true,
        });

        const file = response.data;
        return JSON.stringify(
          {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.size ? Number(file.size) : undefined,
            parents: file.parents,
            url: file.webViewLink,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error uploading ${realPath}: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        if (error.code === 404)
          throw new UserError('Parent folder not found. Check the parentFolderId.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure the authenticated account can write to the target folder.'
          );
        throw new UserError(`Failed to upload file: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
