/**
 * Shared helpers for the structural invariants — the ones enforced by reading
 * the source tree rather than by executing it.
 *
 * A structural invariant is live from the first commit and stays live as code
 * lands around it. That is the point: an invariant that can only be written
 * after the feature exists is an invariant that never gets written.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface SourceFile {
  /** Repo-relative, POSIX separators, e.g. `src/domain/card/state-machine.ts`. */
  path: string;
  text: string;
}

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'migrations', 'coverage']);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every TypeScript source file under `src/<subdir>`, comments stripped. */
export function sourceFiles(subdir = ''): SourceFile[] {
  const base = join(ROOT, 'src', subdir);
  let files: string[];
  try {
    files = walk(base, []);
  } catch {
    // The directory does not exist yet. An invariant over an empty set holds.
    return [];
  }
  return files.map((full) => ({
    path: relative(ROOT, full).split(sep).join('/'),
    text: stripComments(readFileSync(full, 'utf8')),
  }));
}

/**
 * Removes block and line comments so that prose explaining an invariant is not
 * mistaken for a violation of it. Deliberately naive — it does not parse
 * strings — which is safe here because every check below is a "must not
 * contain" and a false positive fails loudly rather than passing silently.
 */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Files whose path matches, useful for carving out a sanctioned exception. */
export function except(files: SourceFile[], ...allowed: string[]): SourceFile[] {
  return files.filter((f) => !allowed.includes(f.path));
}

export function linesMatching(file: SourceFile, re: RegExp): string[] {
  return file.text.split('\n').filter((l) => re.test(l)).map((l) => l.trim());
}
