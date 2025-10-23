# Complete Google Docs Flow - Field-by-Field Timeline

## Scenario
Dr. Smith opens a patient document, edits it over 15 minutes, downloads it, then closes the tab.

---

## Initial State (Before Session Starts)

### Database State

**`document_versions` table:**
```sql
id: d7f3c891-1234-5678-9abc-def012345678
task_id: acc40a55-a71a-44fb-8b72-6110058534a7
file_id: f7e8d9c0-1234-5678-9abc-def012345678
version_number: 0
html_content: NULL
s3_key: "results/user123/file456/v0.html"
character_count: 4892
word_count: 834
edited_by: NULL
edited_at: NULL
created_at: "2025-10-21T09:00:00Z"
edit_reason: "Original OCR output"
ip_address: NULL
user_agent: NULL
is_draft: FALSE
is_latest: TRUE
is_original: TRUE
draft_session_id: NULL
```

**`document_edit_sessions` table:**
```sql
(empty - no sessions yet)
```

---

## Event 1: User Opens Document (10:00:00 AM)

### Frontend Action
```javascript
// User clicks on task in dashboard
// Frontend generates session ID
currentSessionId = "user123_task456_1729504800000"; // userId_taskId_timestamp

// Call backend to start session
POST /api/sessions/acc40a55-a71a-44fb-8b72-6110058534a7/start
Headers: { 'x-user-id': '3c8bf409-1992-4156-add2-3d5bb3df6ec1' }
Body: { sessionId: "user123_task456_1729504800000" }
```

### Backend Action
```javascript
// Create session record
INSERT INTO document_edit_sessions (
  id,
  task_id,
  user_id,
  username,
  session_id,
  started_at,
  last_activity_at,
  ended_at,
  versions_created,
  outcome,
  ip_address,
  user_agent
) VALUES (
  'a1b2c3d4-5678-9abc-def0-123456789abc',
  'acc40a55-a71a-44fb-8b72-6110058534a7',
  '3c8bf409-1992-4156-add2-3d5bb3df6ec1',
  'dr.smith@hospital.com',
  'user123_task456_1729504800000',
  '2025-10-21T10:00:00Z',
  '2025-10-21T10:00:00Z',
  NULL,  -- Session still active
  0,     -- No versions created yet
  NULL,  -- No outcome yet
  '192.168.1.100',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0'
);
```

### Database State After Event 1

**`document_edit_sessions`:**
```sql
id: a1b2c3d4-5678-9abc-def0-123456789abc
task_id: acc40a55-a71a-44fb-8b72-6110058534a7
user_id: 3c8bf409-1992-4156-add2-3d5bb3df6ec1
username: dr.smith@hospital.com
session_id: user123_task456_1729504800000
started_at: 2025-10-21T10:00:00Z
last_activity_at: 2025-10-21T10:00:00Z
ended_at: NULL                              ← Still active
versions_created: 0                         ← No edits yet
outcome: NULL                               ← Still active
ip_address: 192.168.1.100
user_agent: Mozilla/5.0 (Macintosh...) Chrome/120.0.0.0
```

**`document_versions`:**
```sql
(Same as before - just v0, no changes yet)
```

---

## Event 2: First Edit / Auto-Save (10:00:15 AM)

### User Action
- User types: "Patient presents with acute symptoms..."
- After 3 seconds of no typing → auto-save fires

### Frontend Action
```javascript
// Save to localStorage (instant backup)
localStorage.setItem('draft_acc40a55-a71a-44fb-8b72-6110058534a7', '<html>...content...</html>');
localStorage.setItem('draft_acc40a55-a71a-44fb-8b72-6110058534a7_timestamp', '1729504815000');

// Send to backend
POST /api/versions/acc40a55-a71a-44fb-8b72-6110058534a7/save
Headers: { 'x-user-id': '3c8bf409-1992-4156-add2-3d5bb3df6ec1' }
Body: {
  htmlContent: "<html><body>Patient presents with acute symptoms...</body></html>",
  sessionId: "user123_task456_1729504800000",
  editReason: "Auto-save"
}
```

