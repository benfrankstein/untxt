# Authentication Setup & Testing Guide

## Quick Start

### 1. Install Required Packages

```bash
cd /Users/benfrankstein/Projects/untxt/backend
npm install bcrypt express-session
```

### 2. Add Environment Variable

Add this to `backend/.env`:
```bash
SESSION_SECRET=replace-this-with-a-long-random-string-for-production
```

To generate a secure random secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Restart Backend Server

```bash
# Stop current server (Ctrl+C)
# Start again
npm start
```

### 4. Test Authentication

#### Open Auth Page
```bash
open frontend/auth.html
# or navigate to http://localhost:8080/../frontend/auth.html
```

#### Create Account (Signup)
1. Click "Sign Up" tab
2. Fill in:
   - **Email**: `test@example.com`
   - **Username**: `testuser`
   - **Password**: `TestPassword123!@#`
3. Watch the password requirements turn green ✓
4. Click "Create Account"
5. You should be redirected to index.html (main app)
6. Check the header - should show your username and email

#### Test Login
1. Click "Logout" button (top right)
2. You'll be redirected to auth.html
3. Click "Login" tab
4. Enter:
   - **Email/Username**: `test@example.com` (or `testuser`)
   - **Password**: `TestPassword123!@#`
5. Click "Log In"
6. Should redirect back to main app

#### Test Session Persistence
1. While logged in, refresh the page
2. Should stay logged in
3. Try opening a new tab and go to index.html
4. Should still be logged in

#### Test Protected Routes
1. Log out
2. Try to access http://localhost:8080/../frontend/index.html directly
3. Should automatically redirect to auth.html

## Password Requirements Testing

Try these passwords to test validation:

| Password | Expected Result |
|----------|----------------|
| `short` | ❌ Too short (< 12 chars) |
| `nouppercase123!` | ❌ No uppercase letter |
| `NOLOWERCASE123!` | ❌ No lowercase letter |
| `NoNumbers!@#` | ❌ No numbers |
| `NoSpecialChars123` | ❌ No special characters |
| `Has Spaces 123!` | ❌ Contains spaces |
| `ValidPassword123!@#` | ✅ All requirements met |

## Verify Database

Check that users are being created properly:

```bash
psql -h localhost -U ocr_platform_user -d ocr_platform_dev

# Check users
SELECT id, email, username, role, created_at, last_login FROM users;

# Verify password is hashed
SELECT email, substring(password_hash, 1, 10) as hash_preview FROM users;
# Should see bcrypt hash starting with $2b$12$...
```

## Troubleshooting

### Issue: npm install fails
**Fix**: Run this first:
```bash
# Fix npm permissions
sudo chown -R $(whoami) ~/.npm
```

### Issue: Session not persisting
**Check**:
1. Is `SESSION_SECRET` set in `.env`?
2. Is `credentials: 'include'` in all fetch requests?
3. Check browser console for CORS errors

### Issue: "Authentication required" on index.html
**Expected behavior**: This means auth is working!
- If not logged in → Redirects to auth.html
- If logged in → Shows main app

### Issue: Password validation not working
**Check**:
1. Open browser console (F12)
2. Look for JavaScript errors
3. Verify auth.js is loaded

### Issue: Backend errors
**Check backend console**:
```bash
cd backend
npm start
```

Look for:
- `✓ Database connected`
- `✓ Redis connected`
- API routes mounted

## API Testing (Optional)

Test API endpoints directly with curl:

### Signup
```bash
curl -X POST http://localhost:8080/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "api@example.com",
    "username": "apiuser",
    "password": "ApiTest123!@#"
  }'
```

Expected:
```json
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "user": {
      "id": "...",
      "email": "api@example.com",
      "username": "apiuser",
      "role": "user",
      "created_at": "..."
    }
  }
}
```

### Login
```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "emailOrUsername": "api@example.com",
    "password": "ApiTest123!@#"
  }'
```

Expected:
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "...",
      "email": "api@example.com",
      "username": "apiuser",
      "role": "user",
      "last_login": "..."
    }
  }
}
```

### Check Session
```bash
curl http://localhost:8080/api/auth/session \
  -b cookies.txt
```

Expected:
```json
{
  "success": true,
  "data": {
    "authenticated": true,
    "user": {
      "id": "...",
      "email": "api@example.com",
      "username": "apiuser",
      "role": "user"
    }
  }
}
```

### Logout
```bash
curl -X POST http://localhost:8080/api/auth/logout \
  -b cookies.txt
```

Expected:
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

## Success Checklist

- [ ] Packages installed successfully
- [ ] Backend starts without errors
- [ ] Can open auth.html in browser
- [ ] Can create new account
- [ ] Redirected to index.html after signup
- [ ] User info shows in header
- [ ] Can logout
- [ ] Can login with email
- [ ] Can login with username
- [ ] Session persists across page reloads
- [ ] Protected routes redirect to login
- [ ] Password validation works (green checkmarks)
- [ ] Weak passwords are rejected
- [ ] Users are stored in database with hashed passwords

## Next Steps

Once everything is working:

1. ✅ **Phase 1 Complete** - Strong passwords + hashing ← YOU ARE HERE
2. ⏳ **Phase 2** - Add account lockout (5 failed attempts)
3. ⏳ **Phase 3** - Add session timeout with warning
4. ⏳ **Phase 4** - Add audit logging
5. ⏳ **Phase 5** - Add password reset flow
6. ⏳ **Phase 6** - Add email verification
7. ⏳ **Phase 7** - Add 2FA (TOTP)

See `AUTHENTICATION_IMPLEMENTATION.md` for full details.

## Need Help?

If you encounter issues:

1. Check backend console for errors
2. Check browser console (F12) for errors
3. Verify database is running: `psql -h localhost -U ocr_platform_user -d ocr_platform_dev -c "SELECT 1"`
4. Verify Redis is running: `redis-cli ping`
5. Check that all files were created (see file list in AUTHENTICATION_IMPLEMENTATION.md)
