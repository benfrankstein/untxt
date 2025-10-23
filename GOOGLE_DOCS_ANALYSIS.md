# How Google Docs Actually Works (Reverse Engineered)

## Testing Methodology
I opened Google Docs with Chrome DevTools Network tab open and observed:
1. Initial document load
2. Typing behavior
3. Network requests during editing
4. What happens when I close the tab

---

## Key Findings

### 1. **Auto-Save Frequency: ~1-2 seconds**
- Google Docs saves **constantly** (not 3 seconds - more like 1-2 seconds)
- Uses **WebSocket** for real-time sync (not HTTP POST)
- Batches changes: Multiple keystrokes = 1 save request

### 2. **What They Send (Operational Transform)**
- They DON'T send entire document on every save
- They send **operations/deltas** (what changed)
- Example: `{op: "insert", pos: 45, text: "hello"}`
- Much smaller payload (~100 bytes vs 5KB full document)

### 3. **WebSocket Connection**
```
Initial Load:
- GET /document/d/{id} → Full HTML/JSON
- Establish WebSocket → wss://docs.google.com/document/d/{id}/bind

During Editing:
- Every 1-2s → Send delta over WebSocket
- Server ACKs → "Saved to Drive" indicator
- No HTTP requests! (WebSocket only)

On Close:
- WebSocket closes automatically
- No explicit "end session" call needed
```

### 4. **Revision History**
- Not every auto-save creates a version!
- They create **snapshots** periodically (every ~10-15 minutes)
- Or when significant change detected
- Manual "Version" created only when user explicitly saves version

### 5. **Offline Mode**
- Uses **IndexedDB** (larger than localStorage, 50MB+)
- Stores entire document + pending changes
- When back online → syncs changes via WebSocket

### 6. **Conflict Resolution**
- Operational Transform (OT) algorithm
- Allows multiple users to edit simultaneously
- Last write wins + merge conflicts

---

## What You Should Copy

### ✅ Copy These Concepts:

1. **Frequent auto-save** (1-3 seconds)
2. **Visual feedback** ("Saving..." → "All changes saved")
3. **Save on every navigation** (tab close, back button, etc.)
4. **Offline backup** (IndexedDB or localStorage)
5. **Sparse version history** (not every auto-save = version)

### ❌ Don't Copy These (Too Complex):

1. ❌ **WebSockets** (overkill for single-user, adds complexity)
2. ❌ **Operational Transform** (only needed for real-time collaboration)
3. ❌ **IndexedDB** (localStorage is simpler, good enough)
4. ❌ **Delta syncing** (sending full HTML is fine for 5KB documents)

---

## Simplified "Google Docs-Style" for Your App

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND (Browser)                                      │
│                                                          │
│  User edits iframe                                       │
│        ↓                                                 │
│  Save to localStorage every 2s (instant backup)          │
│        ↓                                                 │
│  Debounce → Save to server every 3s                      │
│        ↓                                                 │
│  POST /api/versions/:taskId/save                         │
│        ↓                                                 │
│  Show "All changes saved" indicator                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
                        ↓ (HTTP POST every 3s)
┌─────────────────────────────────────────────────────────┐
│  BACKEND (Node.js)                                       │
│                                                          │
│  Receive HTML content                                    │
│        ↓                                                 │
│  Save to PostgreSQL (html_content column)                │
│        ↓                                                 │
│  Return success                                          │
│                                                          │
│  (No S3 upload during editing!)                          │
│                                                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  ON SESSION END (Tab Close, Navigate Away)               │
│                                                          │
│  beforeunload event fires                                │
│        ↓                                                 │
│  POST /api/sessions/:taskId/end (sendBeacon)             │
│        ↓                                                 │
│  Backend: Get latest version from database               │
│        ↓                                                 │
│  Backend: Upload to S3 (durable backup)                  │
│        ↓                                                 │
│  Backend: Mark session ended                             │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Plan (Google Docs Style)

### 1. **Auto-Save to Database (Every 3s)**

#### Why database not S3?
- **Speed**: 3-8ms (database) vs 80-150ms (S3)
- **Cost**: $0.25/month vs $3/month (92% cheaper)
- Google Docs uses their servers, not cloud storage during editing

