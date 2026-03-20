#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var { execSync, spawnSync } = require('child_process');
var readline = require('readline');

var VERSION = '2.8.2';

// ── Colors ──
var c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  cyan: '\x1b[36m', red: '\x1b[31m',
};

function log(msg) { console.log(msg); }
function ok(msg) { log('  ' + c.green + '✓' + c.reset + ' ' + msg); }
function info(msg) { log('  ' + c.blue + '→' + c.reset + ' ' + msg); }
function warn(msg) { log('  ' + c.yellow + '!' + c.reset + ' ' + msg); }
function err(msg) { log('  ' + c.red + '✗' + c.reset + ' ' + msg); }

function prompt(question, defaultValue) {
  return new Promise(function(resolve) {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, function(answer) {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

// ── Args ──
var args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  log('');
  log(c.bold + '  AI-Hero' + c.reset + ' - Multi-agent orchestration powered by Claude CLI');
  log('');
  log('  ' + c.dim + 'Usage:' + c.reset);
  log('    npx create-ai-hero ' + c.cyan + '[project-name]' + c.reset);
  log('');
  log('  ' + c.dim + 'If no project name is given, you will be prompted.' + c.reset);
  log('');
  log('  ' + c.dim + 'Example:' + c.reset);
  log('    npx create-ai-hero my-team');
  log('');
  process.exit(0);
}

async function main() {

log('');
log(c.bold + '  AI-Hero v' + VERSION + c.reset);
log(c.dim + '  Multi-agent orchestration powered by Claude CLI' + c.reset);
log('');

var projectName;
if (args.length > 0) {
  projectName = args[0].replace(/[^a-zA-Z0-9_\-\.]/g, '-');
} else {
  var answer = await prompt('  What would you like to name your team folder? ' + c.dim + '[MyTeam]' + c.reset + ': ', 'MyTeam');
  projectName = answer.replace(/[^a-zA-Z0-9_\-\.]/g, '-');
}

var projectDir = path.resolve(process.cwd(), projectName);

// ── Check if dir exists ──
if (fs.existsSync(projectDir)) {
  var contents = fs.readdirSync(projectDir);
  if (contents.length > 0) {
    err('Directory "' + projectName + '" already exists and is not empty.');
    process.exit(1);
  }
}

// ── Copy template ──
info('Creating project in ' + c.cyan + projectDir + c.reset);

var templateDir = path.join(__dirname, 'template');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  var entries = fs.readdirSync(src, { withFileTypes: true });
  entries.forEach(function(entry) {
    var srcPath = path.join(src, entry.name);
    var destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

copyDir(templateDir, projectDir);

// ── Create data directories ──
['data/tasks', 'data/round-tables', 'data/media', 'data/knowledge', 'data/skills', 'profile', 'agents'].forEach(function(d) {
  fs.mkdirSync(path.join(projectDir, d), { recursive: true });
});

// ── Write initial _index files ──
fs.writeFileSync(path.join(projectDir, 'data/tasks/_index.json'), '{"tasks":[]}\n');
fs.writeFileSync(path.join(projectDir, 'data/knowledge/_index.json'), '{"documents":[]}\n');
fs.writeFileSync(path.join(projectDir, 'agents/_registry.json'), '{"agents":[]}\n');
fs.writeFileSync(path.join(projectDir, 'profile/owner.json'), '{}\n');
fs.writeFileSync(path.join(projectDir, 'profile/owner.md'), '');

// ── Write system.json with team name from project name ──
var teamName = projectName.replace(/[-_]/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
fs.writeFileSync(path.join(projectDir, 'config/system.json'), JSON.stringify({
  initialized: false,
  teamName: teamName,
  teamDescription: '',
  version: VERSION
}, null, 2) + '\n');

ok('Project files created');

// ── Install npm dependencies ──
info('Installing dependencies...');
try {
  execSync('npm install --production', {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000
  });
  ok('Dependencies installed');
} catch(e) {
  warn('npm install failed. Run ' + c.cyan + 'cd ' + projectName + ' && npm install' + c.reset + ' manually.');
}

// ── Check for Claude CLI ──
var hasClaude = false;
try {
  execSync(process.platform === 'win32' ? 'where claude' : 'which claude', { stdio: 'ignore' });
  hasClaude = true;
} catch(e) {}

log('');
log(c.bold + c.green + '  ✓ AI-Hero project ready!' + c.reset);
log('');
log('  ' + c.dim + 'Next steps:' + c.reset);
log('');
log('    ' + c.cyan + 'cd ' + projectName + c.reset);

if (process.platform === 'win32') {
  log('    ' + c.cyan + 'launch.bat' + c.reset);
} else {
  log('    ' + c.cyan + 'bash launch.sh' + c.reset);
}

log('');

if (!hasClaude) {
  log('  ' + c.yellow + '⚠' + c.reset + '  Claude CLI not found. Install it for the Command Center:');
  log('    ' + c.cyan + 'npm install -g @anthropic-ai/claude-code' + c.reset);
  log('');
}

log('  The dashboard will open at ' + c.cyan + 'http://localhost:3777' + c.reset);
log('  Complete the setup wizard, then ask your orchestrator to build a team.');
log('');

} // end main

main().catch(function(e) { console.error(e); process.exit(1); });
