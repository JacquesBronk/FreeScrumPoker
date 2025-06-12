// Room client - handles all real-time functionality
class ScrumPokerRoom {
  constructor() {
    this.socket = null;
    this.roomId = null;
    this.userName = null;
    this.userRole = null;
    this.room = null;
    this.selectedCard = null;
    this.selectedConfidence = 'medium';
    this.timerInterval = null;
    this.cardSets = {};
    this.templates = {};
    
    this.init();
  }

  async init() {
    // Get room info from URL
    this.parseURL();
    
    // Load card sets and templates
    await this.loadCardSets();
    await this.loadTemplates();
    
    // Initialize Socket.io
    this.initSocket();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Setup periodic reconnection check
    this.setupConnectionMonitoring();
  }

  parseURL() {
    const pathParts = window.location.pathname.split('/');
    this.roomId = pathParts[pathParts.length - 1];
    
    const urlParams = new URLSearchParams(window.location.search);
    this.userName = urlParams.get('name');
    this.userRole = urlParams.get('role') || 'voter';
    this.teamKey = urlParams.get('team');
    
    if (!this.roomId || !this.userName) {
      this.showToast('Missing room information. Redirecting to home...', 'error');
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
      return;
    }
    
    // Update room ID display
    document.getElementById('roomId').textContent = `Room: ${this.roomId}`;
    document.getElementById('roomCodeDisplay').textContent = this.roomId;
    document.getElementById('roomLinkInput').value = window.location.href.split('?')[0];
  }

  async loadCardSets() {
    try {
      const response = await fetch('/api/cardsets');
      const data = await response.json();
      if (data.success) {
        this.cardSets = data.cardSets;
        this.populateCardSetSelector();
      }
    } catch (error) {
      console.error('Failed to load card sets:', error);
    }
  }

  async loadTemplates() {
    try {
      const response = await fetch('/api/templates');
      const data = await response.json();
      if (data.success) {
        this.templates = data.templates;
        this.populateTemplateSelectors();
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
    }
  }

  initSocket() {
    this.socket = io({
      transports: ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true
    });

    // Connection events
    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.updateConnectionStatus('online', 'Connected');
      this.joinRoom();
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      this.updateConnectionStatus('offline', 'Disconnected');
      
      if (reason === 'io server disconnect') {
        // Server disconnected us, try to reconnect
        this.socket.connect();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.updateConnectionStatus('error', 'Connection Error');
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('Reconnected after', attemptNumber, 'attempts');
      this.updateConnectionStatus('online', 'Reconnected');
      this.joinRoom();
    });

    this.socket.on('reconnecting', (attemptNumber) => {
      console.log('Reconnecting attempt', attemptNumber);
      this.updateConnectionStatus('connecting', 'Reconnecting...');
    });

    // Room events
    this.socket.on('room-joined', (data) => {
      console.log('Successfully joined room:', data.room.id);
      this.room = data.room;
      this.updateRoomUI();
    });

    this.socket.on('participant-joined', (data) => {
      console.log('Participant joined:', data.participant.name);
      if (this.room) {
        this.room.participants.push(data.participant);
        this.updateParticipants();
        this.showToast(`${data.participant.name} joined the room`, 'info');
      }
    });

    this.socket.on('participant-left', (data) => {
      console.log('Participant left:', data.participantName);
      if (this.room) {
        this.room.participants = this.room.participants.filter(p => p.id !== data.participantId);
        this.updateParticipants();
        this.showToast(`${data.participantName} left the room`, 'info');
      }
    });

    this.socket.on('vote-cast', (data) => {
      if (this.room) {
        this.room.votes[data.participantId] = {
          card: data.card,
          confidence: data.confidence,
          timestamp: data.timestamp
        };
        this.updateParticipants();
        this.updateVotingStatus();
      }
    });

    this.socket.on('vote-cleared', (data) => {
      if (this.room) {
        delete this.room.votes[data.participantId];
        this.updateParticipants();
        this.updateVotingStatus();
      }
    });

    this.socket.on('cards-revealed', (data) => {
      if (this.room) {
        this.room.cardsRevealed = data.revealed;
        this.updateCardsRevealed();
        if (data.revealed) {
          this.showToast('Cards revealed!', 'success');
        } else {
          this.showToast('Cards hidden', 'info');
        }
      }
    });

    this.socket.on('votes-cleared', () => {
      if (this.room) {
        this.room.votes = {};
        this.room.cardsRevealed = false;
        this.selectedCard = null;
        this.updateRoomUI();
        this.showToast('All votes cleared', 'info');
      }
    });

    this.socket.on('story-updated', (data) => {
      if (this.room) {
        this.room.currentStory = data.story;
        this.updateStoryUI();
        this.showToast('Story updated', 'info');
      }
    });

    this.socket.on('timer-updated', (data) => {
      if (this.room) {
        this.room.timer = data.timer;
        this.updateTimerUI();
      }
    });

    this.socket.on('card-set-changed', (data) => {
      if (this.room) {
        this.room.cardSet = data.cardSet;
        this.room.customCards = data.customCards || [];
        this.updateVotingCards();
        this.showToast(`Card set changed to ${data.cardSet}`, 'info');
      }
    });

    this.socket.on('estimation-type-changed', (data) => {
      if (this.room) {
        this.room.currentStory.estimationType = data.estimationType;
        this.updateEstimationType();
        this.showToast(`Estimation type: ${data.estimationType}`, 'info');
      }
    });

    this.socket.on('story-completed', (data) => {
      if (this.room) {
        this.room.completedStories.push(data.story);
        this.room.stats = data.stats;
        this.updateCompletedStories();
        this.showToast(`Story completed: ${data.story.estimate} points`, 'success');
      }
    });

    this.socket.on('error', (data) => {
      console.error('Socket error:', data.message);
      this.showToast(data.message, 'error');
    });
  }

