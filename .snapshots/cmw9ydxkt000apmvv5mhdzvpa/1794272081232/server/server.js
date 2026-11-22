const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const Database = require('../db/database');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const db = new Database();

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'connected'
  });
});

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// User Authentication Routes
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (db.findUserByUsername(username)) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const user = db.createUser({ username, password, role: 'user' });
    
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = db.findUserByUsername(username);
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Todo Routes
app.get('/api/todos', authenticateToken, (req, res) => {
  try {
    const todos = db.getTodos();
    res.json(todos);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/todos', authenticateToken, (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Todo text is required' });
    }

    const todo = db.createTodo({
      text: text.trim(),
      completed: false,
      userId: req.user.id
    });

    res.status(201).json(todo);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/todos/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { text, completed } = req.body;

    const existingTodo = db.getTodoById(id);
    if (!existingTodo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    // Check if user owns this todo or is admin
    if (existingTodo.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updates = {};
    if (text !== undefined) updates.text = text.trim();
    if (completed !== undefined) updates.completed = completed;

    const updatedTodo = db.updateTodo(id, updates);
    res.json(updatedTodo);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/todos/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;

    const existingTodo = db.getTodoById(id);
    if (!existingTodo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    // Check if user owns this todo or is admin
    if (existingTodo.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const deleted = db.deleteTodo(id);
    if (deleted) {
      res.json({ message: 'Todo deleted successfully' });
    } else {
      res.status(500).json({ error: 'Failed to delete todo' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/todos', authenticateToken, (req, res) => {
  try {
    const clearedCount = db.clearCompletedTodos();
    res.json({ message: `Cleared ${clearedCount} completed todos` });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin Routes
app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
  try {
    const stats = db.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = db.data.users.map(user => ({
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt
    }));
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/todos', authenticateToken, requireAdmin, (req, res) => {
  try {
    const todos = db.getTodos();
    res.json(todos);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
});

module.exports = app;