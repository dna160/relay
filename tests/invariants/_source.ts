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

/* -------------------------------------------------------------------------- */
/* Client-reachable by transitive reachability.                               */
/*                                                                            */
/* Two weaker definitions came first and each was escaped in practice:        */
/*                                                                            */
/*   - *by signature* ("takes a `ClientScope`") was escaped by a query that   */
/*     takes a plain engagement id because its caller resolved visibility     */
/*     first. Good composition; invisible to the guard.                       */
/*   - *by direct import* was escaped by a query a client route reaches       */
/*     through one intermediate module rather than importing itself.          */
/*                                                                            */
/* The Architect's ruling in round 2: enumerate by reachability. Any query    */
/* function transitively reachable from `src/app/api/client/**` is            */
/* client-reachable and needs a case, whatever its parameters say and however */
/* many modules sit between it and the handler.                               */
/* -------------------------------------------------------------------------- */

/** One module's imports: a resolved module path and the symbols taken from it. */
interface ImportEdge {
  module: string;
  symbols: string[];
  /** True for `import x from`, `import * as x`, or `export * from`. */
  wholeModule: boolean;
}

/** Resolves an import specifier to a repo-relative path, or null if external. */
function resolveModule(fromFile: string, spec: string, known: ReadonlySet<string>): string | null {
  let base: string;
  if (spec.startsWith('@/')) {
    base = `src/${spec.slice(2)}`;
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    const dir = fromFile.split('/').slice(0, -1);
    for (const part of spec.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') dir.pop();
      else dir.push(part);
    }
    base = dir.join('/');
  } else {
    return null; // an npm package; the graph stops at the tree's edge
  }

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

function importsOf(file: SourceFile, known: ReadonlySet<string>): ImportEdge[] {
  const edges: ImportEdge[] = [];

  // `import { a, b as c } from 'x'` and `export { a } from 'x'`.
  for (const match of file.text.matchAll(
    /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g,
  )) {
    const module = resolveModule(file.path, match[2] ?? '', known);
    if (module === null) continue;
    const symbols = (match[1] ?? '')
      .split(',')
      .map((clause) => clause.trim())
      .filter((clause) => clause !== '' && !clause.startsWith('type '))
      .map((clause) => (clause.split(/\s+as\s+/)[0] ?? '').trim())
      .filter((name) => name !== '');
    edges.push({ module, symbols, wholeModule: false });
  }

  // `import x from 'y'`, `import * as x from 'y'`, `export * from 'y'`,
  // `import 'y'` — anything that pulls a module in without naming symbols.
  for (const match of file.text.matchAll(
    /(?:import\s+(?:[A-Za-z0-9_$]+|\*\s+as\s+[A-Za-z0-9_$]+)\s+from|export\s+\*\s+from|import)\s+['"]([^'"]+)['"]/g,
  )) {
    const module = resolveModule(file.path, match[1] ?? '', known);
    if (module === null) continue;
    edges.push({ module, symbols: [], wholeModule: true });
  }

  return edges;
}

export interface ReachableQuery extends ExportedFunction {
  /** The module chain from a client route to this function, for the message. */
  via: readonly string[];
}

/**
 * Every query function reachable from a client entry point, with the path taken.
 *
 * Symbol-level for `src/db/queries/**` and module-level everywhere else. That
 * asymmetry is deliberate: `revision-notes.ts` exports an agency-only read
 * beside a client-visible one, and flagging the whole file because a client
 * route reaches one of them would demand cases for functions no client contact
 * can call. What is tracked is which *names* travel along the graph.
 *
 * A module reached through `import * as` or a side-effect import contributes
 * all of its exports, because at that point nothing narrows it.
 */
export const CLIENT_ENTRY_POINTS: readonly string[] = [
  'app/api/client',
  'app/api/auth/client',
  'app/(client)',
];

export interface ClientGraph {
  /** Every module reachable from an entry point, to the chain that reached it. */
  modules: Map<string, string[]>;
  /** Query symbol -> the chain that carried it here. */
  querySymbols: Map<string, string[]>;
  /** The entry-point files the walk started from. */
  entryPoints: readonly string[];
}

/**
 * Walks the import graph out from the client entry points.
 *
 * Exported so the traversal can be tested on its own. A reachability guard that
 * silently stops at depth one looks exactly like a reachability guard that
 * works, right up until the day something is reached at depth two.
 */
export function clientImportGraph(
  roots: readonly string[] = CLIENT_ENTRY_POINTS,
): ClientGraph {
  const all = sourceFiles();
  const byPath = new Map(all.map((f) => [f.path, f]));
  const known = new Set(byPath.keys());

  const entry = all.filter((f) => roots.some((root) => f.path.startsWith(`src/${root}/`)));

  const modules = new Map<string, string[]>();
  const querySymbols = new Map<string, string[]>();

  const queue: Array<{ file: SourceFile; chain: string[] }> = entry.map((file) => ({
    file,
    chain: [file.path],
  }));
  for (const item of queue) modules.set(item.file.path, item.chain);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    for (const edge of importsOf(current.file, known)) {
      const target = byPath.get(edge.module);
      if (!target) continue;
      const chain = [...current.chain, edge.module];

      if (edge.module.startsWith('src/db/queries/')) {
        const names = edge.wholeModule
          ? exportedFunctions('db/queries')
              .filter((fn) => fn.file === edge.module)
              .map((fn) => fn.name)
          : edge.symbols;
        for (const name of names) if (!querySymbols.has(name)) querySymbols.set(name, chain);
      }

      if (!modules.has(edge.module)) {
        modules.set(edge.module, chain);
        queue.push({ file: target, chain });
      }
    }
  }

  return { modules, querySymbols, entryPoints: entry.map((f) => f.path) };
}

export function queriesReachableFromClientRoutes(
  roots: readonly string[] = CLIENT_ENTRY_POINTS,
): ReachableQuery[] {
  const { querySymbols } = clientImportGraph(roots);
  const declared = new Map(exportedFunctions('db/queries').map((fn) => [fn.name, fn]));
  const out: ReachableQuery[] = [];
  for (const [name, chain] of querySymbols) {
    const fn = declared.get(name);
    if (fn) out.push({ ...fn, via: chain });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
