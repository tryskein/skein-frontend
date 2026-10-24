/**
 * sk-41 — unit tests for the viewer-extension registry.
 *
 * Two surfaces:
 *   - `extractExtension(filename)` — filename parsing, lower-casing,
 *     pathological inputs.
 *   - `isViewableExtension(filename)` / `getViewableKind(filename)` —
 *     positive matches per spec + negatives for binary / image / pdf
 *     so AttachmentList stays a strict gate.
 */

import { describe, expect, test } from 'vitest';
import {
  extractExtension,
  getViewableKind,
  isViewableExtension,
} from '../fileViewerSupport';

describe('extractExtension', () => {
  test('extracts the trailing extension', () => {
    expect(extractExtension('README.md')).toBe('md');
    expect(extractExtension('config.json')).toBe('json');
    expect(extractExtension('archive.tar.gz')).toBe('gz');
  });

  test('lower-cases the result', () => {
    expect(extractExtension('NOTES.TXT')).toBe('txt');
    expect(extractExtension('Component.TSX')).toBe('tsx');
  });

  test('strips path prefixes', () => {
    expect(extractExtension('subdir/script.go')).toBe('go');
    // Windows-style separator — kept for defensive parsing.
    expect(extractExtension('a\\b\\schema.sql')).toBe('sql');
  });

  test('returns empty string when there is no extension', () => {
    expect(extractExtension('Makefile')).toBe('');
    expect(extractExtension('')).toBe('');
    // A leading-dot dotfile has no name part — not usable as an
    // extension.
    expect(extractExtension('.env')).toBe('');
    // Trailing dot — empty extension.
    expect(extractExtension('foo.')).toBe('');
  });
});

describe('isViewableExtension', () => {
  test('returns true for every spec-listed extension', () => {
    const cases = [
      'doc.md',
      'doc.markdown',
      'notes.txt',
      'data.json',
      'schema.yaml',
      'compose.yml',
      'index.ts',
      'Button.tsx',
      'main.go',
      'Program.cs',
      'migration.sql',
    ];
    for (const filename of cases) {
      expect(isViewableExtension(filename)).toBe(true);
    }
  });

  test('is case-insensitive', () => {
    expect(isViewableExtension('README.MD')).toBe(true);
    expect(isViewableExtension('App.TSX')).toBe(true);
    expect(isViewableExtension('design.YAML')).toBe(true);
  });

  test('returns false for non-viewable types', () => {
    const cases = [
      'design.pdf',
      'screenshot.png',
      'photo.jpg',
      'archive.zip',
      'binary.bin',
      'audio.mp3',
      'video.mp4',
      'page.html',
      'style.css',
      'script.js', // explicitly out of the listed code set
      'Cargo.lock',
      'unknown',
      '',
      '.env',
    ];
    for (const filename of cases) {
      expect(isViewableExtension(filename)).toBe(false);
    }
  });
});

describe('getViewableKind', () => {
  test('classifies markdown', () => {
    const md = getViewableKind('doc.md');
    expect(md).not.toBeNull();
    expect(md?.kind).toBe('markdown');

    const markdown = getViewableKind('doc.markdown');
    expect(markdown?.kind).toBe('markdown');
  });

  test('classifies plain text', () => {
    const txt = getViewableKind('notes.txt');
    expect(txt?.kind).toBe('text');
    expect(txt?.language).toBe('');
  });

  test('classifies code with the shiki language identifier', () => {
    expect(getViewableKind('main.go')?.language).toBe('go');
    expect(getViewableKind('Program.cs')?.language).toBe('csharp');
    expect(getViewableKind('schema.sql')?.language).toBe('sql');
    expect(getViewableKind('compose.yml')?.language).toBe('yaml');
    expect(getViewableKind('schema.yaml')?.language).toBe('yaml');
    expect(getViewableKind('index.ts')?.language).toBe('typescript');
    expect(getViewableKind('App.tsx')?.language).toBe('tsx');
    expect(getViewableKind('data.json')?.language).toBe('json');
  });

  test('returns null for non-viewable extensions', () => {
    expect(getViewableKind('design.pdf')).toBeNull();
    expect(getViewableKind('Makefile')).toBeNull();
  });
});
