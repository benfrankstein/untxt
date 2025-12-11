/**
 * Settings Page
 * Handles settings navigation and data loading
 */

const API_BASE = 'http://localhost:8080/api';

// Initialize settings page
document.addEventListener('DOMContentLoaded', async () => {
  // Check for Stripe success redirect first
  await handleStripeSuccess();

  // Then initialize settings
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
  initCreditsPurchase();
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
 * Handle Stripe redirect after successful payment
 */
async function handleStripeSuccess() {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session_id');

  if (!sessionId) return;

  console.log('Processing Stripe payment success...');
  showNotification('Processing your payment...', 'info');

  try {
    const response = await fetch(`${API_BASE}/credits/verify-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ sessionId })
    });

    const data = await response.json();

    if (data.success) {
      showNotification(`Success! ${data.data.creditsAdded} credits added to your account`, 'success');
      await loadCreditsData();
      // Update sidebar credit balance
      if (typeof SidebarNav !== 'undefined') {
        SidebarNav.loadCredits();
      }

      // Clean URL (remove session_id parameter)
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    } else {
      showNotification('Payment verification failed: ' + data.message, 'error');
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    showNotification('Error processing payment. Please contact support.', 'error');
  }
}

/**
 * Initialize credits purchase form
 */
let creditPackages = [];

async function initCreditsPurchase() {
  try {
    // Load packages from API
    const response = await fetch(`${API_BASE}/credits/packages`, {
      credentials: 'include'  // Include session cookies for authentication
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data.packages) {
        creditPackages = data.data.packages;
        setupCreditsPurchaseForm();
      }
    }
  } catch (error) {
    console.error('Error loading credit packages:', error);
  }
}

function setupCreditsPurchaseForm() {
  const radioButtons = document.querySelectorAll('input[name="creditAmount"]');
  const creditsDisplay = document.getElementById('creditsAmountDisplay');
  const purchaseBtn = document.getElementById('purchaseCreditsBtn');
  const customInput = document.getElementById('customAmountInput');

  // Update credits display when selection changes
  radioButtons.forEach(radio => {
    radio.addEventListener('change', () => {
      updateCreditsDisplay();
      // Focus custom input when "Other" is selected
      if (radio.value === 'other' && customInput) {
        setTimeout(() => customInput.focus(), 100);
      }
    });
  });

  // Update credits display when custom amount changes
  if (customInput) {
    customInput.addEventListener('input', () => {
      const otherRadio = document.querySelector('input[name="creditAmount"][value="other"]');
      if (otherRadio) {
        otherRadio.checked = true;
      }
      updateCreditsDisplay();
    });

    // Select "Other" radio when clicking on the custom input
    customInput.addEventListener('click', (e) => {
      e.stopPropagation();
      const otherRadio = document.querySelector('input[name="creditAmount"][value="other"]');
      if (otherRadio) {
        otherRadio.checked = true;
        updateCreditsDisplay();
      }
    });
  }

  // Handle purchase button click
  if (purchaseBtn) {
    purchaseBtn.addEventListener('click', () => {
      handlePurchase();
    });
  }

  // Set initial display
  updateCreditsDisplay();
}

function updateCreditsDisplay() {
  const selectedRadio = document.querySelector('input[name="creditAmount"]:checked');
  const creditsDisplay = document.getElementById('creditsAmountDisplay');
  const customInput = document.getElementById('customAmountInput');

  if (!selectedRadio || !creditsDisplay) return;

  if (selectedRadio.value === 'other') {
    // Custom amount - calculate based on $0.12 per credit
    const customAmount = parseFloat(customInput.value) || 0;
    const credits = Math.floor(customAmount / 0.12);
    creditsDisplay.innerHTML = `<span class="credits-count">${credits}</span><div>credits</div>`;
  } else {
    // Pre-defined package
    const packageIndex = parseInt(selectedRadio.value) - 1;
    const package = creditPackages[packageIndex];

    if (package) {
      creditsDisplay.innerHTML = `<span class="credits-count">${package.credits}</span><div>credits</div>`;
    }
  }
}

async function handlePurchase() {
  const selectedRadio = document.querySelector('input[name="creditAmount"]:checked');
  const purchaseBtn = document.getElementById('purchaseCreditsBtn');
  const customInput = document.getElementById('customAmountInput');

  if (!selectedRadio) {
    showNotification('Please select an amount', 'error');
    return;
  }

  let packageId, customAmount;

  if (selectedRadio.value === 'other') {
    // Custom amount
    customAmount = parseFloat(customInput.value);
    if (!customAmount || customAmount < 5) {
      showNotification('Please enter an amount of at least $5', 'error');
      return;
    }
    // For custom amounts, we'll use the first package ID but pass custom amount
    packageId = creditPackages[0]?.id;
  } else {
    // Pre-defined package
    const packageIndex = parseInt(selectedRadio.value) - 1;
    const package = creditPackages[packageIndex];

    if (!package) {
      showNotification('Package not found', 'error');
      return;
    }
    packageId = package.id;
  }

  const originalText = purchaseBtn.textContent;
  purchaseBtn.textContent = 'Processing...';
  purchaseBtn.disabled = true;

  try {
    const requestBody = customAmount
      ? { packageId, customAmount }
      : { packageId };

    const response = await fetch(`${API_BASE}/credits/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',  // Include session cookies for authentication
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (data.success && data.data.url) {
      // Redirect to Stripe Checkout
      console.log('Redirecting to Stripe Checkout...');
      window.location.href = data.data.url;
    } else if (data.success && data.data.mode === 'simulation') {
      // Simulation mode - credits added directly
      showNotification('Payment simulated. Credits added!', 'success');
      await loadCreditsData();
      // Update sidebar credit balance
      if (typeof SidebarNav !== 'undefined') {
        SidebarNav.loadCredits();
      }
      purchaseBtn.textContent = originalText;
      purchaseBtn.disabled = false;
    } else {
      throw new Error(data.message || 'Failed to create checkout session');
    }
  } catch (error) {
    console.error('Error purchasing credits:', error);
    showNotification(`Failed to purchase credits: ${error.message}`, 'error');
    purchaseBtn.textContent = originalText;
    purchaseBtn.disabled = false;
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
