import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, deleteDoc, addDoc, updateDoc, getDoc, setDoc, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from './js/firebase.js';
import { showNotification } from './notifications.js';
import { updateCartCounter, updateWishlistCounter, updateChatCounter, invalidateCartCache } from './js/utils.js';
import { setupGlobalImageErrorHandler, getImageUrl } from './js/imageCache.js';
import { escapeHtml, sanitizeUrl } from './js/sanitize.js';
import { OdaModal } from './js/odaModal.js';
import authModal from './js/authModal.js';

// Setup global image error handling
setupGlobalImageErrorHandler();

const auth = getAuth(app);
const firestore = getFirestore(app);

const cartItemsContainer = document.getElementById('cart-items');
const totalPriceElement = document.getElementById('total-price');
const subtotalElement = document.getElementById('subtotal');
const deliveryFeeElement = document.getElementById('delivery-fee');
const checkoutButton = document.getElementById('checkout-button');
const clearCartBtn = document.getElementById('clear-cart-btn');
const emptyCartEl = document.getElementById('empty-cart');
const cartSummary = document.getElementById('cart-summary');
const cartCountText = document.getElementById('cart-count-text');

class CartManager {
    constructor() {
        this.cartItems = new Map();
        this.user = null;
        this.deliveryFee = 0;
    }

    updateCartCounters() {
        const count = this.getTotalItemCount();
        // Update nav counter
        const navCounter = document.getElementById('cart-count');
        if (navCounter) navCounter.textContent = count > 0 ? count : '';
        // Update page text
        if (cartCountText) cartCountText.textContent = `${count} item${count !== 1 ? 's' : ''} in your cart`;
    }

    getTotalItemCount() {
        let count = 0;
        this.cartItems.forEach(item => count += item.quantity);
        return count;
    }

    async loadCartItems(user) {
        if (!user) {
            showNotification('Please log in to view your cart.');
            return;
        }

        try {
            const cartSnapshot = await getDocs(collection(firestore, `users/${user.uid}/cart`));
            this.cartItems.clear();
            
            cartItemsContainer.innerHTML = '';

            if (cartSnapshot.empty) {
                this.showEmptyState();
                return;
            }

            cartSnapshot.forEach(docSnap => {
                const item = docSnap.data();
                const itemKey = this.generateItemKey(item);
                
                if (this.cartItems.has(itemKey)) {
                    const existing = this.cartItems.get(itemKey);
                    existing.quantity += (item.quantity || 1);
                    existing.docIds.push(docSnap.id);
                } else {
                    this.cartItems.set(itemKey, {
                        docId: docSnap.id,
                        docIds: [docSnap.id],
                        listingId: item.listingId,
                        name: item.name,
                        price: item.selectedVariation?.price || item.price,
                        quantity: item.quantity || 1,
                        selectedVariation: item.selectedVariation || null,
                        imageUrl: item.selectedVariation?.photoUrl || item.selectedVariation?.imageUrl || item.photoTraceUrl || item.imageUrls?.[0] || 'images/product-placeholder.png',
                        retailPrice: item.selectedVariation?.retailPrice || item.retailPrice || null,
                        ...item
                    });
                }
            });

            this.displayCartItems();
            this.updateTotals();
            emptyCartEl.style.display = 'none';
            cartSummary.style.display = 'block';

        } catch (error) {
            console.error('Error loading cart items:', error);
            showNotification('Error loading cart items');
        }
    }

    showEmptyState() {
        cartItemsContainer.innerHTML = '';
        emptyCartEl.style.display = 'flex';
        cartSummary.style.display = 'none';
        this.updateCartCounters();
    }

    generateItemKey(item) {
        const variationKey = item.selectedVariation ? 
            `-${item.selectedVariation.attr_name || item.selectedVariation.display || ''}` : '';
        return `${item.listingId}${variationKey}`;
    }

