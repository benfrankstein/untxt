# Document Editing System

## Overview

The document editing system implements a Google Docs-style collaborative editing flow with version control, permissions, session tracking, and audit logging. This system allows users to edit OCR-extracted documents in real-time with auto-save functionality while maintaining a complete history of changes.

---

## Core Tables

### 1. `document_versions`

**Purpose:** Stores all versions of edited documents with smart snapshotting to balance history preservation with database efficiency.

**What it does:**
- Maintains version history with 5-minute snapshots
- Stores the HTML content directly in the database during editing
- Tracks metadata like character count, word count, and who made the edit
- Uses content checksums to detect duplicate saves
- Manages "latest" version flags to quickly retrieve current content
- Supports S3 storage keys for final published versions

**Key Features:**
- **Smart snapshotting:** Creates new version every 5 minutes, updates same version within 5-minute window
- **Version numbering:** Each published version gets an incremental number (0, 1, 2, 3...)
- **Content storage:** HTML content stored in `html_content` column
- **Checksums:** MD5 hash of content to detect changes and prevent duplicates
- **Latest tracking:** `is_latest` flag marks the current version
- **Original tracking:** `is_original` flag marks the initial OCR result

---

### 2. `document_edit_sessions`

**Purpose:** Tracks active editing sessions when users are working on documents. **One row per session**, updated continuously.

**What it does:**
- Creates **one session row** when a user opens a document for editing
- **Updates the same row** every 3 seconds with activity timestamp
- Tracks session duration and total versions created
- Records when sessions start and end
- Links to the draft version being edited
- Stores the final published version when session ends

**Key Features:**
- **Session lifecycle:** `started_at`, `ended_at`, `last_activity_at`
- **Activity tracking:** Updates `last_activity_at` on every auto-save (every 3 seconds)
- **Version counting:** `versions_created` increments with each snapshot (every 5 minutes)
- **Single row per session:** Same row is updated throughout entire editing session
- **Publishing:** Links to final published version when user ends session

**Session States:**
- **Active:** `ended_at` is NULL
- **Completed:** `ended_at` is set, `published_version_id` is set
- **Abandoned:** `ended_at` is NULL but `last_activity_at` is old (> 30 minutes)

---

### 3. `document_edit_permissions`

**Purpose:** Controls who can edit specific documents beyond the document owner.

**What it does:**
- Grants editing rights to specific users for specific tasks
- Supports temporary permissions with expiration dates
- Tracks who granted the permission and when
- Allows permissions to be revoked with a reason
- Maintains audit trail of permission changes

**Key Features:**
- **Granular control:** Per-task, per-user permissions
- **Time-limited access:** Optional `expires_at` for temporary access
- **Revocation:** Can be revoked with reason and timestamp
- **Audit trail:** Tracks who granted/revoked and when
- **Active status:** `is_active` flag for quick filtering

**Permission States:**
- **Active:** `is_active = true` and not expired
- **Expired:** `expires_at` is in the past
- **Revoked:** `is_active = false` with revocation details

---

### 4. `document_edits_log`

**Purpose:** Detailed audit log of every edit action performed on documents.

**What it does:**
- Records every significant editing action
- Captures what changed and why
- Tracks user actions like save, publish, revert
- Stores IP address and user agent for security
- Links actions to specific versions
- Maintains complete editing history for compliance

**Key Features:**
- **Action types:** Save, publish, revert, restore, snapshot, etc.
- **Change details:** What was modified (JSONB field)
- **Security info:** IP address and user agent
- **Version linking:** References the version created/modified
- **Timestamps:** Precise timing of every action
- **Session tracking:** Links edits to editing sessions

---

## How They Work Together

### **Editing Flow: From Open to Publish**

#### **Step 1: User Opens Document for Editing**

```
User clicks "Edit" on a task
    ↓
System checks document_edit_permissions
    ↓ (if authorized)
Creates new document_edit_sessions entry
    - started_at: NOW
    - user_id: current user
    - session_id: unique ID
    - versions_created: 0
    ↓
Loads latest version from document_versions
    - WHERE is_latest = true
    ↓
Frontend displays document in editor
```

#### **Step 2: User Edits and Auto-Save Kicks In (Every 3 Seconds)**

