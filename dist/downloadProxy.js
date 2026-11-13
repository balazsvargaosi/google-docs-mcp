import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { stream } from 'hono/streaming';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
// Per-process encryption key — never leaves memory, regenerated on restart.
const ENCRYPTION_KEY = crypto.randomBytes(32);
function encrypt(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // iv (12) + tag (16) + ciphertext — all hex-encoded
    return iv.toString('hex') + tag.toString('hex') + encrypted.toString('hex');
}
function decrypt(blob) {
    const iv = Buffer.from(blob.slice(0, 24), 'hex');
    const tag = Buffer.from(blob.slice(24, 56), 'hex');
    const encrypted = Buffer.from(blob.slice(56), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
}
const pending = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of pending)
        if (v.expiresAt < now)
            pending.delete(k);
}, 60_000).unref();
export function createDownloadToken(opts) {
    const token = crypto.randomBytes(32).toString('hex');
    pending.set(token, {
        ...opts,
        accessToken: encrypt(opts.accessToken),
        expiresAt: Date.now() + 60 * 1000,
    });
    return token;
}
export function registerDownloadRoute(server) {
    const app = server.getApp();
    app.get('/download/:token', async (c) => {
        const token = c.req.param('token');
        const entry = pending.get(token);
        if (!entry || entry.expiresAt < Date.now()) {
            pending.delete(token);
            return c.text('Download link expired or invalid.', 410);
        }
        pending.delete(token);
        let accessToken;
        try {
            accessToken = decrypt(entry.accessToken);
        }
        catch {
            return c.text('Download link expired or invalid.', 410);
        }
        const auth = new OAuth2Client();
        auth.setCredentials({ access_token: accessToken });
        const drive = google.drive({ version: 'v3', auth });
        c.header('Content-Disposition', `attachment; filename="${entry.fileName.replace(/"/g, '\\"')}"`);
        if (entry.isWorkspace && entry.exportMime) {
            c.header('Content-Type', entry.exportMime);
            const res = await drive.files.export({ fileId: entry.fileId, mimeType: entry.exportMime }, { responseType: 'stream' });
            const webStream = Readable.toWeb(res.data);
            return stream(c, async (s) => {
                await s.pipe(webStream);
            });
        }
        else {
            c.header('Content-Type', entry.mimeType);
            const res = await drive.files.get({ fileId: entry.fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
            const webStream = Readable.toWeb(res.data);
            return stream(c, async (s) => {
                await s.pipe(webStream);
            });
        }
    });
}
/** @internal Exposed only for tests — do not use in production code. */
export function _testGetPending() {
    return pending;
}