    displayCartItems() {
        cartItemsContainer.innerHTML = '';

        this.cartItems.forEach((item, itemKey) => {
            const itemTotal = item.price * item.quantity;
            const variantName = item.selectedVariation?.attr_name || item.selectedVariation?.display || item.selectedVariation?.variationTitle || '';
            const minQty = item.minOrderQuantity || 1;
            const qtyBelowMin = item.quantity < minQty;
            
            const cartItemEl = document.createElement('div');
            cartItemEl.className = 'cart-item';
            cartItemEl.dataset.itemKey = itemKey;
            
            // Sanitize user content
            const safeName = escapeHtml(item.name || 'Product');
            const safeVariantName = escapeHtml(variantName);
            const safeImageUrl = sanitizeUrl(item.imageUrl, 'images/product-placeholder.png');
            const safeListingId = encodeURIComponent(item.listingId || '');
            const safeItemKey = escapeHtml(itemKey);
            
            cartItemEl.innerHTML = `
                <img src="${safeImageUrl}" alt="${safeName}" class="cart-item-image" onclick="window.location.href='product.html?id=${safeListingId}'">
                <div class="cart-item-content">
                    <div class="cart-item-header">
                        <h4 class="cart-item-name">${safeName}</h4>
                    </div>
                    ${safeVariantName ? `<span class="cart-item-variant">${safeVariantName}</span>` : ''}
                    <p class="cart-item-price">KES ${(item.price || 0).toLocaleString()}</p>
                    ${item.retailPrice ? `<p class="cart-item-retail">Retail: KES ${item.retailPrice.toLocaleString()}</p>` : ''}
                    ${minQty > 1 ? `<p class="min-order-note" style="font-size: 0.8rem; color: ${qtyBelowMin ? '#e74c3c' : 'var(--text-muted)'};">Min order: ${minQty} units</p>` : ''}
                    <div class="cart-item-actions">
                        <div class="quantity-controls">
                            <button class="qty-btn" data-action="decrease" data-key="${safeItemKey}">−</button>
                            <span>${item.quantity}</span>
                            <button class="qty-btn" data-action="increase" data-key="${safeItemKey}">+</button>
                        </div>
                        <button class="remove-btn" data-key="${safeItemKey}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                    <p style="font-weight: 600; margin-top: 5px;">Subtotal: KES ${itemTotal.toLocaleString()}</p>
                </div>
            `;

            cartItemsContainer.appendChild(cartItemEl);
        });

        this.attachEventListeners();
    }

    attachEventListeners() {
        // Quantity controls
        document.querySelectorAll('.qty-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const itemKey = btn.dataset.key;
                this.updateQuantity(itemKey, action);
            });
        });

        // Remove buttons
        document.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemKey = btn.dataset.key;
                this.removeItem(itemKey);
            });
        });
    }

    async updateQuantity(itemKey, action) {
        const item = this.cartItems.get(itemKey);
        if (!item) return;

        const minQty = item.minOrderQuantity || 1;

        if (action === 'increase') {
            item.quantity += 1;
        } else if (action === 'decrease') {
            if (item.quantity > minQty) {
                item.quantity -= 1;
            } else {
                // If at minimum, prompt to remove
                this.removeItem(itemKey);
                return;
            }
        }

        // Update in Firestore
        await this.syncQuantityToFirestore(item);

        // Update display
        this.displayCartItems();
        this.updateTotals();
    }

    async syncQuantityToFirestore(item) {
        try {
            // Update the first document with the new quantity
            const docRef = doc(firestore, `users/${this.user.uid}/cart/${item.docId}`);
            await updateDoc(docRef, {
                quantity: item.quantity
            });

            // If there are duplicate documents (from old logic), remove them
            if (item.docIds.length > 1) {
                for (let i = 1; i < item.docIds.length; i++) {
                    await deleteDoc(doc(firestore, `users/${this.user.uid}/cart/${item.docIds[i]}`));
                }
                item.docIds = [item.docId]; // Keep only the first one
            }
        } catch (error) {
            console.error('Error syncing quantity:', error);
        }
    }

    async removeItem(itemKey) {
        const confirmed = await OdaModal.confirm({
            title: 'Remove Item',
            message: 'Remove this item from cart?',
            icon: 'trash-alt',
            confirmText: 'Remove',
            dangerous: true
        });
        if (!confirmed) return;

        const item = this.cartItems.get(itemKey);
        if (!item) return;

        try {
            // Delete all associated documents
            for (const docId of item.docIds) {
                await deleteDoc(doc(firestore, `users/${this.user.uid}/cart/${docId}`));
            }

            this.cartItems.delete(itemKey);
            this.displayCartItems();
            this.updateTotals();
            showNotification('Item removed from cart');
            
            // Invalidate cart cache so counter updates across pages
            invalidateCartCache();

            // Check if cart is empty
            if (this.cartItems.size === 0) {
                cartItemsContainer.innerHTML = '<p class="empty-cart-message">Your cart is empty.</p>';
                checkoutButton.disabled = true;
            }
        } catch (error) {
            console.error('Error removing item:', error);
            showNotification('Error removing item');
        }
    }

    updateTotals() {
        let subtotal = 0;
        let itemCount = 0;

        this.cartItems.forEach(item => {
            subtotal += item.price * item.quantity;
            itemCount += item.quantity;
        });

        const total = subtotal + this.deliveryFee;
        
        if (subtotalElement) subtotalElement.textContent = `KES ${subtotal.toLocaleString()}`;
        if (deliveryFeeElement) deliveryFeeElement.textContent = `KES ${this.deliveryFee.toLocaleString()}`;
        if (totalPriceElement) totalPriceElement.textContent = `KES ${total.toLocaleString()}`;
        
        this.updateCartCounters();
    }

    async clearCart() {
        const confirmed = await OdaModal.confirm({
            title: 'Clear Cart',
            message: 'Are you sure you want to clear your entire cart?',
            icon: 'trash-alt',
            confirmText: 'Clear All',
            dangerous: true
        });
        if (!confirmed) return;
        
        try {
            for (const [itemKey, item] of this.cartItems) {
                for (const docId of item.docIds) {
                    await deleteDoc(doc(firestore, `users/${this.user.uid}/cart/${docId}`));
                }
            }
            this.cartItems.clear();
            this.showEmptyState();
            showNotification('Cart cleared');
            
            // Invalidate cart cache
            invalidateCartCache();
        } catch (error) {
            console.error('Error clearing cart:', error);
            showNotification('Error clearing cart');
        }
    }

    async addToCart(listingId) {
        if (!this.user) {
            showNotification('Please log in to add items to cart');
            return;
        }

        try {
            const listingRef = doc(firestore, `Listings/${listingId}`);
            const snapshot = await getDoc(listingRef);
            
            if (!snapshot.exists()) {
                showNotification('Product not found');
                return;
            }

            const listing = snapshot.data();

            // Check if item already exists
            const itemKey = this.generateItemKey({ listingId, selectedVariation: null });
            const existingItem = this.cartItems.get(itemKey);

            if (existingItem) {
                // Update quantity
                existingItem.quantity += 1;
                await this.syncQuantityToFirestore(existingItem);
            } else {
                // Add new item
                await addDoc(collection(firestore, `users/${this.user.uid}/cart`), {
                    userId: this.user.uid,
                    listingId: listingId,
                    quantity: 1,
                    ...listing,
                    addedAt: new Date().toISOString()
                });
            }

            showNotification('Item added to cart!');
            
            // Invalidate cart cache so counter updates
            invalidateCartCache();
            
            await this.loadCartItems(this.user);

        } catch (error) {
            console.error('Error adding to cart:', error);
            showNotification('Failed to add item to cart');
        }
    }
}

