const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const { v7: uuidv7 } = require('uuid');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? 
      ['https://scrumpoker.app', 'https://www.scrumpoker.app'] : 
      ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST']
  }
});

// Production middleware
const isDevelopment = process.env.NODE_ENV !== 'production';

if (isDevelopment) {
  // Development: Completely disable helmet security for easier debugging
  console.log('🔧 Development mode: Security headers disabled');
  // Don't use helmet at all in development
} else {
  // Production: Strict security
  console.log('🔒 Production mode: Security headers enabled');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"]
      }
    }
  }));
}

app.use(compression());
app.use(cors({
  origin: isDevelopment ? true : ['https://scrumpoker.app', 'https://www.scrumpoker.app']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// In-memory storage (resets on server restart - this is intentional)
const rooms = new Map();
const userSessions = new Map();

// Team defaults storage (persistent via files)
let teamDefaults = {};

// Load team defaults on startup
async function loadTeamDefaults() {
  try {
    const data = await fs.readFile('./teamDefaults.json', 'utf8');
    teamDefaults = JSON.parse(data);
    console.log('Loaded team defaults for', Object.keys(teamDefaults).length, 'teams');
  } catch (error) {
    console.log('No team defaults found, starting fresh');
    teamDefaults = {};
  }
}

// Save team defaults
async function saveTeamDefaults() {
  try {
    await fs.writeFile('./teamDefaults.json', JSON.stringify(teamDefaults, null, 2));
    console.log('Team defaults saved');
  } catch (error) {
    console.error('Failed to save team defaults:', error);
  }
}

// Card sets
const defaultCardSets = {
  fibonacci: {
    name: 'Fibonacci',
    cards: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?'],
    description: 'Standard Fibonacci sequence for story points'
  },
  tshirt: {
    name: 'T-Shirt Sizes',
    cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?'],
    description: 'T-shirt sizing for relative estimation'
  },
  powers: {
    name: 'Powers of 2',
    cards: ['1', '2', '4', '8', '16', '32', '64', '?'],
    description: 'Powers of 2 for technical complexity'
  },
  linear: {
    name: 'Linear',
    cards: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '?'],
    description: 'Linear scale for simple estimation'
  }
};

// Story templates
const defaultTemplates = {
  'user-story': {
    name: 'User Story',
    template: 'As a [user] I want [goal] so that [benefit]',
    icon: '👤'
  },
  'bug': {
    name: 'Bug Report',
    template: 'When [action] then [unexpected] but should [expected]',
    icon: '🐛'
  },
  'tech-debt': {
    name: 'Technical Task',
    template: 'Current: [problem]\nProposed: [solution]\nBenefit: [benefit]',
    icon: '⚙️'
  },
  'spike': {
    name: 'Research Spike',
    template: 'Investigation needed: [question]\nSuccess criteria: [criteria]',
    icon: '🔍'
  }
};

// Create a new room with defaults
function createRoom(roomId, teamKey = null) {
  const defaults = teamKey && teamDefaults[teamKey] ? teamDefaults[teamKey] : {};
  
  const room = {
    id: roomId,
    name: defaults.name || `Room ${roomId.slice(-6)}`,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    
    // Participants (no admin roles - trust-based)
    participants: [],
    
    // Current story being estimated
    currentStory: {
      title: '',
      description: '',
      template: 'user-story',
      links: [],
      acceptanceCriteria: [],
      estimationType: 'complexity' // complexity, effort, risk, unknowns
    },
    
    // Voting state
    votes: {},
    cardsRevealed: false,
    
    // Discussion timer
    timer: {
      active: false,
      remaining: 0,
      duration: 300 // 5 minutes default
    },
    
    // Card configuration
    cardSet: defaults.cardSet || 'fibonacci',
    customCards: defaults.customCards || [],
    cardHelp: defaults.cardHelp || {},
    
    // Templates and settings
    templates: { ...defaultTemplates, ...(defaults.templates || {}) },
    
    // Completed stories for export
    completedStories: [],
    
    // Session stats
    stats: {
      totalStories: 0,
      totalRounds: 0,
      averageRounds: 0,
      consensusRate: 0
    }
  };
  
  rooms.set(roomId, room);
  return room;
}

// Get or create room
function getRoom(roomId, teamKey = null) {
  if (rooms.has(roomId)) {
    const room = rooms.get(roomId);
    room.lastActivity = Date.now();
    return room;
  }
  
  return createRoom(roomId, teamKey);
}

// Clean up empty rooms (run every hour)
function cleanupRooms() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [roomId, room] of rooms.entries()) {
    if (room.participants.length === 0 && (now - room.lastActivity) > maxAge) {
      rooms.delete(roomId);
      console.log(`Cleaned up empty room: ${roomId}`);
    }
  }
}

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    rooms: rooms.size,
    version: '1.0.0'
  });
});

