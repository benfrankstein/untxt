# Next Steps to Complete Implementation

## ✅ Completed So Far:

1. ✅ Added `html_content` column to `document_versions` table
2. ✅ Updated `create_new_version()` function to accept `html_content`
3. ✅ Created `update_version_content()` function for updating existing versions
4. ✅ Created `update_version_s3_key()` function for S3 uploads
5. ✅ Updated `db.service.js` with all new functions

## 🔄 Next: Backend API Routes

You need to create these new routes:

### 1. POST /api/versions/:taskId/save (Auto-save endpoint)
- Replaces the old draft endpoint
- Implements snapshot logic (update if < 5min, create if > 5min)
- Stores HTML in database only (no S3 upload)

### 2. POST /api/sessions/:taskId/start (Session start)
- Creates session record when user opens document

### 3. POST /api/sessions/:taskId/end (Session end)
- Uploads latest version to S3
- Marks session as ended

### 4. POST /api/tasks/:taskId/download-result (Download with save)
- Converts HTML to PDF
- Saves version to database + S3
- Streams PDF to user

### 5. GET /api/versions/:taskId/latest (Load document)
- Gets latest version from database or S3
- Checks `html_content` first (faster), falls back to S3

The implementation code for these routes is in:
- `/GOOGLE_DOCS_ANALYSIS.md` (lines 160-350)
- `/COMPLETE_FLOW_WITH_FIELDS.md` (full examples)

## 🔄 Then: Frontend Changes

Update `/frontend/app.js`:

1. **Remove edit mode** - Content always editable
2. **Add auto-save** - Every 3s to database
3. **Add localStorage** - Crash recovery backup
4. **Add session tracking** - Start/end events
5. **Add save indicator** - "Saving..." → "All changes saved"

Full code examples in `/GOOGLE_DOCS_ANALYSIS.md` (lines 100-250)

## 📝 Implementation Order:

```
Step 1: Create new API route file
→ /backend/src/routes/google-docs.routes.js
→ Implement all 5 endpoints

Step 2: Register routes in server.js
→ app.use('/api/versions', googleDocsRoutes);
→ app.use('/api/sessions', googleDocsRoutes);

Step 3: Update frontend
→ Remove old draft functions
→ Add new auto-save logic
→ Add session tracking
→ Add localStorage backup

Step 4: Test end-to-end
→ Upload document
→ Edit with auto-save
→ Download result
→ Close tab (session end)
→ Verify database + S3
```

## 🚀 Quick Start Command:

```bash
# I can create the routes file and update the frontend
# Just say "continue implementing" and I'll create the route files!
```

Would you like me to continue creating the backend routes file?
