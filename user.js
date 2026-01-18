import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getDocs,
    deleteDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from "./js/firebase.js";
import { showNotification } from './notifications.js';
import { setupGlobalImageErrorHandler, getImageUrl } from './js/imageCache.js';
import { escapeHtml, sanitizeUrl } from './js/sanitize.js';

const auth = getAuth(app);
const db = getFirestore(app);

// Setup global image error handling
setupGlobalImageErrorHandler();

let currentUser = null;
let profileUserId = null;
let isOwnProfile = false;
let userItems = [];

// Get userId from URL
const urlParams = new URLSearchParams(window.location.search);
profileUserId = urlParams.get('userId');

// Tab Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        
        // Remove active class from all tabs
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        // Add active class to clicked tab
        btn.classList.add('active');
        document.getElementById(`${tabName}-tab`).classList.add('active');
    });
});

// Load user profile
async function loadUserProfile() {
    // Skip if required elements don't exist (not on user.html page)
    if (!document.getElementById('userName')) {
        return;
    }
    
    try {
        if (!profileUserId) {
            showNotification('User not found', 'error');
            return;
        }

        const userDoc = await getDoc(doc(db, 'Users', profileUserId));
        if (!userDoc.exists()) {
            showNotification('User not found', 'error');
            return;
        }

        const userData = userDoc.data();
        
        // Update profile header (with null checks)
        const profilePicEl = document.getElementById('userProfilePic');
        const userNameEl = document.getElementById('userName');
        const userLocationEl = document.getElementById('userLocation');
        const userJoinDateEl = document.getElementById('userJoinDate');
        const userBioEl = document.getElementById('userBio');
        const userEmailEl = document.getElementById('userEmail');
        const userPhoneEl = document.getElementById('userPhone');
        const aboutTextEl = document.getElementById('aboutText');
        
        if (profilePicEl) profilePicEl.src = userData.profilePicUrl || 'images/profile-placeholder.png';
        if (userNameEl) userNameEl.textContent = userData.name || 'Unknown User';
        if (userLocationEl) userLocationEl.textContent = `${userData.county || ''}, ${userData.region || ''}`;
        if (userJoinDateEl) userJoinDateEl.textContent = `Joined ${new Date(userData.createdAt || Date.now()).toLocaleDateString()}`;
        if (userBioEl) userBioEl.textContent = userData.bio || 'No bio provided';
        if (userEmailEl) userEmailEl.textContent = userData.email || 'Not available';
        if (userPhoneEl) userPhoneEl.textContent = userData.phone || 'Not available';
        if (aboutTextEl) aboutTextEl.textContent = userData.about || 'No additional information provided';

        // Check if this is own profile
        if (currentUser && currentUser.uid === profileUserId) {
            isOwnProfile = true;
            const editBtn = document.getElementById('editProfileBtn');
            const manageBtn = document.getElementById('manageBtn');
            const messageBtn = document.getElementById('messageBtn');
            const followBtn = document.getElementById('followBtn');
            
            if (editBtn) editBtn.style.display = 'block';
            if (manageBtn) manageBtn.style.display = 'block';
            if (messageBtn) messageBtn.style.display = 'none';
            if (followBtn) followBtn.style.display = 'none';
        }

        // Load user items
        await loadUserItems();

        // Load user reviews
        await loadUserReviews();
        
        // Load user orders (only for own profile)
        if (isOwnProfile) {
            await loadUserOrders();
        }

    } catch (error) {
        console.error('Error loading user profile:', error);
        showNotification('Failed to load user profile', 'error');
    }
}