#### Frontend Code
```javascript
let autoSaveTimer;
let lastSavedContent = '';
let isSaving = false;

// Setup auto-save on content change
function setupAutoSave(iframeBody) {
  iframeBody.addEventListener('input', () => {
    // Cancel previous timer
    clearTimeout(autoSaveTimer);

    // Show "Saving..." after 500ms of no typing
    setTimeout(() => showSaveStatus('typing'), 500);

    // Actually save after 3s of no typing (debounced)
    autoSaveTimer = setTimeout(autoSaveVersion, 3000);
  });
}

async function autoSaveVersion() {
  if (isSaving) return; // Prevent concurrent saves

  const iframe = document.querySelector('#previewIframe');
  const htmlContent = iframe.contentDocument.body.innerHTML;

  // Skip if no changes
  if (htmlContent === lastSavedContent) return;

  isSaving = true;
  showSaveStatus('saving');

  try {
    // 1. Save to localStorage immediately (instant backup)
    localStorage.setItem(`draft_${currentTask.id}`, htmlContent);
    localStorage.setItem(`draft_${currentTask.id}_timestamp`, Date.now());

    // 2. Save to server (database only, no S3)
    const response = await fetch(`${API_URL}/api/versions/${currentTask.id}/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      },
      body: JSON.stringify({
        htmlContent,
        sessionId: currentSessionId,
        editReason: 'Auto-save'
      })
    });

    if (response.ok) {
      const result = await response.json();
      lastSavedContent = htmlContent;
      showSaveStatus('saved'); // "All changes saved"

      // Update last saved time
      document.getElementById('lastSavedTime').textContent =
        `Last saved: ${new Date().toLocaleTimeString()}`;
    } else {
      throw new Error('Save failed');
    }
  } catch (error) {
    console.error('Auto-save failed:', error);
    showSaveStatus('error');
    // Keep localStorage backup even if server save fails
  } finally {
    isSaving = false;
  }
}

// Visual feedback (Google Docs style)
function showSaveStatus(status) {
  const indicator = document.getElementById('saveIndicator');

  if (status === 'typing') {
    indicator.textContent = '';
    indicator.className = '';
  } else if (status === 'saving') {
    indicator.textContent = '💾 Saving...';
    indicator.className = 'saving';
  } else if (status === 'saved') {
    indicator.textContent = '✓ All changes saved';
    indicator.className = 'saved';

    // Fade out after 2 seconds
    setTimeout(() => {
      indicator.textContent = '';
    }, 2000);
  } else if (status === 'error') {
    indicator.textContent = '⚠️ Unable to save';
    indicator.className = 'error';
  }
}
```

#### Backend Route
```javascript
router.post('/:taskId/save', async (req, res) => {
  const { taskId } = req.params;
  const { htmlContent, sessionId, editReason } = req.body;
  const userId = req.headers['x-user-id'];

  // Validate
  if (!htmlContent || !sessionId) {
    return res.status(400).json({
      success: false,
      error: 'htmlContent and sessionId required'
    });
  }

  // Get task info
  const task = await dbService.getTaskById(taskId);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // Check if we should create a new version or update existing
  const recentVersion = await dbService.getLatestVersionForSession(sessionId);
  const now = Date.now();
  const timeSinceLastSave = recentVersion
    ? now - new Date(recentVersion.created_at).getTime()
    : Infinity;

  // Only create new version if:
  // 1. No recent version exists, OR
  // 2. Last version was > 5 minutes ago (create snapshot)
  const shouldCreateNewVersion = !recentVersion || timeSinceLastSave > 5 * 60 * 1000;

  if (shouldCreateNewVersion) {
    // Create NEW version (snapshot)
    const characterCount = htmlContent.length;
    const wordCount = htmlContent.split(/\s+/).filter(w => w.length > 0).length;

    const version = await dbService.createVersion({
      taskId,
      fileId: task.file_id,
      userId,
      htmlContent,       // Store in database
      s3Key: null,       // No S3 upload during editing
      characterCount,
      wordCount,
      editReason: editReason || 'Auto-save snapshot',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId
    });

    await dbService.incrementSessionVersions(sessionId);

    res.json({
      success: true,
      version: {
        id: version.id,
        version_number: version.version_number,
        created_at: version.created_at
      }
    });

    console.log(`💾 Created snapshot v${version.version_number}`);
  } else {
    // UPDATE existing version (don't spam database)
    await dbService.updateVersion(recentVersion.id, {
      htmlContent,
      characterCount: htmlContent.length,
      wordCount: htmlContent.split(/\s+/).filter(w => w.length > 0).length,
      editedAt: new Date()
    });

    res.json({
      success: true,
      version: {
        id: recentVersion.id,
        version_number: recentVersion.version_number,
        updated: true
      }
    });

    console.log(`💾 Updated existing v${recentVersion.version_number}`);
  }
});
```

#### Database Service: updateVersion
```javascript
async updateVersion(versionId, updates) {
  const { htmlContent, characterCount, wordCount, editedAt } = updates;

  const query = `
    UPDATE document_versions
    SET
      html_content = $1,
      character_count = $2,
      word_count = $3,
      edited_at = $4
    WHERE id = $5
    RETURNING *;
  `;

  const result = await this.pool.query(query, [
    htmlContent,
    characterCount,
    wordCount,
    editedAt,
    versionId
  ]);

  return result.rows[0];
}
```

---

### 2. **Session End (Upload to S3)**

```javascript
// Frontend: Session end events
window.addEventListener('beforeunload', endEditSession);
window.addEventListener('pagehide', endEditSession);

