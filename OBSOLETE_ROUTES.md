# Obsolete Routes - Google Docs Flow Migration

## Summary
After migrating to Google Docs flow (always-editable documents with auto-save), the following routes are **NO LONGER USED** by the frontend but **KEPT FOR BACKWARD COMPATIBILITY**.

---

## ❌ OBSOLETE Frontend Features (Removed)

### Removed from HTML:
- `<button id="editBtn">` - Edit button
- `<select id="versionSelect">` - Version selector dropdown
- `<div id="editWarning">` - Edit mode warning banner
- `<div id="editControls">` - Edit mode controls (Save/Cancel buttons)
- `<input id="editReason">` - Edit reason input field

### Removed from app.js:
- `initializeVersioning()` - Old versioning system
- `enterEditMode()` - Enter edit mode
- `cancelEditMode()` - Cancel edit mode
- `saveNewVersion()` - Save version (old flow)
- `loadVersionsList()` - Load versions list
- `handleVersionChange()` - Version selector change handler
- `updateVersionInfo()` - Update version info display
- All draft-related functions

### Removed from style.css:
- `.btn-edit` - Edit button styles
- `.version-selector` - Version selector styles
- `.edit-warning` - Edit warning banner styles
- `.edit-controls` - Edit controls container
- `.edit-reason-group` - Edit reason input group
- `.edit-actions` - Edit action buttons
- `.btn-save` - Save button styles
- `.btn-cancel` - Cancel button styles

---

## 🔄 OBSOLETE Backend Routes (Kept for Backward Compatibility)

**Location:** `/backend/src/routes/versions.routes.js`

### Still in Code But NOT Called by Frontend:

#### 1. `GET /api/versions/:taskId/permissions` (Line 16)
**Status:** OBSOLETE
**Old Purpose:** Check if user can edit document before showing Edit button
**Google Docs Flow:** All documents immediately editable, no permission check needed
**Keep?** YES - Might be useful for admin panel

#### 2. `GET /api/versions/:taskId/draft` (Line 297)
**Status:** OBSOLETE
**Old Purpose:** Load user's draft when entering edit mode
**Google Docs Flow:** No drafts, loads from `/api/versions/:taskId/latest` instead
**Keep?** YES - Backward compatibility with old clients

#### 3. `POST /api/versions/:taskId/draft` (Line 357)
**Status:** OBSOLETE
**Old Purpose:** Auto-save draft to S3
**Google Docs Flow:** Uses `/api/versions/:taskId/save` (saves to DB only)
**Keep?** YES - Backward compatibility

#### 4. `POST /api/versions/:taskId/publish` (Line 488)
**Status:** OBSOLETE
**Old Purpose:** Publish draft as final version
**Google Docs Flow:** No publish step, every save is a version
**Keep?** YES - Backward compatibility

#### 5. `DELETE /api/versions/:taskId/draft` (Line 594)
**Status:** OBSOLETE
**Old Purpose:** Delete draft when canceling edit
**Google Docs Flow:** No cancel, sessions just end
**Keep?** YES - Backward compatibility

#### 6. `GET /api/versions/:taskId` (Line 642)
**Status:** PARTIALLY OBSOLETE
**Old Purpose:** Get all versions for dropdown selector
**Google Docs Flow:** No version selector in UI
**Keep?** YES - Still useful for admin panel / version history

#### 7. `GET /api/versions/:taskId/:versionNumber` (Line 732)
**Status:** PARTIALLY OBSOLETE
**Old Purpose:** Load specific version from dropdown
**Google Docs Flow:** Always loads latest
**Keep?** YES - Still useful for viewing old versions

---

## ✅ ACTIVE Routes (Used by Google Docs Flow)

**Location:** `/backend/src/routes/versions.routes.js`

### Currently Used by Frontend:

#### 1. `POST /api/versions/:taskId/save` (Line 52) ✅
**Purpose:** Auto-save every 3 seconds
**Flow:** Database only, creates snapshots every 5 minutes

#### 2. `GET /api/versions/:taskId/latest` (Line 165) ✅
**Purpose:** Load latest version when document opens
**Flow:** Checks DB first (fast), falls back to S3

#### 3. `GET /api/versions/:taskId/logs` (Line 242) ✅
**Purpose:** Get audit trail for compliance
**Flow:** Still useful for admin panel

**Location:** `/backend/src/routes/sessions.routes.js`

#### 4. `POST /api/sessions/:taskId/start` ✅
**Purpose:** Start edit session when document opens

#### 5. `POST /api/sessions/:taskId/end` ✅
**Purpose:** End session and upload to S3

#### 6. `POST /api/sessions/:taskId/download-result` ✅
**Purpose:** Download current content as PDF

---

## 📝 Migration Notes

### Old Flow (Edit Button):
```
1. User clicks "Edit" button
2. Frontend calls GET /api/versions/:taskId/permissions
3. Frontend calls GET /api/versions/:taskId/draft (check for existing draft)
4. Content becomes editable
5. User types → POST /api/versions/:taskId/draft (to S3)
6. User clicks "Publish" → POST /api/versions/:taskId/publish
7. OR User clicks "Cancel" → DELETE /api/versions/:taskId/draft
```

### New Flow (Google Docs):
```
1. Document opens → Content immediately editable
2. POST /api/sessions/:taskId/start (start session)
3. User types → POST /api/versions/:taskId/save (to DB)
4. After 5 min → POST /api/versions/:taskId/save (new snapshot)
5. User closes → POST /api/sessions/:taskId/end (upload to S3)
6. User downloads → POST /api/sessions/:taskId/download-result
```

---

## ⚠️ Recommendation

**DO NOT DELETE** obsolete routes yet because:
1. Backward compatibility with old clients
2. May be useful for future features (admin panel, version history viewer)
3. Low maintenance cost (they still work)

**OPTIONAL:** Add deprecation warnings to obsolete routes:
```javascript
console.warn('[DEPRECATED] This route is no longer used by the Google Docs flow');
```

---

## 🔧 Future Cleanup (Optional)

If you're sure no clients use old flow:
1. Remove routes from `versions.routes.js` (lines 297, 357, 488, 594)
2. Remove `document_drafts` table from database
3. Clean up S3 draft files (`results/.../draft_*.html`)

But keep:
- `/permissions` - useful for admin features
- `/:taskId` and `/:taskId/:versionNumber` - version history viewing
- `/logs` - compliance/audit trail

---

Generated: 2025-10-22
Migration: Edit Button → Google Docs Flow
