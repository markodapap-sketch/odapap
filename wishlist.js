import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, deleteDoc, addDoc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from './js/firebase.js';
import { showNotification } from './notifications.js';
import { setupGlobalImageErrorHandler, getImageUrl } from './js/imageCache.js';
import { escapeHtml, sanitizeUrl } from './js/sanitize.js';
import authModal from './js/authModal.js';
import { invalidateWishlistCache, invalidateCartCache } from './js/utils.js';

// Setup global image error handling
setupGlobalImageErrorHandler();

// Initialize Firebase services using the app instance
const auth = getAuth(app);
const firestore = getFirestore(app);

// Get references to the DOM elements
const wishlistItemsContainer = document.getElementById('wishlist-items');
const emptyState = document.getElementById('emptyState');

// Search functionality
const searchInput = document.getElementById('searchInput');
if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const searchQuery = searchInput.value.trim();
            if (searchQuery) {
                window.location.href = `search-results.html?q=${encodeURIComponent(searchQuery)}`;
            }
        }
    });
}

// Update nav counters
async function updateNavCounters(userId) {
    try {
        // Wishlist count
        const wishlistSnapshot = await getDocs(collection(firestore, `users/${userId}/wishlist`));
        const wishlistCounter = document.getElementById('wishlistCounter');
        if (wishlistCounter) {
            wishlistCounter.textContent = wishlistSnapshot.size;
        }
        
        // Cart count
        const cartSnapshot = await getDocs(collection(firestore, `users/${userId}/cart`));
        const cartCounter = document.getElementById('cartCounter');
        if (cartCounter) {
            cartCounter.textContent = cartSnapshot.size;
        }
        
        // Notification count
        const notifQuery = query(
            collection(firestore, `users/${userId}/notifications`),
            where('read', '==', false)
        );
        const notifSnapshot = await getDocs(notifQuery);
        const notifCounter = document.getElementById('notificationCounter');
        if (notifCounter) {
            notifCounter.textContent = notifSnapshot.size;
        }
    } catch (error) {
        console.error('Error updating counters:', error);
    }
}

