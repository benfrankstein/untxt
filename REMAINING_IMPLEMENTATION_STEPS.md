# Remaining Implementation Steps for Google Docs Flow

## Progress So Far ✅
1. ✅ Database migration applied (011_simplify_to_google_docs_flow.sql)
2. ✅ Added Google Docs flow functions to db.service.js:
   - `createVersion()` - Creates version immediately
   - `getLatestVersion()` - Gets latest version
   - `incrementSessionVersions()` - Tracks versions per session

## Remaining Work

### 1. Backend API Routes (`/backend/src/routes/versions.routes.js`)

**Replace draft endpoint with version endpoint:**

```javascript
// OLD: POST /api/versions/:taskId/draft
// NEW: POST /api/versions/:taskId/save

router.post('/:taskId/save', async (req, res) => {
  const { taskId } = req.params;
  const { content, editReason, sessionId } = req.body;
  const userId = req.headers['x-user-id'];

  // Upload to S3
  const s3Key = `results/${userId}/${fileId}/v${nextVersion}.html`;
  await s3Service.uploadFile(content, s3Key, 'text/html');

  // Create version (not draft!)
  const version = await dbService.createVersion({
    taskId,
    fileId,
    userId,
    s3Key,
    characterCount,
    wordCount,
    editReason: editReason || 'Auto-save',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    sessionId
  });

  // Increment session counter
  await dbService.incrementSessionVersions(sessionId);

  res.json({ success: true, version });
});
```

**Remove these endpoints:**
- ❌ `POST /api/versions/:taskId/publish` (no more publish button)
- ❌ `DELETE /api/versions/:taskId/draft` (no more cancel button)
- ❌ `GET /api/versions/:taskId/draft` (no more drafts)

**Add session endpoints:**
```javascript
// POST /api/sessions/:taskId/start
router.post('/sessions/:taskId/start', async (req, res) => {
  const { taskId } = req.params;
  const { sessionId } = req.body;
  const userId = req.headers['x-user-id'];

  const task = await dbService.getTaskById(taskId);

  const session = await dbService.createOrGetEditSession({
    taskId,
    userId,
    username: task.username,
    sessionId,
    draftId: null,  // No draft ID anymore
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    accessReason: 'owner'
  });

  res.json({ success: true, session });
});

// POST /api/sessions/:taskId/end
router.post('/sessions/:taskId/end', async (req, res) => {
  const { sessionId } = req.body;

  await dbService.closeEditSession({
    sessionId,
    outcome: 'completed',  // User closed document normally
    publishedVersionId: null
  });

  res.json({ success: true });
});
```

### 2. Frontend JavaScript (`/frontend/app.js`)

**Remove edit mode concept:**
```javascript
// DELETE these functions:
- enterEditMode()
- exitEditMode()
- cancelEditMode()
- publishDraft()
- loadExistingDraft()

// DELETE these variables:
- let isEditMode = false;
- let editSessionId = null;
- let currentDraft = null;
```

**Make content always editable:**
```javascript
// When document loads, make it editable immediately
async function showDocumentContent(task) {
  currentTask = task;

  // Get latest version
  const latestVersion = await fetch(`${API_URL}/api/versions/${task.id}/latest`, {
    headers: { 'x-user-id': USER_ID }
  });

  const version = await latestVersion.json();

  // Load HTML into iframe
  const iframe = document.querySelector('#previewIframe');
  iframe.src = version.s3_url;  // Or load via fetch

  // Wait for load, then make editable
  iframe.onload = () => {
    const iframeBody = iframe.contentDocument.body;
    iframeBody.contentEditable = 'true';
    iframeBody.style.outline = 'none';

    // Set up auto-save
    setupAutoSave(iframeBody);

    // Start session
    startEditSession();
  };
}
```

