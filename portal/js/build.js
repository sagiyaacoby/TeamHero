'use strict';
/**
 * app.js build script
 * Concatenates portal/js/modules/app-*.js into portal/js/app.js
 * Run: node portal/js/build.js
 * Output: portal/js/app.js (identical structure to current file)
 */
const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.join(__dirname, 'modules');
const OUTPUT = path.join(__dirname, 'app.js');

// Read all module files in sorted order (app-00 through app-21)
const files = fs.readdirSync(MODULES_DIR)
  .filter(f => f.match(/^app-\d+.*\.js$/))
  .sort();

if (files.length === 0) {
  console.error('[build] No module files found in ' + MODULES_DIR);
  process.exit(1);
}

// Detect line ending style from first module file
const firstContent = fs.readFileSync(path.join(MODULES_DIR, files[0]), 'utf-8');
const eol = firstContent.includes('\r\n') ? '\r\n' : '\n';

const parts = [];
parts.push('(function() {' + eol + "  'use strict';" + eol + eol);

for (const file of files) {
  const content = fs.readFileSync(path.join(MODULES_DIR, file), 'utf-8');
  parts.push(content);
  // Ensure module ends with newline before next module
  if (!content.endsWith('\n')) parts.push(eol);
}

parts.push('})();' + eol);

fs.writeFileSync(OUTPUT, parts.join(''));
console.log('[build] Built app.js from ' + files.length + ' modules -> ' + OUTPUT);