  joinRoom() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('join-room', {
        roomId: this.roomId,
        userName: this.userName,
        userRole: this.userRole,
        teamKey: this.teamKey
      });
    }
  }

  setupEventListeners() {
    // Story title editing
    const storyTitle = document.getElementById('storyTitle');
    storyTitle.addEventListener('blur', () => {
      this.updateStoryField('title', storyTitle.textContent.trim());
    });

    storyTitle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        storyTitle.blur();
      }
    });

    // Confidence selector
    document.querySelectorAll('.confidence-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.confidence-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedConfidence = btn.dataset.confidence;
        
        // Re-cast vote if already voted
        if (this.selectedCard) {
          this.castVote(this.selectedCard, this.selectedConfidence);
        }
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Only handle shortcuts if not in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.toggleRevealCards();
          break;
        case 'c':
        case 'C':
          this.clearVotes();
          break;
        case 'r':
        case 'R':
          this.clearVotes();
          break;
        case 's':
        case 'S':
          this.showStoryModal();
          break;
        case 't':
        case 'T':
          this.toggleTimer();
          break;
      }

      // Number keys for voting
      if (e.key >= '1' && e.key <= '9') {
        const cardIndex = parseInt(e.key) - 1;
        const cards = document.querySelectorAll('.voting-card');
        if (cards[cardIndex]) {
          cards[cardIndex].click();
        }
      }
    });

    // Auto-save timer
    setInterval(() => {
      this.autoSave();
    }, 30000); // Auto-save every 30 seconds
  }

  setupConnectionMonitoring() {
    setInterval(() => {
      if (this.socket && !this.socket.connected) {
        this.updateConnectionStatus('offline', 'Disconnected');
      }
    }, 5000);
  }

  updateConnectionStatus(status, text) {
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    
    indicator.className = `status-indicator ${status}`;
    statusText.textContent = text;
  }

  updateRoomUI() {
    if (!this.room) return;
    
    document.getElementById('roomTitle').textContent = this.room.name;
    this.updateParticipants();
    this.updateStoryUI();
    this.updateVotingCards();
    this.updateEstimationType();
    this.updateTimerUI();
    this.updateCompletedStories();
    this.updateVotingStatus();
    this.updateCardsRevealed();
  }

  updateParticipants() {
    const container = document.getElementById('participantsList');
    const count = document.getElementById('participantCount');
    
    if (!this.room || !this.room.participants) return;
    
    count.textContent = `(${this.room.participants.length})`;
    
    container.innerHTML = this.room.participants.map(participant => {
      const hasVoted = this.room.votes[participant.id];
      const voteDisplay = this.room.cardsRevealed && hasVoted ? 
        `<span class="participant-vote">${hasVoted.card}</span>` : '';
      
      return `
        <div class="participant ${hasVoted ? 'voted' : ''}">
          <div class="participant-avatar">
            ${participant.name.charAt(0).toUpperCase()}
          </div>
          <div class="participant-info">
            <div class="participant-name">
              ${participant.name}
              ${participant.name === this.userName ? ' (You)' : ''}
            </div>
            <div class="participant-role">${participant.role}</div>
          </div>
          ${voteDisplay}
          <div class="vote-status ${hasVoted ? 'voted' : ''}"></div>
        </div>
      `;
    }).join('');
  }

  updateStoryUI() {
    if (!this.room || !this.room.currentStory) return;
    
    const story = this.room.currentStory;
    
    // Update title
    const titleEl = document.getElementById('storyTitle');
    titleEl.textContent = story.title || 'Click to add story title...';
    
    // Update description
    const descEl = document.getElementById('storyDescription');
    if (story.description) {
      descEl.innerHTML = `<p>${story.description.replace(/\n/g, '<br>')}</p>`;
    } else {
      descEl.innerHTML = '<p class="placeholder-text">Add a story description to help your team understand what needs to be estimated.</p>';
    }
    
    // Update links
    this.updateStoryLinks();
    
    // Update acceptance criteria
    this.updateAcceptanceCriteria();
  }

  updateStoryLinks() {
    const linksContainer = document.getElementById('storyLinks');
    const story = this.room?.currentStory;
    
    if (!story || !story.links || story.links.length === 0) {
      linksContainer.classList.add('hidden');
      return;
    }
    
    linksContainer.classList.remove('hidden');
    linksContainer.innerHTML = `
      <h4>Related Links</h4>
      <div class="links-list">
        ${story.links.map(link => `
          <a href="${link.url}" target="_blank" class="story-link">
            🔗 ${link.label || link.url}
          </a>
        `).join('')}
      </div>
    `;
  }

  updateAcceptanceCriteria() {
    const criteriaContainer = document.getElementById('acceptanceCriteria');
    const story = this.room?.currentStory;
    
    if (!story || !story.acceptanceCriteria || story.acceptanceCriteria.length === 0) {
      criteriaContainer.classList.add('hidden');
      return;
    }
    
    criteriaContainer.classList.remove('hidden');
    criteriaContainer.innerHTML = `
      <h4>Acceptance Criteria</h4>
      <ul class="criteria-list">
        ${story.acceptanceCriteria.map(criterion => `
          <li class="criteria-item ${criterion.completed ? 'completed' : ''}">
            <span class="criteria-checkbox ${criterion.completed ? 'checked' : ''}"></span>
            <span class="criteria-text">${criterion.text}</span>
          </li>
        `).join('')}
      </ul>
    `;
  }

  updateVotingCards() {
    const container = document.getElementById('votingCards');
    const cardSetSelect = document.getElementById('cardSetSelect');
    
    if (!this.room) return;
    
    let cards = [];
    
    if (this.room.cardSet === 'custom' && this.room.customCards.length > 0) {
      cards = this.room.customCards.map(card => ({
        display: card.display,
        value: card.value
      }));
    } else if (this.cardSets[this.room.cardSet]) {
      cards = this.cardSets[this.room.cardSet].cards.map(card => ({
        display: card,
        value: card
      }));
    }
    
    cardSetSelect.value = this.room.cardSet;
    
    container.innerHTML = cards.map(card => `
      <div class="voting-card ${this.selectedCard === card.value ? 'selected' : ''}" 
           data-value="${card.value}" 
           onclick="selectCard('${card.value}')">
        ${card.display}
      </div>
    `).join('');
  }

  updateEstimationType() {
    const btn = document.getElementById('estimationTypeBtn');
    const subtitle = document.getElementById('votingSubtitle');
    
    if (!this.room || !this.room.currentStory) return;
    
    const type = this.room.currentStory.estimationType || 'complexity';
    const typeNames = {
      complexity: '📊 Complexity',
      effort: '💪 Effort',
      risk: '⚠️ Risk',
      unknowns: '❓ Unknowns'
    };
    
    btn.textContent = typeNames[type] || '📊 Complexity';
    subtitle.textContent = `Select a card that represents the ${type}`;
  }

  updateTimerUI() {
    const timer = this.room?.timer;
    const timerBtn = document.getElementById('timerBtn');
    const timerDisplay = document.getElementById('timerDisplay');
    const timerText = document.getElementById('timerText');
    const timerMinutes = document.getElementById('timerMinutes');
    
    if (!timer) return;
    
    if (timer.active) {
      timerBtn.textContent = 'Stop';
      timerBtn.classList.add('active');
      timerDisplay.classList.remove('hidden');
      timerMinutes.disabled = true;
      
      // Start local countdown
      this.startLocalTimer(timer.remaining);
    } else {
      timerBtn.textContent = 'Start';
      timerBtn.classList.remove('active');
      timerDisplay.classList.add('hidden');
      timerMinutes.disabled = false;
      
      // Stop local countdown
      this.stopLocalTimer();
    }
  }

  startLocalTimer(remaining) {
    this.stopLocalTimer();
    
    let timeLeft = remaining;
    const timerText = document.getElementById('timerText');
    
    this.timerInterval = setInterval(() => {
      if (timeLeft > 0) {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        timerText.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      } else {
        this.stopLocalTimer();
        this.showToast('Time\'s up!', 'warning');
      }
    }, 1000);
  }

  stopLocalTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateCompletedStories() {
    const container = document.getElementById('completedStories');
    const count = document.getElementById('storyCount');
    
    if (!this.room || !this.room.completedStories) return;
    
    count.textContent = `(${this.room.completedStories.length})`;
    
    if (this.room.completedStories.length === 0) {
      container.innerHTML = '<p class="empty-state">No completed stories yet</p>';
      return;
    }
    
    container.innerHTML = this.room.completedStories.slice(-5).reverse().map(story => `
      <div class="completed-story">
        <div class="story-title">${story.title}</div>
        <div class="story-estimate">${story.estimate} pts</div>
        <div class="story-meta">
          ${story.consensus ? '✅ Consensus' : '⚠️ No consensus'} • 
          ${story.rounds} round${story.rounds !== 1 ? 's' : ''}
        </div>
      </div>
    `).join('');
  }

  updateVotingStatus() {
    if (!this.room) return;
    
    const totalParticipants = this.room.participants.filter(p => p.role === 'voter').length;
    const totalVotes = Object.keys(this.room.votes).length;
    
    // Update participants list with vote indicators
    this.updateParticipants();
  }

  updateCardsRevealed() {
    const resultsSection = document.getElementById('resultsSection');
    const revealBtn = document.getElementById('revealBtn');
    
    if (!this.room) return;
    
    if (this.room.cardsRevealed) {
      resultsSection.classList.remove('hidden');
      revealBtn.textContent = 'Hide Cards';
      this.updateResults();
    } else {
      resultsSection.classList.add('hidden');
      revealBtn.textContent = 'Reveal Cards';
    }
  }

  updateResults() {
    const resultsGrid = document.getElementById('resultsGrid');
    const resultsSummary = document.getElementById('resultsSummary');
    
    if (!this.room || !this.room.cardsRevealed) return;
    
    const votes = Object.entries(this.room.votes);
    const participants = this.room.participants;
    
    // Generate results grid
    resultsGrid.innerHTML = votes.map(([participantId, vote]) => {
      const participant = participants.find(p => p.id === participantId);
      if (!participant) return '';
      
      return `
        <div class="result-card">
          <div class="result-name">${participant.name}</div>
          <div class="result-vote">${vote.card}</div>
          <div class="result-confidence">${vote.confidence} confidence</div>
        </div>
      `;
    }).join('');
    
    // Calculate summary
    const numericVotes = votes
      .map(([, vote]) => parseFloat(vote.card))
      .filter(val => !isNaN(val));
    
    if (numericVotes.length > 0) {
      const average = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
      const min = Math.min(...numericVotes);
      const max = Math.max(...numericVotes);
      const consensus = min === max;
      
      resultsSummary.innerHTML = `
        <div class="summary-stat">
          <span class="stat-label">Average:</span>
          <span class="stat-value">${average.toFixed(1)}</span>
        </div>
        <div class="summary-stat">
          <span class="stat-label">Range:</span>
          <span class="stat-value">${min} - ${max}</span>
        </div>
        <div class="summary-stat">
          <span class="stat-label">Consensus:</span>
          <span class="stat-value ${consensus ? 'consensus' : 'no-consensus'}">
            ${consensus ? 'Yes' : 'No'}
          </span>
        </div>
      `;
    }
  }

  // Action methods
  selectCard(cardValue) {
    this.selectedCard = cardValue;
    this.updateVotingCards();
    this.castVote(cardValue, this.selectedConfidence);
  }

  castVote(card, confidence) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('cast-vote', {
        roomId: this.roomId,
        card: card,
        confidence: confidence
      });
    }
  }

  toggleRevealCards() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('toggle-reveal-cards', {
        roomId: this.roomId
      });
    }
  }

  clearVotes() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('clear-votes', {
        roomId: this.roomId
      });
    }
  }

  toggleTimer() {
    const minutes = parseInt(document.getElementById('timerMinutes').value) || 5;
    
    if (this.socket && this.socket.connected) {
      this.socket.emit('toggle-timer', {
        roomId: this.roomId,
        duration: minutes * 60
      });
    }
  }

  toggleEstimationType() {
    const types = ['complexity', 'effort', 'risk', 'unknowns'];
    const current = this.room?.currentStory?.estimationType || 'complexity';
    const currentIndex = types.indexOf(current);
    const nextType = types[(currentIndex + 1) % types.length];
    
    if (this.socket && this.socket.connected) {
      this.socket.emit('change-estimation-type', {
        roomId: this.roomId,
        estimationType: nextType
      });
    }
  }

  changeCardSet() {
    const select = document.getElementById('cardSetSelect');
    const cardSet = select.value;
    
    if (cardSet === 'custom') {
      this.showCustomCardsModal();
      return;
    }
    
    if (this.socket && this.socket.connected) {
      this.socket.emit('change-card-set', {
        roomId: this.roomId,
        cardSet: cardSet
      });
    }
  }

  updateStoryField(field, value) {
    if (!this.room || !value) return;
    
    if (this.socket && this.socket.connected) {
      this.socket.emit('update-story', {
        roomId: this.roomId,
        updates: { [field]: value }
      });
    }
  }

  completeStory() {
    if (!this.room || !this.room.cardsRevealed) {
      this.showToast('Please reveal cards before completing the story', 'warning');
      return;
    }
    
    const votes = Object.values(this.room.votes);
    if (votes.length === 0) {
      this.showToast('No votes to complete', 'warning');
      return;
    }
    
    // Calculate consensus and estimate
    const numericVotes = votes
      .map(vote => parseFloat(vote.card))
      .filter(val => !isNaN(val));
    
    let estimate = '?';
    let consensus = false;
    
    if (numericVotes.length > 0) {
      const average = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
      estimate = Math.round(average).toString();
      consensus = Math.min(...numericVotes) === Math.max(...numericVotes);
    }
    
    if (this.socket && this.socket.connected) {
      this.socket.emit('complete-story', {
        roomId: this.roomId,
        estimate: estimate,
        consensus: consensus
      });
    }
  }

  exportSession() {
    if (!this.room) return;
    
    const data = {
      roomName: this.room.name,
      roomId: this.room.id,
      exportDate: new Date().toISOString(),
      participants: this.room.participants.map(p => ({ name: p.name, role: p.role })),
      completedStories: this.room.completedStories,
      stats: this.room.stats
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scrum-poker-session-${this.room.id}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    this.showToast('Session exported!', 'success');
  }

  // Modal and UI helpers
  populateCardSetSelector() {
    const select = document.getElementById('cardSetSelect');
    select.innerHTML = Object.entries(this.cardSets).map(([key, cardSet]) => 
      `<option value="${key}">${cardSet.name}</option>`
    ).join('') + '<option value="custom">Custom</option>';
  }

  populateTemplateSelectors() {
    const container = document.getElementById('templateSelector');
    const grid = document.getElementById('templatesGrid');
    
    const templateHTML = Object.entries(this.templates).map(([key, template]) => `
      <div class="template-card" data-template="${key}" onclick="selectTemplate('${key}')">
        <div class="template-title">
          <span class="template-icon">${template.icon}</span>
          <span>${template.name}</span>
        </div>
        <div class="template-preview">${template.template}</div>
      </div>
    `).join('');
    
    if (container) container.innerHTML = templateHTML;
    if (grid) grid.innerHTML = templateHTML;
  }

  showCustomCardsModal() {
    const modal = document.getElementById('customCardsModal');
    const section = document.getElementById('customCardsSection');
    
    // Populate with existing custom cards if any
    const customCards = this.room?.customCards || [];
    
    section.innerHTML = customCards.map((card, index) => `
      <div class="custom-card-item" data-index="${index}">
        <input type="text" class="form-input card-display" placeholder="Display (e.g., S)" value="${card.display}">
        <input type="number" class="form-input card-value" placeholder="Value (e.g., 2)" value="${card.value || ''}">
        <input type="color" class="form-input card-color" value="${card.color || '#f093fb'}">
        <button type="button" class="remove-card-btn" onclick="removeCustomCard(${index})">×</button>
      </div>
    `).join('');
    
    // Add a few empty cards if none exist
    if (customCards.length === 0) {
      for (let i = 0; i < 3; i++) {
        this.addCustomCardToModal();
      }
    }
    
    modal.classList.remove('hidden');
  }

  addCustomCardToModal() {
    const section = document.getElementById('customCardsSection');
    const index = section.children.length;
    
    const cardItem = document.createElement('div');
    cardItem.className = 'custom-card-item';
    cardItem.dataset.index = index;
    cardItem.innerHTML = `
      <input type="text" class="form-input card-display" placeholder="Display (e.g., S)">
      <input type="number" class="form-input card-value" placeholder="Value (e.g., 2)">
      <input type="color" class="form-input card-color" value="#f093fb">
      <button type="button" class="remove-card-btn" onclick="removeCustomCard(${index})">×</button>
    `;
    
    section.appendChild(cardItem);
  }

  removeCustomCardFromModal(index) {
    const section = document.getElementById('customCardsSection');
    const items = section.querySelectorAll('.custom-card-item');
    if (items[index]) {
      items[index].remove();
    }
  }

  saveCustomCards() {
    const section = document.getElementById('customCardsSection');
    const items = section.querySelectorAll('.custom-card-item');
    const customCards = [];
    
    items.forEach(item => {
      const display = item.querySelector('.card-display').value.trim();
      const value = item.querySelector('.card-value').value.trim();
      const color = item.querySelector('.card-color').value;
      
      if (display) {
        customCards.push({
          display: display,
          value: value || display,
          color: color
        });
      }
    });
    
    if (customCards.length === 0) {
      this.showToast('Please add at least one card', 'warning');
      return;
    }
    
    if (this.socket && this.socket.connected) {
      this.socket.emit('change-card-set', {
        roomId: this.roomId,
        cardSet: 'custom',
        customCards: customCards
      });
    }
    
    closeModal('customCardsModal');
  }

  showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    
    toast.className = `toast ${type}`;
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 5000);
  }

  autoSave() {
    if (this.room) {
      localStorage.setItem('scrumPoker_roomBackup', JSON.stringify({
        roomId: this.roomId,
        userName: this.userName,
        userRole: this.userRole,
        selectedCard: this.selectedCard,
        selectedConfidence: this.selectedConfidence,
        timestamp: Date.now()
      }));
    }
  }

  // Story management helpers
  loadStoryIntoModal() {
    if (!this.room?.currentStory) return;
    
    const story = this.room.currentStory;
    
    document.getElementById('modalStoryTitle').value = story.title || '';
    document.getElementById('modalStoryDescription').value = story.description || '';
    
    // Load links
    const linksSection = document.getElementById('linksSection');
    linksSection.innerHTML = '';
    
    if (story.links && story.links.length > 0) {
      story.links.forEach(link => {
        this.addLinkToModal(link.label, link.url);
      });
    } else {
      this.addLinkToModal();
    }
    
    // Load acceptance criteria
    const criteriaSection = document.getElementById('criteriaSection');
    criteriaSection.innerHTML = '';
    
    if (story.acceptanceCriteria && story.acceptanceCriteria.length > 0) {
      story.acceptanceCriteria.forEach(criterion => {
        this.addCriteriaToModal(criterion.text, criterion.completed);
      });
    } else {
      this.addCriteriaToModal();
    }
  }

  addLinkToModal(label = '', url = '') {
    const linksSection = document.getElementById('linksSection');
    const linkItem = document.createElement('div');
    linkItem.className = 'link-item';
    linkItem.innerHTML = `
      <input type="text" class="form-input link-label" placeholder="Label" value="${label}">
      <input type="url" class="form-input link-url" placeholder="https://" value="${url}">
      <button type="button" class="remove-link-btn" onclick="removeLink(this)">×</button>
    `;
    
    linksSection.appendChild(linkItem);
  }

  addCriteriaToModal(text = '', completed = false) {
    const criteriaSection = document.getElementById('criteriaSection');
    const criteriaItem = document.createElement('div');
    criteriaItem.className = 'criteria-item';
    criteriaItem.innerHTML = `
      <input type="checkbox" class="criteria-checkbox" ${completed ? 'checked' : ''}>
      <input type="text" class="criteria-text" placeholder="Add acceptance criterion..." value="${text}">
      <button type="button" class="remove-criteria-btn" onclick="removeCriteria(this)">×</button>
    `;
    
    criteriaSection.appendChild(criteriaItem);
  }

  saveStoryFromModal() {
    const title = document.getElementById('modalStoryTitle').value.trim();
    const description = document.getElementById('modalStoryDescription').value.trim();
    
    // Collect links
    const linkItems = document.querySelectorAll('#linksSection .link-item');
    const links = Array.from(linkItems).map(item => {
      const label = item.querySelector('.link-label').value.trim();
      const url = item.querySelector('.link-url').value.trim();
      return { label, url };
    }).filter(link => link.url);
    
    // Collect acceptance criteria
    const criteriaItems = document.querySelectorAll('#criteriaSection .criteria-item');
    const acceptanceCriteria = Array.from(criteriaItems).map(item => {
      const text = item.querySelector('.criteria-text').value.trim();
      const completed = item.querySelector('.criteria-checkbox').checked;
      return { text, completed };
    }).filter(criterion => criterion.text);
    
    if (this.socket && this.socket.connected) {
      this.socket.emit('update-story', {
        roomId: this.roomId,
        updates: {
          title: title,
          description: description,
          links: links,
          acceptanceCriteria: acceptanceCriteria
        }
      });
    }
    
    closeModal('storyModal');
  }
}