// Initialize cart manager
const cartManager = new CartManager();

// Auth state observer
onAuthStateChanged(auth, async (user) => {
    if (user) {
        cartManager.user = user;
        await cartManager.loadCartItems(user);
        // Update all counters
        await updateCartCounter(firestore, user.uid);
        await updateWishlistCounter(firestore, user.uid);
        await updateChatCounter(firestore, user.uid);
    } else {
        // Show login modal instead of just redirecting
        authModal.show({
            title: 'Login to View Cart',
            message: 'Sign in to view your cart items and continue shopping',
            icon: 'fa-shopping-cart',
            feature: 'view your cart',
            allowCancel: true,
            cancelRedirect: 'index.html'
        });
    }
});

// Checkout button
checkoutButton?.addEventListener('click', () => {
    if (auth.currentUser && cartManager.cartItems.size > 0) {
        window.location.href = 'checkout.html?source=cart';
    } else if (!auth.currentUser) {
        showNotification('Please log in to checkout');
    } else {
        showNotification('Your cart is empty');
    }
});

// Clear cart button
clearCartBtn?.addEventListener('click', () => {
    cartManager.clearCart();
});

// ===== SEARCH FUNCTIONALITY =====
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const searchSuggestions = document.getElementById('searchSuggestions');

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const performSearch = async (searchTerm) => {
    if (!searchTerm || searchTerm.length < 2) {
        searchSuggestions.style.display = 'none';
        return;
    }
    
    try {
        const listingsRef = collection(firestore, "Listings");
        const q = query(
            listingsRef,
            where("name", ">=", searchTerm.toLowerCase()),
            where("name", "<=", searchTerm.toLowerCase() + '\uf8ff'),
            limit(8)
        );
        const querySnapshot = await getDocs(q);
        searchSuggestions.innerHTML = '';
        
        if (querySnapshot.empty) {
            searchSuggestions.style.display = 'none';
            return;
        }

        querySnapshot.forEach((doc) => {
            const listing = doc.data();
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerHTML = `
                <img src="${listing.imageUrls?.[0] || 'images/product-placeholder.png'}" alt="${listing.name}">
                <span>${listing.name}</span>
                <span style="margin-left: auto; color: #ff5722; font-weight: 600;">KES ${(listing.price || 0).toLocaleString()}</span>
            `;
            div.addEventListener('click', () => {
                window.location.href = `product.html?id=${doc.id}`;
            });
            searchSuggestions.appendChild(div);
        });
        searchSuggestions.style.display = 'block';
    } catch (error) {
        console.error('Search error:', error);
    }
};

const debouncedSearch = debounce((e) => performSearch(e.target.value), 300);

searchInput?.addEventListener('input', debouncedSearch);

searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const searchTerm = searchInput.value.trim();
    if (searchTerm) {
        window.location.href = `search-results.html?q=${encodeURIComponent(searchTerm)}`;
    }
});

document.addEventListener('click', (e) => {
    if (searchSuggestions && !searchSuggestions.contains(e.target) && !searchInput?.contains(e.target)) {
        searchSuggestions.style.display = 'none';
    }
});

// Export for use in other pages
window.addToCart = (listingId) => cartManager.addToCart(listingId);