### Backend Logic
```javascript
// Check for recent version in this session
const recentVersion = await dbService.getLatestVersionForSession(sessionId);
// recentVersion = NULL (no version in this session yet)

// Time since last save = Infinity (no recent version)
const shouldCreateNewVersion = true; // No recent version exists

// CREATE NEW VERSION (first snapshot!)
```

### Backend Action
```sql
INSERT INTO document_versions (
  id,
  task_id,
  file_id,
  version_number,
  html_content,
  s3_key,
  character_count,
  word_count,
  edited_by,
  edited_at,
  created_at,
  edit_reason,
  ip_address,
  user_agent,
  is_draft,
  is_latest,
  is_original,
  draft_session_id
) VALUES (
  'e5f6g7h8-1234-5678-9abc-def012345678',
  'acc40a55-a71a-44fb-8b72-6110058534a7',
  'f7e8d9c0-1234-5678-9abc-def012345678',
  1,                                       -- Version 1 (first edit)
  '<html><body>Patient presents with acute symptoms...</body></html>',
  NULL,                                    -- No S3 upload yet
  5012,                                    -- Character count
  856,                                     -- Word count
  '3c8bf409-1992-4156-add2-3d5bb3df6ec1',
  '2025-10-21T10:00:15Z',
  '2025-10-21T10:00:15Z',
  'Auto-save',
  '192.168.1.100',
  'Mozilla/5.0 (Macintosh...) Chrome/120.0.0.0',
  FALSE,
  TRUE,                                    -- This is now the latest
  FALSE,
  'user123_task456_1729504800000'         -- Links to session
);

-- Mark previous version (v0) as not latest
UPDATE document_versions
SET is_latest = FALSE
WHERE task_id = 'acc40a55-a71a-44fb-8b72-6110058534a7'
  AND version_number = 0;

-- Increment session counter
UPDATE document_edit_sessions
SET
  versions_created = versions_created + 1,  -- 0 → 1
  last_activity_at = '2025-10-21T10:00:15Z'
WHERE session_id = 'user123_task456_1729504800000';
```

### Database State After Event 2

**`document_edit_sessions`:**
```sql
versions_created: 1                         ← Incremented!
last_activity_at: 2025-10-21T10:00:15Z     ← Updated!
(all other fields same)
```

**`document_versions`:**
```sql
-- v0 (original)
version_number: 0
is_latest: FALSE                            ← Changed!
html_content: NULL
s3_key: "results/user123/file456/v0.html"

-- v1 (NEW!)
id: e5f6g7h8-1234-5678-9abc-def012345678
version_number: 1
html_content: "<html><body>Patient presents with acute symptoms...</body></html>"
s3_key: NULL                                ← No S3 upload
character_count: 5012
word_count: 856
edited_by: 3c8bf409-1992-4156-add2-3d5bb3df6ec1
edited_at: 2025-10-21T10:00:15Z
created_at: 2025-10-21T10:00:15Z
edit_reason: "Auto-save"
is_latest: TRUE
draft_session_id: "user123_task456_1729504800000"
```

---

## Event 3: Second Edit / Auto-Save (10:00:45 AM)

### User Action
- User types more: "Blood pressure elevated. Recommend immediate treatment."
- 3 seconds → auto-save fires

### Backend Logic
```javascript
const recentVersion = await dbService.getLatestVersionForSession(sessionId);
// recentVersion = v1 (created at 10:00:15)

const timeSinceLastSave = now - new Date(recentVersion.created_at).getTime();
// timeSinceLastSave = 30 seconds

const shouldCreateNewVersion = timeSinceLastSave > 5 * 60 * 1000;
// shouldCreateNewVersion = false (< 5 minutes)

// UPDATE EXISTING VERSION v1
```

