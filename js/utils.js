import { getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

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

export async function updateCartCounter(db, userId) {
    const cartSnapshot = await getDocs(collection(db, `users/${userId}/cart`));
    const itemCount = cartSnapshot.size;

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

export async function updateWishlistCounter(db, userId) {
    const wishlistSnapshot = await getDocs(collection(db, `users/${userId}/wishlist`));
    const itemCount = wishlistSnapshot.size;

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

export async function updateChatCounter(db, userId) {
    const messagesSnapshot = await getDocs(query(collection(db, `Messages`), where("recipientId", "==", userId), where("status", "==", "sent")));
    const unreadCount = messagesSnapshot.size;

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