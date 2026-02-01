// Login form handler
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    // Clear previous error
    errorMessage.classList.remove('show');
    errorMessage.textContent = '';
    
    // Disable button
    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang đăng nhập...';
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Save token to localStorage
            localStorage.setItem('authToken', result.token);
            localStorage.setItem('username', result.username);
            localStorage.setItem('userRole', result.role);
            
            // Redirect to main page
            window.location.href = '/';
        } else {
            // Show error
            errorMessage.textContent = result.message || 'Đăng nhập thất bại';
            errorMessage.classList.add('show');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Đăng nhập';
        }
    } catch (error) {
        console.error('Login error:', error);
        errorMessage.textContent = 'Lỗi kết nối. Vui lòng thử lại.';
        errorMessage.classList.add('show');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Đăng nhập';
    }
});

// Check if already logged in
window.addEventListener('load', () => {
    const token = localStorage.getItem('authToken');
    if (token) {
        // Verify token
        fetch('/api/verify', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                // Already logged in, redirect to main page
                window.location.href = '/';
            }
        })
        .catch(() => {
            // Token invalid, stay on login page
            localStorage.removeItem('authToken');
            localStorage.removeItem('username');
        });
    }
});
