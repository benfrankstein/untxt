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

    // Load projects
    this.loadProjects();
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
   * Load projects from API and render them in sidebar
   * Uses localStorage cache for instant rendering, then updates from API
   */
  async loadProjects() {
    try {
      // First, check if we have cached projects
      const cachedProjects = localStorage.getItem('sidebarProjects');
      if (cachedProjects) {
        try {
          const folders = JSON.parse(cachedProjects);
          console.log('[SidebarNav] Rendering from cache:', folders.length, 'projects');
          this.renderProjects(folders);
        } catch (e) {
          console.error('[SidebarNav] Failed to parse cached projects:', e);
        }
      }

      // Then fetch fresh data from API
      console.log('[SidebarNav] Fetching projects from API...');
      const response = await fetch('http://localhost:8080/api/folders', {
        credentials: 'include'
      });

      console.log('[SidebarNav] API response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('[SidebarNav] API response data:', data);
        const folders = data.folders || data.data || [];
        console.log('[SidebarNav] Loaded projects:', folders);

        // Cache the fresh data
        localStorage.setItem('sidebarProjects', JSON.stringify(folders));

        // Re-render with fresh data
        this.renderProjects(folders);
      } else {
        console.error('[SidebarNav] API request failed:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  },

  /**
   * Render projects in sidebar
   */
  renderProjects(folders) {
    const projectsList = this.projectsList;
    if (!projectsList) {
      console.log('[SidebarNav] projectsList element not found');
      return;
    }

    console.log('[SidebarNav] Rendering projects:', folders.length, 'folders');

    // Keep the "New Project" button
    const newProjectBtn = projectsList.querySelector('#newProjectBtn');

    // Clear existing projects (except New Project button)
    const existingProjects = projectsList.querySelectorAll('.project-item-wrapper, .project-item-all-files');
    console.log('[SidebarNav] Clearing', existingProjects.length, 'existing items');
    existingProjects.forEach(el => el.remove());

    // Add "All Files" as first item
    const allFilesWrapper = document.createElement('div');
    allFilesWrapper.className = 'project-item-wrapper project-item-all-files';
    allFilesWrapper.innerHTML = `
      <a href="/index.html?folder=all" class="project-item" data-project-id="all">
        <svg class="project-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3h18v18H3z"></path>
          <path d="M9 3v18"></path>
          <path d="M3 9h18"></path>
          <path d="M3 15h18"></path>
        </svg>
        <span class="project-name">All Files</span>
      </a>
    `;
    projectsList.appendChild(allFilesWrapper);

    // Render each folder as a project
    folders.forEach(folder => {
      const wrapper = document.createElement('div');
      wrapper.className = 'project-item-wrapper';
      wrapper.innerHTML = `
        <a href="/index.html?folder=${folder.id}" class="project-item" data-project-id="${folder.id}">
          <svg class="project-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${folder.color || '#c7ff00'}" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="project-name">${this.escapeHtml(folder.name)}</span>
        </a>
        <button class="project-menu-btn" data-project-id="${folder.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <circle cx="12" cy="12" r="2"></circle>
            <circle cx="5" cy="12" r="2"></circle>
            <circle cx="19" cy="12" r="2"></circle>
          </svg>
        </button>
        <div class="project-context-menu" data-project-id="${folder.id}">
          <button class="context-menu-item" data-action="rename">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            <span>Rename Project</span>
          </button>
          <button class="context-menu-item context-menu-item-danger" data-action="delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Delete Project</span>
          </button>
        </div>
      `;
      projectsList.appendChild(wrapper);
    });

    // Re-bind context menu events
    this.bindProjectMenuEvents();
  },

  /**
   * Bind project context menu events
   */
  bindProjectMenuEvents() {
    const menuBtns = document.querySelectorAll('.project-menu-btn');
    const contextMenus = document.querySelectorAll('.project-context-menu');
    const projectLinks = document.querySelectorAll('.project-item[data-project-id]');

    // Handle project link clicks to save to localStorage
    projectLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        const projectId = link.dataset.projectId;
        localStorage.setItem('selectedProject', projectId);
        console.log('📁 Saved selected project to localStorage:', projectId);
      });
    });

    // Toggle context menus
    menuBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const projectId = btn.dataset.projectId;
        const menu = document.querySelector(`.project-context-menu[data-project-id="${projectId}"]`);

        // Close all other menus
        contextMenus.forEach(m => {
          if (m !== menu) m.classList.remove('active');
        });

        // Toggle this menu
        menu.classList.toggle('active');
      });
    });

    // Handle menu actions
    const menuItems = document.querySelectorAll('.project-context-menu .context-menu-item');
    menuItems.forEach(item => {
      item.addEventListener('click', async (e) => {
        const menu = item.closest('.project-context-menu');
        const projectId = menu.dataset.projectId;
        const action = item.dataset.action;

        // Close menu
        menu.classList.remove('active');

        if (action === 'rename') {
          // Call global function from app.js if available
          if (typeof window.editFolder === 'function') {
            window.editFolder(projectId);
          } else {
            // Fallback: redirect to main page with edit parameter
            window.location.href = `/index.html?edit=${projectId}`;
          }
        } else if (action === 'delete') {
          // Call global function from app.js if available
          if (typeof window.deleteFolder === 'function') {
            window.deleteFolder(projectId);
          } else {
            // Fallback: redirect to main page with delete parameter
            window.location.href = `/index.html?delete=${projectId}`;
          }
        }
      });
    });

    // Close menus when clicking outside
    document.addEventListener('click', () => {
      contextMenus.forEach(m => m.classList.remove('active'));
    });
  },

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Clear the cached projects
   * Call this when projects are created, updated, or deleted
   */
  clearProjectsCache() {
    localStorage.removeItem('sidebarProjects');
    console.log('[SidebarNav] Cache cleared');
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
    // Call the global function from app.js
    if (typeof window.openNewProjectModal === 'function') {
      window.openNewProjectModal();
    } else {
      console.error('openNewProjectModal function not found');
    }
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
