// Homepage functionality
class ScrumPokerHome {
  constructor() {
    this.init();
  }

  init() {
    // Load saved user preferences
    this.loadUserPreferences();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Check if user came from a room link
    this.checkRoomLink();
  }

  setupEventListeners() {
    // Enter key handlers
    document.getElementById('roomCode').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.joinRoom();
      }
    });

    // Modal form enter key handlers
    document.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const activeModal = document.querySelector('.modal:not(.hidden)');
        if (activeModal) {
          const primaryBtn = activeModal.querySelector('.action-btn.primary');
          if (primaryBtn) {
            primaryBtn.click();
          }
        }
      }
    });

    // Auto-format room codes
    document.getElementById('roomCode').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    });

    document.getElementById('joinRoomCode').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    });
  }

  loadUserPreferences() {
    // Load previously used name and role
    const savedName = localStorage.getItem('scrumPoker_userName');
    const savedRole = localStorage.getItem('scrumPoker_userRole');
    const savedTeamKey = localStorage.getItem('scrumPoker_teamKey');

    if (savedName) {
      document.getElementById('userName').value = savedName;
      document.getElementById('joinUserName').value = savedName;
    }

    if (savedRole) {
      document.getElementById('userRole').value = savedRole;
      document.getElementById('joinUserRole').value = savedRole;
    }

    if (savedTeamKey) {
      document.getElementById('teamKey').value = savedTeamKey;
    }
  }

  saveUserPreferences(userName, userRole, teamKey = null) {
    localStorage.setItem('scrumPoker_userName', userName);
    localStorage.setItem('scrumPoker_userRole', userRole);
    if (teamKey) {
      localStorage.setItem('scrumPoker_teamKey', teamKey);
    }
  }

  checkRoomLink() {
    // Check if URL contains room parameter
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    const name = urlParams.get('name');

    if (roomId) {
      document.getElementById('roomCode').value = roomId;
      if (name) {
        document.getElementById('joinUserName').value = name;
      }
      // Auto-open join modal
      setTimeout(() => this.joinRoom(), 100);
    }
  }

  async createRoom() {
    this.showModal('roomModal');
    
    // Focus on name input
    setTimeout(() => {
      document.getElementById('userName').focus();
    }, 100);
  }

  async confirmCreateRoom() {
    const userName = document.getElementById('userName').value.trim();
    const userRole = document.getElementById('userRole').value;
    const teamKey = document.getElementById('teamKey').value.trim() || null;

    // Validation
    if (!userName) {
      this.showError('Please enter your name');
      document.getElementById('userName').focus();
      return;
    }

    if (userName.length < 2) {
      this.showError('Name must be at least 2 characters');
      document.getElementById('userName').focus();
      return;
    }

    // Save preferences
    this.saveUserPreferences(userName, userRole, teamKey);

    // Show loading
    this.closeModal('roomModal');
    this.showLoading('Creating room...');

    try {
      // Generate new room ID (UUID7 format)
      const roomId = this.generateRoomId();
      
      // Navigate to room
      window.location.href = `/room/${roomId}?name=${encodeURIComponent(userName)}&role=${userRole}${teamKey ? '&team=' + encodeURIComponent(teamKey) : ''}`;
      
    } catch (error) {
      console.error('Error creating room:', error);
      this.hideLoading();
      this.showError('Failed to create room. Please try again.');
    }
  }

  joinRoom() {
    const roomCode = document.getElementById('roomCode').value.trim();
    
    if (!roomCode) {
      this.showModal('joinModal');
      // Focus on name input
      setTimeout(() => {
        document.getElementById('joinUserName').focus();
      }, 100);
      return;
    }

    // If room code is provided, go straight to join modal
    document.getElementById('joinRoomCode').value = roomCode;
    this.showModal('joinModal');
    setTimeout(() => {
      document.getElementById('joinUserName').focus();
    }, 100);
  }

  async confirmJoinRoom() {
    const userName = document.getElementById('joinUserName').value.trim();
    const userRole = document.getElementById('joinUserRole').value;
    const roomCode = document.getElementById('joinRoomCode').value.trim();

    // Validation
    if (!userName) {
      this.showError('Please enter your name');
      document.getElementById('joinUserName').focus();
      return;
    }

    if (!roomCode) {
      this.showError('Please enter a room code');
      document.getElementById('joinRoomCode').focus();
      return;
    }

    if (userName.length < 2) {
      this.showError('Name must be at least 2 characters');
      document.getElementById('joinUserName').focus();
      return;
    }

    // Save preferences
    this.saveUserPreferences(userName, userRole);

    // Show loading
    this.closeModal('joinModal');
    this.showLoading('Joining room...');

    try {
      // Check if room exists
      const response = await fetch(`/api/room/${roomCode}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Room not found');
      }

      // Navigate to room
      window.location.href = `/room/${roomCode}?name=${encodeURIComponent(userName)}&role=${userRole}`;
      
    } catch (error) {
      console.error('Error joining room:', error);
      this.hideLoading();
      this.showError(error.message || 'Failed to join room. Please check the room code and try again.');
    }
  }

  generateRoomId() {
    // Generate a human-friendly room ID
    const adjectives = ['agile', 'swift', 'quick', 'smart', 'wise', 'bold', 'keen', 'neat', 'cool', 'fast'];
    const nouns = ['team', 'squad', 'crew', 'group', 'gang', 'pack', 'unit', 'band', 'clan', 'army'];
    const numbers = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    
    return `${adjective}-${noun}-${numbers}`;
  }

  showModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    // Focus on first input
    setTimeout(() => {
      const firstInput = document.getElementById(modalId).querySelector('input');
      if (firstInput) {
        firstInput.focus();
      }
    }, 100);
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
    document.body.style.overflow = 'auto';
  }

  showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loadingOverlay');
    const messageEl = overlay.querySelector('p');
    messageEl.textContent = message;
    overlay.classList.remove('hidden');
  }

  hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }

  showError(message) {
    document.getElementById('errorMessage').textContent = message;
    this.showModal('errorModal');
  }
}

// Global functions for HTML onclick handlers
function createRoom() {
  app.createRoom();
}

function joinRoom() {
  app.joinRoom();
}

function confirmCreateRoom() {
  app.confirmCreateRoom();
}

function confirmJoinRoom() {
  app.confirmJoinRoom();
}

function closeModal(modalId) {
  app.closeModal(modalId);
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ScrumPokerHome();
});

// DO NOT INCLUDE SERVICE WORKER REGISTRATION
// The following code should NOT be in your file:
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/sw.js').catch(err => {
//       console.log('ServiceWorker registration failed: ', err);
//     });
//   });
// }