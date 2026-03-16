#!/usr/bin/env node
/**
 * migrate-max.js — Migrates tasks from MAX (markdown) format into TeamHero API.
 *
 * Usage:
 *   node migrate-max.js
 *
 * Requires the TeamHero server to be running at http://localhost:3782.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const MAX_TASKS_DIR = path.join('C:', 'Users', 'sagiy', 'OneDrive', 'Documents', 'MAX', 'tmp', 'tasks');
const API_BASE = 'http://localhost:3782';

// ── Agent name mapping ──────────────────────────────────
const AGENT_MAP = {
  'bruno': 'mmseaqj5hyzjmm',
  'fetch': 'mmsgzss0845l7c',
  'scout': 'mmsgzss0845l7c',
  'sogo':  'orchestrator',
  'luna':  'orchestrator',
  'pulse': 'orchestrator',
};

// ── Priority mapping ────────────────────────────────────
const PRIORITY_MAP = {
  'p0': 'urgent',
  'p1': 'high',
  'p2': 'medium',
  'p3': 'low',
};

// ── Status mapping ──────────────────────────────────────
function mapStatus(raw) {
  var s = raw.toLowerCase().replace(/\s*\(.*\)/, '').trim();
  if (s === 'done') return 'done';
  if (s === 'in review' || s === 'pending' || s === 'awaiting decision' || s === 'needs manual check') return 'pending_approval';
  if (s === 'in progress') return 'in_progress';
  if (s === 'ready for dev' || s.indexOf('approved') !== -1) return 'approved';
  if (s === 'on hold' || s === 'blocked') return 'draft';
  if (s.indexOf('confirmed') !== -1) return 'approved';
  return 'draft';
}

// ── HTTP helper ─────────────────────────────────────────
function apiRequest(method, urlPath, data) {
  return new Promise(function(resolve, reject) {
    var body = data ? JSON.stringify(data) : '';
    var opts = {
      hostname: 'localhost',
      port: 3782,
      path: urlPath,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    var req = http.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var text = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(text)); }
        catch(e) { resolve(text); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Markdown parser ─────────────────────────────────────
function parseMaxTask(content) {
  var result = {
    tags: [],
    title: '',
    agent: '',
    priority: 'medium',
    status: 'draft',
    brief: '',
    deliverable: '',
    resultText: '',
    versions: []
  };

  // Parse frontmatter
  var fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    var tagsMatch = fmMatch[1].match(/tags:\s*\[(.*?)\]/);
    if (tagsMatch) {
      result.tags = tagsMatch[1].split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    }
  }

  // Parse title from first # heading
  var titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    result.title = titleMatch[1].trim();
  }

  // Parse meta line: **Agent:** X | **Priority:** Px | **Status:** Y
  var metaMatch = content.match(/\*\*Agent:\*\*\s*(\w+)\s*\|\s*\*\*Priority:\*\*\s*(\S+)\s*\|\s*\*\*Status:\*\*\s*(.+)/);
  if (metaMatch) {
    result.agent = metaMatch[1].trim().toLowerCase();
    var rawPriority = metaMatch[2].trim().toLowerCase();
    result.priority = PRIORITY_MAP[rawPriority] || 'medium';
    result.status = mapStatus(metaMatch[3].trim());
  }

  // Split content into sections by ## headings
  var sections = [];
  var sectionRegex = /^##\s+(.+)$/gm;
  var match;
  var positions = [];
  while ((match = sectionRegex.exec(content)) !== null) {
    positions.push({ title: match[1].trim(), start: match.index, headerEnd: match.index + match[0].length });
  }

  for (var i = 0; i < positions.length; i++) {
    var bodyStart = positions[i].headerEnd;
    var bodyEnd = (i + 1 < positions.length) ? positions[i + 1].start : content.length;
    var body = content.substring(bodyStart, bodyEnd).trim();
    sections.push({ title: positions[i].title, body: body });
  }

  // Process sections
  for (var s = 0; s < sections.length; s++) {
    var sec = sections[s];
    var secTitle = sec.title;
    var secBody = sec.body;

    // Remove trailing --- separators
    secBody = secBody.replace(/\n---\s*$/g, '').trim();

    if (secTitle === 'Brief') {
      result.brief = secBody;
    } else if (secTitle === 'Deliverable') {
      result.deliverable = secBody;
    } else if (secTitle === 'Result') {
      result.resultText = secBody;
    } else if (/^v\d+/.test(secTitle)) {
      // Version section, e.g. "v1 - 2026-03-05"
      var vNumMatch = secTitle.match(/^v(\d+)/);
      var vNum = vNumMatch ? parseInt(vNumMatch[1]) : 1;
      var vDateMatch = secTitle.match(/(\d{4}-\d{2}-\d{2})/);
      var vDate = vDateMatch ? vDateMatch[1] + 'T00:00:00.000Z' : null;

      // Split version body to extract founder feedback
      var founderIdx = secBody.indexOf('### Founder');
      var vContent = secBody;
      var founderComment = '';

      if (founderIdx !== -1) {
        vContent = secBody.substring(0, founderIdx).trim();
        founderComment = secBody.substring(founderIdx + '### Founder'.length).trim();
        // Remove trailing ---
        founderComment = founderComment.replace(/\n---\s*$/g, '').trim();
        vContent = vContent.replace(/\n---\s*$/g, '').trim();
      }

      // Determine version decision based on founder comment
      var decision = null;
      if (founderComment) {
        var lcComment = founderComment.toLowerCase();
        if (lcComment.indexOf('awaiting review') !== -1 || lcComment.indexOf('awaiting') !== -1) {
          decision = null; // still pending
        } else if (lcComment.indexOf('needs improvement') !== -1 || lcComment.indexOf('improve') !== -1) {
          decision = 'improve';
        } else if (lcComment.indexOf('approved') !== -1) {
          decision = 'approved';
        } else {
          // Has feedback but no explicit decision marker - treat as improve
          decision = 'improve';
        }
      }

      result.versions.push({
        number: vNum,
        content: vContent,
        comments: founderComment,
        decision: decision,
        submittedAt: vDate,
        decidedAt: decision ? vDate : null
      });
    } else if (secTitle.toLowerCase().indexOf('status') !== -1) {
      // Some files have a ## Status section, skip
    }
  }

  return result;
}

// ── Main migration ──────────────────────────────────────
async function migrate() {
  console.log('=== MAX to TeamHero Migration ===\n');

  // Verify API is running
  try {
    await apiRequest('GET', '/api/tasks');
  } catch(e) {
    console.error('ERROR: Cannot connect to TeamHero API at ' + API_BASE);
    console.error('Make sure the server is running (node server.js)');
    process.exit(1);
  }

  // Read all .md files
  var files;
  try {
    files = fs.readdirSync(MAX_TASKS_DIR).filter(function(f) { return f.endsWith('.md'); });
  } catch(e) {
    console.error('ERROR: Cannot read MAX tasks directory: ' + MAX_TASKS_DIR);
    process.exit(1);
  }

  console.log('Found ' + files.length + ' task files to migrate.\n');

  var success = 0;
  var errors = 0;

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var filePath = path.join(MAX_TASKS_DIR, file);
    var content = fs.readFileSync(filePath, 'utf8');
    var parsed = parseMaxTask(content);

    // Generate an ID from filename (e.g. "B-01 Hero Trust Statement.md" -> "b-01")
    var idMatch = file.match(/^([A-Z]-\d+)/);
    var taskId = idMatch ? idMatch[1].toLowerCase() : file.replace(/\.md$/, '').toLowerCase().replace(/\s+/g, '-');

    // Map agent name to TeamHero agent ID
    var assignedTo = AGENT_MAP[parsed.agent] || 'orchestrator';

    console.log('[' + (i + 1) + '/' + files.length + '] ' + file);
    console.log('  Title: ' + parsed.title);
    console.log('  Agent: ' + parsed.agent + ' -> ' + assignedTo);
    console.log('  Priority: ' + parsed.priority + ' | Status: ' + parsed.status);
    console.log('  Tags: ' + (parsed.tags.length > 0 ? parsed.tags.join(', ') : '(none)'));
    console.log('  Versions: ' + parsed.versions.length);

    try {
      // Create the task
      var taskData = {
        id: taskId,
        title: parsed.title,
        description: parsed.brief || parsed.deliverable || '',
        assignedTo: assignedTo,
        status: parsed.status,
        priority: parsed.priority,
        tags: parsed.tags,
        brief: parsed.brief
      };

      // If there's a deliverable or result at task level and we have versions, attach to v1
      var v1Content = '';
      var v1Deliverable = parsed.deliverable;
      var v1Result = parsed.resultText;

      if (parsed.versions.length > 0) {
        v1Content = parsed.versions[0].content;
        taskData.content = v1Content;
      }

      if (v1Deliverable) taskData.deliverable = v1Deliverable;
      if (v1Result) taskData.result = v1Result;

      var created = await apiRequest('POST', '/api/tasks', taskData);
      if (created.error) {
        console.log('  ERROR creating task: ' + created.error);
        errors++;
        continue;
      }

      // Update v1 with deliverable/result if present (these go on the version)
      if (v1Deliverable || v1Result || (parsed.versions.length > 0 && parsed.versions[0].comments)) {
        var v1Update = {};
        if (parsed.versions.length > 0) {
          v1Update.content = parsed.versions[0].content;
          v1Update.comments = parsed.versions[0].comments || '';
          v1Update.decision = parsed.versions[0].decision;
          v1Update.submittedAt = parsed.versions[0].submittedAt;
          v1Update.decidedAt = parsed.versions[0].decidedAt;
        }
        if (v1Deliverable) v1Update.deliverable = v1Deliverable;
        if (v1Result) v1Update.result = v1Result;
        await apiRequest('PUT', '/api/tasks/' + taskId + '/versions/1', v1Update);
      }

      // Create additional versions (v2, v3, ...)
      for (var v = 1; v < parsed.versions.length; v++) {
        var ver = parsed.versions[v];
        var vUpdate = {
          content: ver.content,
          comments: ver.comments || '',
          decision: ver.decision,
          status: ver.content ? 'submitted' : 'draft',
          submittedAt: ver.submittedAt,
          decidedAt: ver.decidedAt
        };
        await apiRequest('PUT', '/api/tasks/' + taskId + '/versions/' + ver.number, vUpdate);
      }

      // Update task version count to latest
      if (parsed.versions.length > 1) {
        var latestV = parsed.versions[parsed.versions.length - 1].number;
        await apiRequest('PUT', '/api/tasks/' + taskId, { version: latestV });
      }

      console.log('  -> OK');
      success++;
    } catch(e) {
      console.log('  ERROR: ' + e.message);
      errors++;
    }

    console.log('');
  }

  console.log('=== Migration Complete ===');
  console.log('Success: ' + success + ' | Errors: ' + errors + ' | Total: ' + files.length);
}

migrate().catch(function(e) {
  console.error('Migration failed:', e);
  process.exit(1);
});
