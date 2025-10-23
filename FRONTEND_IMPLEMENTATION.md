# Frontend Implementation Guide - Google Docs Flow

## Summary of Changes Needed

Your `/frontend/app.js` needs these updates:

### 1. Add New Global Variables (at top of file)
```javascript
// Google Docs Flow - Session Management
let currentSessionId = null;
let autoSaveTimer = null;
let lastSavedContent = '';
let isSaving = false;
```

### 2. Replace Document Loading Function

**Find:** `showDocumentContent(task)` function
**Replace with:**
```javascript
async function showDocumentContent(task) {
  currentTask = task;

  // Load latest version from backend
  try {
    const response = await fetch(`${API_URL}/api/versions/${task.id}/latest`, {
      headers: { 'x-user-id': USER_ID }
    });

    if (!response.ok) {
      throw new Error('Failed to load document');
    }

    const htmlContent = await response.text();
    const versionNumber = response.headers.get('X-Version-Number');
    const contentSource = response.headers.get('X-Content-Source');

    console.log(`📖 Loaded version ${versionNumber} from ${contentSource}`);

    // Load into iframe
    const iframe = previewContainer.querySelector('iframe');
    iframe.srcdoc = htmlContent;

    // Wait for iframe to load, then make editable
    iframe.onload = () => {
      makeIframeEditable();
      startEditSession();
    };

  } catch (error) {
    console.error('Error loading document:', error);
    alert('Failed to load document. Please try again.');
  }
}

function makeIframeEditable() {
  const iframe = previewContainer.querySelector('iframe');
  if (!iframe || !iframe.contentDocument) {
    console.error('No iframe found');
    return;
  }

  const iframeBody = iframe.contentDocument.body;
  if (iframeBody) {
    iframeBody.contentEditable = 'true';
    iframeBody.style.outline = 'none';
    iframeBody.focus();

    // Setup auto-save
    setupAutoSave(iframeBody);

    console.log('✏️ Content is now editable (Google Docs mode)');
  }
}
```

### 3. Add Session Management Functions

**Add these new functions:**
```javascript
// =====================================================
// GOOGLE DOCS FLOW: Session Management
// =====================================================

async function startEditSession() {
  if (currentSessionId) return; // Already started

  // Generate unique session ID
  currentSessionId = `${USER_ID}_${currentTask.id}_${Date.now()}`;

  try {
    const response = await fetch(`${API_URL}/api/sessions/${currentTask.id}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      },
      body: JSON.stringify({ sessionId: currentSessionId })
    });

    if (response.ok) {
      console.log('📝 Edit session started:', currentSessionId);

      // Check for crash recovery
      checkForCrashRecovery();
    }
  } catch (error) {
    console.error('Failed to start session:', error);
  }
}

function endEditSession() {
  if (!currentSessionId) return;

  // Get current content
  const iframe = previewContainer?.querySelector('iframe');
  const htmlContent = iframe?.contentDocument?.body?.innerHTML;

  if (htmlContent) {
    // Use sendBeacon for reliable delivery even if page is closing
    const data = new Blob([JSON.stringify({
      sessionId: currentSessionId,
      htmlContent: htmlContent,
      outcome: 'completed'
    })], { type: 'application/json' });

    navigator.sendBeacon(
      `${API_URL}/api/sessions/${currentTask.id}/end`,
      data
    );

    console.log('✅ Edit session ended:', currentSessionId);
  }

  // Clear localStorage backup
  localStorage.removeItem(`draft_${currentTask.id}`);
  localStorage.removeItem(`draft_${currentTask.id}_timestamp`);

  currentSessionId = null;
}

// Attach session end events
window.addEventListener('beforeunload', endEditSession);
window.addEventListener('pagehide', endEditSession);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    endEditSession();
  }
});
```

### 4. Add Auto-Save Function

**Add this new function:**
```javascript
// =====================================================
// GOOGLE DOCS FLOW: Auto-Save
// =====================================================

function setupAutoSave(iframeBody) {
  // Listen for content changes
  iframeBody.addEventListener('input', () => {
    clearTimeout(autoSaveTimer);

    // Show "typing" indicator after 500ms
    setTimeout(() => {
      if (!isSaving) {
        showSaveStatus('typing');
      }
    }, 500);

    // Actually save after 3s of no typing (debounced)
    autoSaveTimer = setTimeout(autoSaveVersion, 3000);
  });

  // Also save on paste
  iframeBody.addEventListener('paste', () => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(autoSaveVersion, 3000);
  });
}

