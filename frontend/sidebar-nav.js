/**
 * Universal Sidebar Navigation
 * Handles sidebar initialization, state management, and interactions
 */

const SidebarNav = {
  /**
   * Initialize the sidebar navigation
   * @param {string} currentPage - Current page identifier ('documents', 'account', etc.)
   */
  init(currentPage = 'documents') {
    this.currentPage = currentPage;
    this.sidebar = document.getElementById('sidebarNav');
    this.collapseBtn = document.getElementById('sidebarCollapseBtn');
    this.logoutBtn = document.getElementById('sidebarLogoutBtn');
    this.buyCreditsBtn = document.getElementById('sidebarBuyCreditsBtn');

    // User dropdown elements
    this.userDropdown = document.getElementById('sidebarUserDropdown');
    this.userTrigger = document.getElementById('sidebarUserTrigger');
    this.dropdownLogoutBtn = document.getElementById('dropdownLogoutBtn');
    this.dropdownCreditsBtn = document.getElementById('dropdownCreditsBtn');

    // Projects elements
    this.projectsHeader = document.getElementById('projectsHeader');
    this.projectsList = document.getElementById('projectsList');
    this.newProjectBtn = document.getElementById('newProjectBtn');

    // Settings modal elements
    this.settingsModal = document.getElementById('settingsModalOverlay');
    this.settingsModalClose = document.getElementById('settingsModalClose');
    this.settingsNavItems = document.querySelectorAll('.settings-nav-item');
    this.settingsTabs = document.querySelectorAll('.settings-tab');
    this.settingsBuyCreditsBtn = document.getElementById('settingsBuyCreditsBtn');
    this.accountSettingsLink = document.querySelector('a[href="account.html"]');

    // Load collapse state from localStorage
    this.loadCollapseState();

    // Load projects collapse state
    this.loadProjectsCollapseState();

    // Set active page
    this.setActivePage(currentPage);

    // Bind event listeners
    this.bindEvents();

    // Load user data
    this.loadUserData();

    // Load credits balance
    this.loadCredits();

    // Load projects (TODO: implement)
    // this.loadProjects();
  },

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Collapse/Expand toggle
    if (this.collapseBtn) {
      this.collapseBtn.addEventListener('click', () => this.toggleCollapse());
    }

    // Logo click to expand when collapsed
    const logoContent = document.querySelector('.sidebar-logo-content');
    if (logoContent) {
      logoContent.addEventListener('click', () => {
        if (this.sidebar.classList.contains('collapsed')) {
          this.expand();
        }
      });
    }

    // Logout (old button - will be removed)
    if (this.logoutBtn) {
      this.logoutBtn.addEventListener('click', () => this.handleLogout());
    }

    // Buy credits
    if (this.buyCreditsBtn) {
      this.buyCreditsBtn.addEventListener('click', () => this.handleBuyCredits());
    }

    // User dropdown toggle
    if (this.userTrigger) {
      this.userTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleUserDropdown();
      });
    }

    // Dropdown action buttons
    if (this.dropdownLogoutBtn) {
      this.dropdownLogoutBtn.addEventListener('click', () => {
        this.closeUserDropdown();
        this.handleLogout();
      });
    }

    if (this.dropdownCreditsBtn) {
      this.dropdownCreditsBtn.addEventListener('click', () => {
        this.closeUserDropdown();
        this.handleBuyCredits();
      });
    }

    // Click outside to close dropdown
    document.addEventListener('click', (e) => {
      if (this.userDropdown && this.userDropdown.classList.contains('active')) {
        if (!this.userDropdown.contains(e.target) && !this.userTrigger.contains(e.target)) {
          this.closeUserDropdown();
        }
      }
    });

    // ESC key to close dropdown or settings modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.settingsModal && this.settingsModal.classList.contains('active')) {
          this.closeSettingsModal();
        } else if (this.userDropdown && this.userDropdown.classList.contains('active')) {
          this.closeUserDropdown();
        }
      }
    });

    // Projects header toggle
    if (this.projectsHeader) {
      this.projectsHeader.addEventListener('click', () => this.toggleProjects());
    }

    // New project button
    if (this.newProjectBtn) {
      this.newProjectBtn.addEventListener('click', () => this.handleNewProject());
    }

    // Settings modal - Open from Account Settings link
    if (this.accountSettingsLink) {
      this.accountSettingsLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.closeUserDropdown();
        this.openSettingsModal();
      });
    }

    // Settings modal - Close button
    if (this.settingsModalClose) {
      this.settingsModalClose.addEventListener('click', () => this.closeSettingsModal());
    }

    // Settings modal - Close on overlay click
    if (this.settingsModal) {
      this.settingsModal.addEventListener('click', (e) => {
        if (e.target === this.settingsModal) {
          this.closeSettingsModal();
        }
      });
    }

    // Settings modal - Tab switching
    this.settingsNavItems.forEach(item => {
      item.addEventListener('click', () => {
        const tabName = item.dataset.tab;
        this.switchSettingsTab(tabName);
      });
    });

    // Settings modal - Buy credits button
    if (this.settingsBuyCreditsBtn) {
      this.settingsBuyCreditsBtn.addEventListener('click', () => {
        this.closeSettingsModal();
        this.handleBuyCredits();
      });
    }

    // Mobile: Close sidebar when clicking outside
    if (window.innerWidth <= 1024) {
      this.setupMobileBackdrop();
    }

    // Handle window resize
    window.addEventListener('resize', () => {
      if (window.innerWidth <= 1024) {
        this.setupMobileBackdrop();
      } else {
        this.removeMobileBackdrop();
      }
    });

    // Project menu buttons
    document.querySelectorAll('.project-menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const projectId = btn.dataset.projectId;
        this.toggleProjectMenu(projectId);
      });
    });

    // Context menu items
    document.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = item.dataset.action;
        const menu = item.closest('.project-context-menu');
        const projectId = menu.dataset.projectId;
        this.handleProjectAction(projectId, action);
      });
    });

    // Click outside to close project menus
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.project-context-menu') && !e.target.closest('.project-menu-btn')) {
        this.closeAllProjectMenus();
      }
    });

    // Project item clicks - navigate to documents page
    document.querySelectorAll('.project-item:not(.project-new)').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const projectId = item.dataset.projectId;
        this.handleProjectClick(projectId);
      });
    });
  },

  /**
   * Set active page highlight
   */
  setActivePage(page) {
    const navItems = this.sidebar.querySelectorAll('.sidebar-nav-item');
    navItems.forEach(item => {
      if (item.dataset.page === page) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  },

  /**
   * Toggle sidebar collapse state
   */
  toggleCollapse() {
    if (this.sidebar.classList.contains('collapsed')) {
      this.expand();
    } else {
      this.collapse();
    }
  },

  /**
   * Collapse sidebar
   */
  collapse() {
    this.sidebar.classList.add('collapsed');
    localStorage.setItem('sidebarCollapsed', 'true');
  },

  /**
   * Expand sidebar
   */
  expand() {
    this.sidebar.classList.remove('collapsed');
    localStorage.setItem('sidebarCollapsed', 'false');
  },

  /**
   * Load collapse state from localStorage
   */
  loadCollapseState() {
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
      this.sidebar.classList.add('collapsed');
    }
  },

  /**
   * Load user data (name, email, avatar)
   */
  async loadUserData() {
    try {
      const response = await fetch('http://localhost:8080/api/auth/profile', {
        credentials: 'include' // Include session cookies
      });

      if (response.ok) {
        const data = await response.json();
        const user = data.data.user;

        // Update user name
        const userName = document.getElementById('sidebarUserName');
        if (userName) {
          userName.textContent = user.username || 'User';
        }

        // Update user plan (TODO: Add plan field to database)
        const userPlan = document.getElementById('sidebarUserPlan');
        if (userPlan) {
          userPlan.textContent = user.plan || 'Free';
        }

        // Update dropdown email
        const dropdownEmail = document.getElementById('dropdownEmail');
        if (dropdownEmail) {
          dropdownEmail.textContent = user.email || '';
        }

        // Update dropdown user name
        const dropdownUserName = document.getElementById('dropdownUserName');
        if (dropdownUserName) {
          dropdownUserName.textContent = user.username || 'User';
        }

        // Update avatars (first letter of username) - both sidebar and dropdown
        const initial = user.username ? user.username.charAt(0).toUpperCase() : 'U';

        const userAvatar = document.getElementById('sidebarUserAvatar');
        if (userAvatar) {
          userAvatar.textContent = initial;
        }

        const dropdownAvatar = document.getElementById('dropdownUserAvatar');
        if (dropdownAvatar) {
          dropdownAvatar.textContent = initial;
        }
      } else {
        console.error('Failed to load user data: HTTP', response.status);
        // Set fallback values
        const userName = document.getElementById('sidebarUserName');
        if (userName) userName.textContent = 'User';

        const dropdownUserName = document.getElementById('dropdownUserName');
        if (dropdownUserName) dropdownUserName.textContent = 'User';
      }
    } catch (error) {
      console.error('Failed to load user data:', error);
      // Set fallback values
      const userName = document.getElementById('sidebarUserName');
      if (userName) userName.textContent = 'User';

      const dropdownUserName = document.getElementById('dropdownUserName');
      if (dropdownUserName) dropdownUserName.textContent = 'User';
    }
  },

  /**
   * Load credits balance
   */
  async loadCredits() {
    try {
      const response = await fetch('http://localhost:8080/api/credits/balance', {
        credentials: 'include' // Include session cookies
      });

      if (response.ok) {
        const data = await response.json();
        const balance = data.data.balance || 0;

        // Update sidebar credits widget
        const creditsBalance = document.getElementById('sidebarCreditsBalance');
        if (creditsBalance) {
          creditsBalance.textContent = balance;
        }

        // Update dropdown credits balance
        const dropdownCreditsBalance = document.getElementById('dropdownCreditsBalance');
        if (dropdownCreditsBalance) {
          dropdownCreditsBalance.textContent = balance;
        }
      }
    } catch (error) {
      console.error('Failed to load credits:', error);
    }
  },

  /**
   * Update credits balance (called from other pages when credits change)
   */
  updateCredits(newBalance) {
    const creditsBalance = document.getElementById('sidebarCreditsBalance');
    if (creditsBalance) {
      creditsBalance.textContent = newBalance;
    }

    const dropdownCreditsBalance = document.getElementById('dropdownCreditsBalance');
    if (dropdownCreditsBalance) {
      dropdownCreditsBalance.textContent = newBalance;
    }
  },

  /**
   * Handle logout
   */
  async handleLogout() {
    try {
      // Call logout endpoint to destroy session
      await fetch('http://localhost:8080/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (error) {
      console.error('Logout error:', error);
    }

    // Redirect to auth page
    window.location.href = 'auth.html';
  },

  /**
   * Handle buy credits click
   */
  handleBuyCredits() {
    // Navigate to settings page with credits section active
    window.location.href = 'settings.html#credits';
  },

  /**
   * Toggle user dropdown menu
   */
  toggleUserDropdown() {
    if (!this.userDropdown) return;

    if (this.userDropdown.classList.contains('active')) {
      this.closeUserDropdown();
    } else {
      this.openUserDropdown();
    }
  },

  /**
   * Open user dropdown menu
   */
  openUserDropdown() {
    if (!this.userDropdown) return;
    this.userDropdown.classList.add('active');
  },

  /**
   * Close user dropdown menu
   */
  closeUserDropdown() {
    if (!this.userDropdown) return;
    this.userDropdown.classList.remove('active');
  },

  /**
   * Setup mobile backdrop for overlay
   */
  setupMobileBackdrop() {
    let backdrop = document.getElementById('sidebarBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'sidebarBackdrop';
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);

      backdrop.addEventListener('click', () => {
        this.closeMobileSidebar();
      });
    }
  },

  /**
   * Remove mobile backdrop
   */
  removeMobileBackdrop() {
    const backdrop = document.getElementById('sidebarBackdrop');
    if (backdrop) {
      backdrop.remove();
    }
  },

  /**
   * Open mobile sidebar
   */
  openMobileSidebar() {
    if (window.innerWidth <= 1024) {
      this.sidebar.classList.add('mobile-open');
      const backdrop = document.getElementById('sidebarBackdrop');
      if (backdrop) {
        backdrop.classList.add('active');
      }
    }
  },

  /**
   * Close mobile sidebar
   */
  closeMobileSidebar() {
    this.sidebar.classList.remove('mobile-open');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (backdrop) {
      backdrop.classList.remove('active');
    }
  },

  /**
   * Toggle projects dropdown
   */
  toggleProjects() {
    if (!this.projectsHeader || !this.projectsList) return;

    const isCollapsed = this.projectsHeader.classList.contains('collapsed');

    if (isCollapsed) {
      this.projectsHeader.classList.remove('collapsed');
      this.projectsList.classList.remove('collapsed');
      localStorage.setItem('projectsCollapsed', 'false');
    } else {
      this.projectsHeader.classList.add('collapsed');
      this.projectsList.classList.add('collapsed');
      localStorage.setItem('projectsCollapsed', 'true');
    }
  },

  /**
   * Load projects collapse state from localStorage
   */
  loadProjectsCollapseState() {
    const isCollapsed = localStorage.getItem('projectsCollapsed') === 'true';
    if (isCollapsed && this.projectsHeader && this.projectsList) {
      this.projectsHeader.classList.add('collapsed');
      this.projectsList.classList.add('collapsed');
    }
  },

  /**
   * Handle new project button click
   */
  handleNewProject() {
    // TODO: Implement new project modal/flow
    console.log('Create new project');
    alert('New project creation will be implemented soon!');
  },

  /**
   * Open settings modal
   */
  openSettingsModal() {
    if (!this.settingsModal) return;
    this.settingsModal.classList.add('active');
    document.body.style.overflow = 'hidden'; // Prevent body scroll
    this.loadSettingsData();
  },

  /**
   * Close settings modal
   */
  closeSettingsModal() {
    if (!this.settingsModal) return;
    this.settingsModal.classList.remove('active');
    document.body.style.overflow = ''; // Restore body scroll
  },

  /**
   * Switch settings tab
   */
  switchSettingsTab(tabName) {
    // Update nav items
    this.settingsNavItems.forEach(item => {
      if (item.dataset.tab === tabName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update tab content
    this.settingsTabs.forEach(tab => {
      if (tab.id === `${tabName}Tab`) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  },

  /**
   * Load settings data into modal
   */
  async loadSettingsData() {
    try {
      // Load user profile data
      const profileResponse = await fetch('http://localhost:8080/api/auth/profile', {
        credentials: 'include'
      });

      if (profileResponse.ok) {
        const profileData = await profileResponse.json();
        const user = profileData.data.user;

        // Update settings avatar
        const settingsAvatar = document.getElementById('settingsAvatar');
        if (settingsAvatar && user.username) {
          settingsAvatar.textContent = user.username.charAt(0).toUpperCase();
        }

        // Update full name
        const settingsFullName = document.getElementById('settingsFullName');
        if (settingsFullName) {
          const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'User';
          settingsFullName.textContent = fullName;
        }

        // Update email
        const settingsEmail = document.getElementById('settingsEmail');
        if (settingsEmail) {
          settingsEmail.textContent = user.email || '-';
        }

        // Update individual fields
        const settingsFirstName = document.getElementById('settingsFirstName');
        if (settingsFirstName) {
          settingsFirstName.textContent = user.first_name || '-';
        }

        const settingsLastName = document.getElementById('settingsLastName');
        if (settingsLastName) {
          settingsLastName.textContent = user.last_name || '-';
        }

        const settingsUsername = document.getElementById('settingsUsername');
        if (settingsUsername) {
          settingsUsername.textContent = user.username || '-';
        }

        const settingsPhone = document.getElementById('settingsPhone');
        if (settingsPhone) {
          settingsPhone.textContent = user.phone_number || '-';
        }

        const settingsCreatedAt = document.getElementById('settingsCreatedAt');
        if (settingsCreatedAt && user.created_at) {
          settingsCreatedAt.textContent = new Date(user.created_at).toLocaleDateString();
        }

        const settingsUserId = document.getElementById('settingsUserId');
        if (settingsUserId) {
          settingsUserId.textContent = user.id || '-';
        }
      }

      // Load credits balance
      const creditsResponse = await fetch('http://localhost:8080/api/credits/balance', {
        credentials: 'include'
      });

      if (creditsResponse.ok) {
        const creditsData = await creditsResponse.json();
        const balance = creditsData.data.balance || 0;

        const settingsCreditsBalance = document.getElementById('settingsCreditsBalance');
        if (settingsCreditsBalance) {
          settingsCreditsBalance.textContent = balance;
        }
      }
    } catch (error) {
      console.error('Failed to load settings data:', error);
    }
  },

  /**
   * Toggle project context menu
   */
  toggleProjectMenu(projectId) {
    const menu = document.querySelector(`.project-context-menu[data-project-id="${projectId}"]`);
    if (!menu) return;

    const isActive = menu.classList.contains('active');

    // Close all menus first
    this.closeAllProjectMenus();

    // Open this menu if it wasn't active
    if (!isActive) {
      // Get the position of the menu button
      const menuBtn = document.querySelector(`.project-menu-btn[data-project-id="${projectId}"]`);
      if (menuBtn) {
        const rect = menuBtn.getBoundingClientRect();
        menu.style.top = `${rect.top}px`;
        menu.style.left = `${rect.right + 8}px`;
      }
      menu.classList.add('active');
    }
  },

  /**
   * Close all project context menus
   */
  closeAllProjectMenus() {
    document.querySelectorAll('.project-context-menu').forEach(menu => {
      menu.classList.remove('active');
    });
  },

  /**
   * Handle project actions (rename, delete)
   */
  async handleProjectAction(projectId, action) {
    this.closeAllProjectMenus();

    if (action === 'rename') {
      this.handleRenameProject(projectId);
    } else if (action === 'delete') {
      this.handleDeleteProject(projectId);
    }
  },

  /**
   * Handle rename project
   */
  async handleRenameProject(projectId) {
    const projectItem = document.querySelector(`.project-item[data-project-id="${projectId}"]`);
    if (!projectItem) return;

    const projectNameSpan = projectItem.querySelector('.project-name');
    const currentName = projectNameSpan.textContent;

    const newName = prompt('Enter new project name:', currentName);

    if (newName && newName.trim() !== '' && newName !== currentName) {
      try {
        const response = await fetch(`http://localhost:8080/api/projects/${projectId}/rename`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ name: newName.trim() })
        });

        if (response.ok) {
          projectNameSpan.textContent = newName.trim();
          console.log('Project renamed successfully');
        } else {
          const errorData = await response.json();
          alert(`Failed to rename project: ${errorData.message || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Error renaming project:', error);
        alert('Failed to rename project. Please try again.');
      }
    }
  },

  /**
   * Handle delete project
   */
  async handleDeleteProject(projectId) {
    const projectItem = document.querySelector(`.project-item[data-project-id="${projectId}"]`);
    if (!projectItem) return;

    const projectNameSpan = projectItem.querySelector('.project-name');
    const projectName = projectNameSpan.textContent;

    const confirmed = confirm(`Are you sure you want to delete "${projectName}"? This action cannot be undone.`);

    if (confirmed) {
      try {
        const response = await fetch(`http://localhost:8080/api/projects/${projectId}`, {
          method: 'DELETE',
          credentials: 'include'
        });

        if (response.ok) {
          // Remove the project from the DOM
          const wrapper = projectItem.closest('.project-item-wrapper');
          if (wrapper) {
            wrapper.remove();
          }
          console.log('Project deleted successfully');
        } else {
          const errorData = await response.json();
          alert(`Failed to delete project: ${errorData.message || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Error deleting project:', error);
        alert('Failed to delete project. Please try again.');
      }
    }
  },

  /**
   * Handle project click - navigate to documents page and show project
   */
  handleProjectClick(projectId) {
    console.log('📁 Project clicked:', projectId);

    // Check if we're on index.html or home page
    const isOnIndexPage = window.location.pathname.includes('index.html') || window.location.pathname === '/';

    if (isOnIndexPage && typeof selectFolder === 'function' && typeof showViewer === 'function') {
      // Already on index page with app.js loaded - select folder directly
      console.log('📄 Already on index page, selecting folder directly');

      selectFolder(projectId);

      // Show first document in viewer if available
      setTimeout(() => {
        const projectTasks = tasks.filter(t => t.folder_id === projectId);
        if (projectTasks.length > 0) {
          console.log('📄 Opening first document in viewer');
          showViewer(projectTasks[0]);
        }
      }, 100);
    } else {
      // Navigate to index.html with project selection
      localStorage.setItem('selectedProject', projectId);
      window.location.href = 'index.html';
    }
  }
};


// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SidebarNav;
}
