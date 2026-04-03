#!/usr/bin/env node

/**
 * TeamHero Secret Scanner
 * Scans files for accidentally committed secrets, API keys, tokens, and credentials.
 *
 * Usage:
 *   node scripts/scan-secrets.js --staged     Scan git-staged files (used by pre-commit hook)
 *   node scripts/scan-secrets.js --all        Scan entire working tree
 *   node scripts/scan-secrets.js --path <f>   Scan a specific file or directory

 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..');

const WHITELIST_PATH = path.join(PROJECT_ROOT, '.secret-scan-whitelist.json');

// Max file size to scan (512 KB) - skip large files
const MAX_FILE_SIZE = 512 * 1024;

// Extensions to always skip (binary / media)
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp',
  '.mp4', '.mp3', '.wav', '.ogg', '.webm',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.lock', '.bin', '.dat',
  '.enc'  // encrypted vault files
]);

// Directories to always skip when walking trees
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.playwright-mcp', 'temp', '.claude',
  'backups', '__pycache__', '.next', 'dist', 'build'
]);

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

const PATTERNS = [
  // API keys & tokens
  { name: 'AWS Access Key',        regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'GitHub Token',          regex: /gh[ps]_[A-Za-z0-9_]{36,}/g },
  { name: 'Slack Token',           regex: /xox[bpors]-[A-Za-z0-9-]{10,}/g },
  { name: 'Generic API Key',       regex: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9_\-]{20,}/gi },
  { name: 'Generic Token',         regex: /(?:token|bearer)\s*[:=]\s*["']?[A-Za-z0-9_\-\.]{20,}/gi },
  { name: 'JWT',                   regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_\-]+/g },

  // Passwords & secrets
  { name: 'Password Assignment',   regex: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/gi },
  { name: 'Secret Assignment',     regex: /(?:secret|private[_-]?key)\s*[:=]\s*["'][^"']{4,}["']/gi },

  // Private keys
  { name: 'Private Key (PEM)',     regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g },
  { name: 'PGP Private Key',       regex: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g },

  // Connection strings with credentials
  { name: 'Database URL',          regex: /(?:postgres|mysql|mongodb|redis):\/\/[^\s"']+:[^\s"']+@/g },
  { name: 'HTTP Basic Auth URL',   regex: /https?:\/\/[^:\s"']+:[^@\s"']+@[^\s"']+/g },

  // Hardcoded env fallbacks
  { name: 'Env Var Fallback',      regex: /process\.env\.[A-Z_]+\s*(?:\|\||\?\?)\s*["'][^"']{8,}["']/g },
];

// ---------------------------------------------------------------------------
// Whitelist loading
// ---------------------------------------------------------------------------

function loadWhitelist() {
  const defaults = { patterns: [], files: [], lines: [] };
  if (!fs.existsSync(WHITELIST_PATH)) return defaults;
  try {
    const raw = fs.readFileSync(WHITELIST_PATH, 'utf8');
    const wl = JSON.parse(raw);
    return {
      patterns: wl.patterns || [],
      files: wl.files || [],
      lines: wl.lines || []
    };
  } catch (e) {
    console.error(`Warning: could not parse whitelist file: ${e.message}`);
    return defaults;
  }
}

// Simple glob matching (supports * and **)
function globMatch(pattern, filepath) {
  // Normalize to forward slashes
  const p = pattern.replace(/\\/g, '/');
  const f = filepath.replace(/\\/g, '/');

  // Convert glob to regex
  let re = p
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp('^' + re + '$').test(f);
}

function isWhitelistedFile(relPath, whitelist) {
  return whitelist.files.some(pattern => globMatch(pattern, relPath));
}

function isWhitelistedMatch(relPath, matchText, whitelist) {
  // Check pattern whitelist (literal substring match)
  if (whitelist.patterns.some(wp => matchText.includes(wp))) return true;
  // Check line-level whitelist
  if (whitelist.lines.some(entry =>
    globMatch(entry.file, relPath) && matchText.includes(entry.pattern)
  )) return true;
  return false;
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

function isBinaryBuffer(buf) {
  // Check first 512 bytes for null bytes (binary indicator)
  const check = buf.slice(0, 512);
  for (let i = 0; i < check.length; i++) {
    if (check[i] === 0) return true;
  }
  return false;
}

function scanFileContent(content, relPath, whitelist) {
  const findings = [];
  const lines = content.split(/\r?\n/);

  for (const pattern of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Reset regex lastIndex for global patterns
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        const matchText = match[0];
        if (!isWhitelistedMatch(relPath, matchText, whitelist)) {
          findings.push({
            file: relPath,
            line: i + 1,
            pattern: pattern.name,
            match: matchText.length > 60 ? matchText.substring(0, 57) + '...' : matchText
          });
        }
      }
    }
  }
  return findings;
}

function scanFile(absPath, relPath, whitelist) {
  if (isWhitelistedFile(relPath, whitelist)) return [];

  const ext = path.extname(absPath).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return [];

  try {
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_FILE_SIZE) return [];
    if (stat.size === 0) return [];
  } catch {
    return [];
  }

  try {
    const buf = fs.readFileSync(absPath);
    if (isBinaryBuffer(buf)) return [];
    const content = buf.toString('utf8');
    return scanFileContent(content, relPath, whitelist);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// File collection modes
// ---------------------------------------------------------------------------

function getStagedFiles(cwd) {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.trim().split('\n').filter(f => f.length > 0);
  } catch {
    return [];
  }
}

function walkDirectory(dir, rootDir, collected) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walkDirectory(fullPath, rootDir, collected);
      }
    } else if (entry.isFile()) {
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      collected.push({ abs: fullPath, rel: relPath });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(findings, mode) {
  if (findings.length === 0) {
    console.log(`[secret-scan] ${mode}: No secrets detected. All clear.`);
    return 0;
  }

  console.error(`\n[secret-scan] ${mode}: Found ${findings.length} potential secret(s)!\n`);
  console.error('-----------------------------------------------------------');

  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    Pattern: ${f.pattern}`);
    console.error(`    Match:   ${f.match}`);
    console.error('');
  }

  console.error('-----------------------------------------------------------');
  console.error('Commit blocked. Remove the secret or add to .secret-scan-whitelist.json');
  console.error('To bypass (not recommended): git commit --no-verify\n');
  return 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const whitelist = loadWhitelist();
  let files = [];
  let mode = 'manual';

  if (args.includes('--staged')) {
    mode = 'pre-commit (staged files)';
    const staged = getStagedFiles(PROJECT_ROOT);
    files = staged.map(rel => ({
      abs: path.join(PROJECT_ROOT, rel),
      rel
    }));
  } else if (args.includes('--all')) {
    mode = 'full repo scan';
    walkDirectory(PROJECT_ROOT, PROJECT_ROOT, files);
  } else if (args.includes('--path')) {
    const idx = args.indexOf('--path');
    const target = args[idx + 1];
    if (!target) {
      console.error('Usage: --path <file-or-directory>');
      process.exit(1);
    }
    const absTarget = path.resolve(target);
    mode = `path scan (${target})`;
    const stat = fs.statSync(absTarget);
    if (stat.isDirectory()) {
      walkDirectory(absTarget, absTarget, files);
    } else {
      files = [{ abs: absTarget, rel: path.basename(absTarget) }];
    }
  } else {
    console.log('Usage:');
    console.log('  node scripts/scan-secrets.js --staged   Scan staged files (pre-commit)');
    console.log('  node scripts/scan-secrets.js --all      Scan entire repo');
    console.log('  node scripts/scan-secrets.js --path <p> Scan specific file or directory');
    process.exit(0);
  }

  console.log(`[secret-scan] Mode: ${mode} | Files: ${files.length} | Whitelist: ${WHITELIST_PATH}`);

  const allFindings = [];
  for (const file of files) {
    const findings = scanFile(file.abs, file.rel, whitelist);
    allFindings.push(...findings);
  }

  const exitCode = printReport(allFindings, mode);
  process.exit(exitCode);
}

main();
