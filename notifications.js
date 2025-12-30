export function showNotification(message, type = 'info') {
    // Remove any existing notifications
    const existingNotifications = document.querySelectorAll('.notification-card');
    existingNotifications.forEach(n => n.remove());
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    const colors = {
        success: { bg: '#e8f5e9', border: '#4caf50', icon: '#2e7d32' },
        error: { bg: '#ffebee', border: '#f44336', icon: '#c62828' },
        warning: { bg: '#fff3e0', border: '#ff9800', icon: '#ef6c00' },
        info: { bg: '#e3f2fd', border: '#2196f3', icon: '#1565c0' }
    };
    
    const color = colors[type] || colors.info;
    const icon = icons[type] || icons.info;
    
    const notification = document.createElement('div');
    notification.className = `notification-card notification-${type}`;
    notification.innerHTML = `
        <div class="notification-card-content">
            <div class="notification-icon-wrapper" style="background: ${color.border}20;">
                <i class="fas ${icon}" style="color: ${color.icon};"></i>
            </div>
            <div class="notification-text">
                <span class="notification-message">${message}</span>
            </div>
            <button class="notification-close-btn" aria-label="Close">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="notification-progress" style="background: ${color.border};"></div>
    `;

    // Add styles if not already added
    if (!document.getElementById('notification-card-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-card-styles';
        style.textContent = `
            .notification-card {
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%) translateY(-100px);
                min-width: 320px;
                max-width: 90vw;
                background: white;
                border-radius: 16px;
                box-shadow: 0 12px 40px rgba(0,0,0,0.15);
                z-index: 100000;
                overflow: hidden;
                opacity: 0;
                transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .notification-card.show {
                transform: translateX(-50%) translateY(0);
                opacity: 1;
            }
            
            .notification-card-content {
                display: flex;
                align-items: center;
                gap: 16px;
                padding: 16px 20px;
            }
            
            .notification-icon-wrapper {
                width: 44px;
                height: 44px;
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            
            .notification-icon-wrapper i {
                font-size: 20px;
            }
            
            .notification-text {
                flex: 1;
            }
            
            .notification-message {
                font-size: 14px;
                font-weight: 500;
                color: #333;
                line-height: 1.4;
            }
            
            .notification-close-btn {
                background: none;
                border: none;
                padding: 8px;
                cursor: pointer;
                border-radius: 8px;
                color: #999;
                transition: all 0.2s;
                flex-shrink: 0;
            }
            
            .notification-close-btn:hover {
                background: #f5f5f5;
                color: #333;
            }
            
            .notification-progress {
                height: 4px;
                width: 100%;
                animation: notificationProgress 5s linear forwards;
            }
            
            @keyframes notificationProgress {
                from { width: 100%; }
                to { width: 0%; }
            }
            
            .notification-success { border-left: 4px solid #4caf50; }
            .notification-error { border-left: 4px solid #f44336; }
            .notification-warning { border-left: 4px solid #ff9800; }
            .notification-info { border-left: 4px solid #2196f3; }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    // Show the notification with animation
    requestAnimationFrame(() => {
        notification.classList.add('show');
    });

    // Auto-hide after 5 seconds
    const hideTimeout = setTimeout(() => {
        hideNotification(notification);
    }, 5000);

    // Close button event
    notification.querySelector('.notification-close-btn').addEventListener('click', () => {
        clearTimeout(hideTimeout);
        hideNotification(notification);
    });
}

function hideNotification(notification) {
    notification.classList.remove('show');
    setTimeout(() => {
        notification.remove();
    }, 400);
}

function getIconForType(type) {
  switch (type) {
      case 'success':
          return 'fa-check-circle';
      case 'error':
          return 'fa-exclamation-circle';
      case 'warning':
          return 'fa-exclamation-triangle';
      default:
          return 'fa-info-circle';
  }
}