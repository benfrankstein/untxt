# OAuth2 Email Configuration Guide

This guide will help you set up OAuth2 authentication for sending emails via Gmail. This is the recommended approach for production as it's more secure than using App Passwords.

## Overview

The email service supports two authentication methods:
1. **App Password** (default) - Simpler, good for development
2. **OAuth2 Refresh Token** (recommended for production) - More secure, better for HIPAA compliance

## Why OAuth2?

- ✅ More secure - tokens can be revoked without changing your Gmail password
- ✅ Scoped permissions - only grants access to send emails
- ✅ Automatic token refresh - access tokens auto-renew using refresh token
- ✅ Google's recommended approach
- ✅ Better audit trail and compliance

## Prerequisites

- A Gmail account (or Google Workspace account)
- Access to Google Cloud Console
- Node.js installed on your machine

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown (top-left)
3. Click "New Project"
4. Name it "untxt Email Service" (or your preferred name)
5. Click "Create"
6. Wait for the project to be created and select it

## Step 2: Enable Gmail API

1. In your Google Cloud project, go to **"APIs & Services"** > **"Library"**
2. Search for **"Gmail API"**
3. Click on it and click **"Enable"**
4. Wait for it to enable (takes a few seconds)

## Step 3: Configure OAuth Consent Screen

1. Go to **"APIs & Services"** > **"OAuth consent screen"**
2. Select **"External"** user type (unless you have Google Workspace)
3. Click **"Create"**
4. Fill in the required information:
   - **App name**: untxt Email Service
   - **User support email**: Your email
   - **Developer contact email**: Your email
5. Click **"Save and Continue"**
6. On **"Scopes"** page:
   - Click **"Add or Remove Scopes"**
   - Search for `https://mail.google.com/`
   - Check the box for this scope
   - Click **"Update"**
   - Click **"Save and Continue"**
7. On **"Test users"** page:
   - Click **"Add Users"**
   - Add the Gmail address you want to send emails from
   - Click **"Save and Continue"**
8. Review and click **"Back to Dashboard"**

## Step 4: Create OAuth2 Credentials

1. Go to **"APIs & Services"** > **"Credentials"**
2. Click **"Create Credentials"** > **"OAuth client ID"**
3. Choose **"Desktop app"** as application type
4. Name it "untxt SMTP Client"
5. Click **"Create"**
6. A dialog will appear with your credentials:
   - **Client ID**: Copy this (looks like: `xxxxx.apps.googleusercontent.com`)
   - **Client Secret**: Copy this
7. Click **"OK"**

## Step 5: Configure Environment Variables

Add the following to your `.env` file:

```bash
# Enable OAuth2
SMTP_USE_OAUTH2=true

# OAuth2 Credentials (from Step 4)
SMTP_OAUTH2_CLIENT_ID=your-client-id.apps.googleusercontent.com
SMTP_OAUTH2_CLIENT_SECRET=your-client-secret

# Gmail account to send from
SMTP_USER=your-email@gmail.com

# Other SMTP settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM_ADDRESS=your-email@gmail.com
SMTP_FROM_NAME=untxt Support
SMTP_REPLY_TO=noreply@untxt.ai
```

## Step 6: Generate Refresh Token

Run the token generation script:

```bash
cd backend
node src/scripts/generate-oauth-token.js
```

The script will:
1. Display an authorization URL
2. Ask you to visit the URL and authorize the app
3. Ask you to paste the authorization code
4. Generate and display your refresh token

### What to do:

1. **Copy the URL** displayed by the script
2. **Open it in your browser**
3. **Sign in** with the Gmail account you want to send emails from
4. **Review the permissions** (it will ask for permission to send emails)
5. Click **"Allow"**
6. **Copy the authorization code** shown on the page
7. **Paste it** back into the terminal
8. The script will display your **refresh token**

## Step 7: Add Refresh Token to .env

Copy the refresh token from the script output and add it to your `.env` file:

```bash
SMTP_OAUTH2_REFRESH_TOKEN=your-very-long-refresh-token-here
```

## Step 8: Verify Configuration

Your complete OAuth2 email configuration in `.env` should look like this:

