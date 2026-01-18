import { getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

// ===== COUNTER CACHING SYSTEM =====
// Cache counters to reduce Firestore reads significantly
const counterCache = {
    cart: { count: 0, timestamp: 0 },
    wishlist: { count: 0, timestamp: 0 },
    chat: { count: 0, timestamp: 0 }
};

const COUNTER_CACHE_DURATION = 30 * 1000; // 30 seconds - balance between freshness and reads

// Session storage keys for persistence across page loads
const STORAGE_KEYS = {
    CART: 'oda_cart_count',
    WISHLIST: 'oda_wishlist_count',
    CHAT: 'oda_chat_count'
};

function getStoredCounter(key) {
    try {
        const stored = sessionStorage.getItem(key);
        if (stored) {
            const { count, timestamp } = JSON.parse(stored);
            if (Date.now() - timestamp < COUNTER_CACHE_DURATION) {
                return { count, valid: true };
            }
        }
    } catch (e) {}
    return { count: 0, valid: false };
}

function storeCounter(key, count) {
    try {
        sessionStorage.setItem(key, JSON.stringify({
            count,
            timestamp: Date.now()
        }));
    } catch (e) {}
}

export function animateButton(button, soundFile) {
    button.classList.add('clicked');
    setTimeout(() => {
        button.classList.remove('clicked');
    }, 300);
    
    // Ensure the sound file path is correct
    const audio = new Audio(soundFile);
    audio.play().catch(error => {
        console.error("Audio playback failed:", error);
    });
}

export function animateIconToCart(button) {
    const iconClone = button.cloneNode(true);
    const rect = button.getBoundingClientRect();

    iconClone.classList.add('icon-clone');
    iconClone.style.position = 'absolute';
    iconClone.style.top = `${rect.top}px`;
    iconClone.style.left = `${rect.left}px`;
    iconClone.style.transition = 'all 1s ease-in-out';
    iconClone.style.zIndex = '1000';
    document.body.appendChild(iconClone);

    setTimeout(() => {
        iconClone.style.top = '10px';
        iconClone.style.left = '50%';
        iconClone.style.transform = 'scale(0.5)';
    }, 100);

    setTimeout(() => {
        iconClone.remove();
    }, 1100);
}

export async function updateCartCounter(db, userId, forceRefresh = false) {
    const now = Date.now();
    
    // Check memory cache first
    if (!forceRefresh && counterCache.cart.timestamp && (now - counterCache.cart.timestamp) < COUNTER_CACHE_DURATION) {
        updateCartUI(counterCache.cart.count);
        return;
    }
    
    // Check session storage cache
    if (!forceRefresh) {
        const stored = getStoredCounter(STORAGE_KEYS.CART);
        if (stored.valid) {
            counterCache.cart = { count: stored.count, timestamp: now };
            updateCartUI(stored.count);
            return;
        }
    }
    
    // Fetch from Firestore
    const cartSnapshot = await getDocs(collection(db, `users/${userId}/cart`));
    const itemCount = cartSnapshot.size;

    // Update caches
    counterCache.cart = { count: itemCount, timestamp: now };
    storeCounter(STORAGE_KEYS.CART, itemCount);
    
    updateCartUI(itemCount);
}

function updateCartUI(itemCount) {
    // Update old cart icon if exists
    const cartIcon = document.getElementById('cart-icon');
    if (cartIcon) {
        let counter = cartIcon.querySelector('.cart-notification');
        if (!counter) {
            counter = document.createElement('span');
            counter.className = 'cart-notification';
            cartIcon.appendChild(counter);
        }
        counter.textContent = itemCount;
    }
    
    // Update nav bar counter
    const navCounter = document.getElementById('cart-count');
    if (navCounter) {
        navCounter.textContent = itemCount > 0 ? itemCount : '';
    }
}

export async function updateWishlistCounter(db, userId, forceRefresh = false) {
    const now = Date.now();
    
    // Check memory cache first
    if (!forceRefresh && counterCache.wishlist.timestamp && (now - counterCache.wishlist.timestamp) < COUNTER_CACHE_DURATION) {
        updateWishlistUI(counterCache.wishlist.count);
        return;
    }
    
    // Check session storage cache
    if (!forceRefresh) {
        const stored = getStoredCounter(STORAGE_KEYS.WISHLIST);
        if (stored.valid) {
            counterCache.wishlist = { count: stored.count, timestamp: now };
            updateWishlistUI(stored.count);
            return;
        }
    }
    
    // Fetch from Firestore
    const wishlistSnapshot = await getDocs(collection(db, `users/${userId}/wishlist`));
    const itemCount = wishlistSnapshot.size;

    // Update caches
    counterCache.wishlist = { count: itemCount, timestamp: now };
    storeCounter(STORAGE_KEYS.WISHLIST, itemCount);
    
    updateWishlistUI(itemCount);
}

function updateWishlistUI(itemCount) {
    // Update old wishlist icon if exists
    const wishlistIcon = document.getElementById('wishlist-icon');
    if (wishlistIcon) {
        let counter = wishlistIcon.querySelector('.cart-notification');
        if (!counter) {
            counter = document.createElement('span');
            counter.className = 'cart-notification';
            wishlistIcon.appendChild(counter);
        }
        counter.textContent = itemCount;
    }
    
    // Update nav bar counter
    const navCounter = document.getElementById('wishlist-count');
    if (navCounter) {
        navCounter.textContent = itemCount > 0 ? itemCount : '';
    }
}

export async function updateChatCounter(db, userId, forceRefresh = false) {
    const now = Date.now();
    
    // Check memory cache first
    if (!forceRefresh && counterCache.chat.timestamp && (now - counterCache.chat.timestamp) < COUNTER_CACHE_DURATION) {
        updateChatUI(counterCache.chat.count);
        return;
    }
    
    // Check session storage cache
    if (!forceRefresh) {
        const stored = getStoredCounter(STORAGE_KEYS.CHAT);
        if (stored.valid) {
            counterCache.chat = { count: stored.count, timestamp: now };
            updateChatUI(stored.count);
            return;
        }
    }
    
    // Fetch from Firestore
    const messagesSnapshot = await getDocs(query(collection(db, `Messages`), where("recipientId", "==", userId), where("status", "==", "sent")));
    const unreadCount = messagesSnapshot.size;

    // Update caches
    counterCache.chat = { count: unreadCount, timestamp: now };
    storeCounter(STORAGE_KEYS.CHAT, unreadCount);
    
    updateChatUI(unreadCount);
}

function updateChatUI(unreadCount) {
    // Update old notification icon if exists
    const chatIcon = document.getElementById('notification-icon');
    if (chatIcon) {
        let counter = chatIcon.querySelector('.cart-notification');
        if (!counter) {
            counter = document.createElement('span');
            counter.className = 'cart-notification';
            chatIcon.appendChild(counter);
        }
        counter.textContent = unreadCount;
    }
    
    // Update nav bar counter
    const navCounter = document.getElementById('notification-count');
    if (navCounter) {
        navCounter.textContent = unreadCount > 0 ? unreadCount : '';
    }
}

// Force refresh counters after actions that modify data
export function invalidateCartCache() {
    counterCache.cart.timestamp = 0;
    sessionStorage.removeItem(STORAGE_KEYS.CART);
}

export function invalidateWishlistCache() {
    counterCache.wishlist.timestamp = 0;
    sessionStorage.removeItem(STORAGE_KEYS.WISHLIST);
}

export function invalidateChatCache() {
    counterCache.chat.timestamp = 0;
    sessionStorage.removeItem(STORAGE_KEYS.CHAT);
}

/**
 * Update all navigation counters (cart, wishlist, notifications)
 */
export async function updateNavCounters(db, userId) {
    if (!db || !userId) return;
    
    try {
        await Promise.all([
            updateCartCounter(db, userId),
            updateWishlistCounter(db, userId),
            updateChatCounter(db, userId)
        ]);
    } catch (error) {
        console.error('Error updating nav counters:', error);
    }
}