### Backend Action
```sql
-- UPDATE v1 (don't create new version)
UPDATE document_versions
SET
  html_content = '<html><body>Patient presents with acute symptoms... Blood pressure elevated. Recommend immediate treatment.</body></html>',
  character_count = 5123,
  word_count = 876,
  edited_at = '2025-10-21T10:00:45Z'
WHERE id = 'e5f6g7h8-1234-5678-9abc-def012345678';

-- Update session activity time
UPDATE document_edit_sessions
SET last_activity_at = '2025-10-21T10:00:45Z'
WHERE session_id = 'user123_task456_1729504800000';

-- NOTE: versions_created stays at 1 (we updated, not created)
```

### Database State After Event 3

**`document_edit_sessions`:**
```sql
versions_created: 1                         ← Same (didn't create new)
last_activity_at: 2025-10-21T10:00:45Z     ← Updated!
```

**`document_versions`:**
```sql
-- v1 (UPDATED!)
html_content: "<html><body>Patient presents... Blood pressure elevated...</body></html>"
character_count: 5123                       ← Updated!
word_count: 876                             ← Updated!
edited_at: 2025-10-21T10:00:45Z            ← Updated!
created_at: 2025-10-21T10:00:15Z           ← Stays same (when first created)
```

---

## Event 4-10: More Auto-Saves (10:01:00 - 10:05:00)

### User keeps typing every ~30 seconds

Each auto-save:
- **Updates v1** (because < 5 minutes since v1 created)
- **Does NOT create new version**
- Updates: `html_content`, `character_count`, `word_count`, `edited_at`
- Does NOT update: `version_number`, `created_at`, `id`

### Database State After 5 minutes

**`document_edit_sessions`:**
```sql
versions_created: 1                         ← Still 1 (only updating v1)
last_activity_at: 2025-10-21T10:05:00Z
```

**`document_versions`:**
```sql
-- v1 (continuously updated)
html_content: "...latest content after 5 minutes of editing..."
character_count: 5456
word_count: 912
edited_at: 2025-10-21T10:05:00Z            ← Keeps updating
created_at: 2025-10-21T10:00:15Z           ← Never changes
```

---

## Event 11: Snapshot Time! (10:06:00 AM)

### User types more (now > 5 minutes since v1 created)

### Backend Logic
```javascript
const recentVersion = await dbService.getLatestVersionForSession(sessionId);
// recentVersion = v1 (created at 10:00:15)

const timeSinceLastSave = now - new Date(recentVersion.created_at).getTime();
// timeSinceLastSave = 5 minutes 45 seconds

const shouldCreateNewVersion = timeSinceLastSave > 5 * 60 * 1000;
// shouldCreateNewVersion = TRUE! (> 5 minutes)

// CREATE NEW VERSION v2 (snapshot!)
```

### Backend Action
```sql
INSERT INTO document_versions (
  id,
  task_id,
  file_id,
  version_number,
  html_content,
  s3_key,
  character_count,
  word_count,
  edited_by,
  edited_at,
  created_at,
  edit_reason,
  ip_address,
  user_agent,
  is_draft,
  is_latest,
  is_original,
  draft_session_id
) VALUES (
  'i9j0k1l2-1234-5678-9abc-def012345678',
  'acc40a55-a71a-44fb-8b72-6110058534a7',
  'f7e8d9c0-1234-5678-9abc-def012345678',
  2,                                       -- Version 2 (snapshot!)
  '<html><body>...content after 6 minutes...</body></html>',
  NULL,
  5634,
  928,
  '3c8bf409-1992-4156-add2-3d5bb3df6ec1',
  '2025-10-21T10:06:00Z',
  '2025-10-21T10:06:00Z',                  -- NEW created_at
  'Auto-save snapshot',
  '192.168.1.100',
  'Mozilla/5.0 (Macintosh...) Chrome/120.0.0.0',
  FALSE,
  TRUE,
  FALSE,
  'user123_task456_1729504800000'
);

-- Mark v1 as not latest
UPDATE document_versions
SET is_latest = FALSE
WHERE id = 'e5f6g7h8-1234-5678-9abc-def012345678';

-- Increment session counter
UPDATE document_edit_sessions
SET
  versions_created = versions_created + 1,  -- 1 → 2
  last_activity_at = '2025-10-21T10:06:00Z'
WHERE session_id = 'user123_task456_1729504800000';
```