```
User types in the editor
    ↓
Every 3 seconds, auto-save triggers
    ↓
Backend checks: Was last version created < 5 minutes ago?
    ↓
    ├─ YES (< 5 min) → UPDATE existing document_versions row
    │   - html_content: current editor content
    │   - content_checksum: md5(content)
    │   - character_count, word_count updated
    │   - edited_at: NOW
    │   - NO new row created
    │   - Response: snapshot = false
    │
    └─ NO (> 5 min or no version) → CREATE new document_versions row
        - NEW snapshot in history
        - html_content: current editor content
        - content_checksum: md5(content)
        - is_latest: true
        - version_number: incremented
        - Response: snapshot = true
    ↓
Updates document_edit_sessions (same row)
    - last_activity_at: NOW
    - versions_created: increment (only if new snapshot created)
    ↓
Creates document_edits_log entry
    - action: "auto_save" or "snapshot"
    - version_id: version ID (updated or new)
    - details: what changed
```

**Auto-save Strategy (5-Minute Window):**
```
Time      | Action                          | document_versions
----------|--------------------------------|-------------------
20:00:00  | Open editor                    | (load existing)
20:00:03  | Auto-save #1                   | CREATE row A
20:00:06  | Auto-save #2                   | UPDATE row A
20:00:09  | Auto-save #3                   | UPDATE row A
...       | (100 auto-saves)               | UPDATE row A
20:05:03  | Auto-save #100 (> 5 min!)      | CREATE row B ← NEW SNAPSHOT!
20:05:06  | Auto-save #101                 | UPDATE row B
20:05:09  | Auto-save #102                 | UPDATE row B
...       | (100 auto-saves)               | UPDATE row B
20:10:03  | Auto-save #200 (> 5 min!)      | CREATE row C ← NEW SNAPSHOT!
20:15:00  | User closes → Publish          | CREATE row D (final)
```

**Result:** 4 rows in `document_versions`, but auto-save ran 200+ times!

#### **Step 3: User Publishes/Ends Session**

```
User clicks "Download Result" or closes editor
    ↓
Frontend calls /api/sessions/:id/end
    ↓
Backend creates final version in document_versions
    - Marks as published (is_draft = false)
    - Sets s3_key if uploaded to S3
    - Increments version_number
    ↓
Updates document_edit_sessions (same row)
    - ended_at: NOW
    - published_version_id: final version
    ↓
Creates document_edits_log entry
    - action: "publish"
    - version_id: published version
    ↓
Uploads final HTML to S3
Updates tasks.current_version_id
```

---

## Version Management

### **Version Types**

**Original Version (OCR Result)**
- `is_original = true`
- `version_number = 0`
- Created automatically when OCR completes
- Never modified

**Snapshot Versions (During Editing)**
- Created every 5 minutes during active editing
- `is_latest = true` (only the most recent snapshot)
- Updated within 5-minute windows (not creating new rows)
- Provide point-in-time history

**Published Versions**
- `is_draft = false`
- `version_number >= 1`
- Permanent, immutable records
- Stored in S3 and database

### **Version Numbering**

```
version_number = 0  → Original OCR result
version_number = 1  → First published edit
version_number = 2  → Second published edit
version_number = N  → Nth published edit
```

Snapshots during editing share the same version_number until published.

---

## Database Impact: 15-Minute Editing Session

### **What Actually Gets Written:**

| Table | Rows Created | Rows Updated | Total Operations |
|-------|--------------|--------------|------------------|
| `document_edit_sessions` | 1 | ~300 | 301 |
| `document_versions` | 3-4 | ~300 | 303-304 |
| `document_edits_log` | ~300 | 0 | ~300 |
| **TOTAL** | **~304** | **~600** | **~904** |

### **Breakdown:**

**`document_edit_sessions`:**
- 1 INSERT at session start
- ~300 UPDATEs (every 3 seconds for 15 minutes)
- Total: **301 operations on 1 row**

**`document_versions`:**
- 1 CREATE at 00:00 (first auto-save)
- ~100 UPDATEs (within 5-minute window)
- 1 CREATE at 05:00 (new snapshot)
- ~100 UPDATEs (within 5-minute window)
- 1 CREATE at 10:00 (new snapshot)
- ~100 UPDATEs (within 5-minute window)
- 1 CREATE at 15:00 (final publish)
- Total: **4 rows, ~300 updates = 304 operations**

**`document_edits_log`:**
- 1 INSERT per auto-save (~300 times)
- Each is a separate audit entry
- Total: **~300 rows**

---

## Permission System

### **Who Can Edit?**

1. **Document Owner** (user_id on tasks table)
   - Always has edit permission
   - No entry needed in document_edit_permissions

2. **Granted Users**
   - Explicit entry in document_edit_permissions
   - Can be temporary or permanent
   - Can be revoked