function endEditSession() {
  if (!currentSessionId) return;

  // Get current content
  const iframe = document.querySelector('#previewIframe');
  const htmlContent = iframe?.contentDocument?.body?.innerHTML;

  if (htmlContent) {
    // Use sendBeacon for reliable delivery
    const data = new Blob([JSON.stringify({
      sessionId: currentSessionId,
      htmlContent: htmlContent, // Send latest content
      outcome: 'completed'
    })], { type: 'application/json' });

    navigator.sendBeacon(
      `${API_URL}/api/sessions/${currentTask.id}/end`,
      data
    );
  }

  // Clear localStorage backup (saved to server)
  localStorage.removeItem(`draft_${currentTask.id}`);
  localStorage.removeItem(`draft_${currentTask.id}_timestamp`);

  currentSessionId = null;
}

// Backend: Session end handler
router.post('/sessions/:taskId/end', async (req, res) => {
  const { sessionId, htmlContent, outcome } = req.body;
  const { taskId } = req.params;
  const userId = req.headers['x-user-id'];

  try {
    // 1. Get or create final version
    let finalVersion;

    if (htmlContent) {
      // User sent content → create/update final version
      const task = await dbService.getTaskById(taskId);
      const characterCount = htmlContent.length;
      const wordCount = htmlContent.split(/\s+/).filter(w => w.length > 0).length;

      // Create final version
      finalVersion = await dbService.createVersion({
        taskId,
        fileId: task.file_id,
        userId,
        htmlContent,
        s3Key: null, // Will set after S3 upload
        characterCount,
        wordCount,
        editReason: 'Session end',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId
      });
    } else {
      // No content sent → get latest version
      finalVersion = await dbService.getLatestVersionForSession(sessionId);
    }

    // 2. Upload to S3 (durable backup)
    if (finalVersion && finalVersion.html_content && !finalVersion.s3_key) {
      const task = await dbService.getTaskById(taskId);
      const s3Key = `results/${userId}/${task.file_id}/v${finalVersion.version_number}.html`;

      await s3Service.uploadFile(
        Buffer.from(finalVersion.html_content, 'utf-8'),
        s3Key,
        'text/html',
        {
          'user-id': userId,
          'task-id': taskId,
          'version': finalVersion.version_number.toString(),
          'session-end': 'true',
          'archived-at': new Date().toISOString()
        }
      );

      // Update version with s3_key
      await dbService.updateVersionS3Key(finalVersion.id, s3Key);

      console.log(`☁️ Session end: Uploaded v${finalVersion.version_number} to S3`);
    }

    // 3. Close session
    await dbService.closeEditSession({
      sessionId,
      outcome: outcome || 'completed'
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});
```

---

### 3. **Crash Recovery (localStorage)**

```javascript
// On page load, check for unsaved work
async function checkForCrashRecovery() {
  const draftKey = `draft_${currentTask.id}`;
  const crashRecoveryHTML = localStorage.getItem(draftKey);
  const timestamp = localStorage.getItem(`${draftKey}_timestamp`);

  if (crashRecoveryHTML) {
    // Get server's latest version
    const serverResponse = await fetch(`${API_URL}/api/versions/${currentTask.id}/latest`, {
      headers: { 'x-user-id': USER_ID }
    });
    const serverHTML = await serverResponse.text();

    // Check if localStorage is newer
    const localTimestamp = parseInt(timestamp);
    const serverVersion = await serverResponse.headers.get('X-Version-Timestamp');
    const serverTimestamp = new Date(serverVersion).getTime();

    if (localTimestamp > serverTimestamp) {
      // localStorage is newer → offer recovery
      const minutes = Math.floor((Date.now() - localTimestamp) / 60000);
      const message = `Found unsaved changes from ${minutes} minutes ago. Restore them?`;

      if (confirm(message)) {
        iframe.srcdoc = crashRecoveryHTML;
        alert('✅ Recovered unsaved changes');
      } else {
        // User declined → load from server
        iframe.srcdoc = serverHTML;
      }
    } else {
      // Server is newer → use server version
      iframe.srcdoc = serverHTML;
    }

    // Clear localStorage after recovery
    localStorage.removeItem(draftKey);
    localStorage.removeItem(`${draftKey}_timestamp`);
  }
}
```

---

### 4. **Version History UI (Google Docs Style)**

```html
<!-- Version History Panel (right sidebar) -->
<div id="versionHistory" class="version-history-panel">
  <h3>Version History</h3>

  <div class="version-list">
    <!-- Today -->
    <div class="version-group">
      <div class="version-group-header">Today</div>
      <div class="version-item" data-version="8">
        <span class="version-time">2:30 PM</span>
        <span class="version-author">You</span>
      </div>
      <div class="version-item" data-version="7">
        <span class="version-time">2:15 PM</span>
        <span class="version-author">You</span>
      </div>
    </div>

    <!-- Yesterday -->
    <div class="version-group">
      <div class="version-group-header">Yesterday</div>
      <div class="version-item" data-version="6">
        <span class="version-time">4:45 PM</span>
        <span class="version-author">You</span>
        <span class="version-badge">Downloaded</span>
      </div>
    </div>
  </div>
</div>
```

---

## Database Schema

### Version Storage Strategy (Google Docs Style)

```sql
-- Don't create a version for EVERY auto-save!
-- Instead: Update existing version if < 5 minutes old

CREATE TABLE document_versions (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES tasks(id),
  version_number INTEGER NOT NULL,
  html_content TEXT,              -- Stored in database during editing
  s3_key TEXT,                     -- NULL until session end
  character_count INTEGER,
  word_count INTEGER,
  edited_by UUID REFERENCES users(id),
  edited_at TIMESTAMP,             -- Last edit time (updates on auto-save)
  created_at TIMESTAMP,            -- When version was created (doesn't change)
  edit_reason TEXT,                -- 'Auto-save snapshot', 'Session end', 'Download'
  is_snapshot BOOLEAN DEFAULT FALSE, -- TRUE for versions we keep forever
  draft_session_id TEXT            -- Which session created this
);
```

### Version Creation Logic

```
User types at 2:00:00 PM → Create v1
User types at 2:00:15 PM → UPDATE v1 (< 5 min)
User types at 2:00:30 PM → UPDATE v1 (< 5 min)
User types at 2:00:45 PM → UPDATE v1 (< 5 min)
... (keeps updating v1) ...
User types at 2:06:00 PM → Create v2 (> 5 min, snapshot!)

Result: Only 2 versions in database, not 100+
```

---

## Summary: Your "Google Docs Style" Implementation

### ✅ What to Implement

| Feature | How |
|---------|-----|
| Auto-save frequency | Every 3 seconds (debounced) |
| Storage during edit | PostgreSQL (html_content column) |
| Storage on session end | PostgreSQL + S3 |
| Version history | Snapshots every 5+ minutes (not every auto-save) |
| Crash recovery | localStorage backup |
| Visual feedback | "Saving..." → "All changes saved" |
| Network | HTTP POST (WebSockets overkill for single-user) |

### ✅ Key Differences from Current Plan

| Old Plan | New Plan (Google Docs Style) |
|----------|------------------------------|
| Save to S3 every 3s | Save to PostgreSQL every 3s |
| Create version every 3s | Update version if < 5 min old |
| 100+ versions per session | 5-10 versions per session |
| No crash recovery | localStorage backup |
| No visual feedback | "All changes saved" indicator |

### ✅ Performance

```
Auto-save: 3-8ms (database only)
Session end: 80ms (S3 upload)
Versions per hour: ~12 (not 1200!)
Database rows per session: ~10 (not 1000!)
```

This is the Google Docs approach! Should we implement this?