### Database State After Event 11

**`document_edit_sessions`:**
```sql
versions_created: 2                         ← Incremented! (v1 and v2)
last_activity_at: 2025-10-21T10:06:00Z
```

**`document_versions`:**
```sql
-- v0 (original)
version_number: 0
is_latest: FALSE
s3_key: "results/user123/file456/v0.html"

-- v1 (first snapshot)
version_number: 1
html_content: "...content from 10:00-10:05..."
character_count: 5456
created_at: 2025-10-21T10:00:15Z
edited_at: 2025-10-21T10:05:00Z            ← Last update before v2 created
is_latest: FALSE                            ← Not latest anymore
s3_key: NULL

-- v2 (NEW snapshot!)
version_number: 2
html_content: "...content after 6 minutes..."
character_count: 5634
created_at: 2025-10-21T10:06:00Z
edited_at: 2025-10-21T10:06:00Z
is_latest: TRUE
s3_key: NULL
```

---

## Event 12-15: More Edits (10:06:15 - 10:10:00)

All edits **update v2** (because < 5 minutes since v2 created)

### Database State

**`document_edit_sessions`:**
```sql
versions_created: 2                         ← Still 2
last_activity_at: 2025-10-21T10:10:00Z
```

**`document_versions`:**
```sql
-- v2 (continuously updated)
html_content: "...latest content..."
character_count: 5678
edited_at: 2025-10-21T10:10:00Z            ← Keeps updating
created_at: 2025-10-21T10:06:00Z           ← Never changes
```

---

## Event 16: User Downloads Result (10:10:30 AM)

### User Action
- Clicks "Download Result" button

### Frontend Action
```javascript
POST /api/tasks/acc40a55-a71a-44fb-8b72-6110058534a7/download-result
Headers: { 'x-user-id': '3c8bf409-1992-4156-add2-3d5bb3df6ec1' }
Body: {
  htmlContent: "<html><body>...current content from iframe...</body></html>",
  sessionId: "user123_task456_1729504800000",
  editReason: "Downloaded by user"
}
```

### Backend Action
```javascript
// 1. Convert HTML to PDF
const pdfBuffer = await pdfService.htmlToPdf(htmlContent);

// 2. Stream PDF to user (user gets file NOW)
res.end(pdfBuffer, 'binary');

// 3. AFTER user gets file, save HTML to S3
const s3Key = "results/user123/file456/v3.html";
await s3Service.uploadFile(htmlContent, s3Key, 'text/html');

// 4. Create version with BOTH html_content AND s3_key
```

```sql
INSERT INTO document_versions (
  id,
  task_id,
  file_id,
  version_number,
  html_content,
  s3_key,
  character_count,
  word_count,
  edited_by,
  edited_at,
  created_at,
  edit_reason,
  ip_address,
  user_agent,
  is_draft,
  is_latest,
  is_original,
  draft_session_id
) VALUES (
  'm3n4o5p6-1234-5678-9abc-def012345678',
  'acc40a55-a71a-44fb-8b72-6110058534a7',
  'f7e8d9c0-1234-5678-9abc-def012345678',
  3,                                       -- Version 3
  '<html><body>...downloaded content...</body></html>',
  'results/user123/file456/v3.html',       -- BOTH html_content AND s3_key!
  5678,
  934,
  '3c8bf409-1992-4156-add2-3d5bb3df6ec1',
  '2025-10-21T10:10:30Z',
  '2025-10-21T10:10:30Z',
  'Downloaded by user',                    -- Special reason!
  '192.168.1.100',
  'Mozilla/5.0 (Macintosh...) Chrome/120.0.0.0',
  FALSE,
  TRUE,
  FALSE,
  'user123_task456_1729504800000'
);

-- Mark v2 as not latest
UPDATE document_versions SET is_latest = FALSE WHERE version_number = 2;

-- Increment session counter
UPDATE document_edit_sessions
SET
  versions_created = versions_created + 1,  -- 2 → 3
  last_activity_at = '2025-10-21T10:10:30Z'
WHERE session_id = 'user123_task456_1729504800000';
```

