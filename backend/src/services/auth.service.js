/**
 * Authentication Service
 * Handles user registration, login, and password management
 */

const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const dbService = require('./db.service');

const BCRYPT_ROUNDS = 12; // Cost factor for bcrypt (higher = more secure but slower)

/**
 * Password validation requirements
 */
const PASSWORD_REQUIREMENTS = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?'
};

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} - {valid: boolean, errors: string[]}
 */
function validatePassword(password) {
  const errors = [];

  if (!password) {
    return { valid: false, errors: ['Password is required'] };
  }

  // Check minimum length
  if (password.length < PASSWORD_REQUIREMENTS.minLength) {
    errors.push(`Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters long`);
  }

  // Check maximum length (prevent DoS)
  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }

  // Check for uppercase
  if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Check for lowercase
  if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Check for numbers
  if (PASSWORD_REQUIREMENTS.requireNumbers && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  // Check for special characters
  if (PASSWORD_REQUIREMENTS.requireSpecialChars) {
    const specialCharsRegex = new RegExp(`[${PASSWORD_REQUIREMENTS.specialChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`);
    if (!specialCharsRegex.test(password)) {
      errors.push('Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)');
    }
  }

  // Check for spaces
  if (/\s/.test(password)) {
    errors.push('Password cannot contain spaces');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean}
 */
function validateEmail(email) {
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  return emailRegex.test(email);
}

/**
 * Validate username
 * @param {string} username - Username to validate
 * @returns {Object} - {valid: boolean, errors: string[]}
 */
function validateUsername(username) {
  const errors = [];

  if (!username) {
    return { valid: false, errors: ['Username is required'] };
  }

  if (username.length < 3) {
    errors.push('Username must be at least 3 characters long');
  }

  if (username.length > 100) {
    errors.push('Username must be less than 100 characters');
  }

  // Only allow alphanumeric, underscores, and hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    errors.push('Username can only contain letters, numbers, underscores, and hyphens');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Hash password using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Hashed password
 */
async function hashPassword(password) {
  try {
    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const hash = await bcrypt.hash(password, salt);
    return hash;
  } catch (error) {
    console.error('Error hashing password:', error);
    throw new Error('Failed to hash password');
  }
}

/**
 * Compare password with hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {Promise<boolean>} - True if match
 */
async function comparePassword(password, hash) {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    console.error('Error comparing password:', error);
    return false;
  }
}

/**
 * Register new user
 * @param {Object} userData - {email, username, password}
 * @returns {Promise<Object>} - User object (without password)
 */
async function registerUser({ email, username, password }) {
  // Validate email
  if (!email || !validateEmail(email)) {
    throw new Error('Invalid email address');
  }

  // Validate username
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    throw new Error(usernameValidation.errors[0]);
  }

  // Validate password
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    throw new Error(passwordValidation.errors[0]);
  }

  // Check if email already exists
  const existingEmail = await dbService.getUserByEmail(email);
  if (existingEmail) {
    throw new Error('Email already registered');
  }

  // Check if username already exists
  const existingUsername = await dbService.getUserByUsername(username);
  if (existingUsername) {
    throw new Error('Username already taken');
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create user
  const userId = uuidv4();
  const user = await dbService.createUser({
    id: userId,
    email: email.toLowerCase().trim(),
    username: username.trim(),
    password_hash: passwordHash,
    role: 'user'
  });

  // Remove password hash from response
  const { password_hash, ...userWithoutPassword } = user;

  console.log(`✓ User registered: ${email} (${userId})`);

  return userWithoutPassword;
}

/**
 * Authenticate user (login)
 * @param {string} emailOrUsername - Email or username
 * @param {string} password - Plain text password
 * @returns {Promise<Object>} - User object (without password)
 */
async function authenticateUser(emailOrUsername, password) {
  if (!emailOrUsername || !password) {
    throw new Error('Email/username and password are required');
  }

  // Try to find user by email or username
  let user;
  if (validateEmail(emailOrUsername)) {
    user = await dbService.getUserByEmail(emailOrUsername.toLowerCase().trim());
  } else {
    user = await dbService.getUserByUsername(emailOrUsername.trim());
  }

  if (!user) {
    throw new Error('Invalid credentials');
  }

  // Check if account is active
  if (!user.is_active) {
    throw new Error('Account is disabled');
  }

  // Compare password
  const isMatch = await comparePassword(password, user.password_hash);
  if (!isMatch) {
    throw new Error('Invalid credentials');
  }

  // Update last login timestamp
  await dbService.updateUserLastLogin(user.id);

  // Remove password hash from response
  const { password_hash, ...userWithoutPassword } = user;

  console.log(`✓ User authenticated: ${user.email} (${user.id})`);

  return userWithoutPassword;
}

/**
 * Get password requirements (for frontend display)
 * @returns {Object}
 */
function getPasswordRequirements() {
  return {
    minLength: PASSWORD_REQUIREMENTS.minLength,
    requireUppercase: PASSWORD_REQUIREMENTS.requireUppercase,
    requireLowercase: PASSWORD_REQUIREMENTS.requireLowercase,
    requireNumbers: PASSWORD_REQUIREMENTS.requireNumbers,
    requireSpecialChars: PASSWORD_REQUIREMENTS.requireSpecialChars
  };
}

module.exports = {
  validatePassword,
  validateEmail,
  validateUsername,
  hashPassword,
  comparePassword,
  registerUser,
  authenticateUser,
  getPasswordRequirements
};
