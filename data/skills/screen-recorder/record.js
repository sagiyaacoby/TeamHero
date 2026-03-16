/**
 * Screen Recorder Skill — ffmpeg-based desktop capture
 *
 * Usage:
 *   node record.js start [options]    Start recording
 *   node record.js stop               Stop the current recording
 *   node record.js status             Check if recording is active
 *
 * Options:
 *   --output <path>      Output file path (default: recordings/rec-<timestamp>.mp4)
 *   --fps <number>       Framerate (default: 15)
 *   --window <title>     Record a specific window by title instead of full desktop
 *   --region <WxH+X+Y>   Record a specific region, e.g. 1280x720+0+0
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SKILL_DIR = __dirname;
const PID_FILE = path.join(SKILL_DIR, '.recording.pid');
const META_FILE = path.join(SKILL_DIR, '.recording.json');
const REC_DIR = path.join(SKILL_DIR, 'recordings');

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

function isRecording() {
  if (!fs.existsSync(PID_FILE)) return false;
  var pid = fs.readFileSync(PID_FILE, 'utf8').trim();
  try {
    process.kill(parseInt(pid), 0); // test if process exists
    return true;
  } catch(e) {
    // stale pid file
    cleanup();
    return false;
  }
}

function cleanup() {
  try { fs.unlinkSync(PID_FILE); } catch(e) {}
}

function getMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch(e) { return null; }
}

function parseArgs(args) {
  var opts = { fps: 15, output: null, window: null, region: null };
  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i+1]) { opts.output = args[++i]; }
    else if (args[i] === '--fps' && args[i+1]) { opts.fps = parseInt(args[++i]); }
    else if (args[i] === '--window' && args[i+1]) { opts.window = args[++i]; }
    else if (args[i] === '--region' && args[i+1]) { opts.region = args[++i]; }
  }
  return opts;
}

function startRecording(opts) {
  if (isRecording()) {
    var meta = getMeta();
    console.log(JSON.stringify({ error: 'Already recording', output: meta ? meta.output : 'unknown' }));
    process.exit(1);
  }

  ensureDir(REC_DIR);

  var timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  var outputFile = opts.output || path.join(REC_DIR, 'rec-' + timestamp + '.mp4');

  // Ensure output directory exists
  ensureDir(path.dirname(outputFile));

  // Build ffmpeg args based on platform
  var ffArgs = [];
  var platform = process.platform;

  if (platform === 'win32') {
    // Windows: use GDI grab
    ffArgs.push('-f', 'gdigrab');
    ffArgs.push('-framerate', String(opts.fps));
    if (opts.window) {
      ffArgs.push('-i', 'title=' + opts.window);
    } else if (opts.region) {
      // region format: WxH+X+Y e.g. 1280x720+0+0
      var m = opts.region.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
      if (m) {
        ffArgs.push('-offset_x', m[3], '-offset_y', m[4]);
        ffArgs.push('-video_size', m[1] + 'x' + m[2]);
      }
      ffArgs.push('-i', 'desktop');
    } else {
      ffArgs.push('-i', 'desktop');
    }
  } else if (platform === 'darwin') {
    // macOS: use AVFoundation
    ffArgs.push('-f', 'avfoundation');
    ffArgs.push('-framerate', String(opts.fps));
    ffArgs.push('-i', '1:none'); // screen 1, no audio
  } else {
    // Linux: use x11grab
    ffArgs.push('-f', 'x11grab');
    ffArgs.push('-framerate', String(opts.fps));
    if (opts.region) {
      var m = opts.region.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
      if (m) {
        ffArgs.push('-video_size', m[1] + 'x' + m[2]);
        ffArgs.push('-i', ':0.0+' + m[3] + ',' + m[4]);
      } else {
        ffArgs.push('-i', ':0.0');
      }
    } else {
      ffArgs.push('-i', ':0.0');
    }
  }

  // Output encoding: H.264 with reasonable quality and fast encoding
  ffArgs.push('-c:v', 'libx264');
  ffArgs.push('-preset', 'ultrafast');
  ffArgs.push('-crf', '23');
  ffArgs.push('-pix_fmt', 'yuv420p');
  ffArgs.push('-movflags', '+faststart');
  ffArgs.push('-y'); // overwrite
  ffArgs.push(outputFile);

  // Spawn ffmpeg detached so it survives this script exiting
  var proc = spawn('ffmpeg', ffArgs, {
    detached: true,
    stdio: ['pipe', 'ignore', 'pipe'],
    shell: platform === 'win32'
  });

  var startupError = '';
  proc.stderr.on('data', function(chunk) {
    startupError += chunk.toString();
  });

  // Give ffmpeg a moment to start, then check it's alive
  setTimeout(function() {
    try {
      process.kill(proc.pid, 0);
      // It's running — save PID and metadata
      fs.writeFileSync(PID_FILE, String(proc.pid));
      var meta = {
        pid: proc.pid,
        output: outputFile,
        startedAt: new Date().toISOString(),
        fps: opts.fps,
        window: opts.window || null,
        region: opts.region || null
      };
      fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));

      proc.unref();
      console.log(JSON.stringify({ ok: true, recording: true, output: outputFile, pid: proc.pid }));
      process.exit(0);
    } catch(e) {
      console.log(JSON.stringify({ error: 'ffmpeg failed to start', details: startupError.slice(-500) }));
      process.exit(1);
    }
  }, 1500);
}

function stopRecording() {
  if (!isRecording()) {
    console.log(JSON.stringify({ error: 'No active recording' }));
    process.exit(1);
  }

  var pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
  var meta = getMeta();

  try {
    if (process.platform === 'win32') {
      // On Windows, send taskkill to gracefully stop ffmpeg
      execSync('taskkill /PID ' + pid, { timeout: 5000, stdio: 'ignore' });
    } else {
      // On Unix, send SIGINT (like pressing q) for graceful stop
      process.kill(pid, 'SIGINT');
    }
  } catch(e) {
    // Process may already be gone
  }

  // Wait a moment for ffmpeg to finalize the file
  setTimeout(function() {
    cleanup();
    var result = { ok: true, stopped: true };
    if (meta) {
      result.output = meta.output;
      result.startedAt = meta.startedAt;
      result.duration = Math.round((Date.now() - new Date(meta.startedAt).getTime()) / 1000) + 's';
      // Check file size
      try {
        var stat = fs.statSync(meta.output);
        result.fileSize = Math.round(stat.size / 1024) + ' KB';
      } catch(e) {}
    }
    try { fs.unlinkSync(META_FILE); } catch(e) {}
    console.log(JSON.stringify(result));
  }, 2000);
}

function showStatus() {
  if (!isRecording()) {
    console.log(JSON.stringify({ recording: false }));
    return;
  }
  var meta = getMeta();
  if (meta) {
    meta.recording = true;
    meta.elapsed = Math.round((Date.now() - new Date(meta.startedAt).getTime()) / 1000) + 's';
    console.log(JSON.stringify(meta));
  } else {
    console.log(JSON.stringify({ recording: true }));
  }
}

// --- Main ---
var command = process.argv[2];
var restArgs = process.argv.slice(3);

switch (command) {
  case 'start':
    startRecording(parseArgs(restArgs));
    break;
  case 'stop':
    stopRecording();
    break;
  case 'status':
    showStatus();
    break;
  default:
    console.log(JSON.stringify({
      error: 'Unknown command: ' + command,
      usage: 'node record.js <start|stop|status> [--output path] [--fps 15] [--window title] [--region WxH+X+Y]'
    }));
    process.exit(1);
}
