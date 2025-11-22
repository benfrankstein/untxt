// ============================================
// CREDITS SYSTEM
// ============================================

// Stripe Configuration
const STRIPE_PUBLISHABLE_KEY = 'pk_test_51STc7YHJfMf64wFePmCDH0C33nLyQOIlswyyWEdwRPyiNdcnFLlOBJ6rBVd7BIMxuJ9J5rGr4i1tMwYKrL8MyFh500fovMrWLA';

let currentCreditBalance = null;
let creditPackages = [];
let stripe = null;

/**
 * Fetch current credit balance from API
 */
async function fetchCreditBalance() {
  try {
    const response = await fetch(`${API_URL}/api/credits/balance`, {
      headers: {
        'x-user-id': USER_ID
      }
    });

    if (!response.ok) throw new Error('Failed to fetch credit balance');

    const data = await response.json();
    if (data.success) {
      currentCreditBalance = data.data.balance;
      updateCreditBalanceDisplay(currentCreditBalance);
      return currentCreditBalance;
    }
  } catch (error) {
    console.error('Error fetching credit balance:', error);
    updateCreditBalanceDisplay(null);
  }
}

/**
 * Update credit balance display in UI
 */
function updateCreditBalanceDisplay(balance) {
  const balanceEl = document.getElementById('creditsBalance');
  if (!balanceEl) return;

  if (balance === null || balance === undefined) {
    balanceEl.textContent = '--';
    balanceEl.className = 'credits-balance';
    return;
  }

  balanceEl.textContent = balance;

  // Add visual warnings for low balance
  if (balance === 0) {
    balanceEl.className = 'credits-balance empty';
  } else if (balance <= 5) {
    balanceEl.className = 'credits-balance low';
  } else {
    balanceEl.className = 'credits-balance';
  }
}

/**
 * Fetch available credit packages
 */
async function fetchCreditPackages() {
  try {
    const response = await fetch(`${API_URL}/api/credits/packages`);

    if (!response.ok) throw new Error('Failed to fetch credit packages');

    const data = await response.json();
    if (data.success) {
      creditPackages = data.data.packages;
      return creditPackages;
    }
  } catch (error) {
    console.error('Error fetching credit packages:', error);
    return [];
  }
}

/**
 * Open purchase credits modal
 */
async function openPurchaseCreditsModal() {
  const modal = document.getElementById('purchaseCreditsModal');
  const packagesContainer = document.getElementById('creditsPackages');

  if (!modal || !packagesContainer) return;

  // Show modal
  modal.classList.add('active');

  // Load packages if not already loaded
  if (creditPackages.length === 0) {
    creditPackages = await fetchCreditPackages();
  }

  // Render packages
  renderCreditPackages(packagesContainer, creditPackages);
}

/**
 * Close purchase credits modal
 */
function closePurchaseCreditsModal() {
  const modal = document.getElementById('purchaseCreditsModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

/**
 * Render credit packages in modal
 */
function renderCreditPackages(container, packages) {
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
 * Purchase credits (Real Stripe Checkout or Simulated)
 */
async function purchaseCredits(packageId) {
  const button = event.target;
  const originalText = button.textContent;
  button.textContent = 'Processing...';
  button.classList.add('loading');

  try {
    // Check if we should use simulation or real Stripe
    const useSimulation = localStorage.getItem('useSimulationMode') === 'true' || !stripe;

    if (useSimulation) {
      // SIMULATION MODE: Direct credit add (for testing)
      console.log('🧪 Using simulation mode');
      const response = await fetch(`${API_URL}/api/credits/simulate-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': USER_ID
        },
        body: JSON.stringify({ packageId })
      });

      const data = await response.json();

      if (data.success) {
        await fetchCreditBalance();
        showNotification(`TEST MODE: Added ${data.data.creditsAdded} credits! New balance: ${data.data.newBalance}`, 'success');
        closePurchaseCreditsModal();
      } else {
        throw new Error(data.message || 'Payment failed');
      }
    } else {
      // REAL STRIPE CHECKOUT
      console.log('💳 Using Stripe Checkout');
      const response = await fetch(`${API_URL}/api/credits/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': USER_ID
        },
        body: JSON.stringify({ packageId })
      });

      const data = await response.json();

      if (data.success && data.data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.data.url;
      } else if (data.success && data.data.mode === 'simulation') {
        // Stripe not configured, fall back to simulation
        showNotification('Stripe not configured. Using simulation mode.', 'info');
        localStorage.setItem('useSimulationMode', 'true');
        // Retry with simulation
        button.textContent = originalText;
        button.classList.remove('loading');
        return purchaseCredits(packageId);
      } else {
        throw new Error(data.message || 'Failed to create checkout session');
      }
    }
  } catch (error) {
    console.error('Error purchasing credits:', error);
    showNotification(`Failed to purchase credits: ${error.message}`, 'error');
    button.textContent = originalText;
    button.classList.remove('loading');
  }
}

/**
 * Show notification to user
 */
function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 2rem;
    right: 2rem;
    background: ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--error)' : 'var(--gray-200)'};
    color: ${type === 'success' || type === 'error' ? '#000' : 'var(--gray-900)'};
    padding: 1rem 1.5rem;
    border-radius: 8px;
    box-shadow: var(--shadow-xl);
    z-index: 10000;
    font-weight: 600;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(notification);

  // Remove after 5 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

