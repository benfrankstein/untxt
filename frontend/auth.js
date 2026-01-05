// Configuration
const API_URL = 'http://localhost:8080';

// Check for OAuth error in URL params
const urlParams = new URLSearchParams(window.location.search);
const oauthError = urlParams.get('error');

if (oauthError) {
  // Show error message
  setTimeout(() => {
    showAlert(decodeURIComponent(oauthError), 'error');
  }, 100);

  // Clean URL
  window.history.replaceState({}, document.title, window.location.pathname);
}

// Tab switching
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;

    // Update active tab
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Update active form
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById(`${tabName}Form`).classList.add('active');

    // Clear alert
    hideAlert();
  });
});

// Password visibility toggle
function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  const toggle = input.parentElement.querySelector('.password-toggle');

  if (input.type === 'password') {
    input.type = 'text';
    // Eye-off icon (with slash)
    toggle.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="3" y1="3" x2="21" y2="21"></line>
      </svg>
    `;
  } else {
    input.type = 'password';
    // Eye icon (no slash)
    toggle.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
  }
}

// Show alert message
function showAlert(message, type = 'success') {
  const alert = document.getElementById('alert');
  alert.textContent = message;
  alert.className = `alert ${type} visible`;
}

// Hide alert message
function hideAlert() {
  const alert = document.getElementById('alert');
  alert.classList.remove('visible');
}

// Show field error
function showFieldError(fieldId, message) {
  const input = document.getElementById(fieldId);
  const error = document.getElementById(`${fieldId}Error`);

  input.classList.add('error');
  error.textContent = message;
  error.classList.add('visible');
}

// Clear field error
function clearFieldError(fieldId) {
  const input = document.getElementById(fieldId);
  const error = document.getElementById(`${fieldId}Error`);

  input.classList.remove('error');
  error.classList.remove('visible');
}

// Clear all errors
function clearAllErrors(formId) {
  const form = document.getElementById(formId);
  form.querySelectorAll('.form-input').forEach(input => {
    input.classList.remove('error');
  });
  form.querySelectorAll('.form-error').forEach(error => {
    error.classList.remove('visible');
  });
}

// Password strength validation (real-time)
const passwordInput = document.getElementById('signupPassword');
passwordInput?.addEventListener('input', () => {
  const password = passwordInput.value;

  // Length check
  const lengthReq = document.getElementById('req-length');
  if (password.length >= 12) {
    lengthReq.classList.add('met');
  } else {
    lengthReq.classList.remove('met');
  }

  // Uppercase check
  const uppercaseReq = document.getElementById('req-uppercase');
  if (/[A-Z]/.test(password)) {
    uppercaseReq.classList.add('met');
  } else {
    uppercaseReq.classList.remove('met');
  }

  // Lowercase check
  const lowercaseReq = document.getElementById('req-lowercase');
  if (/[a-z]/.test(password)) {
    lowercaseReq.classList.add('met');
  } else {
    lowercaseReq.classList.remove('met');
  }

  // Number check
  const numberReq = document.getElementById('req-number');
  if (/[0-9]/.test(password)) {
    numberReq.classList.add('met');
  } else {
    numberReq.classList.remove('met');
  }

  // Special character check
  const specialReq = document.getElementById('req-special');
  if (/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    specialReq.classList.add('met');
  } else {
    specialReq.classList.remove('met');
  }
});

// Login form submission
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const emailOrUsername = document.getElementById('loginEmailOrUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const button = document.getElementById('loginButton');

  // Clear previous errors
  clearAllErrors('loginForm');
  hideAlert();

  // Validate
  if (!emailOrUsername) {
    showFieldError('loginEmailOrUsername', 'Email or username is required');
    return;
  }

  if (!password) {
    showFieldError('loginPassword', 'Password is required');
    return;
  }

  // Disable button
  button.disabled = true;
  button.textContent = 'Logging in...';

  try {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include', // Important for session cookies
      body: JSON.stringify({
        emailOrUsername,
        password
      })
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Login successful! Redirecting...', 'success');

      // Redirect to main app after 1 second
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1000);
    } else {
      showAlert(data.error || 'Login failed', 'error');
      button.disabled = false;
      button.textContent = 'Log In';
    }
  } catch (error) {
    console.error('Login error:', error);
    showAlert('Network error. Please try again.', 'error');
    button.disabled = false;
    button.textContent = 'Log In';
  }
});

// Signup form submission
document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const firstName = document.getElementById('signupFirstName').value.trim();
  const lastName = document.getElementById('signupLastName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const phoneNumber = document.getElementById('signupPhoneNumber').value.trim();
  const username = document.getElementById('signupUsername').value.trim();
  const password = document.getElementById('signupPassword').value;
  const button = document.getElementById('signupButton');

  // Clear previous errors
  clearAllErrors('signupForm');
  hideAlert();

  // Validate first name
  if (!firstName) {
    showFieldError('signupFirstName', 'First name is required');
    return;
  }

  // Validate last name
  if (!lastName) {
    showFieldError('signupLastName', 'Last name is required');
    return;
  }

  // Validate email
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFieldError('signupEmail', 'Please enter a valid email address');
    return;
  }

  // Validate username
  if (!username || username.length < 3) {
    showFieldError('signupUsername', 'Username must be at least 3 characters');
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    showFieldError('signupUsername', 'Username can only contain letters, numbers, underscores, and hyphens');
    return;
  }

  // Validate password
  const passwordErrors = [];
  if (password.length < 12) passwordErrors.push('at least 12 characters');
  if (!/[A-Z]/.test(password)) passwordErrors.push('an uppercase letter');
  if (!/[a-z]/.test(password)) passwordErrors.push('a lowercase letter');
  if (!/[0-9]/.test(password)) passwordErrors.push('a number');
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) passwordErrors.push('a special character');

  if (passwordErrors.length > 0) {
    showFieldError('signupPassword', `Password must contain ${passwordErrors.join(', ')}`);
    return;
  }

  // Disable button
  button.disabled = true;
  button.textContent = 'Creating account...';

  try {
    const response = await fetch(`${API_URL}/api/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include', // Important for session cookies
      body: JSON.stringify({
        firstName,
        lastName,
        email,
        phoneNumber: phoneNumber || null,
        username,
        password
      })
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Account created successfully! Redirecting...', 'success');

      // Redirect to main app after 1 second
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1000);
    } else {
      showAlert(data.error || 'Signup failed', 'error');

      // Show specific field errors if possible
      if (data.error.includes('first name') || data.error.includes('First name')) {
        showFieldError('signupFirstName', data.error);
      } else if (data.error.includes('last name') || data.error.includes('Last name')) {
        showFieldError('signupLastName', data.error);
      } else if (data.error.includes('email')) {
        showFieldError('signupEmail', data.error);
      } else if (data.error.includes('username')) {
        showFieldError('signupUsername', data.error);
      } else if (data.error.includes('password') || data.error.includes('Password')) {
        showFieldError('signupPassword', data.error);
      }

      button.disabled = false;
      button.textContent = 'Create Account';
    }
  } catch (error) {
    console.error('Signup error:', error);
    showAlert('Network error. Please try again.', 'error');
    button.disabled = false;
    button.textContent = 'Create Account';
  }
});

