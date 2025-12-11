# Google OAuth Setup Guide

This guide walks you through setting up Google OAuth for your application.

## Overview

Your app now supports:
- ✅ Sign up with Google
- ✅ Sign in with Google
- ✅ Account linking (Google + password accounts)
- ✅ Email conflict detection
- ✅ HIPAA-compliant audit logging

## Step 1: Run Database Migration

First, apply the OAuth migration to add the necessary columns to your users table:

```bash
# Connect to your PostgreSQL database
psql -h localhost -U ocr_platform_user -d ocr_platform_dev

# Run the migration
\i database/migrations/019_add_oauth_support.sql

# Verify the changes
\d users
```

You should see new columns:
- `auth_provider` (enum: 'local' or 'google')
- `google_id` (varchar, unique)
- `linked_providers` (jsonb)

## Step 2: Get Google OAuth Credentials

### 2.1 Go to Google Cloud Console

Visit: https://console.cloud.google.com/

### 2.2 Create a New Project (or select existing)

1. Click the project dropdown at the top
2. Click "New Project"
3. Name it something like "untxt" or "OCR Platform"
4. Click "Create"

### 2.3 Enable Google+ API

1. In the left sidebar, go to **APIs & Services > Library**
2. Search for "Google+ API" or "People API"
3. Click on it and press "Enable"

### 2.4 Configure OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Choose **External** (unless you have a Google Workspace)
3. Click "Create"

**Fill in the form:**
- **App name**: untxt (or your app name)
- **User support email**: your-email@example.com
- **App logo**: (optional for testing)
- **Application home page**: http://localhost:3000
- **Authorized domains**: (leave empty for localhost testing)
- **Developer contact email**: your-email@example.com

4. Click "Save and Continue"

**Scopes:**
- Click "Add or Remove Scopes"
- Select:
  - `userinfo.email`
  - `userinfo.profile`
- Click "Update" then "Save and Continue"

**Test users (for development):**
- Add your Gmail address as a test user
- Click "Save and Continue"

5. Review and click "Back to Dashboard"

### 2.5 Create OAuth Client ID

1. Go to **APIs & Services > Credentials**
2. Click **"Create Credentials" > "OAuth client ID"**
3. Choose **"Web application"**

**Configure the client:**
- **Name**: untxt Web Client (or whatever you like)

- **Authorized JavaScript origins** (for development):
  ```
  http://localhost:8080
  http://localhost:3000
  ```

- **Authorized redirect URIs**:
  ```
  http://localhost:8080/api/auth/google/callback
  ```

4. Click "Create"

### 2.6 Copy Your Credentials

A popup will show your:
- **Client ID**: Something like `123456789-abc123.apps.googleusercontent.com`
- **Client Secret**: Something like `GOCSPX-abc123xyz789`

**Keep these safe!** You'll need them in the next step.

## Step 3: Configure Environment Variables

