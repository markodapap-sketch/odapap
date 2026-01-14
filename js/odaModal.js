/**
 * Custom Modal/Dialog System - Oda Pap
 * Replaces browser dialogs with beautiful custom modals
 */

class OdaModal {
    static activeModals = [];
    
    /**
     * Show a confirmation dialog
     * @param {Object} options - Modal options
     * @returns {Promise<boolean>}
     */
    static confirm(options = {}) {
        return new Promise((resolve) => {
            const config = {
                title: options.title || 'Confirm Action',
                message: options.message || 'Are you sure?',
                icon: options.icon || 'question-circle',
                iconColor: options.iconColor || '#ff5722',
                confirmText: options.confirmText || 'Confirm',
                cancelText: options.cancelText || 'Cancel',
                confirmClass: options.confirmClass || 'primary',
                dangerous: options.dangerous || false
            };
            
            const modal = this.createModal(`
                <div class="oda-modal-icon" style="color: ${config.iconColor}">
                    <i class="fas fa-${config.icon}"></i>
                </div>
                <h3 class="oda-modal-title">${config.title}</h3>
                <p class="oda-modal-message">${config.message}</p>
                <div class="oda-modal-actions">
                    <button class="oda-modal-btn cancel">${config.cancelText}</button>
                    <button class="oda-modal-btn ${config.dangerous ? 'danger' : config.confirmClass}">${config.confirmText}</button>
                </div>
            `, { closeable: true });
            
            modal.querySelector('.oda-modal-btn.cancel').onclick = () => {
                this.close(modal);
                resolve(false);
            };
            
            modal.querySelector(`.oda-modal-btn.${config.dangerous ? 'danger' : config.confirmClass}`).onclick = () => {
                this.close(modal);
                resolve(true);
            };
        });
    }
    
    /**
     * Show an alert dialog
     * @param {Object} options - Modal options
     * @returns {Promise<void>}
     */
    static alert(options = {}) {
        return new Promise((resolve) => {
            const config = {
                title: options.title || 'Notice',
                message: options.message || '',
                icon: options.icon || 'info-circle',
                iconColor: options.iconColor || '#2196f3',
                buttonText: options.buttonText || 'OK',
                type: options.type || 'info' // info, success, warning, error
            };
            
            const typeColors = {
                info: '#2196f3',
                success: '#4caf50',
                warning: '#ff9800',
                error: '#f44336'
            };
            
            const typeIcons = {
                info: 'info-circle',
                success: 'check-circle',
                warning: 'exclamation-triangle',
                error: 'times-circle'
            };
            
            config.iconColor = typeColors[config.type] || config.iconColor;
            config.icon = typeIcons[config.type] || config.icon;
            
            const modal = this.createModal(`
                <div class="oda-modal-icon" style="color: ${config.iconColor}">
                    <i class="fas fa-${config.icon}"></i>
                </div>
                <h3 class="oda-modal-title">${config.title}</h3>
                <p class="oda-modal-message">${config.message}</p>
                <div class="oda-modal-actions single">
                    <button class="oda-modal-btn primary">${config.buttonText}</button>
                </div>
            `, { closeable: true });
            
            modal.querySelector('.oda-modal-btn.primary').onclick = () => {
                this.close(modal);
                resolve();
            };
        });
    }
    
    /**
     * Show a prompt dialog
     * @param {Object} options - Modal options
     * @returns {Promise<string|null>}
     */
    static prompt(options = {}) {
        return new Promise((resolve) => {
            const config = {
                title: options.title || 'Enter Value',
                message: options.message || '',
                placeholder: options.placeholder || '',
                defaultValue: options.defaultValue || '',
                inputType: options.inputType || 'text',
                confirmText: options.confirmText || 'Submit',
                cancelText: options.cancelText || 'Cancel'
            };
            
            const modal = this.createModal(`
                <h3 class="oda-modal-title">${config.title}</h3>
                ${config.message ? `<p class="oda-modal-message">${config.message}</p>` : ''}
                <div class="oda-modal-input-group">
                    <input type="${config.inputType}" class="oda-modal-input" placeholder="${config.placeholder}" value="${config.defaultValue}">
                </div>
                <div class="oda-modal-actions">
                    <button class="oda-modal-btn cancel">${config.cancelText}</button>
                    <button class="oda-modal-btn primary">${config.confirmText}</button>
                </div>
            `, { closeable: true });
            
            const input = modal.querySelector('.oda-modal-input');
            input.focus();
            
            modal.querySelector('.oda-modal-btn.cancel').onclick = () => {
                this.close(modal);
                resolve(null);
            };
            
            modal.querySelector('.oda-modal-btn.primary').onclick = () => {
                this.close(modal);
                resolve(input.value);
            };
            
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.close(modal);
                    resolve(input.value);
                }
            });
        });
    }
    
    /**
     * Show a loading modal
     * @param {string} message - Loading message
     * @returns {Object} - Modal reference with close method
     */
    static loading(message = 'Loading...') {
        const modal = this.createModal(`
            <div class="oda-modal-loading">
                <div class="oda-spinner"></div>
                <p class="oda-modal-message">${message}</p>
            </div>
        `, { closeable: false, compact: true });
        
        return {
            modal,
            close: () => this.close(modal),
            updateMessage: (msg) => {
                modal.querySelector('.oda-modal-message').textContent = msg;
            }
        };
    }
    
    /**
     * Show a custom modal with any content
     * @param {string} content - HTML content
     * @param {Object} options - Modal options
     * @returns {HTMLElement}
     */
    static custom(content, options = {}) {
        return this.createModal(content, options);
    }
    
    /**
     * Create and show a modal
     * @private
     */
    static createModal(content, options = {}) {
        const overlay = document.createElement('div');
        overlay.className = 'oda-modal-overlay';
        if (options.compact) overlay.classList.add('compact');
        
        const container = document.createElement('div');
        container.className = 'oda-modal-container';
        container.innerHTML = content;
        
        if (options.closeable !== false) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'oda-modal-close';
            closeBtn.innerHTML = '<i class="fas fa-times"></i>';
            closeBtn.onclick = () => this.close(overlay);
            container.prepend(closeBtn);
            
            overlay.onclick = (e) => {
                if (e.target === overlay) this.close(overlay);
            };
        }
        
        overlay.appendChild(container);
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        
        // Animate in
        requestAnimationFrame(() => {
            overlay.classList.add('active');
        });
        
        this.activeModals.push(overlay);
        
        // Escape key to close
        if (options.closeable !== false) {
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    this.close(overlay);
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);
        }
        
        return overlay;
    }
    
    /**
     * Close a modal
     * @param {HTMLElement} modal - Modal element to close
     */
    static close(modal) {
        if (!modal) return;
        
        modal.classList.remove('active');
        modal.classList.add('closing');
        
        setTimeout(() => {
            modal.remove();
            this.activeModals = this.activeModals.filter(m => m !== modal);
            if (this.activeModals.length === 0) {
                document.body.style.overflow = '';
            }
        }, 200);
    }
    
    /**
     * Close all modals
     */
    static closeAll() {
        this.activeModals.forEach(modal => this.close(modal));
    }
}

