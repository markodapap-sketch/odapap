/**
 * Auth Modal - Reusable login/signup prompt modal
 * Shows when users try to access protected features/pages
 */

const AUTH_MODAL_STYLES = `
.auth-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    opacity: 0;
    animation: authFadeIn 0.3s ease forwards;
}

@keyframes authFadeIn {
    to { opacity: 1; }
}

.auth-modal-content {
    background: white;
    border-radius: 20px;
    padding: 32px 24px;
    max-width: 380px;
    width: 90%;
    text-align: center;
    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.35);
    transform: translateY(20px) scale(0.95);
    animation: authSlideIn 0.3s ease forwards;
}

@keyframes authSlideIn {
    to { transform: translateY(0) scale(1); }
}

.auth-modal-icon {
    width: 80px;
    height: 80px;
    background: linear-gradient(135deg, #ff5722, #ff7043);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
    box-shadow: 0 8px 25px rgba(255, 87, 34, 0.3);
}

.auth-modal-icon i {
    font-size: 36px;
    color: white;
}

.auth-modal-content h2 {
    color: #333;
    font-size: 22px;
    margin: 0 0 8px;
    font-weight: 700;
}

.auth-modal-content p {
    color: #666;
    font-size: 14px;
    line-height: 1.5;
    margin: 0 0 24px;
}

.auth-modal-buttons {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.auth-modal-btn {
    padding: 14px 24px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: none;
}

.auth-modal-btn.primary {
    background: linear-gradient(135deg, #ff5722, #f4511e);
    color: white;
    box-shadow: 0 4px 15px rgba(255, 87, 34, 0.3);
}

.auth-modal-btn.primary:hover {
    background: linear-gradient(135deg, #f4511e, #e64a19);
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(255, 87, 34, 0.4);
}

.auth-modal-btn.secondary {
    background: #f5f5f5;
    color: #333;
    border: 1px solid #e0e0e0;
}

.auth-modal-btn.secondary:hover {
    background: #eeeeee;
}

.auth-modal-btn.ghost {
    background: transparent;
    color: #666;
    padding: 10px;
}

.auth-modal-btn.ghost:hover {
    color: #333;
    background: #f5f5f5;
}

.auth-modal-divider {
    display: flex;
    align-items: center;
    margin: 16px 0;
    color: #999;
    font-size: 12px;
}

.auth-modal-divider::before,
.auth-modal-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #e0e0e0;
}

.auth-modal-divider::before { margin-right: 12px; }
.auth-modal-divider::after { margin-left: 12px; }

.auth-modal-features {
    display: flex;
    justify-content: center;
    gap: 20px;
    margin-bottom: 20px;
    flex-wrap: wrap;
}

.auth-feature {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #666;
}

.auth-feature i {
    color: #4caf50;
    font-size: 14px;
}
`;

class AuthModal {
    constructor() {
        this.modal = null;
        this.injectStyles();
    }

