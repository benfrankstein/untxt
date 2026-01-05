/**
 * Script to generate OAuth2 refresh token for Gmail SMTP
 *
 * This script helps you obtain an OAuth2 refresh token for sending emails via Gmail.
 *
 * PREREQUISITES:
 * 1. Go to Google Cloud Console: https://console.cloud.google.com/
 * 2. Create a new project or select existing one
 * 3. Enable Gmail API:
 *    - Go to "APIs & Services" > "Library"
 *    - Search for "Gmail API" and enable it
 * 4. Create OAuth2 credentials:
 *    - Go to "APIs & Services" > "Credentials"
 *    - Click "Create Credentials" > "OAuth client ID"
 *    - Choose "Desktop app" as application type
 *    - Download the credentials JSON file
 * 5. Copy the Client ID and Client Secret to your .env file
 *
 * USAGE:
 * node src/scripts/generate-oauth-token.js
 */

const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

// OAuth2 scopes for Gmail sending
const SCOPES = ['https://mail.google.com/'];

// Get credentials from environment
const CLIENT_ID = process.env.SMTP_OAUTH2_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.SMTP_OAUTH2_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // For desktop apps

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function validateConfig() {
  if (!CLIENT_ID || CLIENT_ID.includes('your-')) {
    log('\n❌ Error: SMTP_OAUTH2_CLIENT_ID or GOOGLE_CLIENT_ID not configured in .env', colors.red);
    log('\nPlease follow these steps:', colors.yellow);
    log('1. Go to https://console.cloud.google.com/', colors.reset);
    log('2. Create OAuth2 credentials (Desktop app)', colors.reset);
    log('3. Add CLIENT_ID to your .env file', colors.reset);
    return false;
  }

  if (!CLIENT_SECRET || CLIENT_SECRET.includes('your-')) {
    log('\n❌ Error: SMTP_OAUTH2_CLIENT_SECRET or GOOGLE_CLIENT_SECRET not configured in .env', colors.red);
    log('\nPlease add your OAuth2 client secret to your .env file', colors.yellow);
    return false;
  }

  return true;
}

async function generateRefreshToken() {
  log('\n╔════════════════════════════════════════════════════════════╗', colors.bright);
  log('║     Gmail OAuth2 Refresh Token Generator for untxt        ║', colors.bright);
  log('╚════════════════════════════════════════════════════════════╝\n', colors.bright);

  if (!validateConfig()) {
    process.exit(1);
  }

  // Create OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );

  // Generate authorization URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // Force consent screen to get refresh token
  });

  log('Step 1: Authorize this app', colors.blue);
  log('─────────────────────────────────────────────────────────────', colors.blue);
  log('\nPlease visit this URL to authorize the application:\n', colors.yellow);
  log(authUrl, colors.green);
  log('\n');

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Prompt for authorization code
  rl.question('Enter the authorization code from the page: ', async (code) => {
    try {
      log('\nStep 2: Exchanging authorization code for tokens...', colors.blue);
      log('─────────────────────────────────────────────────────────────', colors.blue);

      // Exchange authorization code for tokens
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.refresh_token) {
        log('\n❌ Error: No refresh token received', colors.red);
        log('\nThis usually happens when you\'ve already authorized this app before.', colors.yellow);
        log('Try these solutions:', colors.yellow);
        log('1. Revoke access at: https://myaccount.google.com/permissions', colors.reset);
        log('2. Re-run this script and authorize again', colors.reset);
        log('3. Or delete and recreate your OAuth2 credentials in Google Cloud Console\n', colors.reset);
        rl.close();
        process.exit(1);
      }

      log('\n✅ Success! Here are your tokens:\n', colors.green);
      log('─────────────────────────────────────────────────────────────', colors.bright);
      log('Access Token (expires in 1 hour):', colors.yellow);
      log(tokens.access_token, colors.reset);
      log('\nRefresh Token (use this in your .env file):', colors.yellow);
      log(tokens.refresh_token, colors.green);
      log('─────────────────────────────────────────────────────────────\n', colors.bright);

      log('Step 3: Update your .env file', colors.blue);
      log('─────────────────────────────────────────────────────────────', colors.blue);
      log('\nAdd these lines to your .env file:\n', colors.reset);
      log('SMTP_USE_OAUTH2=true', colors.green);
      log(`SMTP_OAUTH2_REFRESH_TOKEN=${tokens.refresh_token}`, colors.green);
      log('\nMake sure you also have:', colors.reset);
      log(`SMTP_OAUTH2_CLIENT_ID=${CLIENT_ID}`, colors.reset);
      log(`SMTP_OAUTH2_CLIENT_SECRET=${CLIENT_SECRET}`, colors.reset);
      log(`SMTP_USER=${process.env.SMTP_USER || 'your-email@gmail.com'}`, colors.reset);

      log('\n✅ Configuration complete! Your email service will now use OAuth2.\n', colors.green);

      rl.close();
    } catch (error) {
      log('\n❌ Error getting tokens:', colors.red);
      log(error.message, colors.red);
      rl.close();
      process.exit(1);
    }
  });
}

// Run the script
generateRefreshToken().catch(error => {
  log('\n❌ Unexpected error:', colors.red);
  console.error(error);
  process.exit(1);
});
