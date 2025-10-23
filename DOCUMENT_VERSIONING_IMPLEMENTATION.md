# Document Versioning Implementation - HIPAA Compliant

## Overview
Implemented Option 1: Version Control with Full Audit Trail for editable HTML results.

---

## ✅ Backend Implementation Complete

### 1. Database Schema (`database/migrations/003_add_document_versions.sql`)

**Tables Created:**

#### `document_versions`
- Stores metadata for each edited version
- Fields: version_number, s3_key, character_count, word_count
- Tracks: edited_by, edited_at, edit_reason, content_checksum
- Audit: ip_address, user_agent
- Flags: is_original, is_latest

#### `document_edits_log`
- Detailed audit log of ALL edit actions
- Tracks: action (create_version, view_version, download_version)
- Full audit metadata: user, IP, user agent, session
- Compliance: access_granted, access_reason

#### `document_edit_permissions`
- Fine-grained permission control
- Fields: can_edit, granted_by, expires_at
- Revocation: revoked, revoked_by, revoke_reason

**Triggers:**
- `create_original_version()` - Auto-create version 0 when task completes
- `update_latest_version()` - Maintain is_latest flag automatically

---

### 2. Database Service Methods (`backend/src/services/db.service.js`)

**Version Management:**
- `createDocumentVersion()` - Create new version record
- `getDocumentVersions(taskId)` - Get all versions for a task
- `getDocumentVersion(taskId, versionNumber)` - Get specific version
- `getLatestDocumentVersion(taskId)` - Get current active version
- `getOriginalDocumentVersion(taskId)` - Get OCR output (version 0)
- `getNextVersionNumber(taskId)` - Calculate next version number

**Audit Logging:**
- `logDocumentEdit()` - Log all edit actions
- `getDocumentEditLogs(taskId)` - Retrieve audit logs

**Permissions:**
- `canUserEditDocument(taskId, userId)` - Check edit permission
- `grantEditPermission()` - Give user edit access
- `revokeEditPermission()` - Remove edit access

---

### 3. API Endpoints (`backend/src/routes/versions.routes.js`)

#### **GET /api/versions/:taskId**
- List all versions for a task
- Returns: version metadata with editor info

#### **GET /api/versions/:taskId/:versionNumber**
- Get specific version HTML content
- Returns: HTML content with version headers
- Logs: view_version action

#### **POST /api/versions/:taskId**
- Create new version (save edited HTML)
- Body: `{ htmlContent, editReason, editSummary }`
- Process:
  1. Check edit permission
  2. Calculate metrics (character/word count)
  3. Generate SHA-256 checksum
  4. Upload to S3: `results/{userId}/{fileId}/v{N}_edited.html`
  5. Update `latest.html`
  6. Create version record
  7. Log edit action
- Returns: version metadata

#### **GET /api/versions/:taskId/logs**
- Get edit audit logs
- Owner or admin only
- Pagination support

#### **GET /api/versions/:taskId/permissions**
- Check if user can edit document
- Returns: `{ canEdit, reason }`

---

## 🗂️ S3 Structure

```
results/
└── {userId}/
    └── {fileId}/
        ├── result.html             (original OCR - immutable)
        ├── v1_edited.html          (first edit)
        ├── v2_edited.html          (second edit)
        ├── v3_edited.html          (third edit)
        └── latest.html             (copy of most recent)
```

**Version Naming:**
- `result.html` - Original OCR output (version 0)
- `v{N}_edited.html` - Edited version N
- `latest.html` - Always points to current version

---

## 🔐 HIPAA Compliance Features

### Access Control
- ✅ Owner-based permissions (user owns task)
- ✅ Role-based permissions (admin can edit)
- ✅ Explicit grant/revoke permissions
- ✅ Permission expiration support
- ✅ Access reason tracking

### Audit Trail
- ✅ Every edit logged with full metadata
- ✅ WHO: user_id, username
- ✅ WHEN: timestamp (UTC)
- ✅ WHAT: action, changes_description
- ✅ WHERE: IP address, user agent
- ✅ WHY: edit_reason, access_reason

### Data Integrity
- ✅ SHA-256 checksums for tamper detection
- ✅ Original always preserved (immutable)
- ✅ Version history never deleted
- ✅ All versions in database with FK constraints

### Encryption
- ✅ S3 server-side encryption (existing)
- ✅ TLS in transit (HTTPS)
- ✅ Same security model as original files

---

## 📊 Permission Logic

```javascript
canUserEditDocument(taskId, userId):
  1. Check if user owns task → allow (reason: 'owner')
  2. Check if user is admin → allow (reason: 'admin')
  3. Check explicit permissions → allow if granted (reason: 'granted_permission')
  4. Otherwise → deny (reason: 'no_permission')
```

---

## 🔄 Edit Flow (Backend)

1. **User requests edit**
   - Frontend: `POST /api/versions/:taskId`
   - Body: `{ htmlContent, editReason }`

2. **Backend validation**
   - Check task exists
   - Verify edit permission
   - Calculate next version number

3. **Content processing**
   - Calculate character/word count
   - Generate SHA-256 checksum
   - Sanitize HTML (TODO: add XSS protection)