```bash
# Enable OAuth2 authentication
SMTP_USE_OAUTH2=true

# OAuth2 Credentials
SMTP_OAUTH2_CLIENT_ID=123456789.apps.googleusercontent.com
SMTP_OAUTH2_CLIENT_SECRET=GOCSPX-abc123def456
SMTP_OAUTH2_REFRESH_TOKEN=1//0gABC...very-long-token

# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_FROM_ADDRESS=your-email@gmail.com
SMTP_FROM_NAME=untxt Support
SMTP_REPLY_TO=noreply@untxt.ai
FRONTEND_URL=http://localhost:3000
```

## Step 9: Test Your Configuration

Restart your server and test the password reset flow:

```bash
# Restart the backend
npm start

# Test the email service
# Try requesting a password reset from your frontend
```

Check your server logs - you should see:
```
Email service initialized successfully using OAuth2
```

## Troubleshooting

### "No refresh token received"

This happens if you've already authorized the app before. Solutions:

1. **Revoke access**: Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
2. Find "untxt Email Service" and remove it
3. Run the generate token script again

### "Invalid credentials"

- Double-check your Client ID and Client Secret
- Make sure there are no extra spaces or quotes
- Verify the credentials match the ones in Google Cloud Console

### "Access denied"

- Make sure you added your email as a test user in OAuth consent screen
- Verify Gmail API is enabled in your project

### "SMTP connection failed"

- Check that `SMTP_USE_OAUTH2=true` in your .env
- Verify all OAuth2 environment variables are set
- Check server logs for specific error messages

### "Token expired"

This shouldn't happen with refresh tokens - they automatically renew access tokens. If you see this:
- Verify your refresh token is correct
- Make sure you're using `access_type: 'offline'` (already set in the script)
- Regenerate your refresh token

## Security Best Practices

1. **Never commit** your `.env` file to version control
2. **Rotate tokens** periodically (every 6-12 months)
3. **Revoke access** immediately if tokens are compromised
4. **Use different projects** for development and production
5. **Monitor usage** in Google Cloud Console
6. **Set up alerts** for unusual API usage

## Switching Between Auth Methods

### To use OAuth2 (recommended):
```bash
SMTP_USE_OAUTH2=true
# ... OAuth2 credentials
```

### To use App Password (fallback):
```bash
SMTP_USE_OAUTH2=false
# or just comment out/remove the line
SMTP_PASS=your-app-password
```

## Production Considerations

### For Production Deployment:

1. **Create a separate Google Cloud Project** for production
2. **Verify your OAuth consent screen** (submit for verification if needed)
3. **Use environment-specific credentials**:
   - Development: Test project with limited scope
   - Staging: Staging project for pre-production testing
   - Production: Production project with monitoring

4. **Set up monitoring**:
   - Monitor Gmail API quotas in Google Cloud Console
   - Set up alerts for quota limits
   - Track email send rates and failures

5. **Handle rate limits**:
   - Gmail has sending limits (500 emails/day for free accounts)
   - Consider using SendGrid or AWS SES for higher volumes
   - Implement retry logic for transient failures

## Google Workspace vs Personal Gmail

### Personal Gmail Account:
- Sending limit: 500 emails/day
- Suitable for: Development, small projects
- OAuth consent screen: External (needs test users)

### Google Workspace Account:
- Sending limit: 2000 emails/day
- Suitable for: Production use
- OAuth consent screen: Internal (auto-approved for workspace users)
- Better support and SLA

## Alternative Email Services

If Gmail's limits are too restrictive, consider:

1. **SendGrid** - High volume transactional emails
2. **AWS SES** - Scalable, cost-effective
3. **Mailgun** - Developer-friendly API
4. **Postmark** - Excellent deliverability

The email service code would need minor modifications to support these.

## Need Help?

If you encounter issues:
1. Check the server logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test with the `generate-oauth-token.js` script
4. Review Google Cloud Console for API errors and quotas

## Useful Links

- [Google Cloud Console](https://console.cloud.google.com/)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [OAuth2 Playground](https://developers.google.com/oauthplayground/)
- [Manage App Permissions](https://myaccount.google.com/permissions)
- [Nodemailer OAuth2 Guide](https://nodemailer.com/smtp/oauth2/)
