  // ── Media ──────────────────────────────────────────
  var IMAGE_EXTS = ['png','jpg','jpeg','gif','svg','webp'];
  var VIDEO_EXTS = ['mp4','webm','mov','avi'];
  var DOC_EXTS = ['pdf','doc','docx','txt','md','csv','xls','xlsx'];

  function mediaTypeIcon(ext) {
    if (VIDEO_EXTS.indexOf(ext) >= 0) return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
    if (DOC_EXTS.indexOf(ext) >= 0) return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  }

  async function loadMediaRecursive(dir, prefix) {
    var items = await api.get('/api/ls/' + dir);
    var result = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var relPath = prefix ? prefix + '/' + item.name : item.name;
      if (item.isDir) {
        var sub = await loadMediaRecursive(dir + '/' + item.name, relPath);
        result = result.concat(sub);
      } else {
        result.push({ name: relPath });
      }
    }
    return result;
  }

  async function loadMedia() {
    try {
      var results = await Promise.all([loadMediaRecursive('data/media', ''), loadMediaMetadata()]);
      var mediaFiles = results[0];
      var metadata = results[1] || {};
      var el = document.getElementById('media-grid');
      // Filter out _index.json from file list
      mediaFiles = mediaFiles.filter(function(f) { return f.name !== '_index.json'; });
      if (state.mediaFilter && state.mediaFilter !== 'all') {
        var extMap = { image: IMAGE_EXTS, video: VIDEO_EXTS, document: DOC_EXTS };
        var allowedExts = extMap[state.mediaFilter] || [];
        mediaFiles = mediaFiles.filter(function(f) {
          var ext = f.name.split('.').pop().toLowerCase();
          return allowedExts.indexOf(ext) >= 0;
        });
      }

      if (mediaFiles.length === 0) {
        el.innerHTML = '<div class="empty-state">No media files yet</div>';
        return;
      }
      el.innerHTML = mediaFiles.map(function(f) {
        var ext = f.name.split('.').pop().toLowerCase();
        var isImage = IMAGE_EXTS.indexOf(ext) >= 0;
        var typeStr = isImage ? 'image' : (VIDEO_EXTS.indexOf(ext) >= 0 ? 'video' : 'document');
        var displayName = f.name.split('/').pop();
        var truncName = displayName.length > 20 ? displayName.slice(0, 17) + '...' : displayName;
        var subdir = f.name.indexOf('/') >= 0 ? f.name.substring(0, f.name.lastIndexOf('/')) : '';
        var subdirBadge = subdir ? '<span style="font-size:10px;color:var(--text-muted);display:block;overflow:hidden;text-overflow:ellipsis">' + escHtml(subdir) + '</span>' : '';
        var meta = metadata[f.name] || {};
        var tagsBadge = (meta.tags && meta.tags.length > 0) ? '<div class="media-thumb-tags">' + meta.tags.map(function(t) { return '<span class="tag-badge tag-badge-sm">' + escHtml(t) + '</span>'; }).join('') + '</div>' : '';
        // Encode path segments individually to support subdirectories
        var encodedPath = f.name.split('/').map(encodeURIComponent).join('/');
        if (isImage) {
          return '<div class="media-thumb" onclick="App.openMediaPreview(\'' + escHtml(f.name.replace(/'/g, "\\'")) + '\',\'' + typeStr + '\')">' +
            '<img src="/api/raw/data/media/' + encodedPath + '" alt="' + escHtml(f.name) + '">' +
            '<div class="media-thumb-info">' + subdirBadge + '<span class="media-thumb-name" title="' + escHtml(f.name) + '">' + escHtml(truncName) + '</span>' + tagsBadge + '</div></div>';
        }
        return '<div class="media-thumb" onclick="App.openMediaPreview(\'' + escHtml(f.name.replace(/'/g, "\\'")) + '\',\'' + typeStr + '\')">' +
          '<div class="media-thumb-icon">' + mediaTypeIcon(ext) + '</div>' +
          '<div class="media-thumb-info">' + subdirBadge + '<span class="media-thumb-name" title="' + escHtml(f.name) + '">' + escHtml(truncName) + '</span>' + tagsBadge + '</div></div>';
      }).join('');
    } catch(e) {
      document.getElementById('media-grid').innerHTML = '<div class="empty-state">No media files yet</div>';
    }
  }

  function openMediaPreview(filename, type) {
    state.currentMediaFile = filename;
    var content = document.getElementById('media-preview-content');
    var encodedPath = filename.split('/').map(encodeURIComponent).join('/');
    var meta = (mediaMetadataCache || {})[filename] || {};
    var metaHtml = '<div class="media-meta-panel">' +
      '<div class="form-group"><label>Tags</label><input type="text" id="media-meta-tags" value="' + escHtml((meta.tags || []).join(', ')) + '" placeholder="tag1, tag2"></div>' +
      '<div class="form-group"><label>Description</label><input type="text" id="media-meta-desc" value="' + escHtml(meta.description || '') + '" placeholder="Optional description"></div>' +
      '<button class="btn btn-secondary btn-sm" onclick="App.saveMediaMeta()">Save Metadata</button>' +
      '</div>';
    if (type === 'image') {
      content.innerHTML = '<img src="/api/raw/data/media/' + encodedPath + '" alt="' + escHtml(filename) + '" style="max-width:100%;max-height:60vh;display:block;margin:0 auto 12px;border-radius:6px">' +
        '<p style="text-align:center;color:var(--text-muted);font-size:13px">' + escHtml(filename) + '</p>' + metaHtml;
    } else {
      var ext = filename.split('.').pop().toLowerCase();
      var icon = mediaTypeIcon(ext);
      content.innerHTML = '<div style="text-align:center;padding:32px">' +
        '<div style="font-size:64px;margin-bottom:16px">' + icon + '</div>' +
        '<p style="font-size:16px;font-weight:500;margin-bottom:8px">' + escHtml(filename) + '</p>' +
        '<p style="color:var(--text-muted);font-size:13px">Type: ' + escHtml(ext.toUpperCase()) + '</p></div>' + metaHtml;
    }
    document.getElementById('media-preview-modal').classList.remove('hidden');
  }

  async function saveMediaMeta() {
    if (!state.currentMediaFile) return;
    var tagsStr = document.getElementById('media-meta-tags').value.trim();
    var tags = tagsStr ? tagsStr.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
    var description = document.getElementById('media-meta-desc').value.trim();
    try {
      await api.put('/api/media/metadata/' + encodeURIComponent(state.currentMediaFile), { tags: tags, description: description });
      toast('Metadata saved');
      if (mediaMetadataCache) {
        if (!mediaMetadataCache[state.currentMediaFile]) mediaMetadataCache[state.currentMediaFile] = {};
        mediaMetadataCache[state.currentMediaFile].tags = tags;
        mediaMetadataCache[state.currentMediaFile].description = description;
      }
    } catch(e) {
      toast('Failed to save metadata', 'error');
    }
  }

  function closeMediaPreview() {
    document.getElementById('media-preview-modal').classList.add('hidden');
    state.currentMediaFile = null;
  }

  async function openMediaFolder() {
    if (!state.currentMediaFile) return;
    try {
      await api.post('/api/media/open-folder', { filename: state.currentMediaFile });
    } catch(e) {
      showToast('Could not open folder', 'error');
    }
  }

  // ── Quick-Add to KB / Media Modals ──────────────────
  function openAddToKb(taskId, version, encodedFilename) {
    var filename = decodeURIComponent(encodedFilename);
    var task = state.currentTask || {};
    var title = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    document.getElementById('add-kb-title').value = title;
    document.getElementById('add-kb-category').value = 'reference';
    document.getElementById('add-kb-tags').value = (task.tags || []).join(', ');
    document.getElementById('add-kb-summary').value = '';
    document.getElementById('add-kb-modal').dataset.taskId = taskId;
    document.getElementById('add-kb-modal').dataset.version = version;
    document.getElementById('add-kb-modal').dataset.filename = encodedFilename;
    document.getElementById('add-kb-modal').classList.remove('hidden');
  }

  function closeAddToKb() {
    document.getElementById('add-kb-modal').classList.add('hidden');
  }

  async function submitAddToKb() {
    var modal = document.getElementById('add-kb-modal');
    var taskId = modal.dataset.taskId;
    var version = modal.dataset.version;
    var filename = modal.dataset.filename;
    var title = document.getElementById('add-kb-title').value.trim();
    var category = document.getElementById('add-kb-category').value;
    var tagsStr = document.getElementById('add-kb-tags').value.trim();
    var tags = tagsStr ? tagsStr.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
    var summary = document.getElementById('add-kb-summary').value.trim();
    try {
      await api.post('/api/tasks/' + taskId + '/versions/' + version + '/files/' + filename + '/add-to-kb', {
        title: title, category: category, tags: tags, summary: summary
      });
      toast('Added to Knowledge Base');
      closeAddToKb();
    } catch(e) {
      toast('Failed: ' + (e.body ? e.body.error : e.message), 'error');
    }
  }

  async function openAddToMedia(taskId, version, encodedFilename, rawUrl) {
    var filename = decodeURIComponent(encodedFilename);
    document.getElementById('add-media-filename').value = filename;
    document.getElementById('add-media-preview').innerHTML = rawUrl ? '<img src="' + rawUrl + '" style="max-width:200px;max-height:120px;border-radius:6px;border:1px solid var(--border)">' : '';
    document.getElementById('add-media-modal').dataset.taskId = taskId;
    document.getElementById('add-media-modal').dataset.version = version;
    document.getElementById('add-media-modal').dataset.filename = encodedFilename;
    // Load folder list
    var folderSelect = document.getElementById('add-media-folder');
    folderSelect.innerHTML = '<option value="social-images">social-images</option><option value="deliverables">deliverables</option>';
    try {
      var data = await api.get('/api/media/folders');
      var existing = ['social-images', 'deliverables'];
      (data.folders || []).forEach(function(f) {
        if (existing.indexOf(f) < 0) {
          folderSelect.innerHTML += '<option value="' + escHtml(f) + '">' + escHtml(f) + '</option>';
          existing.push(f);
        }
      });
    } catch(e) {}
    document.getElementById('add-media-modal').classList.remove('hidden');
  }

  function closeAddToMedia() {
    document.getElementById('add-media-modal').classList.add('hidden');
  }

  async function submitAddToMedia() {
    var modal = document.getElementById('add-media-modal');
    var taskId = modal.dataset.taskId;
    var version = modal.dataset.version;
    var filename = modal.dataset.filename;
    var folder = document.getElementById('add-media-folder').value;
    var newName = document.getElementById('add-media-filename').value.trim();
    try {
      await api.post('/api/tasks/' + taskId + '/versions/' + version + '/files/' + filename + '/copy-to-media', {
        folder: folder, newName: newName || undefined
      });
      toast('Added to Media Library');
      closeAddToMedia();
    } catch(e) {
      toast('Failed: ' + (e.body ? e.body.error : e.message), 'error');
    }
  }

  // ── Media Library with Metadata ──────────────────────
  var mediaMetadataCache = null;

  async function loadMediaMetadata() {
    try {
      var data = await api.get('/api/media/metadata');
      mediaMetadataCache = data.files || {};
    } catch(e) {
      mediaMetadataCache = {};
    }
    return mediaMetadataCache;
  }