// ============================================
// FORGOT PASSWORD MODAL
// ============================================

const forgotPasswordModal = document.getElementById('forgotPasswordModal');
const forgotPasswordLink = document.getElementById('forgotPasswordLink');
const closeForgotPasswordModal = document.getElementById('closeForgotPasswordModal');
const cancelForgotPasswordButton = document.getElementById('cancelForgotPasswordButton');
const forgotPasswordForm = document.getElementById('forgotPasswordForm');
const forgotPasswordAlert = document.getElementById('forgotPasswordAlert');

// Open modal
forgotPasswordLink.addEventListener('click', (e) => {
  e.preventDefault();
  forgotPasswordModal.classList.add('visible');
  document.getElementById('forgotPasswordEmail').value = '';
  clearFieldError('forgotPasswordEmail');
  forgotPasswordAlert.classList.remove('visible');

  // Reset button state
  const button = document.getElementById('forgotPasswordButton');
  button.disabled = false;
  button.textContent = 'Send Reset Link';
});

// Close modal
function closeForgotPasswordModalHandler() {
  forgotPasswordModal.classList.remove('visible');
  forgotPasswordForm.reset();
  clearFieldError('forgotPasswordEmail');
  forgotPasswordAlert.classList.remove('visible');

  // Reset button state
  const button = document.getElementById('forgotPasswordButton');
  button.disabled = false;
  button.textContent = 'Send Reset Link';
}

