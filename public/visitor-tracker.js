// Visitor Tracking System
(function() {
    'use strict';

    const VISITOR_API = '/api/visitors';
    const UPDATE_INTERVAL = 30000; // Update every 30 seconds
    let updateTimer = null;
    let sessionId = null;

    // Get or create session ID
    function getSessionId() {
        if (!sessionId) {
            sessionId = localStorage.getItem('visitorSessionId');
            if (!sessionId) {
                sessionId = generateSessionId();
                localStorage.setItem('visitorSessionId', sessionId);
            }
        }
        return sessionId;
    }

    // Generate a unique session ID
    function generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Initialize visitor tracking
    async function initVisitorTracking() {
        try {
            // Register this visit
            await registerVisit();
            
            // Update visitor stats display
            await updateVisitorStats();
            
            // Set up periodic updates
            updateTimer = setInterval(updateVisitorStats, UPDATE_INTERVAL);
            
            // Clean up on page unload
            window.addEventListener('beforeunload', handlePageUnload);
            
        } catch (error) {
            console.error('Error initializing visitor tracking:', error);
            // Show fallback data if API fails
            showFallbackStats();
        }
    }

    // Register a new visit
    async function registerVisit() {
        try {
            const response = await fetch(`${VISITOR_API}/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': getSessionId()
                },
                body: JSON.stringify({
                    page: window.location.pathname,
                    timestamp: new Date().toISOString()
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to register visit');
            }
            
            const data = await response.json();
            
            // Update session ID if server provided one
            if (data.sessionId) {
                sessionId = data.sessionId;
                localStorage.setItem('visitorSessionId', sessionId);
            }
            
            // Update stats if provided
            if (data.stats) {
                updateStatsDisplay(data.stats);
            }
            
            return data;
        } catch (error) {
            console.error('Error registering visit:', error);
            throw error;
        }
    }

    // Update visitor statistics display
    async function updateVisitorStats() {
        try {
            const response = await fetch(`${VISITOR_API}/stats`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch visitor stats');
            }
            
            const stats = await response.json();
            
            // Update DOM elements
            updateStatsDisplay(stats);
            
        } catch (error) {
            console.error('Error updating visitor stats:', error);
            // Continue with existing display on error
        }
    }

    // Update the stats display in the DOM
    function updateStatsDisplay(stats) {
        const currentVisitorsEl = document.getElementById('current-visitors');
        const todayVisitorsEl = document.getElementById('today-visitors');
        const totalVisitorsEl = document.getElementById('total-visitors');
        
        if (currentVisitorsEl && stats.currentVisitors !== undefined) {
            animateNumber(currentVisitorsEl, stats.currentVisitors);
        }
        
        if (todayVisitorsEl && stats.todayVisitors !== undefined) {
            animateNumber(todayVisitorsEl, stats.todayVisitors);
        }
        
        if (totalVisitorsEl && stats.totalVisitors !== undefined) {
            animateNumber(totalVisitorsEl, stats.totalVisitors);
        }
    }

    // Animate number changes
    function animateNumber(element, newValue) {
        const oldValue = parseInt(element.textContent.replace(/,/g, '')) || 0;
        
        if (oldValue === newValue) return;
        
        // Add animation class
        element.classList.add('updating');
        
        // Update value with formatting
        element.textContent = formatNumber(newValue);
        
        // Remove animation class after animation completes
        setTimeout(() => {
            element.classList.remove('updating');
        }, 300);
    }

    // Format number with thousands separator
    function formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Show fallback stats when API is unavailable
    function showFallbackStats() {
        // Use localStorage for basic tracking as fallback
        let visits = JSON.parse(localStorage.getItem('visitorStats') || '{}');
        const today = new Date().toDateString();
        
        // Initialize if needed
        if (!visits.total) visits.total = 20102347; // Starting from provided number
        if (!visits.today || visits.lastDate !== today) {
            visits.today = 0;
            visits.lastDate = today;
        }
        
        // Increment today's count
        visits.today++;
        visits.total++;
        
        // Save to localStorage
        localStorage.setItem('visitorStats', JSON.stringify(visits));
        
        // Display stats
        updateStatsDisplay({
            currentVisitors: Math.floor(Math.random() * 50) + 20, // Random between 20-70
            todayVisitors: visits.today,
            totalVisitors: visits.total
        });
    }

    // Handle page unload
    function handlePageUnload() {
        // Clear update timer
        if (updateTimer) {
            clearInterval(updateTimer);
        }
        
        // Optionally send unload notification to server
        try {
            const blob = new Blob([JSON.stringify({
                page: window.location.pathname,
                timestamp: new Date().toISOString()
            })], { type: 'application/json' });
            
            navigator.sendBeacon(`${VISITOR_API}/unload`, blob);
        } catch (error) {
            // Silent fail for beacon
        }
    }

    // Public API
    window.visitorTracker = {
        init: initVisitorTracking,
        update: updateVisitorStats
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initVisitorTracking);
    } else {
        initVisitorTracking();
    }
})();