4. **S3 upload**
   - Upload: `v{N}_edited.html`
   - Copy to: `latest.html`
   - Metadata: version, edited-by, timestamp

5. **Database records**
   - Insert document_versions row
   - Trigger updates is_latest flags
   - Log to document_edits_log

6. **Return response**
   - Success: version metadata
   - Error: permission denied or validation error

---

## 🚧 TODO: Frontend Implementation (Not Yet Complete)

### Remaining Tasks:

1. **Edit Mode Toggle**
   - Add "Edit" button next to "UNTXT" toggle
   - Switch between view/edit modes
   - Show warning: "You are editing PHI"

2. **Rich Text Editor**
   - Integrate TinyMCE or Quill
   - Load current HTML into editor
   - Syntax highlighting for HTML

3. **Version Selector**
   - Dropdown: "Original | v1 | v2 | v3 (latest)"
   - Show version metadata
   - Load selected version into preview

4. **Save Version UI**
   - "Save New Version" button
   - Edit reason input field (optional)
   - Confirmation dialog
   - Show diff preview before saving

5. **Version History**
   - List all versions with metadata
   - Show who edited, when, reason
   - "Compare Versions" feature

6. **Permissions UI**
   - Check edit permission on load
   - Show/hide edit button based on permission
   - Display permission reason

---

## 🔧 Database Migration

**To apply migration:**

```bash
cd /Users/benfrankstein/Projects/untxt/database
psql -U ocr_platform_user -d ocr_platform -h localhost < migrations/003_add_document_versions.sql
```

**Verify:**

```sql
\dt document_*  -- List tables
SELECT * FROM document_versions LIMIT 5;
SELECT * FROM document_edits_log LIMIT 5;
SELECT * FROM document_edit_permissions LIMIT 5;
```

---

## 📝 API Usage Examples

### List Versions
```javascript
GET /api/versions/task-123
Headers: { 'x-user-id': 'user-456' }

Response:
{
  "success": true,
  "data": {
    "versions": [
      {
        "id": "...",
        "version_number": 2,
        "s3_key": "results/.../v2_edited.html",
        "is_latest": true,
        "edited_by": "user-456",
        "edited_at": "2025-10-21T14:30:00Z",
        "edit_reason": "Fixed date formatting",
        "editor_username": "benfrankstein"
      },
      ...
    ],
    "total": 3
  }
}
```

### Create New Version
```javascript
POST /api/versions/task-123
Headers: { 'x-user-id': 'user-456', 'Content-Type': 'application/json' }
Body: {
  "htmlContent": "<html>...</html>",
  "editReason": "Corrected merchant name",
  "editSummary": "Changed 'BUTTSTÄDTER' to 'BUTTSTÄDTER VOLLKORN'"
}

Response:
{
  "success": true,
  "data": {
    "version": { ... },
    "message": "Version 3 created successfully"
  }
}
```

### Check Edit Permission
```javascript
GET /api/versions/task-123/permissions
Headers: { 'x-user-id': 'user-456' }

Response:
{
  "success": true,
  "data": {
    "canEdit": true,
    "reason": "owner"
  }
}
```

---

## ⚠️ Important Notes

1. **Original Never Changes**
   - Version 0 (original OCR output) is immutable
   - Always preserved in `result.html`
   - Cannot be edited or deleted

2. **Version Numbers Sequential**
   - Start at 0 (original)
   - Increment: 1, 2, 3, ...
   - Never reuse version numbers

3. **Latest Flag**
   - Only one version per task has `is_latest = TRUE`
   - Automatically managed by trigger
   - Used for `/preview?version=latest`

4. **Cascade Deletes**
   - Delete task → deletes all versions
   - Delete user → prevents deletion (FK constraint)
   - Maintains referential integrity

5. **Audit Log Retention**
   - Logs never deleted (even if version deleted)
   - Required for HIPAA 7-year retention
   - Consider archival strategy for old logs

---

## 📈 Next Steps

1. **Apply Database Migration**
   ```bash
   ./database/scripts/apply_migration.sh 003_add_document_versions.sql
   ```

2. **Test Backend APIs**
   ```bash
   # Test version creation
   curl -X POST http://localhost:8080/api/versions/task-123 \
     -H "x-user-id: user-456" \
     -H "Content-Type: application/json" \
     -d '{"htmlContent":"<html>Test</html>","editReason":"Testing"}'
   ```

3. **Implement Frontend**
   - Add Edit mode UI
   - Integrate rich text editor
   - Add version selector dropdown

4. **Security Enhancements**
   - Add HTML sanitization (DOMPurify)
   - Rate limiting on edit endpoints
   - Add edit session timeout

5. **Testing**
   - Unit tests for DB methods
   - Integration tests for API endpoints
   - E2E tests for edit workflow

---

## 🎯 Benefits

- ✅ Full version history with audit trail
- ✅ HIPAA-compliant access control
- ✅ Original data always preserved
- ✅ Tamper detection via checksums
- ✅ Fine-grained permissions
- ✅ Complete audit logs for compliance
- ✅ Same S3 structure (easy cleanup)
- ✅ Scalable (version per file)

---

**Implementation Status:** Backend Complete ✅ | Frontend Pending ⏳

**Created:** 2025-10-21
**Last Updated:** 2025-10-21
