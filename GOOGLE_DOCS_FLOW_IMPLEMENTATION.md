# Google Docs Flow Implementation Plan

## Overview
Switching from Draft+Publish to Auto-save = Auto-publish flow.

## Backend Changes

### API Endpoints to REMOVE:
- ❌ `GET /api/versions/:taskId/draft` (no more drafts)
- ❌ `POST /api/versions/:taskId/publish` (no more publish button)
- ❌ `DELETE /api/versions/:taskId/draft` (no more cancel button)

### API Endpoints to ADD/KEEP:
- ✅ `POST /api/versions/:taskId/save` - Create new version (replaces draft endpoint)
- ✅ `GET /api/versions/:taskId` - Get all versions for task
- ✅ `GET /api/versions/:taskId/latest` - Get latest version
- ✅ `POST /api/sessions/:taskId/start` - Start edit session
- ✅ `POST /api/sessions/:taskId/end` - End edit session

### DB Service Functions to UPDATE:
```javascript
// OLD: saveDraft() - Creates draft with version_number = -1
// NEW: createVersion() - Creates version with next version number

async createVersion({
  taskId,
  fileId,
  userId,
  s3Key,
  characterCount,
  wordCount,
  editReason,
  ipAddress,
  userAgent,
  sessionId
}) {
  // Calls create_new_version() database function
  // Creates version immediately (no draft flag)
}
```

## Frontend Changes

### UI Elements to REMOVE:
- ❌ "Edit" button (content is always editable)
- ❌ "Publish" button (auto-save = auto-publish)
- ❌ "Cancel" button (no concept of canceling)
- ❌ Edit mode warning banner

### UI Elements to ADD:
- ✅ "All changes saved" indicator (like Google Docs)
- ✅ Auto-save status ("Saving..." → "Saved")
- ✅ Version history sidebar (show all versions)

### JavaScript Changes:
```javascript
// OLD FLOW:
1. Click "Edit" → enterEditMode()
2. Make editable
3. Auto-save → saveDraft()
4. Click "Publish" → publishDraft()

// NEW FLOW:
1. Content is always editable (no edit mode)
2. Auto-save → createVersion() (creates version directly)
3. Show "Saved" indicator
4. Track session start/end
```

### Session Tracking:
```javascript
// Start session when user opens document
window.addEventListener('load', startEditSession);

// End session on:
1. beforeunload (close tab/window)
2. visibilitychange (switch tabs)
3. Logout
4. Navigate to dashboard

function endEditSession() {
  // Use navigator.sendBeacon for reliable delivery
  navigator.sendBeacon(
    `/api/sessions/${taskId}/end`,
    JSON.stringify({ sessionId })
  );
}
```

## Session Lifecycle

### Start:
- User opens document → Create session in `document_edit_sessions`
- Track: `user_id`, `task_id`, `session_id`, `started_at`

### During:
- User types → Auto-save every 3s
- Each save creates a new version
- Increment `versions_created` in session

### End:
- User closes document → Update session `ended_at`
- Track total versions created during session

## HIPAA Compliance

### What We Track:
✅ Every version has full audit trail:
- WHO: `edited_by`, `user_id`
- WHAT: `version_number`, `s3_key` (full content)
- WHEN: `edited_at`, `created_at`
- WHERE: `ip_address`, `user_agent`
- WHY: `edit_reason` ("Auto-save", "Manual edit")

✅ Edit sessions track:
- Session duration (`started_at` → `ended_at`)
- Number of versions created
- Activity timestamps

### What Changed:
- Before: Tracked drafts separately (confusing)
- After: Every change is a version (clearer audit trail)

## Migration Steps

1. ✅ Apply database migration
2. ⏳ Update backend service functions
3. ⏳ Update backend API routes
4. ⏳ Update frontend JavaScript
5. ⏳ Update frontend HTML/CSS
6. ⏳ Test end-to-end

## Testing Checklist

- [ ] Upload document → version 0 created
- [ ] Open document → session starts
- [ ] Type changes → versions 1, 2, 3... created
- [ ] Close tab → session ends properly
- [ ] Reopen document → shows latest version
- [ ] Version history shows all versions
- [ ] Session logs show correct version count