// Load user items
async function loadUserItems() {
    try {
        const itemsQuery = query(
            collection(db, 'Listings'),
            where('uploaderId', '==', profileUserId)
        );
        
        const itemsSnapshot = await getDocs(itemsQuery);
        userItems = [];

        itemsSnapshot.forEach(doc => {
            userItems.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // Update counts
        document.getElementById('itemsCount').textContent = userItems.length;
        document.getElementById('tabItemsCount').textContent = userItems.length;

        displayUserItems();
        displayManageItems();

    } catch (error) {
        console.error('Error loading user items:', error);
    }
}

// Display user items
function displayUserItems() {
    const itemsList = document.getElementById('userItemsList');
    itemsList.innerHTML = '';

    if (userItems.length === 0) {
        itemsList.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <i class="fas fa-inbox"></i>
                <h3>No items listed</h3>
                <p>This user hasn't listed any items yet</p>
            </div>
        `;
        return;
    }

    userItems.forEach(item => {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.onclick = () => window.location.href = `product.html?id=${encodeURIComponent(item.id)}`;
        
        const imageUrl = item.photoTraceUrl || (item.imageUrls && item.imageUrls[0]) || 'images/product-placeholder.png';
        const safeImageUrl = sanitizeUrl(imageUrl, 'images/product-placeholder.png');
        const safeName = escapeHtml(item.name || 'Product');

        card.innerHTML = `
            <div class="item-image">
                <img src="${safeImageUrl}" alt="${safeName}">
            </div>
            <div class="item-info">
                <div class="item-name">${safeName}</div>
                <div class="item-price">KES ${(item.price || 0).toLocaleString()}</div>
                <div class="item-stock">${item.totalStock || 0} in stock</div>
            </div>
        `;

        itemsList.appendChild(card);
    });
}

// Display manage items (for owner only)
function displayManageItems() {
    const manageList = document.getElementById('manageItemsList');
    manageList.innerHTML = '';

    if (!isOwnProfile) return;

    if (userItems.length === 0) {
        manageList.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <i class="fas fa-inbox"></i>
                <h3>No items to manage</h3>
                <p>Create your first listing to get started</p>
            </div>
        `;
        return;
    }

    userItems.forEach(item => {
        const card = document.createElement('div');
        card.className = 'manage-item-card';
        
        const imageUrl = item.photoTraceUrl || (item.imageUrls && item.imageUrls[0]) || 'images/product-placeholder.png';
        const status = item.totalStock > 0 ? 'active' : 'sold';
        
        const safeImageUrl = sanitizeUrl(imageUrl, 'images/product-placeholder.png');
        const safeName = escapeHtml(item.name || 'Product');
        const safeBrand = escapeHtml(item.brand || 'No brand');
        const safeId = escapeHtml(item.id || '');

        card.innerHTML = `
            <div class="manage-item-image">
                <img src="${safeImageUrl}" alt="${safeName}">
                <span class="item-status-badge ${status}">${status === 'active' ? 'Active' : 'Sold Out'}</span>
            </div>
            <div class="manage-item-body">
                <div class="manage-item-name">${safeName}</div>
                <div class="manage-item-meta">
                    <span>${safeBrand}</span>
                    <span>${item.totalStock || 0} in stock</span>
                </div>
                <div class="manage-item-price">KES ${(item.price || 0).toLocaleString()}</div>
                <div class="manage-item-actions">
                    <button class="manage-btn edit-item-btn" onclick="editItem('${safeId}')">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="manage-btn delete-item-btn" onclick="deleteItem('${safeId}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        `;

        manageList.appendChild(card);
    });
}

// Edit item
window.editItem = function(itemId) {
    window.location.href = `listing.html?edit=${itemId}`;
};

// Delete item
window.deleteItem = async function(itemId) {
    // Create confirmation modal
    const modal = document.createElement('div');
    modal.className = 'confirmation-modal';
    modal.innerHTML = `
        <div class="confirmation-content">
            <i class="fas fa-trash-alt" style="font-size: 48px; color: #dc3545; margin-bottom: 16px;"></i>
            <h3>Delete Item?</h3>
            <p>Are you sure you want to delete this item? This action cannot be undone.</p>
            <div class="confirmation-buttons">
                <button class="cancel-btn">Cancel</button>
                <button class="confirm-btn danger">Delete</button>
            </div>
        </div>
    `;
    
    // Add modal styles if not already present
    if (!document.getElementById('confirmModalStyles')) {
        const style = document.createElement('style');
        style.id = 'confirmModalStyles';
        style.textContent = `
            .confirmation-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                animation: fadeIn 0.2s ease;
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .confirmation-content {
                background: white;
                padding: 32px;
                border-radius: 16px;
                text-align: center;
                max-width: 400px;
                width: 90%;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            .confirmation-content h3 {
                margin: 0 0 8px;
                color: #333;
            }
            .confirmation-content p {
                color: #666;
                margin: 0 0 24px;
            }
            .confirmation-buttons {
                display: flex;
                gap: 12px;
                justify-content: center;
            }
            .confirmation-buttons button {
                padding: 12px 24px;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
            }
            .confirmation-buttons .cancel-btn {
                background: #f0f0f0;
                color: #333;
            }
            .confirmation-buttons .cancel-btn:hover {
                background: #e0e0e0;
            }
            .confirmation-buttons .confirm-btn.danger {
                background: #dc3545;
                color: white;
            }
            .confirmation-buttons .confirm-btn.danger:hover {
                background: #c82333;
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(modal);
    
    return new Promise((resolve) => {
        modal.querySelector('.cancel-btn').onclick = () => {
            modal.remove();
            resolve();
        };
        modal.querySelector('.confirm-btn').onclick = async () => {
            modal.remove();
            try {
                await deleteDoc(doc(db, 'Listings', itemId));
                showNotification('Item deleted successfully');
                await loadUserItems();
            } catch (error) {
                console.error('Error deleting item:', error);
                showNotification('Failed to delete item', 'error');
            }
            resolve();
        };
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve();
            }
        };
    });
};

// Load user reviews
async function loadUserReviews() {
    try {
        // This would query reviews collection based on your database structure
        // For now, showing placeholder
        const reviewsList = document.getElementById('reviewsList');
        reviewsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-star"></i>
                <h3>No reviews yet</h3>
                <p>Reviews will appear here as customers leave feedback</p>
            </div>
        `;
    } catch (error) {
        console.error('Error loading reviews:', error);
    }
}

// Load user orders (for own profile only)
async function loadUserOrders() {
    if (!isOwnProfile) return;
    
    const ordersList = document.getElementById('ordersList');
    const emptyOrders = document.getElementById('emptyOrders');
    
    if (!ordersList) return;
    
    try {
        const ordersQuery = query(
            collection(db, 'Orders'),
            where('userId', '==', profileUserId)
        );
        
        const ordersSnapshot = await getDocs(ordersQuery);
        
        if (ordersSnapshot.empty) {
            ordersList.style.display = 'none';
            if (emptyOrders) emptyOrders.style.display = 'block';
            return;
        }
        
        ordersList.style.display = 'grid';
        if (emptyOrders) emptyOrders.style.display = 'none';
        ordersList.innerHTML = '';
        
        const statusConfig = {
            pending: { label: 'Pending', color: '#ff9800', icon: 'hourglass-half' },
            confirmed: { label: 'Confirmed', color: '#2196F3', icon: 'check' },
            out_for_delivery: { label: 'In Transit', color: '#9c27b0', icon: 'truck' },
            delivered: { label: 'Delivered', color: '#4CAF50', icon: 'check-circle' },
            cancelled: { label: 'Cancelled', color: '#f44336', icon: 'times-circle' }
        };
        
        ordersSnapshot.forEach(docSnap => {
            const order = docSnap.data();
            const status = order.status || order.orderStatus || 'pending';
            const config = statusConfig[status] || statusConfig.pending;
            const firstItem = order.items?.[0] || order;
            const orderDate = order.createdAt?.toDate?.() || new Date(order.createdAt) || new Date();
            const totalAmount = order.totalAmount || order.total || (firstItem.price * (firstItem.quantity || 1));
            
            const card = document.createElement('div');
            card.className = 'order-card';
            card.onclick = () => window.location.href = `orderTracking.html`;
            
            card.innerHTML = `
                <div class="order-card-header">
                    <span class="order-id">#${docSnap.id.slice(-8).toUpperCase()}</span>
                    <span class="order-status" style="background: ${config.color}20; color: ${config.color}">
                        <i class="fas fa-${config.icon}"></i> ${config.label}
                    </span>
                </div>
                <div class="order-card-body">
                    <img src="${firstItem.photoUrl || firstItem.imageUrl || (firstItem.imageUrls && firstItem.imageUrls[0]) || 'images/product-placeholder.png'}" 
                         alt="${firstItem.name}" onerror="this.src='images/product-placeholder.png'">
                    <div class="order-card-info">
                        <h4>${firstItem.name || 'Product'}</h4>
                        <p class="order-date">${orderDate.toLocaleDateString()}</p>
                        <p class="order-price">KES ${totalAmount.toLocaleString()}</p>
                    </div>
                </div>
            `;
            
            ordersList.appendChild(card);
        });
        
    } catch (error) {
        console.error('Error loading orders:', error);
    }
}

// Edit profile button
document.getElementById('editProfileBtn')?.addEventListener('click', () => {
    window.location.href = 'profile.html';
});

// Message seller button
document.getElementById('messageBtn')?.addEventListener('click', () => {
    const user = auth.currentUser;
    if (user) {
        window.location.href = `chat.html?sellerId=${profileUserId}`;
    } else {
        showNotification('Please log in to message', 'warning');
    }
});

// Follow button
let isFollowing = false;
document.getElementById('followBtn')?.addEventListener('click', function() {
    isFollowing = !isFollowing;
    if (isFollowing) {
        this.classList.add('following');
        this.innerHTML = '<i class="fas fa-heart"></i> Following';
        showNotification('Following this seller');
    } else {
        this.classList.remove('following');
        this.innerHTML = '<i class="fas fa-heart"></i> Follow';
    }
});

// Sort items
document.getElementById('sortItems')?.addEventListener('change', (e) => {
    const sortBy = e.target.value;
    
    switch(sortBy) {
        case 'newest':
            userItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            break;
        case 'oldest':
            userItems.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            break;
        case 'price-low':
            userItems.sort((a, b) => a.price - b.price);
            break;
        case 'price-high':
            userItems.sort((a, b) => b.price - a.price);
            break;
    }
    
    displayUserItems();
    displayManageItems();
});

// Search items
document.getElementById('searchItems')?.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filteredItems = userItems.filter(item => 
        item.name.toLowerCase().includes(searchTerm)
    );
    
    const manageList = document.getElementById('manageItemsList');
    manageList.innerHTML = '';
    
    if (filteredItems.length === 0) {
        manageList.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><p>No items found</p></div>';
        return;
    }
    
    filteredItems.forEach(item => {
        const card = document.createElement('div');
        card.className = 'manage-item-card';
        const imageUrl = item.photoTraceUrl || (item.imageUrls && item.imageUrls[0]) || 'images/product-placeholder.png';
        const status = item.totalStock > 0 ? 'active' : 'sold';

        card.innerHTML = `
            <div class="manage-item-image">
                <img src="${imageUrl}" alt="${item.name}">
                <span class="item-status-badge ${status}">${status === 'active' ? 'Active' : 'Sold Out'}</span>
            </div>
            <div class="manage-item-body">
                <div class="manage-item-name">${item.name}</div>
                <div class="manage-item-meta">
                    <span>${item.brand || 'No brand'}</span>
                    <span>${item.totalStock || 0} in stock</span>
                </div>
                <div class="manage-item-price">KES ${item.price.toLocaleString()}</div>
                <div class="manage-item-actions">
                    <button class="manage-btn edit-item-btn" onclick="editItem('${item.id}')">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="manage-btn delete-item-btn" onclick="deleteItem('${item.id}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        `;

        manageList.appendChild(card);
    });
});

// Initialize
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        if (!profileUserId) {
            profileUserId = user.uid;
        }
        loadUserProfile();
    } else {
        if (!profileUserId) {
            window.location.href = 'login.html';
        } else {
            loadUserProfile();
        }
    }
});