// CSS Styles for modals
const modalStyles = document.createElement('style');
modalStyles.textContent = `
    .oda-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        opacity: 0;
        transition: opacity 0.2s ease;
        padding: 20px;
    }
    
    .oda-modal-overlay.active {
        opacity: 1;
    }
    
    .oda-modal-overlay.closing {
        opacity: 0;
    }
    
    .oda-modal-overlay.compact .oda-modal-container {
        padding: 30px;
    }
    
    .oda-modal-container {
        background: white;
        border-radius: 16px;
        padding: 30px;
        max-width: 400px;
        width: 100%;
        text-align: center;
        position: relative;
        transform: scale(0.9) translateY(20px);
        transition: transform 0.2s ease;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
    }
    
    .oda-modal-overlay.active .oda-modal-container {
        transform: scale(1) translateY(0);
    }
    
    .oda-modal-overlay.closing .oda-modal-container {
        transform: scale(0.9) translateY(20px);
    }
    
    .oda-modal-close {
        position: absolute;
        top: 12px;
        right: 12px;
        background: #f5f5f5;
        border: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #666;
        transition: all 0.2s;
    }
    
    .oda-modal-close:hover {
        background: #e0e0e0;
        color: #333;
    }
    
    .oda-modal-icon {
        font-size: 3rem;
        margin-bottom: 16px;
    }
    
    .oda-modal-title {
        font-size: 1.25rem;
        font-weight: 600;
        color: #333;
        margin-bottom: 8px;
    }
    
    .oda-modal-message {
        font-size: 0.95rem;
        color: #666;
        line-height: 1.5;
        margin-bottom: 24px;
    }
    
    .oda-modal-actions {
        display: flex;
        gap: 12px;
    }
    
    .oda-modal-actions.single {
        justify-content: center;
    }
    
    .oda-modal-btn {
        flex: 1;
        padding: 12px 20px;
        border-radius: 10px;
        border: none;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }
    
    .oda-modal-btn.cancel {
        background: #f5f5f5;
        color: #666;
    }
    
    .oda-modal-btn.cancel:hover {
        background: #e0e0e0;
    }
    
    .oda-modal-btn.primary {
        background: linear-gradient(135deg, #ff5722, #ff8a65);
        color: white;
    }
    
    .oda-modal-btn.primary:hover {
        background: linear-gradient(135deg, #e64a19, #ff5722);
        transform: translateY(-1px);
    }
    
    .oda-modal-btn.danger {
        background: linear-gradient(135deg, #f44336, #e57373);
        color: white;
    }
    
    .oda-modal-btn.danger:hover {
        background: linear-gradient(135deg, #d32f2f, #f44336);
    }
    
    .oda-modal-input-group {
        margin-bottom: 24px;
    }
    
    .oda-modal-input {
        width: 100%;
        padding: 14px 16px;
        border: 2px solid #e0e0e0;
        border-radius: 10px;
        font-size: 1rem;
        outline: none;
        transition: border-color 0.2s;
    }
    
    .oda-modal-input:focus {
        border-color: #ff5722;
    }
    
    .oda-modal-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
    }
    
    .oda-spinner {
        width: 48px;
        height: 48px;
        border: 4px solid #f5f5f5;
        border-top-color: #ff5722;
        border-radius: 50%;
        animation: oda-spin 0.8s linear infinite;
    }
    
    @keyframes oda-spin {
        to { transform: rotate(360deg); }
    }
    
    /* Mobile adjustments */
    @media (max-width: 480px) {
        .oda-modal-container {
            padding: 24px;
            margin: 10px;
        }
        
        .oda-modal-icon {
            font-size: 2.5rem;
        }
        
        .oda-modal-title {
            font-size: 1.1rem;
        }
        
        .oda-modal-actions {
            flex-direction: column;
        }
        
        .oda-modal-btn {
            padding: 14px 20px;
        }
    }
`;
document.head.appendChild(modalStyles);

// Make globally available
window.OdaModal = OdaModal;

export { OdaModal };