1. Copy your `.env.example` to `.env` (if you haven't already):
   ```bash
   cd backend
   cp .env.example .env
   ```

2. Edit your `.env` file and add your Google credentials:
   ```bash
   # Google OAuth Configuration
   GOOGLE_CLIENT_ID=your-actual-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-actual-client-secret
   GOOGLE_CALLBACK_URL=http://localhost:8080/api/auth/google/callback
   ```

3. Also ensure you have a session secret:
   ```bash
   # Generate a random secret (run this in terminal):
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

   # Add it to .env:
   SESSION_SECRET=<paste-the-generated-secret-here>
   ```

## Step 4: Test the Implementation

### 4.1 Start Your Backend Server

```bash
cd backend
npm install  # Make sure passport packages are installed
npm start
```

Look for logs showing:
```
Server running on port 8080
Database connected
Redis connected
```

### 4.2 Test Google OAuth Flow

**Option 1: Direct Browser Test**

Open your browser and navigate to:
```
http://localhost:8080/api/auth/google
```

This should:
1. Redirect you to Google's sign-in page
2. Ask you to select a Google account
3. Show the consent screen (first time only)
4. Redirect back to your app with `?login=success`

**Option 2: API Test**

You can test the account linking flow:

```bash
# Check if an email exists
curl "http://localhost:8080/api/auth/check-email?email=test@example.com"

# Response will show:
# { "exists": true, "authProvider": "local", "hasGoogleLinked": false }
```

### 4.3 Verify in Database

Check that the OAuth user was created:

```sql
-- Connect to database
psql -h localhost -U ocr_platform_user -d ocr_platform_dev

-- View users with OAuth info
SELECT id, email, username, auth_provider, google_id, email_verified
FROM users
ORDER BY created_at DESC
LIMIT 5;
```

## Step 5: Frontend Integration

### Add "Sign in with Google" Button

You'll need to add a button to your login/signup pages:

```html
<!-- Login Page -->
<a href="http://localhost:8080/api/auth/google">
  <button>
    <img src="google-icon.svg" alt="Google" />
    Sign in with Google
  </button>
</a>
```

### Handle Redirects

After successful Google auth, users are redirected to:
- **Success**: `/dashboard?login=success`
- **Needs Linking**: `/link-account?email=user@example.com&provider=google`
- **Error**: `/login?error=<error-message>`

You'll need to create a `/link-account` page that:
1. Shows the email that needs linking
2. Asks for the user's password
3. POSTs to `/api/auth/google/link` with the password

Example frontend code:

```javascript
// On /link-account page
async function linkAccount(password) {
  const response = await fetch('http://localhost:8080/api/auth/google/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // Important for cookies
    body: JSON.stringify({ password })
  });

  const data = await response.json();

  if (data.success) {
    // Redirect to dashboard
    window.location.href = '/dashboard';
  } else {
    // Show error
    alert(data.error);
  }
}
```

## Step 6: Production Setup

When you're ready to deploy:

### 6.1 Update Google Cloud Console

1. Go back to **APIs & Services > Credentials**
2. Edit your OAuth client ID
3. Add production URLs:

**Authorized JavaScript origins:**
```
https://yourdomain.com
```

**Authorized redirect URIs:**
```
https://yourdomain.com/api/auth/google/callback
```

### 6.2 Update Environment Variables

In production `.env`:
```bash
NODE_ENV=production
GOOGLE_CALLBACK_URL=https://yourdomain.com/api/auth/google/callback
FRONTEND_URL=https://yourdomain.com
SESSION_SECRET=<generate-new-secret-for-production>
```

### 6.3 Enable HTTPS

Google OAuth **requires HTTPS** in production. Make sure:
- Your server has SSL certificates
- `cookie.secure` is set to `true` (already done in code)
- All redirects use `https://`

### 6.4 Verify OAuth Consent Screen

Before public launch:
1. Go to OAuth consent screen
2. Click "Publish App"
3. Submit for verification if you need more than 100 users

## Troubleshooting

### Error: "redirect_uri_mismatch"

**Cause**: The callback URL doesn't match what's in Google Cloud Console.

**Fix**:
1. Check your `.env` file: `GOOGLE_CALLBACK_URL`
2. Go to Google Cloud Console > Credentials
3. Make sure the redirect URI exactly matches (including http/https)

### Error: "Access blocked: This app's request is invalid"

**Cause**: OAuth consent screen not configured or app not verified.

**Fix**:
1. Complete the OAuth consent screen setup
2. Add yourself as a test user
3. For development, keep it in "Testing" mode

### Error: "Google email not verified"

**Cause**: User's Google account email isn't verified.

**Fix**: User needs to verify their email with Google first.

### Users Can't Sign In

**Check**:
1. Database migration ran successfully: `\d users` in psql
2. Backend logs show no errors
3. Google credentials are correct in `.env`
4. Session middleware is working (check cookies in browser DevTools)

### Account Linking Not Working

**Check**:
1. `pendingGoogleLink` is stored in session (check backend logs)
2. Password is correct when linking
3. Frontend is sending cookies (`credentials: 'include'`)

## Security Checklist

- ✅ Using HTTPS in production
- ✅ `SESSION_SECRET` is long and random
- ✅ Google Client Secret is kept secret (not in frontend code)
- ✅ Only requesting necessary scopes (`profile`, `email`)
- ✅ Email verification required for Google users
- ✅ Password verification required for account linking
- ✅ All OAuth events are audit logged
- ✅ Session cookies are `httpOnly` and `secure`

## Testing Scenarios

Before launching, test these flows:

1. ✅ New user signs up with Google → Creates account, logs in
2. ✅ Existing Google user signs in → Logs in successfully
3. ✅ User with password tries Google (same email) → Shows linking page
4. ✅ User links Google to password account → Successfully linked
5. ✅ Wrong password during linking → Shows error
6. ✅ User cancels Google consent → Redirects to login with error
7. ✅ User creates account with email, later adds Google → Can log in both ways

## Need Help?

If you run into issues:
1. Check backend logs for errors
2. Check browser console for frontend errors
3. Verify database schema with `\d users`
4. Test OAuth flow step-by-step
5. Check Google Cloud Console for API errors

## Summary

You now have:
- ✅ Database schema updated for OAuth
- ✅ Google OAuth strategy configured
- ✅ Routes for Google login, callback, and linking
- ✅ Email conflict detection
- ✅ Account linking with password verification
- ✅ HIPAA-compliant audit logging
- ✅ Environment variables configured

**Next steps:**
1. Get Google OAuth credentials
2. Add them to your `.env` file
3. Test the flow in your browser
4. Build the frontend UI for "Sign in with Google"
5. Create the account linking page

**Answer to your original question:**
> "do i have to configure oauth tokens or anything on my server side?"

**Yes, but it's simple:**
- You need to get `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from Google Cloud Console
- Add them to your `.env` file
- Passport.js handles all the token exchange automatically
- You don't store or manage access/refresh tokens yourself for this MVP

The OAuth "tokens" are handled by passport behind the scenes. You just need the client credentials from Google!