app.get('/api/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const { team } = req.query;
  
  try {
    const room = getRoom(roomId, team);
    res.json({
      success: true,
      room: {
        ...room,
        participants: room.participants.map(p => ({
          ...p,
          // Don't expose socket IDs to client
          socketId: undefined
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/cardsets', (req, res) => {
  res.json({ success: true, cardSets: defaultCardSets });
});

app.get('/api/templates', (req, res) => {
  res.json({ success: true, templates: defaultTemplates });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-room', async (data) => {
    try {
      const { roomId, userName, userRole = 'voter', teamKey } = data;
      
      if (!roomId || !userName) {
        socket.emit('error', { message: 'Room ID and username are required' });
        return;
      }
      
      // Get or create room
      const room = getRoom(roomId, teamKey);
      
      // Remove user from any existing rooms
      socket.rooms.forEach(room => {
        if (room !== socket.id) {
          socket.leave(room);
        }
      });
      
      // Join the room
      socket.join(roomId);
      
      // Add or update participant
      const existingParticipant = room.participants.find(p => p.name === userName);
      if (existingParticipant) {
        existingParticipant.socketId = socket.id;
        existingParticipant.role = userRole;
        existingParticipant.lastSeen = Date.now();
      } else {
        room.participants.push({
          id: socket.id,
          socketId: socket.id,
          name: userName,
          role: userRole, // voter, observer
          joinTime: Date.now(),
          lastSeen: Date.now()
        });
      }
      
      // Store user session
      userSessions.set(socket.id, { roomId, userName, userRole });
      
      // Send room state to user
      socket.emit('room-joined', {
        room: {
          ...room,
          participants: room.participants.map(p => ({
            ...p,
            socketId: undefined
          }))
        }
      });
      
      // Notify other participants
      socket.to(roomId).emit('participant-joined', {
        participant: {
          id: socket.id,
          name: userName,
          role: userRole,
          joinTime: Date.now()
        }
      });
      
      console.log(`${userName} joined room ${roomId} as ${userRole}`);
      
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });
  
  // Voting events
  socket.on('cast-vote', (data) => {
    try {
      const { roomId, card, confidence } = data;
      const session = userSessions.get(socket.id);
      
      if (!session || session.roomId !== roomId) {
        socket.emit('error', { message: 'Invalid session' });
        return;
      }
      
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      
      // Store vote
      room.votes[socket.id] = {
        card: card,
        confidence: confidence,
        timestamp: Date.now()
      };
      
      room.lastActivity = Date.now();
      
      // Notify all participants
      io.to(roomId).emit('vote-cast', {
        participantId: socket.id,
        card: card,
        confidence: confidence,
        timestamp: Date.now()
      });
      
      console.log(`${session.userName} voted ${card} with ${confidence} confidence in room ${roomId}`);
      
    } catch (error) {
      console.error('Error casting vote:', error);
      socket.emit('error', { message: 'Failed to cast vote' });
    }
  });
  
  socket.on('toggle-reveal-cards', (data) => {
    try {
      const { roomId } = data;
      const session = userSessions.get(socket.id);
      
      if (!session || session.roomId !== roomId) {
        socket.emit('error', { message: 'Invalid session' });
        return;
      }
      
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      
      room.cardsRevealed = !room.cardsRevealed;
      room.lastActivity = Date.now();
      
      // Notify all participants
      io.to(roomId).emit('cards-revealed', {
        revealed: room.cardsRevealed,
        by: session.userName
      });
      
      console.log(`${session.userName} ${room.cardsRevealed ? 'revealed' : 'hid'} cards in room ${roomId}`);
      
    } catch (error) {
      console.error('Error toggling reveal cards:', error);
      socket.emit('error', { message: 'Failed to toggle card reveal' });
    }
  });
  
  socket.on('clear-votes', (data) => {
    try {
      const { roomId } = data;
      const session = userSessions.get(socket.id);
      
      if (!session || session.roomId !== roomId) {
        socket.emit('error', { message: 'Invalid session' });
        return;
      }
      
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      
      room.votes = {};
      room.cardsRevealed = false;
      room.lastActivity = Date.now();
      
      // Notify all participants
      io.to(roomId).emit('votes-cleared', {
        by: session.userName
      });
      
      console.log(`${session.userName} cleared votes in room ${roomId}`);
      
    } catch (error) {
      console.error('Error clearing votes:', error);
      socket.emit('error', { message: 'Failed to clear votes' });
    }
  });
  
  // Story management events
  socket.on('update-story', (data) => {
    try {
      const { roomId, updates } = data;
      const session = userSessions.get(socket.id);
      
      if (!session || session.roomId !== roomId) {
        socket.emit('error', { message: 'Invalid session' });
        return;
      }
      
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      
      // Update story fields
      Object.keys(updates).forEach(key => {
        if (updates[key] !== undefined) {
          room.currentStory[key] = updates[key];
        }
      });
      
      room.lastActivity = Date.now();
      
      // Notify all participants
      socket.to(roomId).emit('story-updated', {
        story: room.currentStory,
        by: session.userName
      });
      
      console.log(`${session.userName} updated story in room ${roomId}`);
      
    } catch (error) {
      console.error('Error updating story:', error);
      socket.emit('error', { message: 'Failed to update story' });
    }
  });
  
  socket.on('change-estimation-type', (data) => {
    try {
      const { roomId, estimationType } = data;
      const session = userSessions.get(socket.id);
      
      if (!session || session.roomId !== roomId) {
        socket.emit('error', { message: 'Invalid session' });
        return;
      }
      
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      
      room.currentStory.estimationType = estimationType;
      room.lastActivity = Date.now();
      
      // Notify all participants
      io.to(roomId).emit('estimation-type-changed', {
        estimationType: estimationType,
        by: session.userName
      });
      
      console.log(`${session.userName} changed estimation type to ${estimationType} in room ${roomId}`);
      
    } catch (error) {
      console.error('Error changing estimation type:', error);
      socket.emit('error', { message: 'Failed to change estimation type' });
    }
  });
  
  socket.on('change-card-set', (data) => {
    try {
      const { roomId, cardSet, customCards } = data;
      const session = userSessions.get(socket.id);
      
      if (!session || session.roomId !== roomId) {
        socket.emit('error', { message: 'Invalid session' });
        return;
      }
      
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      
      room.cardSet = cardSet;
      if (customCards) {
        room.customCards = customCards;
      }
      room.lastActivity = Date.now();
      
      // Clear existing votes when card set changes
      room.votes = {};
      room.cardsRevealed = false;
      
      // Notify all participants
      io.to(roomId).emit('card-set-changed', {
        cardSet: cardSet,
        customCards: room.customCards,
        by: session.userName
      });
      
      console.log(`${session.userName} changed card set to ${cardSet} in room ${roomId}`);
      
    } catch (error) {
      console.error('Error changing card set:', error);
      socket.emit('error', { message: 'Failed to change card set' });
    }
  });
  
  // Timer events
  socket.on('toggle-timer', (data) => {
    try {
      const { roomId, duration } = data;
      const session = userSessions.get(socket.id);
      
      if (!session || session.roomId !== roomId) {
        socket.emit('error', { message: 'Invalid session' });
        return;
      }
      
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      
      if (room.timer.active) {
        // Stop timer
        room.timer.active = false;
        room.timer.remaining = 0;
        
        if (room.timer.interval) {
          clearInterval(room.timer.interval);
          room.timer.interval = null;
        }
      } else {
        // Start timer
        room.timer.active = true;
        room.timer.duration = duration || 300; // 5 minutes default
        room.timer.remaining = room.timer.duration;
        
        // Start server-side countdown
        room.timer.interval = setInterval(() => {
          room.timer.remaining--;
          
          if (room.timer.remaining <= 0) {
            room.timer.active = false;
            clearInterval(room.timer.interval);
            room.timer.interval = null;
            
            // Notify time's up
            io.to(roomId).emit('timer-finished');
          }
          
          // Update clients every 30 seconds or when timer stops
          if (room.timer.remaining % 30 === 0 || room.timer.remaining <= 0) {
            io.to(roomId).emit('timer-updated', {
              timer: {
                active: room.timer.active,
                remaining: room.timer.remaining,
                duration: room.timer.duration
              }
            });
          }
        }, 1000);
      }
      
      room.lastActivity = Date.now();
      
      // Notify all participants
      io.to(roomId).emit('timer-updated', {
        timer: {
          active: room.timer.active,
          remaining: room.timer.remaining,
          duration: room.timer.duration
        },
        by: session.userName
      });
      
      console.log(`${session.userName} ${room.timer.active ? 'started' : 'stopped'} timer in room ${roomId}`);
      
    } catch (error) {
      console.error('Error toggling timer:', error);
      socket.emit('error', { message: 'Failed to toggle timer' });
    }
  });
  
  // Story completion
  socket.on('complete-story', (data) => {
    try {
      const { roomId, estimate, consensus } = data;
      const session = userSessions.get(socket.id);
      
      if (!session || session.roomId !== roomId) {
        socket.emit('error', { message: 'Invalid session' });
        return;
      }
      
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      
      // Create completed story record
      const completedStory = {
        title: room.currentStory.title || 'Untitled Story',
        description: room.currentStory.description || '',
        estimate: estimate,
        consensus: consensus,
        rounds: 1, // TODO: Track actual rounds
        participants: room.participants.length,
        votes: Object.keys(room.votes).length,
        timestamp: Date.now(),
        estimationType: room.currentStory.estimationType || 'complexity'
      };
      
      room.completedStories.push(completedStory);
      
      // Update stats
      room.stats.totalStories++;
      room.stats.totalRounds += completedStory.rounds;
      room.stats.averageRounds = room.stats.totalRounds / room.stats.totalStories;
      
      const consensusStories = room.completedStories.filter(s => s.consensus).length;
      room.stats.consensusRate = Math.round((consensusStories / room.stats.totalStories) * 100);
      
      // Reset for next story
      room.currentStory = {
        title: '',
        description: '',
        template: 'user-story',
        links: [],
        acceptanceCriteria: [],
        estimationType: room.currentStory.estimationType || 'complexity'
      };
      room.votes = {};
      room.cardsRevealed = false;
      
      // Stop timer if running
      if (room.timer.active) {
        room.timer.active = false;
        if (room.timer.interval) {
          clearInterval(room.timer.interval);
          room.timer.interval = null;
        }
      }
      
      room.lastActivity = Date.now();
      
      // Notify all participants
      io.to(roomId).emit('story-completed', {
        story: completedStory,
        stats: room.stats,
        by: session.userName
      });
      
      // Also send updated room state
      io.to(roomId).emit('story-updated', {
        story: room.currentStory
      });
      
      io.to(roomId).emit('votes-cleared', {
        by: session.userName
      });
      
      console.log(`${session.userName} completed story "${completedStory.title}" with ${estimate} points in room ${roomId}`);
      
    } catch (error) {
      console.error('Error completing story:', error);
      socket.emit('error', { message: 'Failed to complete story' });
    }
  });

  socket.on('disconnect', () => {
    const session = userSessions.get(socket.id);
    if (session) {
      const { roomId, userName } = session;
      const room = rooms.get(roomId);
      
      if (room) {
        // Remove participant
        room.participants = room.participants.filter(p => p.socketId !== socket.id);
        
        // Clean up any running timers if this was the last participant
        if (room.participants.length === 0 && room.timer.interval) {
          clearInterval(room.timer.interval);
          room.timer.interval = null;
          room.timer.active = false;
        }
        
        // Notify other participants
        socket.to(roomId).emit('participant-left', {
          participantId: socket.id,
          participantName: userName
        });
        
        console.log(`${userName} left room ${roomId}`);
      }
      
      userSessions.delete(socket.id);
    }
    
    console.log('User disconnected:', socket.id);
  });
});

// Serve the main app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Handle specific routes that should return HTML
app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all for SPA routing (but exclude API routes and file extensions)
app.get('*', (req, res, next) => {
  // Don't catch API routes or files with extensions
  if (req.path.startsWith('/api/') || req.path.includes('.')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3000;

async function startServer() {
  await loadTeamDefaults();
  
  server.listen(PORT, () => {
    console.log(`🚀 Scrum Poker server running on port ${PORT}`);
    console.log(`📱 Local: http://localhost:${PORT}`);
    
    // Setup cleanup interval
    setInterval(cleanupRooms, 60 * 60 * 1000); // Every hour
    
    // Auto-save team defaults every 5 minutes
    setInterval(saveTeamDefaults, 5 * 60 * 1000);
  });
}

startServer().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await saveTeamDefaults();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await saveTeamDefaults();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});