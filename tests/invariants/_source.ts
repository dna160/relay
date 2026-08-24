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

/* -------------------------------------------------------------------------- */
/* ADR-006's guard, made mechanical.                                          */
/*                                                                            */
/* "Every new query function that can be reached by a client contact needs a   */
/* case in tests/invariants/visibility.spec.ts. No exceptions." — CLAUDE.md.   */
/* That was a sentence in a document, which is a procedure, and ADR-006 says   */
/* the guard is mechanical. This is the mechanism: enumerate the functions the */
/* sentence is about, so the suite can diff itself against them.              */
/* -------------------------------------------------------------------------- */

export interface ExportedFunction {
  name: string;
  /** Repo-relative path of the file that exports it. */
  file: string;
  /** The parameter list, as written, comments already stripped. */
  params: string;
}

/** Reads a balanced parameter list starting at the `(` index. */
function paramsAt(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Every exported function in `src/<subdir>`, with its parameter list.
 *
 * Covers both `export function f(...)` and `export const f = (...) =>`, because
 * which one someone reaches for is a style choice and the invariant is not.
 */
export function exportedFunctions(subdir: string): ExportedFunction[] {
  const out: ExportedFunction[] = [];
  for (const file of sourceFiles(subdir)) {
    const patterns = [
      /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*(?=\()/g,
      /export\s+const\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?=\()/g,
    ];
    for (const pattern of patterns) {
      for (const match of file.text.matchAll(pattern)) {
        const open = file.text.indexOf('(', match.index + match[0].length - 1);
        if (open === -1) continue;
        const params = paramsAt(file.text, open);
        if (params === null) continue;
        out.push({ name: match[1] ?? '', file: file.path, params });
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The client-reachable query layer: every exported function under
 * `src/db/queries/` that takes a `ClientScope`.
 *
 * Taking a `ClientScope` *is* the definition of client-reachable at this layer.
 * A scope cannot be constructed from a request parameter — only from a session
 * (INV-6) — so a function that accepts one is by construction on a path a
 * client contact can reach, and a function that does not is not. The two
 * pre-session reads in `client-auth.ts` are the deliberate exception and are
 * covered separately; see `visibility.spec.ts`.
 */
export function clientScopedQueries(): ExportedFunction[] {
  return exportedFunctions('db/queries').filter((fn) => /\bClientScope\b/.test(fn.params));
}

/**
 * Client-reachable by *import graph* rather than by signature.
 *
 * `clientScopedQueries()` above defines client-reachable as "takes a
 * `ClientScope`". That is a good definition and it has a hole: a query can be
 * reached from a client route while taking a plain `engagementId`, because its
 * caller resolved visibility through a different function first. That is a
 * legitimate design — it is how `loadClientQueue` is built out of
 * `loadClientBoard` — but it means the signature is not the whole boundary, and
 * a guard that only reads signatures can be stepped around without anyone
 * intending to.
 *
 * So the boundary is also computed the other way: whatever the client route
 * handlers actually import from `src/db/queries/`. That set cannot be reduced
 * by changing a parameter type.
 *
 * @param roots directories whose files are reachable by a client contact.
 */
export function queriesImportedByClientRoutes(
  roots: readonly string[] = ['app/api/client', 'app/api/auth/client', 'app/(client)'],
): ExportedFunction[] {
  const imported = new Map<string, string>(); // symbol -> importing file
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      for (const match of file.text.matchAll(
        // `[^}]` rather than `[\s\S]*?`: a lazy any-character group starting at an
        // earlier `import {` will happily span three unrelated imports to reach
        // this one's closing brace, and swallow the names in between.
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@\/db\/queries\/[^'"]+['"]/g,
      )) {
        for (const raw of (match[1] ?? '').split(',')) {
          const clause = raw.trim();
          if (clause === '' || clause.startsWith('type ')) continue;
          const name = (clause.split(/\s+as\s+/)[0] ?? '').trim();
          if (name !== '' && !imported.has(name)) imported.set(name, file.path);
        }
      }
    }
  }

  const declared = new Map(exportedFunctions('db/queries').map((fn) => [fn.name, fn]));
  const out: ExportedFunction[] = [];
  for (const [name] of imported) {
    const fn = declared.get(name);
    if (fn) out.push(fn);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