    injectStyles() {
        if (!document.getElementById('auth-modal-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'auth-modal-styles';
            styleEl.textContent = AUTH_MODAL_STYLES;
            document.head.appendChild(styleEl);
        }
    }

    /**
     * Show the authentication modal
     * @param {Object} options - Configuration options
     * @param {string} options.title - Modal title (default: "Login Required")
     * @param {string} options.message - Modal message
     * @param {string} options.icon - FontAwesome icon class (default: "fa-lock")
     * @param {string} options.redirectUrl - URL to redirect after login (default: current page)
     * @param {string} options.feature - Feature name user is trying to access
     * @param {boolean} options.showSignup - Show signup option (default: true)
     * @param {boolean} options.allowCancel - Allow closing modal (default: true)
     * @param {Function} options.onCancel - Callback when modal is cancelled
     * @param {string} options.cancelRedirect - URL to redirect on cancel (optional)
     */
    show(options = {}) {
        const {
            title = 'Login Required',
            message = 'Please log in to continue',
            icon = 'fa-lock',
            redirectUrl = window.location.href,
            feature = '',
            showSignup = true,
            allowCancel = true,
            onCancel = null,
            cancelRedirect = null
        } = options;

        // Remove existing modal if any
        this.hide();

        const featureText = feature ? ` to ${feature}` : '';

        this.modal = document.createElement('div');
        this.modal.className = 'auth-modal-overlay';
        this.modal.innerHTML = `
            <div class="auth-modal-content">
                <div class="auth-modal-icon">
                    <i class="fas ${icon}"></i>
                </div>
                <h2>${title}</h2>
                <p>${message || `Sign in${featureText} and enjoy the full Oda Pap experience`}</p>
                
                <div class="auth-modal-features">
                    <div class="auth-feature">
                        <i class="fas fa-check-circle"></i>
                        <span>Save items</span>
                    </div>
                    <div class="auth-feature">
                        <i class="fas fa-check-circle"></i>
                        <span>Track orders</span>
                    </div>
                    <div class="auth-feature">
                        <i class="fas fa-check-circle"></i>
                        <span>Chat with sellers</span>
                    </div>
                </div>

                <div class="auth-modal-buttons">
                    <button class="auth-modal-btn primary" id="authModalLogin">
                        <i class="fas fa-sign-in-alt"></i>
                        Log In
                    </button>
                    ${showSignup ? `
                    <div class="auth-modal-divider">or</div>
                    <button class="auth-modal-btn secondary" id="authModalSignup">
                        <i class="fas fa-user-plus"></i>
                        Create Account
                    </button>
                    ` : ''}
                    ${allowCancel ? `
                    <button class="auth-modal-btn ghost" id="authModalCancel">
                        ${cancelRedirect ? '<i class="fas fa-arrow-left"></i> Go Back' : 'Maybe Later'}
                    </button>
                    ` : ''}
                </div>
            </div>
        `;

        document.body.appendChild(this.modal);
        document.body.style.overflow = 'hidden';

        // Encode the redirect URL
        const encodedRedirect = encodeURIComponent(redirectUrl);

        // Event listeners
        this.modal.querySelector('#authModalLogin').addEventListener('click', () => {
            window.location.href = `login.html?redirect=${encodedRedirect}`;
        });

        if (showSignup) {
            this.modal.querySelector('#authModalSignup').addEventListener('click', () => {
                window.location.href = `signup.html?redirect=${encodedRedirect}`;
            });
        }

        if (allowCancel) {
            const cancelBtn = this.modal.querySelector('#authModalCancel');
            cancelBtn.addEventListener('click', () => {
                this.hide();
                if (onCancel) onCancel();
                if (cancelRedirect) {
                    window.location.href = cancelRedirect;
                }
            });
        }

        // Close on overlay click (only if allowCancel is true)
        if (allowCancel) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.hide();
                    if (onCancel) onCancel();
                    if (cancelRedirect) {
                        window.location.href = cancelRedirect;
                    }
                }
            });
        }

        // Close on escape key
        this.escHandler = (e) => {
            if (e.key === 'Escape' && allowCancel) {
                this.hide();
                if (onCancel) onCancel();
                if (cancelRedirect) {
                    window.location.href = cancelRedirect;
                }
            }
        };
        document.addEventListener('keydown', this.escHandler);
    }

    hide() {
        if (this.modal) {
            document.body.style.overflow = '';
            this.modal.remove();
            this.modal = null;
        }
        if (this.escHandler) {
            document.removeEventListener('keydown', this.escHandler);
            this.escHandler = null;
        }
    }

    /**
     * Show modal for specific actions
     */
    showForCart() {
        this.show({
            title: 'Login to Add to Cart',
            message: 'Create an account or log in to save items to your cart and checkout',
            icon: 'fa-shopping-cart',
            feature: 'add items to cart',
            cancelRedirect: null
        });
    }

    showForWishlist() {
        this.show({
            title: 'Login to Save Items',
            message: 'Sign in to save your favorite items and access them anytime',
            icon: 'fa-heart',
            feature: 'save to wishlist',
            cancelRedirect: null
        });
    }

    showForChat() {
        this.show({
            title: 'Login to Chat',
            message: 'Sign in to message sellers and negotiate deals',
            icon: 'fa-comments',
            feature: 'chat with sellers',
            cancelRedirect: null
        });
    }

    showForCheckout() {
        this.show({
            title: 'Login to Checkout',
            message: 'Please sign in to complete your purchase',
            icon: 'fa-credit-card',
            feature: 'checkout',
            allowCancel: true,
            cancelRedirect: 'cart.html'
        });
    }

    showForProfile() {
        this.show({
            title: 'Login Required',
            message: 'Sign in to view and manage your profile',
            icon: 'fa-user',
            feature: 'access your profile',
            allowCancel: true,
            cancelRedirect: 'index.html'
        });
    }

    showForNotifications() {
        this.show({
            title: 'Login to View Messages',
            message: 'Sign in to see your messages and notifications',
            icon: 'fa-bell',
            feature: 'view notifications',
            allowCancel: true,
            cancelRedirect: 'index.html'
        });
    }

    showForListing() {
        this.show({
            title: 'Login to Sell',
            message: 'Create an account or log in to list your products',
            icon: 'fa-store',
            feature: 'list products',
            allowCancel: true,
            cancelRedirect: 'index.html'
        });
    }

    showForDeposit() {
        this.show({
            title: 'Login Required',
            message: 'Sign in to deposit funds to your wallet',
            icon: 'fa-wallet',
            feature: 'deposit funds',
            allowCancel: true,
            cancelRedirect: 'index.html'
        });
    }

    showForOrder() {
        this.show({
            title: 'Login to Track Orders',
            message: 'Sign in to view and track your orders',
            icon: 'fa-box',
            feature: 'track orders',
            allowCancel: true,
            cancelRedirect: 'index.html'
        });
    }
}

// Create singleton instance
const authModal = new AuthModal();

// Export for ES6 modules
export default authModal;
export { AuthModal, authModal };
