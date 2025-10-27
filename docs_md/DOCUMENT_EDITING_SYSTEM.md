# Document Editing System

## Overview

The document editing system implements a Google Docs-style collaborative editing flow with version control, permissions, session tracking, and audit logging. This system allows users to edit OCR-extracted documents in real-time with auto-save functionality while maintaining a complete history of changes.

---

## Core Tables

### 1. `document_versions`

**Purpose:** Stores all versions of edited documents, including both published versions and draft/auto-save snapshots.

**What it does:**
- Maintains a complete version history for every document
- Stores the HTML content directly in the database during editing
- Tracks metadata like character count, word count, and who made the edit
- Uses content checksums to detect duplicate saves
- Manages "latest" version flags to quickly retrieve current content
- Supports S3 storage keys for final published versions

**Key Features:**
- **Version numbering:** Each published version gets an incremental number (0, 1, 2, 3...)
- **Auto-save support:** Versions can be marked as drafts during active editing
- **Content storage:** HTML content stored in `html_content` column
- **Checksums:** MD5 hash of content to detect changes and prevent duplicates
- **Latest tracking:** `is_latest` flag marks the current version
- **Original tracking:** `is_original` flag marks the initial OCR result

---

### 2. `document_edit_sessions`

**Purpose:** Tracks active editing sessions when users are working on documents.

**What it does:**
- Creates a session when a user opens a document for editing
- Tracks session duration and activity
- Counts how many versions/snapshots were created during the session
- Records when sessions start and end
- Links to the draft version being edited
- Stores the final published version when session ends

**Key Features:**
- **Session lifecycle:** `started_at`, `ended_at`, `last_activity_at`
- **Activity tracking:** Updates `last_activity_at` on every auto-save
- **Version counting:** `versions_created` increments with each save
- **Draft linking:** Points to the current draft version being edited
- **Publishing:** Links to final published version when user ends session

**Session States:**
- **Active:** `ended_at` is NULL
- **Completed:** `ended_at` is set, `published_version_id` is set
- **Abandoned:** `ended_at` is NULL but `last_activity_at` is old

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
- **Action types:** Save, publish, revert, restore, etc.
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
    ↓
Loads latest version from document_versions
    - WHERE is_latest = true
    ↓
Frontend displays document in editor
```

#### **Step 2: User Edits and Auto-Save Kicks In**

```
User types in the editor
    ↓
Every 3 seconds, auto-save triggers
    ↓
Creates/updates document_versions
    - html_content: current editor content
    - content_checksum: md5(content)
    - is_draft: false
    - is_latest: true
    - character_count, word_count calculated
    ↓
Updates document_edit_sessions
    - last_activity_at: NOW
    - versions_created: increment
    ↓
Creates document_edits_log entry
    - action: "auto_save"
    - version_id: new version ID
    - details: what changed
```

**Auto-save Strategy:**
- Creates a new version every auto-save
- Each version becomes the "latest"
- Previous versions remain for history
- Checksum prevents duplicate saves

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
Updates document_edit_sessions
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

**Published Versions**
- `is_draft = false`
- `version_number >= 1`
- Permanent, immutable records
- Stored in S3 and database

**Draft/Auto-save Versions**
- `is_draft = false` (but `is_latest = true`)
- Created during active editing
- Multiple versions during one session
- Become permanent history

### **Version Numbering**

```
version_number = 0  → Original OCR result
version_number = 1  → First published edit
version_number = 2  → Second published edit
version_number = N  → Nth published edit
```

Auto-saves during editing create intermediate versions that maintain the history but don't increment the published version number until session ends.

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
- **Last activity** (last_activity_at)
- **How many saves** (versions_created)

### **Session Timeout**

Sessions without activity for 30+ minutes are considered abandoned:
```sql
SELECT * FROM document_edit_sessions
WHERE ended_at IS NULL
  AND last_activity_at < NOW() - INTERVAL '30 minutes'
```

Abandoned sessions can be cleaned up by a background job.

---

## Audit Trail

### **What Gets Logged?**

Every action in `document_edits_log`:
- **User actions:** Save, publish, revert, delete
- **Auto-saves:** Automatic snapshots during editing
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

2. Alice clicks "Edit" button
   → Creates document_edit_sessions (started_at=NOW)
   → Loads version 0 content into editor
   → document_edits_log: action="open_editor"

3. Alice types corrections (every 3 seconds auto-save)
   → Creates document_versions (version 0, is_latest=true)
   → Updates document_edit_sessions (last_activity_at=NOW)
   → document_edits_log: action="auto_save"
   [Repeat 10 times → 10 auto-save versions created]

4. Alice clicks "Download Result"
   → Creates final document_versions (version 1, is_draft=false)
   → Uploads HTML to S3
   → Updates document_versions (s3_key="s3://...")
   → Updates document_edit_sessions (ended_at=NOW, published_version_id=...)
   → document_edits_log: action="publish"

5. Later, Manager Bob needs to edit
   → Alice grants permission via document_edit_permissions
   → Bob can now edit (repeats steps 2-4)
   → Creates version 2 when published
```

---

## Key Design Principles

### **1. Immutable History**
Once a version is created, it's never deleted or modified. This ensures a complete audit trail.

### **2. Latest Version Tracking**
The `is_latest` flag allows instant retrieval of current content without sorting or max() queries.

### **3. Session-Based Editing**
All editing happens within a session context, making it easy to track what happened during each editing period.

### **4. Checksum Deduplication**
Content checksums prevent creating duplicate versions when content hasn't changed.

### **5. Granular Permissions**
Per-document, per-user permissions with expiration and revocation support enterprise security requirements.

### **6. Comprehensive Logging**
Every action is logged with context (who, what, when, why, from where) for security and compliance.

---

## Performance Considerations

### **Indexes**

Critical indexes for fast queries:
- `document_versions`: `(task_id, is_latest)` for current version
- `document_edit_sessions`: `(user_id, ended_at)` for active sessions
- `document_edit_permissions`: `(task_id, user_id, is_active)` for auth checks
- `document_edits_log`: `(task_id, created_at)` for audit trails

### **Auto-save Frequency**

- **3 seconds** is aggressive but provides good UX
- Each auto-save creates a new version row
- Trade-off: More storage vs. better history
- Alternative: Update existing version if < 5 min old

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

### **Get Version History**
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
- Triggers enforce business rules
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

4. **AI-Powered Suggestions**
   - Auto-correct common OCR errors
   - Suggest formatting improvements
   - Detect anomalies in financial documents

5. **Advanced Permissions**
   - Role-based access (editor, reviewer, viewer)
   - Department-level permissions
   - Time-based access windows

---

## Summary

The document editing system provides a robust, auditable, and performant solution for collaborative document editing with complete version control. By separating concerns into four specialized tables, the system maintains:

- **Complete history** via `document_versions`
- **Active session tracking** via `document_edit_sessions`
- **Fine-grained access control** via `document_edit_permissions`
- **Comprehensive audit trail** via `document_edits_log`

This architecture supports enterprise-grade security, compliance requirements, and provides excellent user experience with auto-save and real-time updates.
