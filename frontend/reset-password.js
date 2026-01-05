// Configuration
const API_URL = 'http://localhost:8080';

// Get token from URL
const urlParams = new URLSearchParams(window.location.search);
const resetToken = urlParams.get('token');

// Debug: Log the token to verify it's correct
console.log('Reset token from URL:', resetToken);

// DOM Elements
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const successState = document.getElementById('successState');
const resetPasswordForm = document.getElementById('resetPasswordForm');
const emailDisplay = document.getElementById('emailDisplay');
const alert = document.getElementById('alert');

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
  alert.textContent = message;
  alert.className = `alert ${type} visible`;
}

// Hide alert message
function hideAlert() {
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

// Password strength validation (real-time)
const passwordInput = document.getElementById('newPassword');
if (passwordInput) {
  passwordInput.addEventListener('input', () => {
    const password = passwordInput.value;

    // Check each requirement
    const requirements = {
      'req-length': password.length >= 12,
      'req-uppercase': /[A-Z]/.test(password),
      'req-lowercase': /[a-z]/.test(password),
      'req-number': /[0-9]/.test(password),
      'req-special': /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)
    };

    // Update requirement indicators
    Object.entries(requirements).forEach(([id, met]) => {
      const element = document.getElementById(id);
      if (element) {
        if (met) {
          element.classList.add('met');
        } else {
          element.classList.remove('met');
        }
      }
    });
  });
}

// Validate password strength
function validatePassword(password) {
  const errors = [];

  if (!password) {
    return { isValid: false, errors: ['Password is required'] };
  }

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long');
  }

  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  if (/\s/.test(password)) {
    errors.push('Password cannot contain spaces');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Show error state
function showErrorState(message) {
  loadingState.style.display = 'none';
  resetPasswordForm.style.display = 'none';
  successState.style.display = 'none';
  errorMessage.textContent = message;
  errorState.style.display = 'block';
}

// Show form
function showForm(email) {
  loadingState.style.display = 'none';
  errorState.style.display = 'none';
  successState.style.display = 'none';
  emailDisplay.textContent = email;
  resetPasswordForm.style.display = 'block';
}

// Show success state
function showSuccessState() {
  loadingState.style.display = 'none';
  errorState.style.display = 'none';
  resetPasswordForm.style.display = 'none';
  successState.style.display = 'block';

  // Redirect to login after 5 seconds
  setTimeout(() => {
    window.location.href = 'auth.html';
  }, 5000);
}

// Validate token on page load
async function validateToken() {
  // Check if token exists
  if (!resetToken) {
    showErrorState('No reset token provided. Please use the link from your email.');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/auth/reset-password/${resetToken}`, {
      method: 'GET'
    });

    const data = await response.json();

    if (data.success) {
      // Token is valid, show the form
      showForm(data.data.email);
    } else {
      // Token is invalid or expired
      showErrorState(data.error || 'This password reset link is invalid or has expired.');
    }
  } catch (error) {
    console.error('Token validation error:', error);
    showErrorState('Network error. Please try again later.');
  }
}

// Reset password form submission
resetPasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const button = document.getElementById('resetButton');

  // Clear previous errors
  clearFieldError('newPassword');
  clearFieldError('confirmPassword');
  hideAlert();

  // Validate new password
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.isValid) {
    showFieldError('newPassword', passwordValidation.errors[0]);
    return;
  }

  // Validate confirm password
  if (!confirmPassword) {
    showFieldError('confirmPassword', 'Please confirm your password');
    return;
  }

  if (newPassword !== confirmPassword) {
    showFieldError('confirmPassword', 'Passwords do not match');
    return;
  }

  // Disable button and show loading state
  button.disabled = true;
  button.textContent = 'Resetting...';

  try {
    const response = await fetch(`${API_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: resetToken,
        newPassword: newPassword
      })
    });

    const data = await response.json();

    if (data.success) {
      // Password reset successful
      showSuccessState();
    } else {
      // Password reset failed
      if (response.status === 400) {
        // Token expired or invalid
        showErrorState(data.error || 'This password reset link has expired or been used.');
      } else {
        showAlert(data.error || 'Failed to reset password. Please try again.', 'error');
        button.disabled = false;
        button.textContent = 'Reset Password';
      }
    }
  } catch (error) {
    console.error('Reset password error:', error);
    showAlert('Network error. Please try again.', 'error');
    button.disabled = false;
    button.textContent = 'Reset Password';
  }
});

// Validate token on page load
validateToken();
