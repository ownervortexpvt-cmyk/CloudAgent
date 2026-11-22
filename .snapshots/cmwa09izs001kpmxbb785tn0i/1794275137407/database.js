// Simple JSON-based database for Rakib's portfolio
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'portfolio-data.json');

// Initialize database file if it doesn't exist
if (!fs.existsSync(DB_FILE)) {
    const initialData = {
        gallery: [
            {
                id: 1,
                title: "Urban Landscape",
                description: "City architecture at sunset",
                image: "https://picsum.photos/seed/photo1/400/300.jpg",
                category: "landscape",
                date: "2024-01-15",
                featured: true
            },
            {
                id: 2,
                title: "Portrait Session",
                description: "Professional headshot",
                image: "https://picsum.photos/seed/photo2/400/300.jpg",
                category: "portrait",
                date: "2024-01-20",
                featured: true
            },
            {
                id: 3,
                title: "Nature Study",
                description: "Wildlife photography",
                image: "https://picsum.photos/seed/photo3/400/300.jpg",
                category: "nature",
                date: "2024-02-01",
                featured: false
            },
            {
                id: 4,
                title: "Wedding Moments",
                description: "Special day memories",
                image: "https://picsum.photos/seed/photo4/400/300.jpg",
                category: "wedding",
                date: "2024-02-10",
                featured: true
            },
            {
                id: 5,
                title: "Street Photography",
                description: "Urban life captured",
                image: "https://picsum.photos/seed/photo5/400/300.jpg",
                category: "street",
                date: "2024-02-15",
                featured: false
            },
            {
                id: 6,
                title: "Product Shoot",
                description: "Commercial photography",
                image: "https://picsum.photos/seed/photo6/400/300.jpg",
                category: "commercial",
                date: "2024-02-20",
                featured: true
            }
        ],
        contacts: [
            {
                id: 1,
                name: "John Doe",
                email: "john@example.com",
                message: "I'd love to book a photoshoot!",
                date: "2024-02-25",
                status: "new"
            }
        ],
        categories: [
            { id: 1, name: "portrait", description: "Portrait photography" },
            { id: 2, name: "landscape", description: "Landscape photography" },
            { id: 3, name: "wedding", description: "Wedding photography" },
            { id: 4, name: "street", description: "Street photography" },
            { id: 5, name: "nature", description: "Nature photography" },
            { id: 6, name: "commercial", description: "Commercial photography" }
        ],
        stats: {
            totalPhotos: 6,
            totalContacts: 1,
            featuredPhotos: 3,
            categories: 6
        }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
}

// Database operations
class PortfolioDB {
    constructor() {
        this.data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }

    save() {
        fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2));
    }

    // Gallery operations
    getGallery() {
        return this.data.gallery;
    }

    getGalleryItem(id) {
        return this.data.gallery.find(item => item.id === parseInt(id));
    }

    addGalleryItem(item) {
        const newId = Math.max(...this.data.gallery.map(i => i.id), 0) + 1;
        const newItem = { id: newId, ...item };
        this.data.gallery.push(newItem);
        this.data.stats.totalPhotos++;
        if (newItem.featured) {
            this.data.stats.featuredPhotos++;
        }
        this.save();
        return newItem;
    }

    updateGalleryItem(id, updates) {
        const index = this.data.gallery.findIndex(item => item.id === parseInt(id));
        if (index !== -1) {
            this.data.gallery[index] = { ...this.data.gallery[index], ...updates };
            this.save();
            return this.data.gallery[index];
        }
        return null;
    }

    deleteGalleryItem(id) {
        const index = this.data.gallery.findIndex(item => item.id === parseInt(id));
        if (index !== -1) {
            const deleted = this.data.gallery.splice(index, 1)[0];
            this.data.stats.totalPhotos--;
            if (deleted.featured) {
                this.data.stats.featuredPhotos--;
            }
            this.save();
            return deleted;
        }
        return null;
    }

    // Contact operations
    getContacts() {
        return this.data.contacts;
    }

    getContact(id) {
        return this.data.contacts.find(contact => contact.id === parseInt(id));
    }

    addContact(contact) {
        const newId = Math.max(...this.data.contacts.map(c => c.id), 0) + 1;
        const newContact = { id: newId, ...contact };
        this.data.contacts.push(newContact);
        this.data.stats.totalContacts++;
        this.save();
        return newContact;
    }

    updateContact(id, updates) {
        const index = this.data.contacts.findIndex(contact => contact.id === parseInt(id));
        if (index !== -1) {
            this.data.contacts[index] = { ...this.data.contacts[index], ...updates };
            this.save();
            return this.data.contacts[index];
        }
        return null;
    }

    deleteContact(id) {
        const index = this.data.contacts.findIndex(contact => contact.id === parseInt(id));
        if (index !== -1) {
            const deleted = this.data.contacts.splice(index, 1)[0];
            this.data.stats.totalContacts--;
            this.save();
            return deleted;
        }
        return null;
    }

    // Category operations
    getCategories() {
        return this.data.categories;
    }

    // Stats operations
    getStats() {
        return this.data.stats;
    }
}

module.exports = PortfolioDB;