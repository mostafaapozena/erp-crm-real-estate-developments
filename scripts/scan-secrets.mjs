/**
 * Secret scan (SEC-009, TEST-002). Checks every tracked and untracked-but-not-ignored file for
 * credential patterns. It is a lightweight gate, not a replacement for a dedicated scanner in CI.
 *
 * Usage: npm run check:secrets
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const SELF = 'scripts/scan-secrets.mjs';

const PATTERNS = [
  {
    name: 'Private key block',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  { name: 'AWS access key ID', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    name: 'AWS secret access key assignment',
    regex: /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/i,
  },
  {
    name: 'Credential in connection string',
    regex:
      /\b(?:mongodb(?:\+srv)?|rediss?|postgres(?:ql)?|mysql|amqps?):\/\/[^\s:/<>'"`]+:[^\s@<>'"`]+@/,
  },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Meta/Facebook access token', regex: /\bEAA[A-Za-z0-9]{60,}\b/ },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe live key', regex: /\b[rs]k_live_[0-9a-zA-Z]{20,}\b/ },
  {
    name: 'JSON web token',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
];

const BINARY = /\.(pdf|png|jpe?g|gif|ico|woff2?|ttf|otf|zip|gz)$/i;

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
)
  .split('\0')
  .filter((file) => file && file !== SELF && !BINARY.test(file) && file !== 'package-lock.json');

const findings = [];
for (const file of files) {
  let text;
  try {
    if (statSync(file).size > 2 * 1024 * 1024) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split(/\r?\n/).forEach((line, index) => {
    for (const { name, regex } of PATTERNS) {
      // Report location and pattern only — never the matched value.
      if (regex.test(line)) findings.push(`${file}:${index + 1} — ${name}`);
    }
  });
}

if (findings.length > 0) {
  console.error(`Secret scan failed: ${findings.length} finding(s)`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(`Secret scan passed: ${files.length} files checked, no credential patterns found.`);