/**
 * Check if user has sufficient credits before upload
 */
async function checkCreditsBeforeUpload() {
  if (currentCreditBalance === null) {
    await fetchCreditBalance();
  }

  if (currentCreditBalance === 0) {
    showNotification('You have no credits remaining. Please purchase more credits to continue.', 'error');
    openPurchaseCreditsModal();
    return false;
  }

  return true;
}

/**
 * Handle Stripe success redirect
 * Called when user returns from Stripe checkout
 */
async function handleStripeSuccess() {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session_id');

  if (!sessionId || !sessionId.startsWith('cs_')) {
    return; // Not a Stripe success redirect
  }

  console.log('Processing Stripe payment success...');

  // Show loading notification
  showNotification('Processing your payment...', 'info');

  try {
    const response = await fetch(`${API_URL}/api/credits/verify-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      },
      body: JSON.stringify({ sessionId })
    });

    const data = await response.json();

    if (data.success) {
      const credits = data.data.creditsAdded || data.data.credits;
      showNotification(`Success! ${credits} credits added to your account`, 'success');

      // Refresh balance
      await fetchCreditBalance();

      // Clean URL (remove session_id parameter)
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      showNotification('Payment verification failed: ' + data.message, 'error');
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    showNotification('Error processing payment. Please contact support.', 'error');
  }
}

/**
 * Initialize credits system
 */
async function initCredits() {
  // Check for Stripe success redirect first
  await handleStripeSuccess();

  // Initialize Stripe
  if (typeof Stripe !== 'undefined' && STRIPE_PUBLISHABLE_KEY) {
    try {
      stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
      console.log('✓ Stripe initialized');
    } catch (error) {
      console.warn('⚠ Stripe initialization failed:', error);
      localStorage.setItem('useSimulationMode', 'true');
    }
  } else {
    console.warn('⚠ Stripe.js not loaded, using simulation mode');
    localStorage.setItem('useSimulationMode', 'true');
  }

  // Fetch initial balance
  await fetchCreditBalance();

  // Fetch packages for later
  await fetchCreditPackages();

  // Set up event listeners
  const buyCreditsBtn = document.getElementById('buyCreditsBtn');
  if (buyCreditsBtn) {
    buyCreditsBtn.addEventListener('click', openPurchaseCreditsModal);
  }

  const closePurchaseBtn = document.getElementById('closePurchaseModal');
  if (closePurchaseBtn) {
    closePurchaseBtn.addEventListener('click', closePurchaseCreditsModal);
  }

  // Close modal when clicking outside
  const purchaseModal = document.getElementById('purchaseCreditsModal');
  if (purchaseModal) {
    purchaseModal.addEventListener('click', (e) => {
      if (e.target === purchaseModal) {
        closePurchaseCreditsModal();
      }
    });
  }

  // Refresh balance every 30 seconds
  setInterval(fetchCreditBalance, 30000);

  console.log('✓ Credits system initialized');
}

// Initialize credits when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initCredits, 1000); // Wait for USER_ID to be set
  });
} else {
  setTimeout(initCredits, 1000);
}
