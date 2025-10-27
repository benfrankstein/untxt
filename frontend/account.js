// Configuration
const API_URL = 'http://localhost:8080';

// DOM elements
const loading = document.getElementById('loading');
const errorContainer = document.getElementById('errorContainer');
const errorMessage = document.getElementById('errorMessage');
const accountContent = document.getElementById('accountContent');
const retryBtn = document.getElementById('retryBtn');
const backToDashboard = document.getElementById('backToDashboard');
const logoutBtn = document.getElementById('logoutBtn');

// Profile elements
const userInitials = document.getElementById('userInitials');
const fullName = document.getElementById('fullName');
const userRole = document.getElementById('userRole');
const firstName = document.getElementById('firstName');
const lastName = document.getElementById('lastName');
const username = document.getElementById('username');
const email = document.getElementById('email');
const phoneNumber = document.getElementById('phoneNumber');
const createdAt = document.getElementById('createdAt');
const lastLogin = document.getElementById('lastLogin');
const userId = document.getElementById('userId');

/**
 * Show loading state
 */
function showLoading() {
  loading.classList.remove('hidden');
  errorContainer.classList.add('hidden');
  accountContent.classList.add('hidden');
}

/**
 * Show error state
 */
function showError(message) {
  loading.classList.add('hidden');
  errorContainer.classList.remove('hidden');
  accountContent.classList.add('hidden');
  errorMessage.textContent = message;
}

/**
 * Show account content
 */
function showContent() {
  loading.classList.add('hidden');
  errorContainer.classList.add('hidden');
  accountContent.classList.remove('hidden');
}

/**
 * Format date string
 */
function formatDate(dateString) {
  if (!dateString) return 'Never';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Get initials from name
 */
function getInitials(first, last) {
  const firstInitial = first ? first.charAt(0).toUpperCase() : '';
  const lastInitial = last ? last.charAt(0).toUpperCase() : '';
  return firstInitial + lastInitial || 'U';
}

/**
 * Load user profile
 */
async function loadProfile() {
  showLoading();

  try {
    const response = await fetch(`${API_URL}/api/auth/profile`, {
      credentials: 'include'
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      if (response.status === 401) {
        // Not authenticated, redirect to login
        window.location.href = 'auth.html';
        return;
      }

      throw new Error(data.error || 'Failed to load profile');
    }

    const user = data.data.user;

    // Update profile display
    firstName.textContent = user.firstName || '-';
    lastName.textContent = user.lastName || '-';
    username.textContent = user.username || '-';
    email.textContent = user.email || '-';
    phoneNumber.textContent = user.phoneNumber || 'Not provided';
    createdAt.textContent = formatDate(user.createdAt);
    lastLogin.textContent = formatDate(user.lastLogin);
    userId.textContent = user.id || '-';

    // Update header
    const fullNameText = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
    fullName.textContent = fullNameText;
    userInitials.textContent = getInitials(user.firstName, user.lastName);
    userRole.textContent = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'User';

    showContent();
  } catch (error) {
    console.error('Error loading profile:', error);
    showError(error.message || 'Failed to load profile. Please try again.');
  }
}

/**
 * Logout user
 */
async function logout() {
  try {
    logoutBtn.disabled = true;
    logoutBtn.innerHTML = '<span>Logging out...</span>';

    const response = await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    });

    const data = await response.json();

    if (data.success) {
      window.location.href = 'auth.html';
    } else {
      throw new Error(data.error || 'Logout failed');
    }
  } catch (error) {
    console.error('Logout error:', error);
    alert('Failed to logout. Please try again.');
    logoutBtn.disabled = false;
    logoutBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
      <span>Logout</span>
    `;
  }
}

// Event listeners
retryBtn.addEventListener('click', loadProfile);
backToDashboard.addEventListener('click', () => {
  window.location.href = 'index.html';
});
logoutBtn.addEventListener('click', logout);

// Load profile on page load
loadProfile();
