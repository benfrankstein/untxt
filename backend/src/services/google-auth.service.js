/**
 * Google OAuth Authentication Service
 * Handles Google Sign-In/Sign-Up and account linking
 */

const { v4: uuidv4 } = require('uuid');
const dbService = require('./db.service');
const authService = require('./auth.service');

/**
 * Process Google OAuth login/signup
 * Handles: new user signup, existing user login, account conflict detection
 *
 * @param {Object} googleProfile - Google profile data from OAuth
 * @returns {Promise<Object>} - { user, isNewUser, needsLinking }
 */
async function processGoogleAuth(googleProfile) {
  const { id: googleId, email, given_name: firstName, family_name: lastName, verified_email } = googleProfile;

  // Security: Only allow verified Google emails
  if (!verified_email) {
    throw new Error('Google email not verified. Please verify your email with Google first.');
  }

  // Normalize email
  const normalizedEmail = email.toLowerCase().trim();

  // Check if user already exists with this google_id
  const existingGoogleUser = await dbService.getUserByGoogleId(googleId);
  if (existingGoogleUser) {
    // User has logged in with Google before - simple login
    await dbService.updateUserLastLogin(existingGoogleUser.id);
    const { password_hash, ...userWithoutPassword } = existingGoogleUser;

    console.log(`✓ Google login: ${email} (${existingGoogleUser.id})`);

    return {
      user: userWithoutPassword,
      isNewUser: false,
      needsLinking: false
    };
  }

  // Check if email exists with local auth
  const existingEmailUser = await dbService.getUserByEmail(normalizedEmail);
  if (existingEmailUser) {
    // Email exists but not linked to Google - need account linking
    console.log(`⚠ Google email conflict detected: ${email} (existing local account)`);

    return {
      user: null,
      isNewUser: false,
      needsLinking: true,
      existingUserId: existingEmailUser.id,
      email: normalizedEmail
    };
  }

  // New user - create account with Google auth
  const userId = uuidv4();

  // Generate unique username from email (fallback if name not provided)
  let username = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '');

  // Ensure username is unique
  let usernameAttempt = username;
  let attempt = 1;
  while (await dbService.getUserByUsername(usernameAttempt)) {
    usernameAttempt = `${username}${attempt}`;
    attempt++;
  }
  username = usernameAttempt;

  const newUser = await dbService.createGoogleUser({
    id: userId,
    email: normalizedEmail,
    username,
    google_id: googleId,
    first_name: firstName || 'User',
    last_name: lastName || '',
    auth_provider: 'google',
    email_verified: true, // Google already verified
    role: 'user'
  });

  const { password_hash, ...userWithoutPassword } = newUser;

  console.log(`✓ New Google user created: ${email} (${userId})`);

  return {
    user: userWithoutPassword,
    isNewUser: true,
    needsLinking: false
  };
}

/**
 * Link Google account to existing local account
 * Requires password verification for security
 *
 * @param {string} userId - User ID to link Google account to
 * @param {string} password - User's current password for verification
 * @param {string} googleId - Google account ID
 * @param {string} email - Email to verify it matches
 * @returns {Promise<Object>} - Updated user object
 */
async function linkGoogleAccount(userId, password, googleId, email) {
  // Get existing user
  const user = await dbService.getUserById(userId);

  if (!user) {
    throw new Error('User not found');
  }

  // Verify email matches
  if (user.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error('Email does not match account');
  }

  // Verify this is a local auth account
  if (user.auth_provider !== 'local') {
    throw new Error('Can only link Google to password-based accounts');
  }

  // Verify password
  const isPasswordValid = await authService.comparePassword(password, user.password_hash);
  if (!isPasswordValid) {
    throw new Error('Invalid password');
  }

  // Check if google_id is already used by another account
  const existingGoogleUser = await dbService.getUserByGoogleId(googleId);
  if (existingGoogleUser && existingGoogleUser.id !== userId) {
    throw new Error('This Google account is already linked to another account');
  }

  // Link the account
  const updatedUser = await dbService.linkGoogleToUser(userId, googleId);

  const { password_hash, ...userWithoutPassword } = updatedUser;

  console.log(`✓ Google account linked: ${email} (${userId})`);

  return userWithoutPassword;
}

/**
 * Check if email exists and what auth provider it uses
 * Used for frontend to show appropriate error messages
 *
 * @param {string} email - Email to check
 * @returns {Promise<Object>} - { exists, authProvider }
 */
async function checkEmailExists(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await dbService.getUserByEmail(normalizedEmail);

  if (!user) {
    return { exists: false, authProvider: null };
  }

  return {
    exists: true,
    authProvider: user.auth_provider,
    hasGoogleLinked: !!user.google_id
  };
}

module.exports = {
  processGoogleAuth,
  linkGoogleAccount,
  checkEmailExists
};
