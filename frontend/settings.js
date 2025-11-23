/**
 * Settings Page
 * Handles settings navigation and data loading
 */

const API_BASE = 'http://localhost:8080/api';

// Initialize settings page
document.addEventListener('DOMContentLoaded', () => {
  initializeSettings();
});

function initializeSettings() {
  // Initialize sidebar navigation
  SidebarNav.init('settings');

  // Get nav items and sections
  const navItems = document.querySelectorAll('.settings-nav-item');
  const sections = document.querySelectorAll('.settings-section');

  // Tab switching function
  const switchToSection = (sectionId) => {
    // Update active nav item
    navItems.forEach(nav => {
      if (nav.dataset.section === sectionId) {
        nav.classList.add('active');
      } else {
        nav.classList.remove('active');
      }
    });

    // Update active section
    sections.forEach(section => section.classList.remove('active'));
    const targetSection = document.getElementById(`${sectionId}Section`);
    if (targetSection) {
      targetSection.classList.add('active');
    }
  };

  // Tab switching
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const sectionId = item.dataset.section;
      switchToSection(sectionId);
    });
  });

  // Check for hash in URL and switch to that section
  const hash = window.location.hash.substring(1); // Remove the '#'
  if (hash && ['account', 'credits', 'billing'].includes(hash)) {
    switchToSection(hash);
  }

  // Buy credits button
  const buyCreditsBtn = document.getElementById('buyCreditsBtn');
  if (buyCreditsBtn) {
    buyCreditsBtn.addEventListener('click', () => {
      handleBuyCredits();
    });
  }

  // Load data
  loadAccountData();
  loadCreditsData();
  loadCreditPackages();
}

/**
 * Load account/profile data
 */
async function loadAccountData() {
  try {
    const response = await fetch(`${API_BASE}/auth/profile`, {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      const user = data.data.user;

      // Update avatar
      const profileAvatar = document.getElementById('profileAvatar');
      if (profileAvatar && user.username) {
        profileAvatar.textContent = user.username.charAt(0).toUpperCase();
      }

      // Update profile name (full name in field)
      const profileName = document.getElementById('profileName');
      if (profileName) {
        const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'User';
        profileName.textContent = fullName;
      }

      // Update profile email
      const profileEmail = document.getElementById('profileEmail');
      if (profileEmail) {
        profileEmail.textContent = user.email || '-';
      }

      // Update individual fields
      updateField('firstName', user.first_name);
      updateField('lastName', user.last_name);
      updateField('username', user.username);
      updateField('phoneNumber', user.phone_number);

      // Format and update created date
      if (user.created_at) {
        const createdDate = new Date(user.created_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        updateField('createdAt', createdDate);
      }

      updateField('userId', user.id);
    } else {
      console.error('Failed to load account data');
    }
  } catch (error) {
    console.error('Error loading account data:', error);
  }
}

/**
 * Load credits balance
 */
async function loadCreditsData() {
  try {
    const response = await fetch(`${API_BASE}/credits/balance`, {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      const balance = data.data.balance || 0;

      // Update credits balance in Credits section
      const settingsCreditsBalance = document.getElementById('settingsCreditsBalance');
      if (settingsCreditsBalance) {
        settingsCreditsBalance.textContent = balance;
      }
    } else {
      console.error('Failed to load credits data');
    }
  } catch (error) {
    console.error('Error loading credits data:', error);
  }
}

/**
 * Load credit packages
 */
async function loadCreditPackages() {
  try {
    const response = await fetch(`${API_BASE}/credits/packages`, {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data.packages) {
        renderCreditPackages(data.data.packages);
      }
    } else {
      console.error('Failed to load credit packages');
    }
  } catch (error) {
    console.error('Error loading credit packages:', error);
  }
}

/**
 * Render credit packages
 */
function renderCreditPackages(packages) {
  const container = document.getElementById('settingsCreditsPackages');
  if (!container) return;

  if (!packages || packages.length === 0) {
    container.innerHTML = '<div class="package-loading">No packages available</div>';
    return;
  }

  container.innerHTML = packages.map((pkg, index) => {
    const isPopular = index === 2; // Pro Pack is popular
    const savingsText = pkg.savings_percentage > 0
      ? `Save ${pkg.savings_percentage}%`
      : '';

    return `
      <div class="credit-package ${isPopular ? 'popular' : ''}" data-package-id="${pkg.id}">
        <div class="package-name">${pkg.name}</div>
        <div class="package-credits">${pkg.credits}</div>
        <div class="package-credits-label">credits</div>
        <div class="package-price">$${parseFloat(pkg.price_usd).toFixed(2)}</div>
        ${savingsText ? `<div class="package-savings">${savingsText}</div>` : ''}
        <div class="package-description">${pkg.description || ''}</div>
        <button class="btn-select-package" onclick="purchaseCredits('${pkg.id}')">
          Select Package
        </button>
      </div>
    `;
  }).join('');
}

/**
 * Purchase credits
 */
async function purchaseCredits(packageId) {
  const button = event.target;
  const originalText = button.textContent;
  button.textContent = 'Processing...';
  button.classList.add('loading');

  try {
    const response = await fetch(`${API_BASE}/credits/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ packageId })
    });

    const data = await response.json();

    if (data.success && data.data.url) {
      // Redirect to Stripe Checkout
      window.location.href = data.data.url;
    } else if (data.success && data.data.mode === 'simulation') {
      // Simulation mode
      showNotification('Payment simulated. Credits added!', 'success');
      await loadCreditsData();
      button.textContent = originalText;
      button.classList.remove('loading');
    } else {
      throw new Error(data.message || 'Failed to create checkout session');
    }
  } catch (error) {
    console.error('Error purchasing credits:', error);
    showNotification(`Failed to purchase credits: ${error.message}`, 'error');
    button.textContent = originalText;
    button.classList.remove('loading');
  }
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 2rem;
    right: 2rem;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6b7280'};
    color: white;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    font-weight: 600;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

/**
 * Update a field value
 */
function updateField(fieldId, value) {
  const field = document.getElementById(fieldId);
  if (field) {
    field.textContent = value || '-';
  }
}

/**
 * Handle buy credits action
 */
function handleBuyCredits() {
  // Redirect to main page with buy credits modal trigger
  window.location.href = 'index.html?action=buy-credits';
}
