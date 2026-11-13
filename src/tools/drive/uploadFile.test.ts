import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conversionTarget, guessMimeType } from './uploadFile.js';
import { ensureReadableWithinUploadRoots, parseUploadRoots } from './savePathGuard.js';

describe('guessMimeType / conversionTarget', () => {
  it('guesses from the extension, case-insensitively', () => {
    expect(guessMimeType('report.PDF')).toBe('application/pdf');
    expect(guessMimeType('a.docx')).toContain('wordprocessingml');
    expect(guessMimeType('noext')).toBe('application/octet-stream');
  });

  it('knows which types Drive can convert', () => {
    expect(conversionTarget(guessMimeType('a.docx'))).toBe('application/vnd.google-apps.document');
    expect(conversionTarget(guessMimeType('a.csv'))).toBe(
      'application/vnd.google-apps.spreadsheet'
    );
    expect(conversionTarget('application/pdf')).toBeUndefined();
  });
});

describe('upload path boundary', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'upl-root-')));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'upl-out-')));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('defaults to the working directory', () => {
    expect(parseUploadRoots('', '/work')).toEqual([path.resolve('/work')]);
  });

  it('allows files inside a root', () => {
    const f = path.join(root, 'a.pdf');
    fs.writeFileSync(f, 'x');
    expect(ensureReadableWithinUploadRoots(f, [root])).toBe(f);
  });

  it('rejects files outside every root and ../ traversal', () => {
    const f = path.join(outside, 'secret');
    fs.writeFileSync(f, 'x');
    expect(() => ensureReadableWithinUploadRoots(f, [root])).toThrow(/outside/);
    expect(() =>
      ensureReadableWithinUploadRoots(path.join(root, '..', path.basename(outside), 'secret'), [
        root,
      ])
    ).toThrow(/outside/);
  });

  it('rejects a symlink inside the root that points outside', () => {
    const target = path.join(outside, 'secret');
    fs.writeFileSync(target, 'x');
    const link = path.join(root, 'link');
    fs.symlinkSync(target, link);
    expect(() => ensureReadableWithinUploadRoots(link, [root])).toThrow(/outside/);
  });
});