### **Permission Check Flow**

```
User requests to edit document
    ↓
Check if user_id = tasks.user_id
    ↓ YES → Allow
    ↓ NO
Check document_edit_permissions
    WHERE user_id = ?
      AND task_id = ?
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > NOW)
    ↓ EXISTS → Allow
    ↓ NOT EXISTS → Deny (403 Forbidden)
```

---

## Session Tracking

### **Active Session Monitoring**

The system tracks:
- **Who** is editing (user_id)
- **What** they're editing (task_id)
- **When** they started (started_at)
- **Last activity** (last_activity_at) - updated every 3 seconds
- **How many snapshots** (versions_created) - incremented every 5 minutes

### **Session Timeout**

Sessions without activity for 30+ minutes are considered abandoned:
```sql
SELECT * FROM document_edit_sessions
WHERE ended_at IS NULL
  AND last_activity_at < NOW() - INTERVAL '30 minutes'
```

Abandoned sessions can be cleaned up by a background job (runs every 5 minutes).

---

## Audit Trail

### **What Gets Logged?**

Every action in `document_edits_log`:
- **User actions:** Save, publish, revert, delete
- **Auto-saves:** Every 3-second auto-save gets logged
- **Snapshots:** New version creation (every 5 minutes)
- **Version changes:** Which version was created/modified
- **Permission changes:** Who granted/revoked access
- **Session events:** Start, end, timeout

### **Why This Matters**

1. **Compliance:** HIPAA, SOC2, GDPR require audit logs
2. **Security:** Detect unauthorized access attempts
3. **Debugging:** Trace issues back to specific actions
4. **Analytics:** Understand how users edit documents
5. **Recovery:** Restore previous versions if needed

---

## Data Flow Example

### **Real-World Scenario: User Edits a Receipt**

```
1. User "Alice" uploads receipt PDF
   → OCR worker processes it
   → Creates document_versions (version 0, is_original=true)

2. Alice clicks "Edit" button at 10:00:00
   → Creates document_edit_sessions (started_at=10:00:00)
   → Loads version 0 content into editor
   → document_edits_log: action="open_editor"

3. Alice types corrections

   10:00:03 - Auto-save #1
   → Creates document_versions row A (version 1, is_latest=true)
   → Updates document_edit_sessions (last_activity_at=10:00:03, versions_created=1)
   → document_edits_log: action="snapshot"

   10:00:06 - Auto-save #2
   → Updates document_versions row A (same row!)
   → Updates document_edit_sessions (last_activity_at=10:00:06)
   → document_edits_log: action="auto_save"

   10:00:09 - Auto-save #3
   → Updates document_versions row A (same row!)
   → Updates document_edit_sessions (last_activity_at=10:00:09)
   → document_edits_log: action="auto_save"

   ... (97 more auto-saves, all updating row A)

   10:05:03 - Auto-save #100 (5 minutes passed!)
   → Creates document_versions row B (new snapshot!)
   → Updates document_edit_sessions (last_activity_at=10:05:03, versions_created=2)
   → document_edits_log: action="snapshot"

   ... (continues this pattern)

4. Alice clicks "Download Result" at 10:15:00
   → Creates final document_versions row D (version 1, published)
   → Uploads HTML to S3
   → Updates document_versions row D (s3_key="s3://...")
   → Updates document_edit_sessions (ended_at=10:15:00, published_version_id=D)
   → document_edits_log: action="publish"

RESULT:
- document_edit_sessions: 1 row (updated 300 times)
- document_versions: 4 rows (row A, B, C updated ~100 times each)
- document_edits_log: 300 rows
```

---

## Key Design Principles

### **1. Efficient History**
5-minute snapshotting balances history preservation with database efficiency. You get meaningful history without millions of rows.

### **2. Single Session Row**
Each editing session is one row, updated throughout the session. Easy to track active sessions and session statistics.

### **3. Update vs Create Strategy**
Within 5-minute windows, updates same row. After 5 minutes, creates new snapshot. Prevents excessive row creation while maintaining useful history.

### **4. Latest Version Tracking**
The `is_latest` flag allows instant retrieval of current content without sorting or max() queries.

### **5. Checksum Deduplication**
Content checksums prevent creating duplicate versions when content hasn't actually changed.

### **6. Granular Permissions**
Per-document, per-user permissions with expiration and revocation support enterprise security requirements.

### **7. Comprehensive Logging**
Every action is logged with context (who, what, when, why, from where) for security and compliance.