**Update auto-save to create versions:**
```javascript
// OLD: Saved as draft
async function autoSaveDraft() {
  const response = await fetch(`${API_URL}/api/versions/${currentTask.id}/draft`, {
    method: 'POST',
    body: JSON.stringify({ content: htmlContent, sessionId })
  });
}

// NEW: Creates version immediately
async function autoSaveVersion() {
  const iframe = document.querySelector('#previewIframe');
  const htmlContent = iframe.contentDocument.body.innerHTML;

  // Show "Saving..." indicator
  showSaveStatus('saving');

  const response = await fetch(`${API_URL}/api/versions/${currentTask.id}/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': USER_ID
    },
    body: JSON.stringify({
      content: htmlContent,
      editReason: 'Auto-save',
      sessionId: currentSessionId
    })
  });

  if (response.ok) {
    showSaveStatus('saved');  // Show "All changes saved"
  }
}
```

**Add session tracking:**
```javascript
let currentSessionId = null;

// Start session when document opens
async function startEditSession() {
  currentSessionId = `${USER_ID}_${currentTask.id}_${Date.now()}`;

  await fetch(`${API_URL}/api/sessions/${currentTask.id}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': USER_ID
    },
    body: JSON.stringify({ sessionId: currentSessionId })
  });

  console.log('📝 Edit session started:', currentSessionId);
}

// End session when user closes document
function endEditSession() {
  if (!currentSessionId) return;

  // Use sendBeacon for reliable delivery even if page is closing
  const data = JSON.stringify({ sessionId: currentSessionId });
  navigator.sendBeacon(
    `${API_URL}/api/sessions/${currentTask.id}/end`,
    data
  );

  console.log('✅ Edit session ended:', currentSessionId);
}

// Track session end events
window.addEventListener('beforeunload', endEditSession);  // Tab close
window.addEventListener('pagehide', endEditSession);       // Mobile
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    endEditSession();  // Tab switch/minimize
  }
});

// Also end session when navigating away
function goToDashboard() {
  endEditSession();
  // Then navigate...
}
```

**Add save status indicator:**
```javascript
function showSaveStatus(status) {
  const indicator = document.getElementById('saveIndicator');

  if (status === 'saving') {
    indicator.textContent = '💾 Saving...';
    indicator.className = 'saving';
  } else if (status === 'saved') {
    indicator.textContent = '✅ All changes saved';
    indicator.className = 'saved';

    // Hide after 2 seconds
    setTimeout(() => {
      indicator.textContent = '';
    }, 2000);
  }
}
```

### 3. Frontend HTML (`/frontend/index.html`)

**Remove these UI elements:**
```html
<!-- DELETE -->
<button id="editBtn">Edit</button>
<button id="saveVersionBtn">Publish Version</button>
<button id="cancelEditBtn">Cancel</button>
<div id="editWarning">⚠️ You are in edit mode</div>
```

**Add save indicator:**
```html
<div id="saveIndicator" class="save-indicator"></div>
```

**Add CSS:**
```css
.save-indicator {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
  background: #f0f0f0;
  transition: opacity 0.3s;
}

.save-indicator.saving {
  background: #fef3c7;
  color: #92400e;
}

.save-indicator.saved {
  background: #d1fae5;
  color: #065f46;
}
```

### 4. Testing Checklist

After implementation, test:

- [ ] Upload document → version 0 created automatically
- [ ] Open document → content is immediately editable (no Edit button needed)
- [ ] Type changes → auto-saves every 3s, creates versions 1, 2, 3...
- [ ] See "Saving..." → "All changes saved" indicator
- [ ] Close tab → session ends properly (check database)
- [ ] Reopen document → shows latest version
- [ ] Check version history → all versions are there
- [ ] Check sessions table → session shows correct version_created count
- [ ] Navigate to dashboard → session ends
- [ ] Logout → session ends

## Files to Modify

1. `/backend/src/services/db.service.js` - ✅ DONE
2. `/backend/src/routes/versions.routes.js` - ⏳ IN PROGRESS
3. `/frontend/app.js` - ⏳ PENDING
4. `/frontend/index.html` - ⏳ PENDING

## Estimated Time
- Backend routes: ~30 minutes
- Frontend JS: ~1 hour
- Frontend HTML/CSS: ~15 minutes
- Testing: ~30 minutes
- **Total: ~2-2.5 hours**

## Next Steps

Would you like me to:
1. Continue implementing all remaining changes now?
2. Implement backend routes first, then stop for testing?
3. Create the code changes as separate files for you to review?

Let me know how you'd like to proceed!
