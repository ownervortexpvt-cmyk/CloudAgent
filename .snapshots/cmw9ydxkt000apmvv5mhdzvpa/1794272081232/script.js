// Todo List App with Extended Features
class TodoApp {
    constructor() {
        this.todos = [];
        this.currentFilter = 'all';
        this.currentScreen = 'todoScreen';
        this.searchQuery = '';
        this.memberSince = new Date().toLocaleDateString();
        
        // API Configuration
        this.apiBaseUrl = 'https://jsonplaceholder.typicode.com';
        this.isOnline = navigator.onLine;
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadTodos();
        this.updateMemberSince();
        this.checkConnectivity();
    }

    bindEvents() {
        // Todo Screen Events
        document.getElementById('addBtn').addEventListener('click', () => this.addTodo());
        document.getElementById('todoInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTodo();
        });
        document.getElementById('clearAll').addEventListener('click', () => this.clearCompleted());

        // Filter Tabs
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setFilter(e.target.dataset.filter));
        });

        // Navigation Events
        document.getElementById('searchBtn').addEventListener('click', () => this.showScreen('searchScreen'));
        document.getElementById('profileBtn').addEventListener('click', () => this.showScreen('profileScreen'));
        document.getElementById('backFromSearch').addEventListener('click', () => this.showScreen('todoScreen'));
        document.getElementById('backFromProfile').addEventListener('click', () => this.showScreen('todoScreen'));

        // Search Events
        document.getElementById('searchInput').addEventListener('input', (e) => this.searchTodos(e.target.value));

        // Settings Events
        document.getElementById('notifications').addEventListener('change', (e) => this.saveSettings('notifications', e.target.checked));
        document.getElementById('darkMode').addEventListener('change', (e) => this.toggleDarkMode(e.target.checked));
        document.getElementById('autoClear').addEventListener('change', (e) => this.saveSettings('autoClear', e.target.checked));
        document.getElementById('exportData').addEventListener('click', () => this.exportData());
        document.getElementById('clearAllData').addEventListener('click', () => this.clearAllData());

        // Error State Events
        document.getElementById('retryBtn').addEventListener('click', () => this.retryOperation());

        // Connectivity Events
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    }

    // Core Todo Functions
    async addTodo() {
        const input = document.getElementById('todoInput');
        const text = input.value.trim();
        
        if (text === '') {
            this.showNotification('Please enter a task', 'error');
            return;
        }

        this.showLoading();

        try {
            // Simulate API call - in real app, this would be a POST request
            const todo = {
                id: Date.now(),
                text: text,
                completed: false,
                createdAt: new Date().toISOString(),
                userId: 1
            };

            if (this.isOnline) {
                // In a real app, you would make an API call here
                // const response = await fetch(`${this.apiBaseUrl}/todos`, {
                //     method: 'POST',
                //     headers: { 'Content-Type': 'application/json' },
                //     body: JSON.stringify(todo)
                // });
                // const savedTodo = await response.json();
                // todo.id = savedTodo.id;
            }

            this.todos.unshift(todo);
            this.saveTodos();
            this.renderTodos();
            input.value = '';
            input.focus();
            
            this.showNotification('Task added successfully!', 'success');
        } catch (error) {
            this.showError('Failed to add task. Please try again.');
        } finally {
            this.hideLoading();
        }
    }

    async toggleTodo(id) {
        this.showLoading();

        try {
            const todo = this.todos.find(t => t.id === id);
            if (todo) {
                todo.completed = !todo.completed;
                
                if (this.isOnline) {
                    // In a real app, you would make an API call here
                    // await fetch(`${this.apiBaseUrl}/todos/${id}`, {
                    //     method: 'PUT',
                    //     headers: { 'Content-Type': 'application/json' },
                    //     body: JSON.stringify(todo)
                    // });
                }

                this.saveTodos();
                this.renderTodos();
                this.showNotification(todo.completed ? 'Task completed!' : 'Task marked as active', 'success');
            }
        } catch (error) {
            this.showError('Failed to update task. Please try again.');
        } finally {
            this.hideLoading();
        }
    }

    async deleteTodo(id) {
        this.showLoading();

        try {
            if (this.isOnline) {
                // In a real app, you would make an API call here
                // await fetch(`${this.apiBaseUrl}/todos/${id}`, { method: 'DELETE' });
            }

            this.todos = this.todos.filter(todo => todo.id !== id);
            this.saveTodos();
            this.renderTodos();
            this.showNotification('Task deleted successfully!', 'success');
        } catch (error) {
            this.showError('Failed to delete task. Please try again.');
        } finally {
            this.hideLoading();
        }
    }

    clearCompleted() {
        const completedCount = this.todos.filter(todo => todo.completed).length;
        if (completedCount === 0) {
            this.showNotification('No completed tasks to clear', 'info');
            return;
        }

        if (confirm(`Clear ${completedCount} completed task${completedCount > 1 ? 's' : ''}?`)) {
            this.todos = this.todos.filter(todo => !todo.completed);
            this.saveTodos();
            this.renderTodos();
            this.showNotification(`Cleared ${completedCount} completed task${completedCount > 1 ? 's' : ''}!`, 'success');
        }
    }

    // Filter Functions
    setFilter(filter) {
        this.currentFilter = filter;
        
        // Update active filter button
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        
        this.renderTodos();
    }

    getFilteredTodos() {
        switch (this.currentFilter) {
            case 'active':
                return this.todos.filter(todo => !todo.completed);
            case 'completed':
                return this.todos.filter(todo => todo.completed);
            default:
                return this.todos;
        }
    }

    // Search Functions
    searchTodos(query) {
        this.searchQuery = query.toLowerCase();
        this.renderSearchResults();
    }

    renderSearchResults() {
        const resultsContainer = document.getElementById('searchResults');
        resultsContainer.innerHTML = '';

        if (this.searchQuery.trim() === '') {
            resultsContainer.innerHTML = '<p class="empty-state">Enter a search term to find tasks</p>';
            return;
        }

        const filteredTodos = this.todos.filter(todo => 
            todo.text.toLowerCase().includes(this.searchQuery)
        );

        if (filteredTodos.length === 0) {
            resultsContainer.innerHTML = '<p class="empty-state">No tasks found matching your search</p>';
            return;
        }

        filteredTodos.forEach(todo => {
            const li = document.createElement('div');
            li.className = 'search-result-item';
            
            const highlightedText = todo.text.replace(
                new RegExp(this.searchQuery, 'gi'),
                match => `<span class="highlight">${match}</span>`
            );
            
            li.innerHTML = `
                <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''}>
                <span class="todo-text">${highlightedText}</span>
                <button class="delete-btn">Delete</button>
            `;

            const checkbox = li.querySelector('.todo-checkbox');
            const deleteBtn = li.querySelector('.delete-btn');

            checkbox.addEventListener('change', () => this.toggleTodo(todo.id));
            deleteBtn.addEventListener('click', () => this.deleteTodo(todo.id));

            resultsContainer.appendChild(li);
        });
    }

    // Screen Navigation
    showScreen(screenId) {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });

        // Show requested screen
        const screen = document.getElementById(screenId);
        if (screen) {
            screen.classList.add('active');
            this.currentScreen = screenId;
        }

        // Update profile stats when profile screen is shown
        if (screenId === 'profileScreen') {
            this.updateProfileStats();
        }
    }

    // Data Persistence
    saveTodos() {
        localStorage.setItem('todos', JSON.stringify(this.todos));
        this.updateProfileStats();
    }

    loadTodos() {
        try {
            const saved = localStorage.getItem('todos');
            if (saved) {
                this.todos = JSON.parse(saved);
            }
            this.renderTodos();
        } catch (error) {
            console.error('Failed to load todos:', error);
            this.showError('Failed to load your tasks');
        }
    }

    // Profile Functions
    updateProfileStats() {
        const total = this.todos.length;
        const completed = this.todos.filter(todo => todo.completed).length;
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

        document.getElementById('totalTasks').textContent = `Total: ${total}`;
        document.getElementById('completedTasks').textContent = `Completed: ${completed}`;
        document.getElementById('remainingTasks').textContent = `Remaining: ${total - completed}`;

        // Profile stats
        document.getElementById('totalTasksStat').textContent = total;
        document.getElementById('completedTasksStat').textContent = completed;
        document.getElementById('completionRateStat').textContent = `${completionRate}%`;
    }

    updateMemberSince() {
        document.getElementById('memberSince').textContent = this.memberSince;
    }

    // Settings Functions
    saveSettings(key, value) {
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        settings[key] = value;
        localStorage.setItem('settings', JSON.stringify(settings));
        this.showNotification(`Settings updated`, 'success');
    }

    loadSettings() {
        try {
            const settings = JSON.parse(localStorage.getItem('settings') || '{}');
            document.getElementById('notifications').checked = settings.notifications !== false;
            document.getElementById('darkMode').checked = settings.darkMode || false;
            document.getElementById('autoClear').checked = settings.autoClear || false;
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    toggleDarkMode(enabled) {
        if (enabled) {
            document.body.style.background = '#1a1a1a';
            document.body.style.color = '#ffffff';
        } else {
            document.body.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            document.body.style.color = '#333';
        }
        this.saveSettings('darkMode', enabled);
    }

    exportData() {
        const data = {
            todos: this.todos,
            settings: JSON.parse(localStorage.getItem('settings') || '{}'),
            exportDate: new Date().toISOString(),
            version: '1.0'
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `todo-export-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showNotification('Data exported successfully!', 'success');
    }

    clearAllData() {
        if (confirm('Are you sure you want to clear all data? This action cannot be undone.')) {
            this.todos = [];
            localStorage.removeItem('todos');
            localStorage.removeItem('settings');
            this.renderTodos();
            this.updateProfileStats();
            this.showNotification('All data cleared!', 'success');
        }
    }

    // State Management
    showLoading() {
        this.showScreen('loadingState');
    }

    hideLoading() {
        if (this.currentScreen === 'loadingState') {
            this.showScreen('todoScreen');
        }
    }

    showError(message) {
        const errorState = document.getElementById('errorState');
        document.getElementById('errorMessage').textContent = message;
        this.showScreen('errorState');
    }

    retryOperation() {
        this.showScreen('todoScreen');
        this.renderTodos();
    }

    // Connectivity Management
    checkConnectivity() {
        this.isOnline = navigator.onLine;
        this.updateOnlineStatus();
    }

    handleOnline() {
        this.isOnline = true;
        this.updateOnlineStatus();
        this.showNotification('Back online!', 'success');
    }

    handleOffline() {
        this.isOnline = false;
        this.updateOnlineStatus();
        this.showNotification('You are offline. Some features may be limited.', 'error');
    }

    updateOnlineStatus() {
        // Update UI based on connectivity status
        const statusIndicator = document.createElement('div');
        statusIndicator.id = 'onlineStatus';
        statusIndicator.className = `online-status ${this.isOnline ? 'online' : 'offline'}`;
        statusIndicator.textContent = this.isOnline ? 'Online' : 'Offline';
        
        // Remove existing status indicator
        const existing = document.getElementById('onlineStatus');
        if (existing) {
            existing.remove();
        }
        
        // Add new status indicator
        document.querySelector('.app-header').appendChild(statusIndicator);
    }

    // UI Functions
    renderTodos() {
        const todoList = document.getElementById('todoList');
        const emptyState = document.getElementById('emptyState');
        const filteredTodos = this.getFilteredTodos();

        todoList.innerHTML = '';

        if (filteredTodos.length === 0) {
            emptyState.style.display = 'block';
            document.getElementById('clearAll').style.display = 'none';
        } else {
            emptyState.style.display = 'none';
            document.getElementById('clearAll').style.display = 'block';

            filteredTodos.forEach(todo => {
                const li = document.createElement('li');
                li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
                
                li.innerHTML = `
                    <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''}>
                    <span class="todo-text">${this.escapeHtml(todo.text)}</span>
                    <button class="delete-btn">Delete</button>
                `;

                const checkbox = li.querySelector('.todo-checkbox');
                const deleteBtn = li.querySelector('.delete-btn');

                checkbox.addEventListener('change', () => this.toggleTodo(todo.id));
                deleteBtn.addEventListener('click', () => this.deleteTodo(todo.id));

                todoList.appendChild(li);
            });
        }

        this.updateStats();
    }

    updateStats() {
        const total = this.todos.length;
        const completed = this.todos.filter(todo => todo.completed).length;
        const remaining = total - completed;
        
        document.getElementById('totalTasks').textContent = `Total: ${total}`;
        document.getElementById('completedTasks').textContent = `Completed: ${completed}`;
        document.getElementById('remainingTasks').textContent = `Remaining: ${remaining}`;
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.todoApp = new TodoApp();
});

// Add some CSS for online status indicator
const onlineStatusStyles = `
    .online-status {
        position: absolute;
        top: 10px;
        right: 10px;
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        color: white;
    }
    
    .online-status.online {
        background: #10b981;
    }
    
    .online-status.offline {
        background: #ff4757;
    }
`;

const styleElement = document.createElement('style');
styleElement.textContent = onlineStatusStyles;
document.head.appendChild(styleElement);