// Function to load wishlist items from Firestore
const loadWishlistItems = async (user) => {
    if (!user) {
        showNotification('Please log in to view your wishlist.');
        return;
    }
    try {
        const wishlistItemsSnapshot = await getDocs(collection(firestore, `users/${user.uid}/wishlist`));
        wishlistItemsContainer.innerHTML = '';

        if (wishlistItemsSnapshot.empty) {
            wishlistItemsContainer.style.display = 'none';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        wishlistItemsContainer.style.display = 'grid';
        if (emptyState) emptyState.style.display = 'none';

        wishlistItemsSnapshot.forEach(docSnap => {
            const item = docSnap.data();
            const imageUrl = item.imageUrls?.[0] || item.photoUrl || item.imageUrl || 'images/product-placeholder.png';
            const price = item.price || 0;
            const originalPrice = item.originalPrice || item.retailPrice;
            
            // Sanitize user content
            const safeImageUrl = sanitizeUrl(imageUrl, 'images/product-placeholder.png');
            const safeName = escapeHtml(item.name || 'Product');
            const safeBrand = escapeHtml(item.brand || '');
            const safeListingId = encodeURIComponent(item.listingId || '');
            const safeDocId = escapeHtml(docSnap.id || '');
            
            const wishlistItemElement = document.createElement('div');
            wishlistItemElement.className = 'wishlist-item';
            wishlistItemElement.innerHTML = `
                <img src="${safeImageUrl}" alt="${safeName}" class="wishlist-item-image" 
                     onclick="window.location.href='product.html?id=${safeListingId}'"
                     onerror="this.src='images/product-placeholder.png'">
                <div class="wishlist-item-details">
                    <h3 onclick="window.location.href='product.html?id=${safeListingId}'">${safeName}</h3>
                    <p class="brand">${safeBrand}</p>
                    <p class="price">KES ${price.toLocaleString()}</p>
                    ${originalPrice ? `<p class="original-price">KES ${originalPrice.toLocaleString()}</p>` : ''}
                    <div class="wishlist-actions">
                        <button class="add-to-cart-btn" data-doc-id="${safeDocId}" data-listing-id="${safeListingId}">
                            <i class="fas fa-shopping-cart"></i> Add to Cart
                        </button>
                        <button class="remove-button" data-id="${safeDocId}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
            wishlistItemsContainer.appendChild(wishlistItemElement);
        });

    } catch (error) {
        console.error('Error loading wishlist items:', error);
        showNotification('Error loading wishlist', 'error');
    }
};

// Add to cart function
window.addToCart = async function(wishlistItemId, listingId) {
    const user = auth.currentUser;
    if (!user) {
        showNotification('Please log in first', 'error');
        return;
    }
    
    try {
        // Get item data from wishlist
        const wishlistDoc = await getDoc(doc(firestore, `users/${user.uid}/wishlist/${wishlistItemId}`));
        if (!wishlistDoc.exists()) {
            showNotification('Item not found', 'error');
            return;
        }
        
        const itemData = wishlistDoc.data();
        
        // Add to cart
        await addDoc(collection(firestore, `users/${user.uid}/cart`), {
            listingId: listingId,
            name: itemData.name,
            brand: itemData.brand,
            price: itemData.price,
            imageUrls: itemData.imageUrls,
            photoUrl: itemData.photoUrl || itemData.imageUrls?.[0],
            quantity: 1,
            addedAt: new Date()
        });
        
        showNotification('Added to cart!');
        invalidateCartCache(); // Invalidate cart cache
        updateNavCounters(user.uid);
    } catch (error) {
        console.error('Error adding to cart:', error);
        showNotification('Failed to add to cart', 'error');
    }
};

// Add an auth state observer to check user login status
onAuthStateChanged(auth, (user) => {
    if (user) {
        loadWishlistItems(user);
        updateNavCounters(user.uid);
    } else {
        // Show login modal with cancel option
        authModal.show({
            title: 'Login to View Wishlist',
            message: 'Sign in to save your favorite items and access them anytime',
            icon: 'fa-heart',
            feature: 'view your wishlist',
            allowCancel: true,
            cancelRedirect: 'index.html'
        });
    }
});

// Handle add-to-cart clicks via event delegation
wishlistItemsContainer.addEventListener('click', (event) => {
    const cartBtn = event.target.closest('.add-to-cart-btn');
    if (cartBtn) {
        const docId = cartBtn.dataset.docId;
        const listingId = cartBtn.dataset.listingId;
        if (docId && listingId) {
            window.addToCart(docId, listingId);
        }
    }
});

// Function to remove an item from the wishlist
wishlistItemsContainer.addEventListener('click', async (event) => {
    if (event.target.classList.contains('remove-button') || event.target.closest('.remove-button')) {
        const btn = event.target.closest('.remove-button') || event.target;
        const itemId = btn.getAttribute('data-id');
        const user = auth.currentUser;
        if (user && itemId) {
            try {
                await deleteDoc(doc(firestore, `users/${user.uid}/wishlist/${itemId}`));
                showNotification('Removed from wishlist');
                invalidateWishlistCache(); // Invalidate wishlist cache
                loadWishlistItems(user);
                updateNavCounters(user.uid);
            } catch (error) {
                console.error('Error removing wishlist item:', error);
                showNotification('Error removing item', 'error');
            }
        }
    }
});

// Function to add item to wishlist (exported for other pages)
window.addToWishlist = async function (listingId) {
    const user = auth.currentUser;
    if (user) {
        const listingRef = doc(firestore, `Listings/${listingId}`);
        const snapshot = await getDoc(listingRef);
        const listing = snapshot.data();

        try {
            await addDoc(collection(firestore, `users/${user.uid}/wishlist`), {
                userId: user.uid,
                listingId: listingId,
                ...listing
            });
            showNotification('Item added to wishlist!');
            loadWishlistItems(user);
            updateNavCounters(user.uid);
        } catch (error) {
            console.error('Error adding item to wishlist:', error);
            showNotification('Failed to add item to wishlist. Please try again.');
        }
    } else {
        showNotification('Please log in to add items to the wishlist.');
    }
};