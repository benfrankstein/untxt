/**
 * Account Linking Page
 * Handles linking Google account to existing password account
 */

const API_BASE_URL = 'http://localhost:8080/api';

// Get email from URL params
const urlParams = new URLSearchParams(window.location.search);
const email = urlParams.get('email');
const provider = urlParams.get('provider');

// Display email
if (email) {
  document.getElementById('emailDisplay').textContent = email;
} else {
  // No email provided, redirect to login
  window.location.href = '/auth.html';
}

// Password toggle function
function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  const svg = input.parentElement.querySelector('.password-toggle svg');

  if (input.type === 'password') {
    input.type = 'text';
    svg.style.opacity = '0.6';
  } else {
    input.type = 'password';
    svg.style.opacity = '1';
  }
}

// Show alert message
function showAlert(message, type = 'error') {
  const alert = document.getElementById('alert');
  alert.textContent = message;
  alert.className = `alert ${type} visible`;

  if (type === 'success') {
    setTimeout(() => {
      alert.classList.remove('visible');
    }, 3000);
  }
}

// Hide alert
function hideAlert() {
  const alert = document.getElementById('alert');
  alert.classList.remove('visible');
}

// Show field error
function showFieldError(fieldId, message) {
  const errorElement = document.getElementById(`${fieldId}Error`);
  const inputElement = document.getElementById(fieldId);

  if (errorElement && inputElement) {
    errorElement.textContent = message;
    errorElement.classList.add('visible');
    inputElement.classList.add('error');
  }
}

// Clear field error
function clearFieldError(fieldId) {
  const errorElement = document.getElementById(`${fieldId}Error`);
  const inputElement = document.getElementById(fieldId);

  if (errorElement && inputElement) {
    errorElement.classList.remove('visible');
    inputElement.classList.remove('error');
  }
}

// Handle link account form submission
document.getElementById('linkAccountForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  clearFieldError('linkPassword');

  const password = document.getElementById('linkPassword').value;
  const button = document.getElementById('linkButton');

  // Validation
  if (!password) {
    showFieldError('linkPassword', 'Password is required');
    return;
  }

  // Disable button during request
  button.disabled = true;
  button.textContent = 'Linking...';

  try {
    const response = await fetch(`${API_BASE_URL}/auth/google/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include', // Important for cookies
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Account linked successfully! Redirecting...', 'success');

      // Redirect to dashboard after short delay
      setTimeout(() => {
        window.location.href = '/index.html?linked=success';
      }, 1500);
    } else {
      // Show error
      if (data.error.includes('password') || data.error.includes('Invalid credentials')) {
        showFieldError('linkPassword', 'Incorrect password');
      } else {
        showAlert(data.error || 'Failed to link account', 'error');
      }
    }
  } catch (error) {
    console.error('Link account error:', error);
    showAlert('Network error. Please try again.', 'error');
  } finally {
    // Re-enable button
    button.disabled = false;
    button.textContent = 'Link Google Account';
  }
});

// Clear error on input
document.getElementById('linkPassword').addEventListener('input', () => {
  clearFieldError('linkPassword');
  hideAlert();
});