closeForgotPasswordModal.addEventListener('click', closeForgotPasswordModalHandler);
cancelForgotPasswordButton.addEventListener('click', closeForgotPasswordModalHandler);

// Close modal when clicking outside
forgotPasswordModal.addEventListener('click', (e) => {
  if (e.target === forgotPasswordModal) {
    closeForgotPasswordModalHandler();
  }
});

// Show modal alert
function showForgotPasswordAlert(message, type = 'success') {
  forgotPasswordAlert.textContent = message;
  forgotPasswordAlert.className = `alert ${type} visible`;
}

// Forgot password form submission
forgotPasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('forgotPasswordEmail').value.trim();
  const button = document.getElementById('forgotPasswordButton');

  // Clear previous errors
  clearFieldError('forgotPasswordEmail');
  forgotPasswordAlert.classList.remove('visible');

  // Validate email
  if (!email) {
    showFieldError('forgotPasswordEmail', 'Email is required');
    return;
  }

  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!emailRegex.test(email)) {
    showFieldError('forgotPasswordEmail', 'Please enter a valid email address');
    return;
  }

  // Disable button and show loading state
  button.disabled = true;
  button.textContent = 'Checking...';

  try {
    // First, check if this is a Google account
    const checkResponse = await fetch(`${API_URL}/api/auth/check-email?email=${encodeURIComponent(email)}`);
    const checkData = await checkResponse.json();

    if (checkData.success && checkData.data.exists && checkData.data.authProvider === 'google') {
      // This is a Google account
      showForgotPasswordAlert(
        'This account uses Google Sign-In. To reset your password, please visit your Google Account settings at myaccount.google.com.',
        'error'
      );
      button.disabled = false;
      button.textContent = 'Send Reset Link';
      return;
    }

    // Continue with password reset for local accounts
    button.textContent = 'Sending...';

    const response = await fetch(`${API_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (response.status === 429) {
      // Rate limited
      showForgotPasswordAlert(data.error || 'Too many requests. Please try again later.', 'error');
      button.disabled = false;
      button.textContent = 'Send Reset Link';
      return;
    }

    if (response.status === 404) {
      // Email not found
      showForgotPasswordAlert(data.error || 'No account found with that email address.', 'error');
      button.disabled = false;
      button.textContent = 'Send Reset Link';
      return;
    }

    if (response.status === 500) {
      // Server error (email sending failed)
      showForgotPasswordAlert(data.error || 'Failed to send email. Please try again.', 'error');
      button.disabled = false;
      button.textContent = 'Send Reset Link';
      return;
    }

    if (data.success) {
      // Email sent successfully
      showForgotPasswordAlert(data.message, 'success');

      // Reset button state
      button.disabled = false;
      button.textContent = 'Send Reset Link';

      // Clear form
      forgotPasswordForm.reset();

      // Close modal after 3 seconds
      setTimeout(() => {
        closeForgotPasswordModalHandler();
      }, 3000);
    } else {
      showForgotPasswordAlert(data.error || 'An error occurred. Please try again.', 'error');
      button.disabled = false;
      button.textContent = 'Send Reset Link';
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    showForgotPasswordAlert('Network error. Please try again.', 'error');
    button.disabled = false;
    button.textContent = 'Send Reset Link';
  }
});

// ============================================
// CHECK AUTH
// ============================================

// Check if user is already logged in
async function checkAuth() {
  try {
    const response = await fetch(`${API_URL}/api/auth/session`, {
      credentials: 'include'
    });

    const data = await response.json();

    if (data.success && data.data.authenticated) {
      // User is already logged in, redirect to main app
      window.location.href = 'index.html';
    }
  } catch (error) {
    console.error('Auth check error:', error);
  }
}

// Check auth on page load
checkAuth();