### Database State After Event 16

**`document_edit_sessions`:**
```sql
versions_created: 3                         ← Incremented! (download = version)
last_activity_at: 2025-10-21T10:10:30Z
```

**`document_versions`:**
```sql
-- v3 (NEW - downloaded version!)
version_number: 3
html_content: "...downloaded content..."    ← In database
s3_key: "results/user123/file456/v3.html"  ← AND in S3!
character_count: 5678
edit_reason: "Downloaded by user"           ← Special!
is_latest: TRUE
```

**S3 State:**
```
Bucket: untxt-results
Key: results/user123/file456/v3.html
Content: <html><body>...downloaded content...</body></html>
```

---

## Event 17-20: More Edits After Download (10:11:00 - 10:14:00)

User keeps editing after download.

All edits **update v3** (because < 5 minutes since v3 created)

### Database State

**`document_versions`:**
```sql
-- v3 (updated)
html_content: "...content with more edits after download..."
character_count: 5890
edited_at: 2025-10-21T10:14:00Z            ← Updated
s3_key: "results/user123/file456/v3.html"  ← Stays same (already in S3)
```

---

## Event 21: User Closes Tab (10:15:00 AM)

### User Action
- User clicks X to close tab

### Frontend Action
```javascript
// beforeunload event fires
window.addEventListener('beforeunload', () => {
  // Get current content
  const iframe = document.querySelector('#previewIframe');
  const htmlContent = iframe.contentDocument.body.innerHTML;

  // Send to backend using sendBeacon (reliable)
  const data = new Blob([JSON.stringify({
    sessionId: "user123_task456_1729504800000",
    htmlContent: htmlContent,
    outcome: 'completed'
  })], { type: 'application/json' });

  navigator.sendBeacon(
    '/api/sessions/acc40a55-a71a-44fb-8b72-6110058534a7/end',
    data
  );

  // Clear localStorage backup
  localStorage.removeItem('draft_acc40a55-a71a-44fb-8b72-6110058534a7');
  localStorage.removeItem('draft_acc40a55-a71a-44fb-8b72-6110058534a7_timestamp');
});
```

### Backend Action
```javascript
// 1. Get latest version
const latestVersion = await dbService.getLatestVersionForSession(sessionId);
// latestVersion = v3

// 2. Check if v3 needs S3 upload
// v3.s3_key = "results/user123/file456/v3.html" (already uploaded during download)
// html_content has been updated since download → need to re-upload!

// 3. Re-upload latest content to S3
const s3Key = "results/user123/file456/v3.html"; // Same key, overwrite
await s3Service.uploadFile(latestVersion.html_content, s3Key, 'text/html');

// 4. Close session
```

```sql
-- Update session (mark as ended)
UPDATE document_edit_sessions
SET
  ended_at = '2025-10-21T10:15:00Z',       -- Session ended!
  outcome = 'completed'                     -- User closed normally
WHERE session_id = 'user123_task456_1729504800000';
```

### Final Database State

**`document_edit_sessions` (FINAL):**
```sql
id: a1b2c3d4-5678-9abc-def0-123456789abc
task_id: acc40a55-a71a-44fb-8b72-6110058534a7
user_id: 3c8bf409-1992-4156-add2-3d5bb3df6ec1
username: dr.smith@hospital.com
session_id: user123_task456_1729504800000
started_at: 2025-10-21T10:00:00Z          ← Session start
ended_at: 2025-10-21T10:15:00Z            ← Session end ✓
versions_created: 3                         ← Total snapshots
outcome: completed                          ← How it ended ✓
ip_address: 192.168.1.100
user_agent: Mozilla/5.0 (Macintosh...) Chrome/120.0.0.0
```

