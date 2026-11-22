const express = require('express');
const path = require('path');
const PortfolioDB = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new PortfolioDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'rakib-portfolio')));
app.use(express.static(path.join(__dirname, 'admin')));

// API Routes

// Gallery API
app.get('/api/gallery', (req, res) => {
    try {
        const gallery = db.getGallery();
        res.json(gallery);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch gallery' });
    }
});

app.get('/api/gallery/:id', (req, res) => {
    try {
        const item = db.getGalleryItem(req.params.id);
        if (item) {
            res.json(item);
        } else {
            res.status(404).json({ error: 'Gallery item not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch gallery item' });
    }
});

app.post('/api/gallery', (req, res) => {
    try {
        const { title, description, image, category, featured = false } = req.body;
        if (!title || !description || !image) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const newItem = db.addGalleryItem({
            title,
            description,
            image,
            category,
            featured
        });
        
        res.status(201).json(newItem);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create gallery item' });
    }
});

app.put('/api/gallery/:id', (req, res) => {
    try {
        const updates = req.body;
        const updated = db.updateGalleryItem(req.params.id, updates);
        if (updated) {
            res.json(updated);
        } else {
            res.status(404).json({ error: 'Gallery item not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to update gallery item' });
    }
});

app.delete('/api/gallery/:id', (req, res) => {
    try {
        const deleted = db.deleteGalleryItem(req.params.id);
        if (deleted) {
            res.json(deleted);
        } else {
            res.status(404).json({ error: 'Gallery item not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete gallery item' });
    }
});

// Contact API
app.get('/api/contacts', (req, res) => {
    try {
        const contacts = db.getContacts();
        res.json(contacts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch contacts' });
    }
});

app.get('/api/contacts/:id', (req, res) => {
    try {
        const contact = db.getContact(req.params.id);
        if (contact) {
            res.json(contact);
        } else {
            res.status(404).json({ error: 'Contact not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch contact' });
    }
});

app.post('/api/contacts', (req, res) => {
    try {
        const { name, email, message } = req.body;
        if (!name || !email || !message) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const newContact = db.addContact({
            name,
            email,
            message,
            status: 'new'
        });
        
        res.status(201).json(newContact);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create contact' });
    }
});

app.put('/api/contacts/:id', (req, res) => {
    try {
        const updates = req.body;
        const updated = db.updateContact(req.params.id, updates);
        if (updated) {
            res.json(updated);
        } else {
            res.status(404).json({ error: 'Contact not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to update contact' });
    }
});

app.delete('/api/contacts/:id', (req, res) => {
    try {
        const deleted = db.deleteContact(req.params.id);
        if (deleted) {
            res.json(deleted);
        } else {
            res.status(404).json({ error: 'Contact not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete contact' });
    }
});

// Categories API
app.get('/api/categories', (req, res) => {
    try {
        const categories = db.getCategories();
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// Stats API
app.get('/api/stats', (req, res) => {
    try {
        const stats = db.getStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Admin login check
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.post('/api/admin/login', (req, res) => {
    try {
        const { password } = req.body;
        if (password === ADMIN_PASSWORD) {
            res.json({ success: true, message: 'Login successful' });
        } else {
            res.status(401).json({ success: false, message: 'Invalid password' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Serve admin app
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// Serve portfolio app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Portfolio server running on port ${PORT}`);
    console.log(`Portfolio app: http://localhost:${PORT}`);
    console.log(`Admin app: http://localhost:${PORT}/admin`);
});

module.exports = app;