async function autoSaveVersion() {
  if (isSaving) return; // Prevent concurrent saves
  if (!currentSessionId) return; // No session

  const iframe = previewContainer.querySelector('iframe');
  const htmlContent = iframe.contentDocument.body.innerHTML;

  // Skip if no changes
  if (htmlContent === lastSavedContent) return;

  isSaving = true;
  showSaveStatus('saving');

  try {
    // 1. Save to localStorage immediately (instant backup)
    localStorage.setItem(`draft_${currentTask.id}`, htmlContent);
    localStorage.setItem(`draft_${currentTask.id}_timestamp`, Date.now());

    // 2. Save to backend (database only, no S3)
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
      showSaveStatus('saved');

      // Log snapshot info
      if (result.version.snapshot) {
        console.log(`💾 Created snapshot v${result.version.version_number}`);
      } else {
        console.log(`💾 Updated v${result.version.version_number}`);
      }
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

function showSaveStatus(status) {
  const indicator = document.getElementById('saveIndicator');
  if (!indicator) return;

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

### 5. Add Crash Recovery Function

**Add this function:**
```javascript
// =====================================================
// CRASH RECOVERY: localStorage Backup
// =====================================================

function checkForCrashRecovery() {
  const draftKey = `draft_${currentTask.id}`;
  const crashRecoveryHTML = localStorage.getItem(draftKey);
  const timestamp = localStorage.getItem(`${draftKey}_timestamp`);

  if (crashRecoveryHTML && timestamp) {
    const minutes = Math.floor((Date.now() - parseInt(timestamp)) / 60000);
    const message = `Found unsaved changes from ${minutes} minutes ago. Restore them?`;

    if (confirm(message)) {
      const iframe = previewContainer.querySelector('iframe');
      iframe.srcdoc = crashRecoveryHTML;
      console.log('✅ Restored from crash recovery');
      alert('Recovered unsaved changes!');
    }

    // Clear localStorage after recovery prompt
    localStorage.removeItem(draftKey);
    localStorage.removeItem(`${draftKey}_timestamp`);
  }
}
```

### 6. Update Download Function

**Find:** `downloadResult()` or download button handler
**Replace with:**
```javascript
async function downloadResult() {
  if (!currentTask) return;

  const iframe = previewContainer.querySelector('iframe');
  const htmlContent = iframe.contentDocument.body.innerHTML;

  const downloadBtn = document.getElementById('downloadBtn');
  if (downloadBtn) {
    downloadBtn.textContent = 'Preparing download...';
    downloadBtn.disabled = true;
  }

  try {
    const response = await fetch(`${API_URL}/api/sessions/${currentTask.id}/download-result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      },
      body: JSON.stringify({
        htmlContent,
        sessionId: currentSessionId
      })
    });

    if (!response.ok) throw new Error('Download failed');

    // Download PDF
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentTask.filename}_result.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    // Show version info
    const versionNumber = response.headers.get('X-Version-Number');
    console.log(`📥 Downloaded as version ${versionNumber}`);
    alert(`Downloaded! Auto-saved as version ${versionNumber}`);

  } catch (error) {
    console.error('Download failed:', error);
    alert('Download failed. Please try again.');
  } finally {
    if (downloadBtn) {
      downloadBtn.textContent = 'Download Result';
      downloadBtn.disabled = false;
    }
  }
}
```

### 7. Update "Back to Dashboard" Button

**Find:** Dashboard navigation function
**Update to:**
```javascript
function goToDashboard() {
  // End session before navigating
  endEditSession();

  // Then navigate
  window.location.href = '/dashboard.html'; // or wherever your dashboard is
}
```

---

## HTML Changes Needed

### In `/frontend/index.html`:

#### 1. Add Save Indicator
```html
<!-- Add this near the top of your preview/document area -->
<div id="saveIndicator" class="save-indicator"></div>
```

#### 2. Add CSS for Save Indicator
```css
<style>
.save-indicator {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
  background: #f0f0f0;
  transition: opacity 0.3s;
  z-index: 1000;
}

.save-indicator.saving {
  background: #fef3c7;
  color: #92400e;
}

.save-indicator.saved {
  background: #d1fae5;
  color: #065f46;
}

.save-indicator.error {
  background: #fee2e2;
  color: #991b1b;
}
</style>
```

#### 3. Remove Old Buttons (if they exist)
```html
<!-- REMOVE these if they exist: -->
<button id="editBtn">Edit</button>
<button id="saveVersionBtn">Publish Version</button>
<button id="cancelEditBtn">Cancel</button>
```

---

## Testing Checklist

After implementing:

1. ✅ Upload a document → Can you see it?
2. ✅ Content is immediately editable (no Edit button needed)
3. ✅ Type something → See "Saving..." after 3s
4. ✅ See "All changes saved" indicator
5. ✅ Check browser console → See "Created snapshot" or "Updated version"
6. ✅ Close tab and reopen → Latest changes are there
7. ✅ Click "Download Result" → Get PDF
8. ✅ Keep editing after download → Works normally
9. ✅ Simulate crash (close browser forcefully) → Reopen → Get recovery prompt

---

## Quick Implementation Steps

1. **Backup your current `/frontend/app.js`**
   ```bash
   cp /frontend/app.js /frontend/app.js.backup
   ```

2. **Add the new global variables** at the top

3. **Replace/update the functions** listed above

4. **Add the HTML changes** to `index.html`

5. **Test** with a real document

---

## Need Help?

If you get stuck, check:
- Browser console for errors
- Network tab to see API calls
- `/BACKEND_COMPLETE.md` for API endpoint details
- `/COMPLETE_FLOW_WITH_FIELDS.md` for expected behavior

The backend is ready and waiting! Just need to update the frontend to use it.