**`document_versions` (FINAL):**
```sql
-- v0 (original OCR output)
id: d7f3c891-1234-5678-9abc-def012345678
version_number: 0
html_content: NULL
s3_key: "results/user123/file456/v0.html"
character_count: 4892
word_count: 834
edited_by: NULL
edited_at: NULL
created_at: 2025-10-21T09:00:00Z
edit_reason: "Original OCR output"
is_latest: FALSE
is_original: TRUE
draft_session_id: NULL

-- v1 (first 5 minutes of editing)
id: e5f6g7h8-1234-5678-9abc-def012345678
version_number: 1
html_content: "<html>...content from 10:00-10:05...</html>"
s3_key: NULL                                ← Never uploaded to S3
character_count: 5456
word_count: 912
edited_by: 3c8bf409-1992-4156-add2-3d5bb3df6ec1
edited_at: 2025-10-21T10:05:00Z
created_at: 2025-10-21T10:00:15Z
edit_reason: "Auto-save"
is_latest: FALSE
draft_session_id: "user123_task456_1729504800000"
ip_address: 192.168.1.100
user_agent: Mozilla/5.0 (Macintosh...) Chrome/120.0.0.0

-- v2 (next 4 minutes of editing)
id: i9j0k1l2-1234-5678-9abc-def012345678
version_number: 2
html_content: "<html>...content from 10:06-10:10...</html>"
s3_key: NULL                                ← Never uploaded to S3
character_count: 5678
word_count: 934
edited_by: 3c8bf409-1992-4156-add2-3d5bb3df6ec1
edited_at: 2025-10-21T10:10:00Z
created_at: 2025-10-21T10:06:00Z
edit_reason: "Auto-save snapshot"
is_latest: FALSE
draft_session_id: "user123_task456_1729504800000"
ip_address: 192.168.1.100
user_agent: Mozilla/5.0 (Macintosh...) Chrome/120.0.0.0

-- v3 (downloaded + final edits)
id: m3n4o5p6-1234-5678-9abc-def012345678
version_number: 3
html_content: "<html>...final content at session end...</html>"
s3_key: "results/user123/file456/v3.html"  ← In S3!
character_count: 5890
word_count: 981
edited_by: 3c8bf409-1992-4156-add2-3d5bb3df6ec1
edited_at: 2025-10-21T10:14:00Z            ← Last edit before close
created_at: 2025-10-21T10:10:30Z           ← Created on download
edit_reason: "Downloaded by user"
is_latest: TRUE
draft_session_id: "user123_task456_1729504800000"
ip_address: 192.168.1.100
user_agent: Mozilla/5.0 (Macintosh...) Chrome/120.0.0.0
```

**S3 State (FINAL):**
```
Bucket: untxt-results

Keys:
├── results/user123/file456/v0.html       (original OCR output)
└── results/user123/file456/v3.html       (final version after download + edits)

(v1 and v2 only in database, not in S3)
```

---

## Summary

### What Got Saved:

| What | Database | S3 |
|------|----------|-----|
| v0 (original) | ✅ | ✅ |
| v1 (edits 10:00-10:05) | ✅ | ❌ |
| v2 (edits 10:06-10:10) | ✅ | ❌ |
| v3 (download + final) | ✅ | ✅ |
| Session record | ✅ | N/A |

### HIPAA Audit Trail:

**Question: Who accessed this document?**
→ Dr. Smith (user 3c8bf409...)

**Question: When?**
→ Oct 21, 2025, 10:00:00 AM - 10:15:00 AM (15 minute session)

**Question: What did they do?**
→ Created 3 versions, downloaded once, made 5890 characters total

**Question: Where from?**
→ IP 192.168.1.100, Chrome browser on Mac

**Question: What did the document look like before and after?**
→ Before: v0 (4892 chars)
→ After: v3 (5890 chars)
→ Diff: Added 998 characters

**Question: Can you show me the exact content?**
→ v0: Available in S3
→ v1: Available in database (html_content)
→ v2: Available in database (html_content)
→ v3: Available in both database and S3

**All HIPAA requirements met! ✅**