// Additional global functions for HTML onclick handlers
function addCustomCard() {
  window.roomApp.addCustomCardToModal();
}

function removeCustomCard(index) {
  window.roomApp.removeCustomCardFromModal(index);
}

function saveCustomCards() {
  window.roomApp.saveCustomCards();
}

function addLink() {
  window.roomApp.addLinkToModal();
}

function removeLink(button) {
  button.parentElement.remove();
}

function addCriteria() {
  window.roomApp.addCriteriaToModal();
}

function removeCriteria(button) {
  button.parentElement.remove();
}

function saveStory() {
  window.roomApp.saveStoryFromModal();
}

// Enhanced modal management
function showStoryModal() {
  window.roomApp.loadStoryIntoModal();
  document.getElementById('storyModal').classList.remove('hidden');
  // Focus on title input
  setTimeout(() => {
    document.getElementById('modalStoryTitle').focus();
  }, 100);
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.roomApp = new ScrumPokerRoom();
  
  // Setup modal background click to close
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  });
  
  // Setup escape key to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal:not(.hidden)');
      if (activeModal) {
        activeModal.classList.add('hidden');
      }
    }
  });
});

// Handle browser back/forward
window.addEventListener('popstate', () => {
  if (window.roomApp && window.roomApp.socket) {
    window.roomApp.socket.disconnect();
  }
});

// Handle page unload
window.addEventListener('beforeunload', () => {
  if (window.roomApp && window.roomApp.socket) {
    window.roomApp.socket.disconnect();
  }
});

// Handle visibility change (tab switching)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && window.roomApp && window.roomApp.socket) {
    // Reconnect if needed when tab becomes visible
    if (!window.roomApp.socket.connected) {
      window.roomApp.socket.connect();
    }
  }
});