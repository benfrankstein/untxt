const { Pool } = require('pg');
const config = require('../config');

class DatabaseService {
  constructor() {
    this.pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected database error:', err);
    });
  }

  /**
   * Create a new file record in the database
   */
  async createFile(fileData) {
    const {
      fileId,
      userId,
      filename,
      mimeType,
      fileSize,
      s3Key,
      fileHash,
    } = fileData;

    // Determine file type based on mime type
    let fileType = 'document';
    if (mimeType.startsWith('image/')) {
      fileType = 'image';
    } else if (mimeType === 'application/pdf') {
      fileType = 'pdf';
    }

    // Make stored_filename unique by prepending fileId
    const storedFilename = `${fileId}_${filename}`;

    const query = `
      INSERT INTO files (
        id, user_id, original_filename, stored_filename, file_type,
        mime_type, file_size, s3_key, file_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const values = [
      fileId,
      userId,
      filename,
      storedFilename, // Make unique with fileId prefix
      fileType,
      mimeType,
      fileSize,
      s3Key,
      fileHash
    ];
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get file by ID
   */
  async getFileById(fileId) {
    const query = 'SELECT * FROM files WHERE id = $1;';
    const result = await this.pool.query(query, [fileId]);
    return result.rows[0] || null;
  }

  /**
   * Get all files for a user with pagination
   */
  async getFilesByUserId(userId, limit = 50, offset = 0) {
    const query = `
      SELECT * FROM files
      WHERE user_id = $1
      ORDER BY uploaded_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const result = await this.pool.query(query, [userId, limit, offset]);
    return result.rows;
  }

  /**
   * Update file status
   */
  async updateFileStatus(fileId, status) {
    const query = `
      UPDATE files
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const result = await this.pool.query(query, [status, fileId]);
    return result.rows[0] || null;
  }

  /**
   * Create a task record
   */
  async createTask(taskData) {
    const {
      taskId,
      fileId,
      userId,
      priority = 5,
    } = taskData;

    const query = `
      INSERT INTO tasks (
        id, file_id, user_id, priority, status
      )
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING *;
    `;

    const values = [taskId, fileId, userId, priority];
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get task by ID with file and result information
   */
  async getTaskById(taskId) {
    const query = `
      SELECT
        t.*,
        f.original_filename as filename,
        f.mime_type,
        f.s3_key,
        r.s3_result_key,
        r.extracted_text,
        r.confidence_score,
        r.word_count,
        r.page_count,
        u.username,
        u.email
      FROM tasks t
      LEFT JOIN files f ON t.file_id = f.id
      LEFT JOIN results r ON t.id = r.task_id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.id = $1;
    `;
    const result = await this.pool.query(query, [taskId]);
    return result.rows[0] || null;
  }

  /**
   * Get all tasks for a user with pagination
   */
  async getTasksByUserId(userId, limit = 50, offset = 0) {
    const query = `
      SELECT
        t.*,
        f.original_filename as filename,
        f.mime_type
      FROM tasks t
      LEFT JOIN files f ON t.file_id = f.id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const result = await this.pool.query(query, [userId, limit, offset]);
    return result.rows;
  }

  /**
   * Update task status
   */
  async updateTaskStatus(taskId, status, errorMessage = null) {
    const query = `
      UPDATE tasks
      SET
        status = $1,
        error_message = $2,
        ${status === 'processing' ? 'started_at = NOW(),' : ''}
        ${status === 'completed' || status === 'failed' ? 'completed_at = NOW(),' : ''}
        updated_at = NOW()
      WHERE id = $3
      RETURNING *;
    `;
    const result = await this.pool.query(query, [status, errorMessage, taskId]);
    return result.rows[0] || null;
  }

  /**
   * Update task with result
   */
  async updateTaskResult(taskId, resultData) {
    const {
      status = 'completed',
      result,
      errorMessage = null,
    } = resultData;

    const query = `
      UPDATE tasks
      SET
        status = $1,
        result = $2,
        error_message = $3,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $4
      RETURNING *;
    `;
    const result_query = await this.pool.query(query, [
      status,
      JSON.stringify(result),
      errorMessage,
      taskId,
    ]);
    return result_query.rows[0] || null;
  }

  /**
   * Update file with result S3 key
   */
  async updateFileResult(fileId, s3ResultKey) {
    const query = `
      UPDATE files
      SET
        s3_result_key = $1,
        status = 'processed',
        updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const result = await this.pool.query(query, [s3ResultKey, fileId]);
    return result.rows[0] || null;
  }

  /**
   * Get task statistics for a user
   */
  async getTaskStats(userId) {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) as total
      FROM tasks
      WHERE user_id = $1;
    `;
    const result = await this.pool.query(query, [userId]);
    return result.rows[0];
  }

  /**
   * Delete a task and associated records
   * Returns the task data before deletion (includes S3 keys for cleanup)
   */
  async deleteTask(taskId) {
    // First get the task with file and result info for S3 cleanup
    const task = await this.getTaskById(taskId);

    if (!task) {
      return null;
    }

    // Delete task (cascade will delete results)
    const deleteQuery = 'DELETE FROM tasks WHERE id = $1;';
    await this.pool.query(deleteQuery, [taskId]);

    // Delete file record
    const deleteFileQuery = 'DELETE FROM files WHERE id = $1;';
    await this.pool.query(deleteFileQuery, [task.file_id]);

    return task; // Return task data with S3 keys for cleanup
  }

  /**
   * Create a new user
   */
  async createUser(userData) {
    const {
      id,
      email,
      username,
      password_hash,
      role = 'user'
    } = userData;

    const query = `
      INSERT INTO users (
        id, email, username, password_hash, role, is_active, email_verified
      )
      VALUES ($1, $2, $3, $4, $5, true, false)
      RETURNING id, email, username, role, is_active, email_verified, created_at, updated_at;
    `;

    const values = [id, email, username, password_hash, role];
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1;';
    const result = await this.pool.query(query, [email]);
    return result.rows[0] || null;
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username) {
    const query = 'SELECT * FROM users WHERE username = $1;';
    const result = await this.pool.query(query, [username]);
    return result.rows[0] || null;
  }

  /**
   * Get user by ID
   */
  async getUserById(userId) {
    const query = 'SELECT * FROM users WHERE id = $1;';
    const result = await this.pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Update user last login timestamp
   */
  async updateUserLastLogin(userId) {
    const query = `
      UPDATE users
      SET last_login = NOW()
      WHERE id = $1
      RETURNING id;
    `;
    const result = await this.pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Create a new session record
   */
  async createSession(sessionData) {
    const {
      id,
      userId,
      sessionToken,
      ipAddress,
      userAgent,
      expiresAt
    } = sessionData;

    const query = `
      INSERT INTO user_sessions (
        id, user_id, session_token, ip_address, user_agent, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, session_token, ip_address, user_agent, created_at, last_activity, expires_at;
    `;

    const values = [id, userId, sessionToken, ipAddress, userAgent, expiresAt];
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get session by session token
   */
  async getSessionByToken(sessionToken) {
    const query = `
      SELECT * FROM user_sessions
      WHERE session_token = $1 AND expires_at > NOW();
    `;
    const result = await this.pool.query(query, [sessionToken]);
    return result.rows[0] || null;
  }

  /**
   * Update session last activity timestamp and extend expiration
   * (Rolling session - extends expiration on each activity)
   */
  async updateSessionActivity(sessionToken) {
    const query = `
      UPDATE user_sessions
      SET
        last_activity = NOW(),
        expires_at = NOW() + INTERVAL '30 minutes'
      WHERE session_token = $1
      RETURNING id;
    `;
    const result = await this.pool.query(query, [sessionToken]);
    return result.rows[0] || null;
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId) {
    const query = `
      SELECT * FROM user_sessions
      WHERE user_id = $1 AND expires_at > NOW()
      ORDER BY last_activity DESC;
    `;
    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }

  /**
   * Delete a session (logout)
   */
  async deleteSession(sessionToken) {
    const query = 'DELETE FROM user_sessions WHERE session_token = $1;';
    const result = await this.pool.query(query, [sessionToken]);
    return result.rowCount > 0;
  }

  /**
   * Delete all sessions for a user
   */
  async deleteAllUserSessions(userId) {
    const query = 'DELETE FROM user_sessions WHERE user_id = $1;';
    const result = await this.pool.query(query, [userId]);
    return result.rowCount;
  }

  /**
   * Delete expired sessions (cleanup job)
   */
  async deleteExpiredSessions() {
    const query = 'DELETE FROM user_sessions WHERE expires_at <= NOW();';
    const result = await this.pool.query(query);
    return result.rowCount;
  }

  /**
   * Create an audit log entry
   */
  async createAuditLog(auditData) {
    const {
      id,
      userId,
      eventType,
      eventCategory,
      details,
      ipAddress,
      userAgent,
      severity = 'info'
    } = auditData;

    const query = `
      INSERT INTO audit_logs (
        id, user_id, event_type, event_category, details, ip_address, user_agent, severity
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, user_id, event_type, event_category, details, ip_address, user_agent, severity, created_at;
    `;

    const values = [id, userId, eventType, eventCategory, details, ipAddress, userAgent, severity];
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get audit logs for a user
   */
  async getUserAuditLogs(userId, options = {}) {
    const {
      limit = 100,
      offset = 0,
      eventCategory = null,
      eventType = null
    } = options;

    let query = `
      SELECT * FROM audit_logs
      WHERE user_id = $1
    `;

    const values = [userId];
    let paramIndex = 2;

    if (eventCategory) {
      query += ` AND event_category = $${paramIndex}`;
      values.push(eventCategory);
      paramIndex++;
    }

    if (eventType) {
      query += ` AND event_type = $${paramIndex}`;
      values.push(eventType);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1};`;
    values.push(limit, offset);

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  /**
   * Get recent audit logs (admin)
   */
  async getRecentAuditLogs(options = {}) {
    const {
      limit = 100,
      offset = 0,
      severity = null
    } = options;

    let query = 'SELECT * FROM audit_logs';
    const values = [];
    let paramIndex = 1;

    if (severity) {
      query += ` WHERE severity = $${paramIndex}`;
      values.push(severity);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1};`;
    values.push(limit, offset);

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  /**
   * Health check - verify database connection
   */
  async healthCheck() {
    try {
      const result = await this.pool.query('SELECT NOW() as current_time;');
      return {
        healthy: true,
        timestamp: result.rows[0].current_time,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
      };
    }
  }

  /**
   * Close database connection pool
   */
  async close() {
    await this.pool.end();
  }

  // =============================================
  // Access Control Methods (HIPAA Compliance)
  // =============================================

  /**
   * Check if user has access to a specific task/file
   * Returns { hasAccess: boolean, denialReason: string|null }
   */
  async checkUserFileAccess(userId, taskId) {
    const query = 'SELECT * FROM check_user_file_access($1, $2);';
    const result = await this.pool.query(query, [userId, taskId]);

    if (result.rows.length === 0) {
      return { hasAccess: false, denialReason: 'Access check failed' };
    }

    return {
      hasAccess: result.rows[0].has_access,
      denialReason: result.rows[0].denial_reason,
    };
  }

  /**
   * Revoke all file access for a user (global revocation)
   */
  async revokeUserAccess(userId, adminUserId, reason) {
    const query = 'SELECT revoke_user_access($1, $2, $3);';
    await this.pool.query(query, [userId, adminUserId, reason]);
    return true;
  }

  /**
   * Restore all file access for a user (remove global revocation)
   */
  async restoreUserAccess(userId, adminUserId) {
    const query = 'SELECT restore_user_access($1, $2);';
    await this.pool.query(query, [userId, adminUserId]);
    return true;
  }

  /**
   * Revoke access to a specific file/task
   */
  async revokeFileAccess(userId, taskId, adminUserId, reason, temporary = false, expiresAt = null) {
    const query = 'SELECT revoke_file_access($1, $2, $3, $4, $5, $6);';
    await this.pool.query(query, [userId, taskId, adminUserId, reason, temporary, expiresAt]);
    return true;
  }

  /**
   * Restore access to a specific file/task
   */
  async restoreFileAccess(userId, taskId, adminUserId) {
    const query = 'SELECT restore_file_access($1, $2, $3);';
    await this.pool.query(query, [userId, taskId, adminUserId]);
    return true;
  }

  /**
   * Get user access status
   */
  async getUserAccessStatus(userId) {
    const query = `
      SELECT
        id,
        username,
        email,
        access_revoked,
        access_revoked_at,
        access_revoked_by,
        revocation_reason
      FROM users
      WHERE id = $1;
    `;
    const result = await this.pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Get all revoked users (for admin panel)
   */
  async getRevokedUsers() {
    const query = 'SELECT * FROM revoked_users_view ORDER BY access_revoked_at DESC;';
    const result = await this.pool.query(query);
    return result.rows;
  }

  /**
   * Get file access control records for a user
   */
  async getUserFileAccessControls(userId) {
    const query = `
      SELECT
        fac.*,
        t.id AS task_id,
        f.original_filename,
        f.s3_key,
        admin.username AS revoked_by_username
      FROM file_access_control fac
      JOIN tasks t ON fac.task_id = t.id
      JOIN files f ON t.file_id = f.id
      LEFT JOIN users admin ON fac.revoked_by = admin.id
      WHERE fac.user_id = $1
      ORDER BY fac.created_at DESC;
    `;
    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }

  /**
   * Log file access attempt (audit trail for HIPAA)
   */
  async logFileAccess(accessData) {
    const {
      userId,
      username,
      taskId,
      fileId,
      s3Key,
      filename,
      accessResult = 'allowed',
      accessDeniedReason = null,
      ipAddress = null,
      userAgent = null,
      sessionId = null,
      downloadDurationMs = null,
      metadata = null,
    } = accessData;

    const query = `
      INSERT INTO file_access_log (
        user_id, username, task_id, file_id, s3_key, filename,
        access_result, access_denied_reason, ip_address, user_agent,
        session_id, download_duration_ms, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;

    const values = [
      userId,
      username,
      taskId,
      fileId,
      s3Key,
      filename,
      accessResult,
      accessDeniedReason,
      ipAddress,
      userAgent,
      sessionId,
      downloadDurationMs,
      metadata ? JSON.stringify(metadata) : null,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get file access logs for a user (audit report)
   */
  async getUserFileAccessLogs(userId, limit = 100, offset = 0) {
    const query = `
      SELECT * FROM file_access_log
      WHERE user_id = $1
      ORDER BY accessed_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const result = await this.pool.query(query, [userId, limit, offset]);
    return result.rows;
  }

  /**
   * Get recent access denials (security monitoring)
   */
  async getRecentAccessDenials(limit = 100) {
    const query = `
      SELECT * FROM recent_access_denials_view
      LIMIT $1;
    `;
    const result = await this.pool.query(query, [limit]);
    return result.rows;
  }

  /**
   * Get user file access statistics
   */
  async getUserFileAccessStats(userId) {
    const query = `
      SELECT * FROM user_file_access_stats
      WHERE user_id = $1;
    `;
    const result = await this.pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Log admin action (audit trail)
   */
  async logAdminAction(actionData) {
    const {
      adminUserId,
      adminUsername,
      action,
      actionDescription = null,
      targetUserId = null,
      targetUsername = null,
      targetTaskId = null,
      reason = null,
      ipAddress = null,
      userAgent = null,
      metadata = null,
    } = actionData;

    const query = `
      INSERT INTO admin_action_log (
        admin_user_id, admin_username, action, action_description,
        target_user_id, target_username, target_task_id, reason,
        ip_address, user_agent, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `;

    const values = [
      adminUserId,
      adminUsername,
      action,
      actionDescription,
      targetUserId,
      targetUsername,
      targetTaskId,
      reason,
      ipAddress,
      userAgent,
      metadata ? JSON.stringify(metadata) : null,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get admin action logs
   */
  async getAdminActionLogs(limit = 100, offset = 0) {
    const query = `
      SELECT * FROM admin_action_log
      ORDER BY performed_at DESC
      LIMIT $1 OFFSET $2;
    `;
    const result = await this.pool.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Get admin actions summary
   */
  async getAdminActionsSummary() {
    const query = 'SELECT * FROM admin_actions_summary;';
    const result = await this.pool.query(query);
    return result.rows;
  }

  // ==========================================
  // DOCUMENT VERSIONING METHODS
  // ==========================================

  /**
   * Create a new document version
   */
  async createDocumentVersion(versionData) {
    const {
      taskId,
      fileId,
      versionNumber,
      s3Key,
      characterCount,
      wordCount,
      editedBy,
      editReason,
      editSummary,
      contentChecksum,
      ipAddress,
      userAgent,
    } = versionData;

    const query = `
      INSERT INTO document_versions (
        task_id, file_id, version_number, s3_key,
        character_count, word_count,
        edited_by, edit_reason, edit_summary,
        content_checksum, ip_address, user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;

    const result = await this.pool.query(query, [
      taskId,
      fileId,
      versionNumber,
      s3Key,
      characterCount,
      wordCount,
      editedBy,
      editReason,
      editSummary,
      contentChecksum,
      ipAddress,
      userAgent,
    ]);

    return result.rows[0];
  }

  /**
   * Get all versions for a task
   */
  async getDocumentVersions(taskId) {
    const query = `
      SELECT
        v.*,
        u.username as editor_username,
        u.email as editor_email
      FROM document_versions v
      LEFT JOIN users u ON v.edited_by = u.id
      WHERE v.task_id = $1
      ORDER BY v.version_number DESC;
    `;

    const result = await this.pool.query(query, [taskId]);
    return result.rows;
  }

  /**
   * Get specific version by task and version number
   */
  async getDocumentVersion(taskId, versionNumber) {
    const query = `
      SELECT
        v.*,
        u.username as editor_username,
        u.email as editor_email
      FROM document_versions v
      LEFT JOIN users u ON v.edited_by = u.id
      WHERE v.task_id = $1 AND v.version_number = $2;
    `;

    const result = await this.pool.query(query, [taskId, versionNumber]);
    return result.rows[0];
  }

  /**
   * Get latest version for a task
   */
  async getLatestDocumentVersion(taskId) {
    const query = `
      SELECT
        v.*,
        u.username as editor_username,
        u.email as editor_email
      FROM document_versions v
      LEFT JOIN users u ON v.edited_by = u.id
      WHERE v.task_id = $1 AND v.is_latest = TRUE
      LIMIT 1;
    `;

    const result = await this.pool.query(query, [taskId]);
    return result.rows[0];
  }

  /**
   * Get original version for a task
   */
  async getOriginalDocumentVersion(taskId) {
    const query = `
      SELECT * FROM document_versions
      WHERE task_id = $1 AND is_original = TRUE
      LIMIT 1;
    `;

    const result = await this.pool.query(query, [taskId]);
    return result.rows[0];
  }

  /**
   * Log document edit action
   */
  async logDocumentEdit(logData) {
    const {
      versionId,
      taskId,
      userId,
      username,
      action,
      changesDescription,
      diffSummary,
      ipAddress,
      userAgent,
      sessionId,
      accessGranted,
      accessReason,
    } = logData;

    const query = `
      INSERT INTO document_edits_log (
        version_id, task_id, user_id, username, action,
        changes_description, diff_summary,
        ip_address, user_agent, session_id,
        access_granted, access_reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;

    const result = await this.pool.query(query, [
      versionId,
      taskId,
      userId,
      username,
      action,
      changesDescription,
      diffSummary ? JSON.stringify(diffSummary) : null,
      ipAddress,
      userAgent,
      sessionId,
      accessGranted !== undefined ? accessGranted : true,
      accessReason || 'owner',
    ]);

    return result.rows[0];
  }

  /**
   * Get edit logs for a task
   */
  async getDocumentEditLogs(taskId, limit = 50, offset = 0) {
    const query = `
      SELECT * FROM document_edits_log
      WHERE task_id = $1
      ORDER BY logged_at DESC
      LIMIT $2 OFFSET $3;
    `;

    const result = await this.pool.query(query, [taskId, limit, offset]);
    return result.rows;
  }

  /**
   * Check if user can edit a document
   */
  async canUserEditDocument(taskId, userId) {
    // Check if user owns the task
    const taskQuery = `
      SELECT user_id FROM tasks WHERE id = $1;
    `;
    const taskResult = await this.pool.query(taskQuery, [taskId]);

    if (taskResult.rows.length === 0) {
      return { canEdit: false, reason: 'Task not found' };
    }

    const task = taskResult.rows[0];

    // Owner can always edit
    if (task.user_id === userId) {
      return { canEdit: true, reason: 'owner' };
    }

    // Check if user is admin
    const userQuery = `
      SELECT role FROM users WHERE id = $1;
    `;
    const userResult = await this.pool.query(userQuery, [userId]);

    if (userResult.rows.length > 0 && userResult.rows[0].role === 'admin') {
      return { canEdit: true, reason: 'admin' };
    }

    // Check explicit permissions
    const permQuery = `
      SELECT * FROM document_edit_permissions
      WHERE task_id = $1 AND user_id = $2
        AND can_edit = TRUE AND revoked = FALSE
        AND (expires_at IS NULL OR expires_at > NOW());
    `;
    const permResult = await this.pool.query(permQuery, [taskId, userId]);

    if (permResult.rows.length > 0) {
      return { canEdit: true, reason: 'granted_permission' };
    }

    return { canEdit: false, reason: 'no_permission' };
  }

  /**
   * Grant edit permission to a user
   */
  async grantEditPermission(taskId, userId, grantedBy, expiresAt = null) {
    const query = `
      INSERT INTO document_edit_permissions (
        task_id, user_id, granted_by, expires_at
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (task_id, user_id) DO UPDATE
      SET
        can_edit = TRUE,
        revoked = FALSE,
        granted_by = EXCLUDED.granted_by,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await this.pool.query(query, [taskId, userId, grantedBy, expiresAt]);
    return result.rows[0];
  }

  /**
   * Revoke edit permission from a user
   */
  async revokeEditPermission(taskId, userId, revokedBy, reason) {
    const query = `
      UPDATE document_edit_permissions
      SET
        revoked = TRUE,
        revoked_by = $3,
        revoked_at = CURRENT_TIMESTAMP,
        revoke_reason = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE task_id = $1 AND user_id = $2
      RETURNING *;
    `;

    const result = await this.pool.query(query, [taskId, userId, revokedBy, reason]);
    return result.rows[0];
  }

  /**
   * Get next version number for a task
   */
  async getNextVersionNumber(taskId) {
    const query = `
      SELECT COALESCE(MAX(version_number), -1) + 1 as next_version
      FROM document_versions
      WHERE task_id = $1 AND is_draft = FALSE;
    `;

    const result = await this.pool.query(query, [taskId]);
    return result.rows[0].next_version;
  }

  // =====================================================
  // DRAFT VERSION METHODS (Auto-save for HIPAA compliance)
  // =====================================================

  /**
   * Create or update a draft version (auto-save)
   */
  async createOrUpdateDraft(draftData) {
    const {
      taskId,
      fileId,
      userId,
      s3Key,
      characterCount,
      wordCount,
      editReason,
      contentChecksum,
      ipAddress,
      userAgent,
      sessionId
    } = draftData;

    // Check if user already has a draft for this task
    const existingDraft = await this.getUserDraft(taskId, userId);

    if (existingDraft) {
      // Update existing draft
      const query = `
        UPDATE document_versions
        SET
          s3_key = $1,
          character_count = $2,
          word_count = $3,
          edit_reason = $4,
          content_checksum = $5,
          ip_address = $6,
          user_agent = $7,
          draft_session_id = $8,
          autosave_count = autosave_count + 1,
          last_autosaved_at = CURRENT_TIMESTAMP,
          draft_expires_at = CURRENT_TIMESTAMP + INTERVAL '24 hours'
        WHERE id = $9
        RETURNING *;
      `;

      const result = await this.pool.query(query, [
        s3Key,
        characterCount,
        wordCount,
        editReason || 'Auto-save draft',
        contentChecksum,
        ipAddress,
        userAgent,
        sessionId,
        existingDraft.id
      ]);

      return result.rows[0];
    } else {
      // Create new draft
      const query = `
        INSERT INTO document_versions (
          task_id,
          file_id,
          version_number,
          s3_key,
          character_count,
          word_count,
          edited_by,
          edit_reason,
          content_checksum,
          ip_address,
          user_agent,
          is_draft,
          draft_session_id,
          last_autosaved_at,
          draft_expires_at
        ) VALUES (
          $1, $2, -1, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '24 hours'
        )
        RETURNING *;
      `;

      const result = await this.pool.query(query, [
        taskId,
        fileId,
        s3Key,
        characterCount,
        wordCount,
        userId,
        editReason || 'Auto-save draft',
        contentChecksum,
        ipAddress,
        userAgent,
        sessionId
      ]);

      return result.rows[0];
    }
  }

  /**
   * Get user's active draft for a task
   */
  async getUserDraft(taskId, userId) {
    const query = `
      SELECT dv.*,
        u.username as editor_username
      FROM document_versions dv
      LEFT JOIN users u ON dv.edited_by = u.id
      WHERE dv.task_id = $1
        AND dv.edited_by = $2
        AND dv.is_draft = TRUE
      ORDER BY dv.last_autosaved_at DESC
      LIMIT 1;
    `;

    const result = await this.pool.query(query, [taskId, userId]);
    return result.rows[0];
  }

  /**
   * Publish a draft as a final version
   */
  async publishDraft(draftId, editReason) {
    const query = `
      SELECT * FROM publish_draft_version($1, $2);
    `;

    const result = await this.pool.query(query, [draftId, editReason]);
    return result.rows[0];
  }

  /**
   * Delete a draft (user cancels edit)
   */
  async deleteDraft(draftId) {
    const query = `
      DELETE FROM document_versions
      WHERE id = $1 AND is_draft = TRUE
      RETURNING *;
    `;

    const result = await this.pool.query(query, [draftId]);
    return result.rows[0];
  }

  /**
   * Delete user's draft for a task
   */
  async deleteUserDraft(taskId, userId) {
    const query = `
      DELETE FROM document_versions
      WHERE task_id = $1 AND edited_by = $2 AND is_draft = TRUE
      RETURNING *;
    `;

    const result = await this.pool.query(query, [taskId, userId]);
    return result.rows[0];
  }

  /**
   * Clean up expired drafts (for scheduled job)
   */
  async cleanupExpiredDrafts() {
    const query = `
      SELECT cleanup_expired_drafts() as deleted_count;
    `;

    const result = await this.pool.query(query);
    return result.rows[0].deleted_count;
  }

  /**
   * Get all versions including drafts for a task
   */
  async getDocumentVersionsWithDrafts(taskId, userId = null) {
    let query;
    let params;

    if (userId) {
      // Include only this user's drafts
      query = `
        SELECT dv.*,
          u.username as editor_username
        FROM document_versions dv
        LEFT JOIN users u ON dv.edited_by = u.id
        WHERE dv.task_id = $1
          AND (dv.is_draft = FALSE OR (dv.is_draft = TRUE AND dv.edited_by = $2))
        ORDER BY dv.version_number DESC, dv.last_autosaved_at DESC;
      `;
      params = [taskId, userId];
    } else {
      // Only published versions
      query = `
        SELECT dv.*,
          u.username as editor_username
        FROM document_versions dv
        LEFT JOIN users u ON dv.edited_by = u.id
        WHERE dv.task_id = $1 AND dv.is_draft = FALSE
        ORDER BY dv.version_number DESC;
      `;
      params = [taskId];
    }

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  // ========================================
  // EDIT SESSION MANAGEMENT (Session-based logging)
  // ========================================

  /**
   * Create or get active edit session
   */
  async createOrGetEditSession({ taskId, userId, username, sessionId, draftId, ipAddress, userAgent, accessReason }) {
    // Check if session already exists
    const checkQuery = `
      SELECT * FROM document_edit_sessions
      WHERE session_id = $1;
    `;
    const existing = await this.pool.query(checkQuery, [sessionId]);

    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    // Create new session
    const insertQuery = `
      INSERT INTO document_edit_sessions (
        task_id, user_id, username, session_id, draft_id,
        ip_address, user_agent, access_reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;

    const result = await this.pool.query(insertQuery, [
      taskId, userId, username, sessionId, draftId,
      ipAddress, userAgent, accessReason
    ]);

    return result.rows[0];
  }

  /**
   * Update session with auto-save metrics
   */
  async updateEditSessionAutoSave({ sessionId, characterCount, wordCount }) {
    const query = `
      UPDATE document_edit_sessions
      SET
        autosave_count = autosave_count + 1,
        total_characters_changed = $2,
        total_words_changed = $3,
        last_activity_at = CURRENT_TIMESTAMP
      WHERE session_id = $1
      RETURNING *;
    `;

    const result = await this.pool.query(query, [sessionId, characterCount, wordCount]);
    return result.rows[0];
  }

  /**
   * Close edit session with outcome
   */
  async closeEditSession({ sessionId, outcome, publishedVersionId }) {
    const query = `
      UPDATE document_edit_sessions
      SET
        ended_at = CURRENT_TIMESTAMP,
        outcome = $2,
        published_version_id = $3
      WHERE session_id = $1
      RETURNING *;
    `;

    const result = await this.pool.query(query, [sessionId, outcome, publishedVersionId]);
    return result.rows[0];
  }

  /**
   * Get active edit sessions for a user
   */
  async getActiveEditSessions(userId) {
    const query = `
      SELECT * FROM document_edit_sessions
      WHERE user_id = $1 AND ended_at IS NULL
      ORDER BY started_at DESC;
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }

  /**
   * Get edit session history for a document
   */
  async getDocumentEditHistory(taskId) {
    const query = `
      SELECT
        s.*,
        dv.version_number as published_version_number
      FROM document_edit_sessions s
      LEFT JOIN document_versions dv ON s.published_version_id = dv.id
      WHERE s.task_id = $1
      ORDER BY s.started_at DESC;
    `;

    const result = await this.pool.query(query, [taskId]);
    return result.rows;
  }

  // =====================================================
  // GOOGLE DOCS FLOW: Version Management (No Drafts)
  // =====================================================

  /**
   * Create a new version immediately (Google Docs flow - no drafts)
   * Every save creates a version with the next version number
   */
  async createVersion(versionData) {
    const {
      taskId,
      fileId,
      userId,
      htmlContent,      // NEW: HTML content for database storage
      s3Key,            // NULL during editing, set on session end/download
      characterCount,
      wordCount,
      editReason = 'Auto-save',
      ipAddress,
      userAgent,
      sessionId
    } = versionData;

    const query = `
      SELECT * FROM create_new_version(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      );
    `;

    const result = await this.pool.query(query, [
      taskId,
      fileId,
      userId,
      htmlContent,      // Pass HTML content
      s3Key,
      characterCount,
      wordCount,
      editReason,
      ipAddress,
      userAgent,
      sessionId
    ]);

    return result.rows[0];
  }

  /**
   * Get the latest version for a task
   */
  async getLatestVersion(taskId) {
    const query = `
      SELECT * FROM document_versions
      WHERE task_id = $1 AND is_latest = TRUE
      ORDER BY version_number DESC
      LIMIT 1;
    `;

    const result = await this.pool.query(query, [taskId]);
    return result.rows[0];
  }

  /**
   * Increment version count in edit session
   */
  async incrementSessionVersions(sessionId) {
    const query = `SELECT increment_session_versions($1);`;
    await this.pool.query(query, [sessionId]);
  }

  /**
   * Get latest version for a specific session (for snapshot logic)
   */
  async getLatestVersionForSession(sessionId) {
    const query = `
      SELECT * FROM document_versions
      WHERE draft_session_id = $1
      ORDER BY version_number DESC
      LIMIT 1;
    `;

    const result = await this.pool.query(query, [sessionId]);
    return result.rows[0];
  }

  /**
   * Update existing version content (for < 5 min auto-saves)
   */
  async updateVersion(versionId, updates) {
    const { htmlContent, characterCount, wordCount } = updates;

    const query = `
      SELECT * FROM update_version_content($1, $2, $3, $4);
    `;

    const result = await this.pool.query(query, [
      versionId,
      htmlContent,
      characterCount,
      wordCount
    ]);

    return result.rows[0];
  }

  /**
   * Update version with S3 key after uploading to S3
   */
  async updateVersionS3Key(versionId, s3Key) {
    const query = `
      SELECT * FROM update_version_s3_key($1, $2);
    `;

    const result = await this.pool.query(query, [versionId, s3Key]);
    return result.rows[0];
  }

  /**
   * Get next version number for a task
   */
  async getNextVersionNumber(taskId) {
    const query = `
      SELECT COALESCE(MAX(version_number), -1) + 1 as next_version
      FROM document_versions
      WHERE task_id = $1;
    `;

    const result = await this.pool.query(query, [taskId]);
    return result.rows[0].next_version;
  }
}

module.exports = new DatabaseService();
