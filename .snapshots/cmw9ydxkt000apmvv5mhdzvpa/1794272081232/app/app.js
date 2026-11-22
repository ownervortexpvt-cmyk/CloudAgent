class TodoApp {
    constructor() {
        this.apiUrl = 'http://localhost:3001/api';
        this.token = localStorage.getItem('token');
        this.user = JSON.parse(localStorage.getItem('user') || 'null');
        this.todos = [];
        this.currentFilter = 'all';
        
        this.initializeElements();
        this.bindEvents();
        this.showScreen(this.token ? 'main' : 'login');
    }

    initializeElements() {
        // Screen elements
        this.loginScreen = document.getElementById('loginScreen');
        this.mainScreen = document.getElementById('mainScreen');
        this.registerScreen = document.getElementById('registerScreen');

        // Login elements
        this.usernameInput = document.getElementById('username');
        this.passwordInput = document.getElementById('password');
        this.loginBtn = document.getElementById('loginBtn');
        this.registerBtn = document.getElementById('registerBtn');

        // Register elements
        this.regUsernameInput = document.getElementById('regUsername');
        this.regPasswordInput = document.getElementById('regPassword');
        this.regPasswordConfirmInput = document.getElementById('regPasswordConfirm');
        this.registerSubmitBtn = document.getElementById('registerSubmitBtn');
        this.cancelRegisterBtn = document.getElementById('cancelRegisterBtn');

        // Main app elements
        this.userWelcome = document.getElementById('userWelcome');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.todoInput = document.getElementById('todoInput');
        this.addBtn = document.getElementById('addBtn');
        this.todoList = document.getElementById('todoList');
        this.emptyState = document.getElementById('emptyState');
        this.totalTasks = document.getElementById('totalTasks');
        this.completedTasks = document.getElementById('completedTasks');
        this.activeTasks = document.getElementById('activeTasks');
        this.clearCompletedBtn = document.getElementById('clearCompletedBtn');

        // Filter elements
        this.filterBtns = document.querySelectorAll('.filter-btn');
    }

    bindEvents() {
        // Login events
        this.loginBtn.addEventListener('click', () => this.login());
        this.usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });
        this.passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });

        // Register events
        this.registerBtn.addEventListener('click', () => this.showScreen('register'));
        this.registerSubmitBtn.addEventListener('click', () => this.register());
        this.cancelRegisterBtn.addEventListener('click', () => this.showScreen('login'));
        this.regPasswordConfirmInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.register();
        });

        // Main app events
        this.logoutBtn.addEventListener('click', () => this.logout());
        this.addBtn.addEventListener('click', () => this.addTodo());
        this.todoInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTodo();
        });
        this.clearCompletedBtn.addEventListener('click', () => this.clearCompleted());

        // Filter events
        this.filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setFilter(e.target.dataset.filter);
            });
        });
    }

    showScreen(screenName) {
        // Hide all screens
        this.loginScreen.style.display = 'none';
        this.mainScreen.style.display = 'none';
        this.registerScreen.style.display = 'none';

        // Show selected screen
        switch(screenName) {
            case 'login':
                this.loginScreen.style.display = 'flex';
                this.usernameInput.focus();
                break;
            case 'register':
                this.registerScreen.style.display = 'flex';
                this.regUsernameInput.focus();
                break;
            case 'main':
                this.mainScreen.style.display = 'block';
                if (this.user) {
                    this.userWelcome.textContent = `Welcome, ${this.user.username}!`;
                }
                this.loadTodos();
                break;
        }
    }

    async login() {
        const username = this.usernameInput.value.trim();
        const password = this.passwordInput.value.trim();

        if (!username || !password) {
            this.showMessage('Please enter both username and password', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.apiUrl}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.token = data.token;
                this.user = data.user;
                localStorage.setItem('token', this.token);
                localStorage.setItem('user', JSON.stringify(this.user));
                this.showScreen('main');
                this.showMessage('Login successful!', 'success');
            } else {
                this.showMessage(data.error || 'Login failed', 'error');
            }
        } catch (error) {
            this.showMessage('Network error. Please try again.', 'error');
        }
    }

    async register() {
        const username = this.regUsernameInput.value.trim();
        const password = this.regPasswordInput.value.trim();
        const confirmPassword = this.regPasswordConfirmInput.value.trim();

        if (!username || !password || !confirmPassword) {
            this.showMessage('Please fill in all fields', 'error');
            return;
        }

        if (password !== confirmPassword) {
            this.showMessage('Passwords do not match', 'error');
            return;
        }

        if (password.length < 3) {
            this.showMessage('Password must be at least 3 characters', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.apiUrl}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.token = data.token;
                this.user = data.user;
                localStorage.setItem('token', this.token);
                localStorage.setItem('user', JSON.stringify(this.user));
                this.showScreen('main');
                this.showMessage('Registration successful!', 'success');
            } else {
                this.showMessage(data.error || 'Registration failed', 'error');
            }
        } catch (error) {
            this.showMessage('Network error. Please try again.', 'error');
        }
    }

    logout() {
        this.token = null;
        this.user = null;
        this.todos = [];
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        this.showScreen('login');
        this.showMessage('Logged out successfully', 'success');
    }

    async addTodo() {
        const text = this.todoInput.value.trim();

        if (!text) {
            this.showMessage('Please enter a todo item', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.apiUrl}/todos`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ text })
            });

            const data = await response.json();

            if (response.ok) {
                this.todoInput.value = '';
                this.todoInput.focus();
                this.loadTodos();
                this.showMessage('Todo added successfully!', 'success');
            } else {
                this.showMessage(data.error || 'Failed to add todo', 'error');
            }
        } catch (error) {
            this.showMessage('Network error. Please try again.', 'error');
        }
    }

    async loadTodos() {
        try {
            const response = await fetch(`${this.apiUrl}/todos`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                this.todos = await response.json();
                this.renderTodos();
            } else {
                this.showMessage('Failed to load todos', 'error');
            }
        } catch (error) {
            this.showMessage('Network error. Please try again.', 'error');
        }
    }

    async toggleTodo(id, completed) {
        try {
            const response = await fetch(`${this.apiUrl}/todos/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ completed })
            });

            if (response.ok) {
                this.loadTodos();
            }
        } catch (error) {
            this.showMessage('Network error. Please try again.', 'error');
        }
    }

    async deleteTodo(id) {
        if (!confirm('Are you sure you want to delete this todo?')) {
            return;
        }

        try {
            const response = await fetch(`${this.apiUrl}/todos/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                this.loadTodos();
                this.showMessage('Todo deleted successfully!', 'success');
            } else {
                this.showMessage('Failed to delete todo', 'error');
            }
        } catch (error) {
            this.showMessage('Network error. Please try again.', 'error');
        }
    }

    async clearCompleted() {
        const completedCount = this.todos.filter(todo => todo.completed).length;
        if (completedCount === 0) {
            this.showMessage('No completed todos to clear', 'error');
            return;
        }

        if (!confirm(`Are you sure you want to clear ${completedCount} completed todos?`)) {
            return;
        }

        try {
            const response = await fetch(`${this.apiUrl}/todos`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                this.loadTodos();
                this.showMessage(`Cleared ${completedCount} completed todos!`, 'success');
            } else {
                this.showMessage('Failed to clear completed todos', 'error');
            }
        } catch (error) {
            this.showMessage('Network error. Please try again.', 'error');
        }
    }

    setFilter(filter) {
        this.currentFilter = filter;
        
        // Update filter buttons
        this.filterBtns.forEach(btn => {
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

    renderTodos() {
        const filteredTodos = this.getFilteredTodos();
        this.todoList.innerHTML = '';

        if (filteredTodos.length === 0) {
            this.emptyState.style.display = 'block';
            this.clearCompletedBtn.style.display = 'none';
        } else {
            this.emptyState.style.display = 'none';
            this.clearCompletedBtn.style.display = 'block';

            filteredTodos.forEach(todo => {
                const li = document.createElement('li');
                li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
                
                li.innerHTML = `
                    <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''}>
                    <span class="todo-text">${this.escapeHtml(todo.text)}</span>
                    <div class="todo-actions">
                        <button class="delete-btn">Delete</button>
                    </div>
                `;

                const checkbox = li.querySelector('.todo-checkbox');
                const deleteBtn = li.querySelector('.delete-btn');

                checkbox.addEventListener('change', () => this.toggleTodo(todo.id, !todo.completed));
                deleteBtn.addEventListener('click', () => this.deleteTodo(todo.id));

                this.todoList.appendChild(li);
            });
        }

        this.updateStats();
    }

    updateStats() {
        const total = this.todos.length;
        const completed = this.todos.filter(todo => todo.completed).length;
        const active = total - completed;

        this.totalTasks.textContent = `Total: ${total}`;
        this.completedTasks.textContent = `Completed: ${completed}`;
        this.activeTasks.textContent = `Active: ${active}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showMessage(message, type) {
        // Remove existing messages
        const existingMessages = document.querySelectorAll('.error-message, .success-message');
        existingMessages.forEach(msg => msg.remove());

        // Create new message
        const messageDiv = document.createElement('div');
        messageDiv.className = `${type}-message`;
        messageDiv.textContent = message;

        // Add to current screen
        const currentScreen = document.querySelector('.screen:not([style*="display: none"]) .container');
        if (currentScreen) {
            currentScreen.insertBefore(messageDiv, currentScreen.firstChild);
        }

        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 3000);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new TodoApp();
});