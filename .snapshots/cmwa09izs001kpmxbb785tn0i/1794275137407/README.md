# Rakib's Portfolio Website

A beautiful dark-themed portfolio website for photographer Rakib with a complete admin panel and backend API.

## Features

### Main Portfolio Website
- **Hero Section**: Elegant introduction with parallax effect
- **Gallery Grid**: 6 placeholder images with hover effects
- **About Section**: Professional photographer bio with social links
- **Contact Form**: Functional contact form with validation
- **Dark Theme**: Modern, professional dark design
- **Responsive Design**: Works on all devices

### Admin Panel
- **Dashboard**: Real-time statistics and overview
- **Gallery Management**: Add, edit, and delete photos
- **Contact Management**: View and manage contact messages
- **Category Management**: Organize photos by categories
- **Role-based Access**: Secure admin login system

### Backend API
- **RESTful API**: Complete CRUD operations for all data
- **JSON Database**: Simple file-based persistence
- **Static File Serving**: Serves both portfolio and admin apps
- **Error Handling**: Comprehensive error handling

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Access the applications:
   - Portfolio: http://localhost:3000
   - Admin Panel: http://localhost:3000/admin

## API Endpoints

### Gallery
- `GET /api/gallery` - Get all gallery items
- `GET /api/gallery/:id` - Get specific gallery item
- `POST /api/gallery` - Create new gallery item
- `PUT /api/gallery/:id` - Update gallery item
- `DELETE /api/gallery/:id` - Delete gallery item

### Contacts
- `GET /api/contacts` - Get all contacts
- `GET /api/contacts/:id` - Get specific contact
- `POST /api/contacts` - Create new contact
- `PUT /api/contacts/:id` - Update contact
- `DELETE /api/contacts/:id` - Delete contact

### Categories
- `GET /api/categories` - Get all categories

### Stats
- `GET /api/stats` - Get portfolio statistics

### Admin
- `POST /api/admin/login` - Admin login

## Admin Login

Default admin password: `admin123`

## Database

The application uses a JSON file (`portfolio-data.json`) for persistence. The database includes:

- Gallery items with metadata
- Contact messages
- Categories
- Statistics

## Security

- Admin authentication with password protection
- Input validation on all API endpoints
- CORS protection for API requests
- Secure file serving

## Customization

### Environment Variables
- `PORT`: Server port (default: 3000)
- `ADMIN_PASSWORD`: Admin password (default: admin123)

### Styling
- CSS variables for easy theming
- Modern dark theme design
- Responsive grid layouts
- Smooth animations and transitions

## Files Structure

```
├── server.js          # Express server
├── database.js       # Database operations
├── package.json      # Dependencies
├── index.html        # Main portfolio website
├── admin/
│   └── index.html    # Admin dashboard
└── portfolio-data.json # Database file
```

## Development

The application is built with:
- **Backend**: Node.js + Express
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Database**: JSON file storage
- **Styling**: Modern CSS with custom properties

## License

MIT License - feel free to use this for your own portfolio!