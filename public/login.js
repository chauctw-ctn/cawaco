// Login form handler
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const btnText = submitBtn.querySelector('.btn-text');
    const spinner = submitBtn.querySelector('.spinner');
    
    // Clear previous error
    errorMessage.classList.remove('show');
    errorMessage.textContent = '';
    
    // Show loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    btnText.textContent = 'Đang đăng nhập...';
    spinner.style.display = 'inline-block';
    
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
            
            // Add transition effect before redirect
            document.body.classList.add('transitioning');
            document.querySelector('.page-transition-overlay').classList.add('active');
            
            // Redirect after animation
            setTimeout(() => {
                window.location.href = '/';
            }, 400);
        } else {
            // Show error
            errorMessage.textContent = result.message || 'Đăng nhập thất bại';
            errorMessage.classList.add('show');
            
            // Reset button state
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
            btnText.textContent = 'Đăng nhập';
            spinner.style.display = 'none';
        }
    } catch (error) {
        console.error('Login error:', error);
        errorMessage.textContent = 'Lỗi kết nối. Vui lòng thử lại.';
        errorMessage.classList.add('show');
        
        // Reset button state
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        btnText.textContent = 'Đăng nhập';
        spinner.style.display = 'none';
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
            } else {
                // Token invalid, clear all auth data
                localStorage.removeItem('authToken');
                localStorage.removeItem('username');
                localStorage.removeItem('userRole');
            }
        })
        .catch(() => {
            // Token invalid or network error, clear all auth data
            localStorage.removeItem('authToken');
            localStorage.removeItem('username');
        });
    }
});
