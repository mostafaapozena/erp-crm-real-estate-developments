/**
 * Relative documentation link check.
 *
 * Every Markdown file in the repository is scanned for relative links and the target is resolved on
 * disk. A broken link in `docs/` is how a decision record quietly becomes unreachable, so this runs in
 * `npm run verify` rather than being done by hand.
 *
 * Absolute URLs (`http:`, `https:`, `mailto:`) are not fetched — this check is about the repository's
 * own internal consistency, and a network call would make the result depend on someone else's uptime.
 * A link with a `#fragment` is resolved to its file; heading anchors are not verified.
 *
 * It also detects **self-splicing**: a document whose own title reappears inside its body. That is
 * the signature of a `String.prototype.replace` whose replacement *string* contained the
 * "text before the match" substitution pattern (a dollar sign followed by a backtick). It silently
 * duplicated half of `docs/MEMORY.md` once, and later two architecture documents. Any script that
 * edits documentation must pass its replacement as a **function**, which is never interpreted.
 *
 * Usage: npm run check:links
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'test-results',
  // Ignored by Git and by ESLint: throwaway probes, never documentation.
  'scratch',
  'sandbox',
]);
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function markdownFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      found.push(...markdownFiles(path));
    } else if (entry.name.endsWith('.md')) {
      found.push(path);
    }
  }
  return found;
}

/** The 1-based line on which the document's own `# ` title reappears, if it does. */
export function selfSpliceLine(text) {
  const lines = text.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^# \S/.test(line));
  if (titleIndex < 0) return undefined;
  const title = lines[titleIndex];
  const elsewhere = lines.findIndex((line, index) => index !== titleIndex && line.includes(title));
  return elsewhere < 0 ? undefined : elsewhere + 1;
}

const files = markdownFiles(root);
let checked = 0;
const broken = [];
const spliced = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const spliceLine = selfSpliceLine(text);
  if (spliceLine !== undefined) spliced.push(`${relative(root, file)}:${spliceLine}`);
  // Fenced code blocks hold example paths that need not exist.
  const withoutCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const match of withoutCode.matchAll(LINK)) {
    const target = match[1];
    if (/^(https?:|mailto:|tel:|#)/i.test(target)) continue;
    checked += 1;
    const [pathPart] = target.split('#');
    if (!pathPart) continue;
    const resolved = resolve(dirname(file), decodeURIComponent(pathPart));
    const exists =
      existsSync(resolved) && (statSync(resolved).isFile() || statSync(resolved).isDirectory());
    if (!exists) broken.push(`${relative(root, file)} → ${target}`);
  }
}

console.log(`Checked ${checked} relative links across ${files.length} Markdown files.`);
let failed = false;
if (broken.length > 0) {
  console.error(`\n${broken.length} broken link(s):`);
  for (const entry of broken) console.error(`  ${entry}`);
  failed = true;
}
if (spliced.length > 0) {
  console.error(`\n${spliced.length} document(s) repeat their own title — a self-splice:`);
  for (const entry of spliced) console.error(`  ${entry}`);
  failed = true;
}
if (failed) process.exit(1);
console.log('Documentation link and integrity check passed.');
