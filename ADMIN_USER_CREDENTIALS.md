# Admin User Credentials

**Generated:** 2025-10-19

## Database Reset Summary

All seed data has been wiped from the database. The only user in the system is the admin user created below.

## Admin User Details

| Field | Value |
|-------|-------|
| **User ID** | `3c8bf409-1992-4156-add2-3d5bb3df6ec1` |
| **Username** | `benfrankstein` |
| **Email** | `benjamin.frankstein@gmail.com` |
| **Password** | `Banker2b` |
| **Role** | `admin` |
| **Status** | Active, Email Verified |

## Database State

| Table | Count |
|-------|-------|
| Users | 1 (admin only) |
| Tasks | 0 |
| Files | 0 |
| Results | 0 |
| Sessions | 0 |

## Frontend Configuration

The frontend has been updated to use your user ID:

```javascript
// frontend/app.js
const USER_ID = '3c8bf409-1992-4156-add2-3d5bb3df6ec1'; // benfrankstein (admin)
```

## Password Hash

The password is hashed using bcrypt with 10 rounds:
```
$2a$10$iNqSjo1PHbeT07RW.xwZ4eLITR39CEK4H1YL3JNKEI5fHcVpr0lWe
```

## Next Steps

1. **Upload Documents**: Visit http://localhost:3000 to upload PDFs
2. **Change Password**: After first login, change the password for security
3. **Create Additional Users**: Use the admin panel (when implemented) to create more users

## Security Notes

⚠️ **IMPORTANT**:
- This password is stored in plain text in this file for development purposes
- Delete this file or change the password before deploying to production
- Consider implementing password reset functionality

## Database Reset Script

To reset the database again in the future:

```bash
# Manual reset
psql -U ocr_platform_user -d ocr_platform_dev -f database/scripts/reset_with_admin.sql
```

Or to create a different admin user, modify the SQL script and regenerate the password hash:

```bash
# Generate new password hash
psql -U ocr_platform_user -d ocr_platform_dev -c "SELECT crypt('YourNewPassword', gen_salt('bf', 10));"
```

## Verify Login

To test the credentials:

```sql
-- Check if password matches
SELECT
    id,
    username,
    email,
    role,
    password_hash = crypt('Banker2b', password_hash) as password_matches
FROM users
WHERE username = 'benfrankstein';
```

Should return `password_matches: t` (true)