---

## Performance Considerations

### **Why 5-Minute Snapshots?**

**Without snapshotting (every auto-save creates new version):**
- 15-minute session = 300 auto-saves = 300 version rows
- 10 users editing = 3,000 rows per 15 minutes
- 1 day of editing = 288,000 rows 😱

**With 5-minute snapshotting:**
- 15-minute session = 3 snapshots = 3 version rows
- 10 users editing = 30 rows per 15 minutes
- 1 day of editing = 2,880 rows ✅ (100x reduction!)

### **Indexes**

Critical indexes for fast queries:
- `document_versions`: `(task_id, is_latest)` for current version
- `document_versions`: `(task_id, created_at)` for version history
- `document_edit_sessions`: `(user_id, ended_at)` for active sessions
- `document_edit_sessions`: `(ended_at, last_activity_at)` for abandoned sessions
- `document_edit_permissions`: `(task_id, user_id, is_active)` for auth checks
- `document_edits_log`: `(task_id, created_at)` for audit trails

### **S3 vs Database Storage**

- **During editing:** HTML in database (`html_content`)
- **After publish:** Upload to S3, set `s3_key`
- **Database:** Fast access, good for active editing
- **S3:** Cheaper storage, good for archived versions

---

## Common Queries

### **Get Current Version**
```sql
SELECT * FROM document_versions
WHERE task_id = ? AND is_latest = true;
```

### **Get Version History (5-min snapshots)**
```sql
SELECT * FROM document_versions
WHERE task_id = ?
ORDER BY edited_at DESC;
```

### **Check Edit Permission**
```sql
SELECT * FROM document_edit_permissions
WHERE user_id = ? AND task_id = ?
  AND is_active = true
  AND (expires_at IS NULL OR expires_at > NOW());
```

### **Active Editing Sessions**
```sql
SELECT * FROM document_edit_sessions
WHERE ended_at IS NULL
ORDER BY last_activity_at DESC;
```

### **Abandoned Sessions (no activity > 30 min)**
```sql
SELECT * FROM document_edit_sessions
WHERE ended_at IS NULL
  AND last_activity_at < NOW() - INTERVAL '30 minutes';
```

### **User's Edit History**
```sql
SELECT * FROM document_edits_log
WHERE user_id = ?
ORDER BY created_at DESC;
```

---

## Security Features

### **Access Control**
- Owner always has access
- Others need explicit permission grants
- Permissions can expire automatically
- Permissions can be revoked with audit trail

### **Audit Trail**
- Every edit action logged with IP and user agent
- Permission changes tracked
- Version history immutable
- Session tracking for accountability

### **Data Integrity**
- Content checksums detect corruption
- Foreign keys prevent orphaned records
- Triggers enforce business rules (single draft per user, etc.)
- Constraints ensure data validity

---

## Future Enhancements

### **Potential Features**

1. **Real-time Collaboration**
   - Multiple users editing simultaneously
   - Conflict resolution with operational transforms
   - Live cursor positions

2. **Smart Diffing**
   - Show exact changes between versions
   - Highlight what text was added/removed
   - Word-level or character-level diffs

3. **Version Branching**
   - Create alternate versions from any point
   - Merge branches back together
   - Experimental edits without affecting main line

4. **Configurable Snapshot Interval**
   - Admin can adjust 5-minute default
   - Per-user or per-task settings
   - Balance history granularity vs. storage

5. **AI-Powered Suggestions**
   - Auto-correct common OCR errors
   - Suggest formatting improvements
   - Detect anomalies in financial documents

6. **Advanced Permissions**
   - Role-based access (editor, reviewer, viewer)
   - Department-level permissions
   - Time-based access windows

---

## Summary

The document editing system provides a robust, auditable, and performant solution for collaborative document editing with smart version control. By using a **5-minute snapshotting strategy**, the system achieves:

- **Meaningful history:** Version snapshots every 5 minutes
- **Database efficiency:** 100x fewer rows than naive approach
- **Active updates:** Changes within 5-min windows update same row
- **Session tracking:** One row per session, updated continuously
- **Complete audit:** Every action logged for compliance

The four specialized tables work together seamlessly:

- **`document_versions`** → Version history with smart snapshotting
- **`document_edit_sessions`** → Single row per session, updated continuously
- **`document_edit_permissions`** → Fine-grained access control
- **`document_edits_log`** → Comprehensive audit trail

This architecture supports enterprise-grade security, compliance requirements, and provides excellent user experience with auto-save and real-time updates.
