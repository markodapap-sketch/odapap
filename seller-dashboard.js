/**
 * Seller Dashboard - Oda Pap
 * Complete seller management hub with order handling, dispatch photos, earnings tracking
 */

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    query, 
    where, 
    getDocs, 
    getDoc,
    doc, 
    updateDoc, 
    addDoc,
    orderBy,
    Timestamp,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { app } from "./js/firebase.js";
import { setupGlobalImageErrorHandler, getImageUrl } from './js/imageCache.js';
import { escapeHtml, sanitizeUrl } from './js/sanitize.js';

// Initialize Firebase
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Setup image error handling
setupGlobalImageErrorHandler();

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const state = {
    user: null,
    userData: null,
    section: 'overview',
    orders: [],
    products: [],
    earnings: {
        available: 0,
        pending: 0,
        lifetime: 0
    },
    dispatchOrderId: null,
    dispatchPhoto: null,
    unsubscribers: [],
    notifications: [],
    unreadCount: 0
};

const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
function toast(msg, type = 'info', duration = 3500) {
    const container = $('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const safeMsg = escapeHtml(msg);
    el.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : 'info-circle'}"></i><span>${safeMsg}</span>`;
    container.appendChild(el);
    setTimeout(() => el.remove(), duration);
}

function formatDate(date) {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(date) {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function timeAgo(date) {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    const seconds = Math.floor((Date.now() - d) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return formatDate(date);
}

// ═══════════════════════════════════════════════════════════
// AUTH & INIT
// ═══════════════════════════════════════════════════════════
onAuthStateChanged(auth, async user => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }
    
    state.user = user;
    
    // Load user data
    try {
        const userDoc = await getDoc(doc(db, "Users", user.uid));
        if (userDoc.exists()) {
            state.userData = userDoc.data();
            updateSellerProfile();
        }
    } catch (err) {
        console.error('Error loading user data:', err);
    }
    
    // Load initial data
    await Promise.all([
        loadSellerOrders(),
        loadSellerProducts()
    ]);
    
    updateDashboard();
    setupRealtimeListeners();
});

function updateSellerProfile() {
    const data = state.userData;
    $('sellerAvatar').src = getImageUrl(data?.profilePicUrl, 'profile');
    $('sellerName').textContent = data?.name || 'Seller';
    
    const isVerified = data?.verified || data?.isVerified;
    $('sellerVerified').innerHTML = isVerified 
        ? '<i class="fas fa-check-circle"></i> Verified Seller' 
        : '<span class="unverified">Not Verified</span>';
    $('sellerVerified').className = isVerified ? 'seller-status' : 'seller-status unverified';
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // Sidebar navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => switchSection(btn.dataset.section));
    });
    
    // Mobile menu
    $('menuBtn')?.addEventListener('click', () => {
        $('sidebar').classList.toggle('open');
        toggleOverlay(true);
    });
    
    // Filters
    $('orderStatusFilter')?.addEventListener('change', () => renderOrders());
    $('orderSearch')?.addEventListener('input', () => renderOrders());
    $('productStockFilter')?.addEventListener('change', () => renderProducts());
    
    // Modals
    $('closeOrderModal')?.addEventListener('click', closeOrderModal);
    $('orderModal')?.addEventListener('click', e => {
        if (e.target === $('orderModal')) closeOrderModal();
    });
    
    $('closeDispatchModal')?.addEventListener('click', closeDispatchModal);
    $('dispatchModal')?.addEventListener('click', e => {
        if (e.target === $('dispatchModal')) closeDispatchModal();
    });
    
    // Dispatch photo upload
    $('dispatchUploadArea')?.addEventListener('click', () => $('dispatchPhotoInput').click());
    $('dispatchPhotoInput')?.addEventListener('change', handleDispatchPhotoSelect);
    $('cancelDispatch')?.addEventListener('click', closeDispatchModal);
    $('confirmDispatch')?.addEventListener('click', confirmDispatch);
    
    // Store settings form
    $('storeSettingsForm')?.addEventListener('submit', handleStoreSettingsSave);
    
    // Withdraw button
    $('withdrawBtn')?.addEventListener('click', () => {
        window.location.href = 'withdraw.html';
    });
    
    // Notification bell
    $('notifBtn')?.addEventListener('click', toggleNotifications);
    document.addEventListener('click', (e) => {
        const dropdown = $('notificationDropdown');
        const bell = $('notifBtn');
        if (dropdown && bell && !dropdown.contains(e.target) && !bell.contains(e.target)) {
            dropdown.classList.remove('active');
        }
    });
    
    // Load notifications
    loadNotifications();
});

function switchSection(section) {
    state.section = section;
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === section);
    });
    
    // Show section
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    $(`${section}-section`)?.classList.add('active');
    
    // Close mobile sidebar
    $('sidebar').classList.remove('open');
    toggleOverlay(false);
    
    // Load section data
    if (section === 'orders') renderOrders();
    if (section === 'products') renderProducts();
    if (section === 'earnings') updateEarnings();
    if (section === 'store') loadStoreSettings();
}

window.switchSection = switchSection;

function toggleOverlay(show) {
    let overlay = document.querySelector('.sidebar-overlay');
    if (show && !overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay active';
        overlay.addEventListener('click', () => {
            $('sidebar').classList.remove('open');
            toggleOverlay(false);
        });
        document.body.appendChild(overlay);
    } else if (!show && overlay) {
        overlay.remove();
    }
}

// ═══════════════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════════════
async function loadSellerOrders() {
    try {
        // Get orders where seller's products are included
        const ordersSnap = await getDocs(collection(db, "Orders"));
        const allOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        // Filter orders that contain this seller's products
        state.orders = allOrders.filter(order => {
            return order.items?.some(item => item.sellerId === state.user.uid);
        });
        
        updateOrdersBadge();
        
    } catch (err) {
        console.error('Error loading orders:', err);
        toast('Failed to load orders', 'error');
    }
}

async function loadSellerProducts() {
    try {
        const q = query(
            collection(db, "Listings"),
            where("uploaderId", "==", state.user.uid)
        );
        const snap = await getDocs(q);
        state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
    } catch (err) {
        console.error('Error loading products:', err);
        toast('Failed to load products', 'error');
    }
}

function setupRealtimeListeners() {
    // Listen for new orders in real-time
    const ordersQuery = collection(db, "Orders");
    
    const unsubOrders = onSnapshot(ordersQuery, async snap => {
        const allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const sellerOrders = allOrders.filter(order => {
            return order.items?.some(item => item.sellerId === state.user.uid);
        });
        
        // Check for new orders
        const newOrders = sellerOrders.filter(o => 
            !state.orders.find(existing => existing.id === o.id) && 
            (o.status || o.orderStatus) === 'pending'
        );
        
        if (newOrders.length > 0) {
            toast(`${newOrders.length} new order${newOrders.length > 1 ? 's' : ''}!`, 'success');
            // Play notification sound if available
            playNotificationSound();
        }
        
        state.orders = sellerOrders;
        updateOrdersBadge();
        
        if (state.section === 'orders') renderOrders();
        if (state.section === 'overview') {
            renderRecentOrders();
            updateStats();
        }
    });
    
    state.unsubscribers.push(unsubOrders);
}

function playNotificationSound() {
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleURHidbl1pN3W0mR3eTatIJ7dZrf6+TOs42Jo9Lh3M++');
        audio.volume = 0.5;
        audio.play().catch(() => {});
    } catch (e) {}
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD OVERVIEW
// ═══════════════════════════════════════════════════════════
function updateDashboard() {
    updateStats();
    updateSalesStats();
    renderRecentOrders();
    renderLowStock();
    updateEarnings();
}

function updateStats() {
    const pendingOrders = state.orders.filter(o => {
        const status = o.status || o.orderStatus;
        return status === 'pending' || status === 'confirmed';
    }).length;
    const completedOrders = state.orders.filter(o => (o.status || o.orderStatus) === 'delivered');
    
    let totalEarnings = 0;
    completedOrders.forEach(order => {
        order.items?.forEach(item => {
            if (item.sellerId === state.user.uid) {
                totalEarnings += (item.pricePerUnit || item.price || 0) * (item.quantity || 1);
            }
        });
    });
    
    $('pendingOrders').textContent = pendingOrders;
    $('totalEarnings').textContent = `KES ${totalEarnings.toLocaleString()}`;
    $('totalProducts').textContent = state.products.length;
    
    // Calculate average rating
    let totalRatings = 0, ratingCount = 0;
    state.products.forEach(p => {
        if (p.avgRating) {
            totalRatings += p.avgRating;
            ratingCount++;
        }
    });
    $('avgRating').textContent = ratingCount > 0 ? (totalRatings / ratingCount).toFixed(1) : 'N/A';
    
    state.earnings.lifetime = totalEarnings;
}

function updateSalesStats() {
    // All completed orders (delivered)
    const completedOrders = state.orders.filter(o => (o.status || o.orderStatus) === 'delivered');
    
    let totalSales = 0;
    let totalRevenue = 0;
    let monthSales = 0;
    let monthRevenue = 0;
    
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    
    completedOrders.forEach(order => {
        let orderTotal = 0;
        let sellerItemCount = 0;
        
        order.items?.forEach(item => {
            if (item.sellerId === state.user.uid) {
                orderTotal += (item.pricePerUnit || item.price || 0) * (item.quantity || 1);
                sellerItemCount += item.quantity || 1;
            }
        });
        
        if (sellerItemCount > 0) {
            totalSales++;
            totalRevenue += orderTotal;
            
            // Check if order is from this month
            const orderDate = (order.orderDate || order.createdAt)?.toDate?.() || new Date(order.orderDate || order.createdAt);
            if (orderDate.getMonth() === thisMonth && orderDate.getFullYear() === thisYear) {
                monthSales++;
                monthRevenue += orderTotal;
            }
        }
    });
    
    $('totalSales').textContent = totalSales;
    $('totalRevenue').textContent = `KES ${totalRevenue.toLocaleString()}`;
    $('monthSales').textContent = monthSales;
    $('monthRevenue').textContent = `KES ${monthRevenue.toLocaleString()}`;
}

function updateOrdersBadge() {
    const pending = state.orders.filter(o => (o.status || o.orderStatus) === 'pending').length;
    $('ordersBadge').textContent = pending;
    $('ordersBadge').style.display = pending > 0 ? '' : 'none';
}

function renderRecentOrders() {
    const container = $('recentOrdersList');
    const recent = [...state.orders]
        .sort((a, b) => {
            const dateA = a.orderDate?.toDate?.() || new Date(a.orderDate);
            const dateB = b.orderDate?.toDate?.() || new Date(b.orderDate);
            return dateB - dateA;
        })
        .slice(0, 5);
    
    if (recent.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>No orders yet</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = recent.map(order => {
        const sellerItems = order.items?.filter(i => i.sellerId === state.user.uid) || [];
        const total = sellerItems.reduce((sum, i) => sum + (i.pricePerUnit || i.price || 0) * (i.quantity || 1), 0);
        const totalQty = sellerItems.reduce((sum, i) => sum + (i.quantity || 1), 0);
        const orderStatus = order.status || order.orderStatus || 'pending';
        
        const safeOrderId = escapeHtml(order.orderId || order.id?.slice(0, 8) || '');
        const safeBuyerName = escapeHtml(order.buyerDetails?.name || 'Customer');
        const safeId = escapeHtml(order.id || '');
        
        // Build items preview (show up to 2 items in recent orders)
        const itemsHtml = sellerItems.slice(0, 2).map(item => {
            const name = item.productName || item.name || 'Product';
            const qty = item.quantity || 1;
            const price = item.pricePerUnit || item.price || 0;
            const variation = item.selectedVariation || item.variant;
            let variantText = '';
            if (variation) {
                if (typeof variation === 'object') {
                    variantText = `${variation.title || ''}: ${variation.attr_name || variation.value || ''}`;
                } else {
                    variantText = variation;
                }
            }
            return `
                <div class="order-preview-row">
                    <img src="${getImageUrl(item.imageUrl, 'product')}" alt="" data-fallback="product">
                    <div class="order-preview-info">
                        <div class="order-preview-name">${escapeHtml(name)}</div>
                        ${variantText ? `<span class="order-preview-variant">${escapeHtml(variantText)}</span>` : ''}
                        <div class="order-preview-qty">Qty: ${qty}</div>
                    </div>
                    <div class="order-preview-price">KES ${(price * qty).toLocaleString()}</div>
                </div>
            `;
        }).join('');
        
        const moreItems = sellerItems.length > 2 ? `<div class="order-more-items">+${sellerItems.length - 2} more item(s)</div>` : '';
        
        // Generate quick action buttons for recent orders too
        const quickActions = getQuickActionButtons(order, safeId, orderStatus);
        
        return `
            <div class="order-item">
                <div class="order-item-header" onclick="viewOrder('${safeId}')" style="cursor:pointer;">
                    <div class="order-info">
                        <span class="order-id">#${safeOrderId}</span>
                        <span class="order-buyer">${safeBuyerName}</span>
                    </div>
                    <span class="status-badge ${escapeHtml(orderStatus)}">${formatStatus(orderStatus)}</span>
                </div>
                <div class="order-items-preview" onclick="viewOrder('${safeId}')" style="cursor:pointer;">
                    ${itemsHtml}
                    ${moreItems}
                </div>
                <div class="order-item-footer">
                    <span class="order-time">${timeAgo(order.orderDate || order.createdAt)}</span>
                    <div class="order-quick-actions">
                        ${quickActions}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderLowStock() {
    const container = $('lowStockList');
    const lowStock = state.products.filter(p => (p.totalStock || 0) < 10 && (p.totalStock || 0) > 0);
    const outOfStock = state.products.filter(p => (p.totalStock || 0) === 0);
    
    const items = [...outOfStock, ...lowStock].slice(0, 5);
    
    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-check-circle" style="color:#10b981"></i>
                <p>All products are well stocked</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = items.map(p => `
        <div class="low-stock-item">
            <img src="${getImageUrl(p.imageUrls?.[0], 'product')}" alt="" data-fallback="product">
            <div class="info">
                <h5>${escapeHtml(p.name || 'Product')}</h5>
                <span class="stock-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    ${p.totalStock === 0 ? 'Out of stock' : `Only ${p.totalStock} left`}
                </span>
            </div>
            <button class="btn-restock" onclick="window.location.href='listing.html'">Restock</button>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════════════════════
// ORDERS SECTION
// ═══════════════════════════════════════════════════════════
function renderOrders() {
    const container = $('ordersContainer');
    const statusFilter = $('orderStatusFilter')?.value || 'all';
    const searchTerm = $('orderSearch')?.value.toLowerCase() || '';
    
    let filtered = [...state.orders];
    
    // Filter by status
    if (statusFilter !== 'all') {
        filtered = filtered.filter(o => (o.status || o.orderStatus) === statusFilter);
    }
    
    // Filter by search
    if (searchTerm) {
        filtered = filtered.filter(o => 
            (o.orderId || o.id).toLowerCase().includes(searchTerm) ||
            (o.buyerDetails?.name || '').toLowerCase().includes(searchTerm)
        );
    }
    
    // Sort by date
    filtered.sort((a, b) => {
        const dateA = (a.orderDate || a.createdAt)?.toDate?.() || new Date(a.orderDate || a.createdAt);
        const dateB = (b.orderDate || b.createdAt)?.toDate?.() || new Date(b.orderDate || b.createdAt);
        return dateB - dateA;
    });
    
    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>No orders found</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = filtered.map(order => {
        const sellerItems = order.items?.filter(i => i.sellerId === state.user.uid) || [];
        const total = sellerItems.reduce((sum, i) => sum + (i.pricePerUnit || i.price || 0) * (i.quantity || 1), 0);
        const totalQty = sellerItems.reduce((sum, i) => sum + (i.quantity || 1), 0);
        const orderStatus = order.status || order.orderStatus || 'pending';
        
        const safeOrderId = escapeHtml(order.orderId || order.id?.slice(0, 8) || '');
        const safeBuyerName = escapeHtml(order.buyerDetails?.name || 'Customer');
        const safeId = escapeHtml(order.id || '');
        
        // Build items preview (show up to 3 items)
        const itemsHtml = sellerItems.slice(0, 3).map(item => {
            const name = item.productName || item.name || 'Product';
            const qty = item.quantity || 1;
            const price = item.pricePerUnit || item.price || 0;
            const variation = item.selectedVariation || item.variant;
            let variantText = '';
            if (variation) {
                if (typeof variation === 'object') {
                    variantText = `${variation.title || ''}: ${variation.attr_name || variation.value || ''}`;
                } else {
                    variantText = variation;
                }
            }
            return `
                <div class="order-preview-row">
                    <img src="${getImageUrl(item.imageUrl, 'product')}" alt="" data-fallback="product">
                    <div class="order-preview-info">
                        <div class="order-preview-name">${escapeHtml(name)}</div>
                        ${variantText ? `<span class="order-preview-variant">${escapeHtml(variantText)}</span>` : ''}
                        <div class="order-preview-qty">Qty: ${qty} × KES ${price.toLocaleString()}</div>
                    </div>
                    <div class="order-preview-price">KES ${(price * qty).toLocaleString()}</div>
                </div>
            `;
        }).join('');
        
        const moreItems = sellerItems.length > 3 ? `<div class="order-more-items">+${sellerItems.length - 3} more item(s)</div>` : '';
        
        // Generate quick action buttons based on status
        const quickActions = getQuickActionButtons(order, safeId, orderStatus);
        
        return `
            <div class="order-item">
                <div class="order-item-header" onclick="viewOrder('${safeId}')" style="cursor:pointer;">
                    <div class="order-info">
                        <span class="order-id">#${safeOrderId}</span>
                        <span class="order-buyer">${safeBuyerName} • ${formatDate(order.orderDate || order.createdAt)}</span>
                    </div>
                    <span class="status-badge ${escapeHtml(orderStatus)}">${formatStatus(orderStatus)}</span>
                </div>
                <div class="order-items-preview" onclick="viewOrder('${safeId}')" style="cursor:pointer;">
                    ${itemsHtml}
                    ${moreItems}
                </div>
                <div class="order-item-footer">
                    <span style="font-size:12px;color:var(--gray-500);"><i class="fas fa-box"></i> ${totalQty} item(s) • KES ${total.toLocaleString()}</span>
                    <div class="order-quick-actions">
                        ${quickActions}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Generate quick action buttons for order cards
function getQuickActionButtons(order, orderId, status) {
    switch (status) {
        case 'pending':
            return `
                <button class="btn-quick btn-accept" onclick="event.stopPropagation(); confirmUpdateOrderStatus('${orderId}', 'confirmed')" title="Accept Order">
                    <i class="fas fa-check"></i>
                </button>
                <button class="btn-quick btn-reject" onclick="event.stopPropagation(); confirmUpdateOrderStatus('${orderId}', 'cancelled')" title="Cancel">
                    <i class="fas fa-times"></i>
                </button>
            `;
        case 'confirmed':
            return `
                <button class="btn-quick btn-dispatch" onclick="event.stopPropagation(); openDispatchModal('${orderId}')" title="Mark Ready for Dispatch">
                    <i class="fas fa-truck"></i>
                </button>
            `;
        case 'out_for_delivery':
            return `
                <button class="btn-quick btn-deliver" onclick="event.stopPropagation(); confirmUpdateOrderStatus('${orderId}', 'delivered')" title="Mark Delivered">
                    <i class="fas fa-check-double"></i>
                </button>
            `;
        default:
            return `
                <button class="btn-quick btn-view" onclick="event.stopPropagation(); viewOrder('${orderId}')" title="View Details">
                    <i class="fas fa-eye"></i>
                </button>
            `;
    }
}

window.viewOrder = function(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    
    // Get status (checkout saves as 'status', some legacy as 'orderStatus')
    const orderStatus = order.status || order.orderStatus || 'pending';
    
    const sellerItems = order.items?.filter(i => i.sellerId === state.user.uid) || [];
    // Handle both price field names: pricePerUnit (new) and price (legacy)
    const total = sellerItems.reduce((sum, i) => sum + (i.pricePerUnit || i.price || 0) * (i.quantity || 1), 0);
    
    const body = $('orderModalBody');
    body.innerHTML = `
        <div class="order-detail-row">
            <span>Order ID</span>
            <strong>#${escapeHtml(order.orderId || order.id.slice(0, 8))}</strong>
        </div>
        <div class="order-detail-row">
            <span>Status</span>
            <span class="status-badge ${escapeHtml(orderStatus)}">${formatStatus(orderStatus)}</span>
        </div>
        <div class="order-detail-row">
            <span>Order Date</span>
            <span>${formatDate(order.orderDate || order.createdAt)} ${formatTime(order.orderDate || order.createdAt)}</span>
        </div>
        <div class="order-detail-row">
            <span>Customer</span>
            <span>${escapeHtml(order.buyerDetails?.name || 'N/A')}</span>
        </div>
        <div class="order-detail-row">
            <span>Shipping Address</span>
            <span>${escapeHtml(order.buyerDetails?.deliveryAddress || order.buyerDetails?.address || order.shippingAddress?.address || 'N/A')}</span>
        </div>
        
        <h4 style="margin: 20px 0 12px; font-size: 15px;">Your Items (${sellerItems.length})</h4>
        <div class="order-items-list">
            ${sellerItems.map(item => {
                const itemName = item.productName || item.name || 'Product';
                const itemPrice = item.pricePerUnit || item.price || 0;
                const qty = item.quantity || 1;
                const variation = item.selectedVariation || item.variant;
                let variantHtml = '';
                if (variation) {
                    if (typeof variation === 'object') {
                        variantHtml = `<span class="order-item-variant-badge"><i class="fas fa-tag"></i> ${escapeHtml(variation.title || 'Variant')}: ${escapeHtml(variation.attr_name || variation.value || '')}</span>`;
                    } else {
                        variantHtml = `<span class="order-item-variant-badge"><i class="fas fa-tag"></i> ${escapeHtml(variation)}</span>`;
                    }
                }
                return `
                <div class="order-item-row">
                    <img src="${getImageUrl(item.imageUrl, 'product')}" alt="" data-fallback="product">
                    <div class="order-item-details">
                        <h5>${escapeHtml(itemName)}</h5>
                        ${variantHtml}
                        <small><i class="fas fa-box"></i> Qty: <strong>${qty}</strong> × KES ${itemPrice.toLocaleString()}</small>
                    </div>
                    <strong>KES ${(itemPrice * qty).toLocaleString()}</strong>
                </div>
            `;
            }).join('')}
        </div>
        
        <div class="order-detail-row" style="font-size: 16px; font-weight: 600;">
            <span>Your Earnings</span>
            <span style="color: var(--green);">KES ${total.toLocaleString()}</span>
        </div>
        
        ${order.dispatchPhoto ? `
            <div style="margin-top: 16px;">
                <h4 style="font-size: 14px; margin-bottom: 8px;">Dispatch Proof</h4>
                <img src="${order.dispatchPhoto}" alt="Dispatch" style="width: 100%; max-height: 200px; object-fit: cover; border-radius: 8px;">
                ${order.dispatchNote ? `<p style="font-size: 13px; color: var(--gray-500); margin-top: 8px;">${escapeHtml(order.dispatchNote)}</p>` : ''}
            </div>
        ` : ''}
        
        <div class="order-actions">
            ${getOrderActions(order)}
        </div>
    `;
    
    $('orderModal').classList.add('active');
};

function getOrderActions(order) {
    // Get status (checkout saves as 'status', some legacy as 'orderStatus')
    const orderStatus = order.status || order.orderStatus || 'pending';
    
    switch (orderStatus) {
        case 'pending':
            return `
                <button class="btn btn-primary" onclick="confirmUpdateOrderStatus('${order.id}', 'confirmed')">
                    <i class="fas fa-check"></i> Accept Order
                </button>
                <button class="btn btn-secondary" onclick="confirmUpdateOrderStatus('${order.id}', 'cancelled')">
                    Cancel
                </button>
            `;
        case 'confirmed':
            return `
                <button class="btn btn-primary" onclick="openDispatchModal('${order.id}')">
                    <i class="fas fa-truck"></i> Mark Ready for Dispatch
                </button>
            `;
        case 'out_for_delivery':
            return `
                <button class="btn btn-success" onclick="confirmUpdateOrderStatus('${order.id}', 'delivered')">
                    <i class="fas fa-check-double"></i> Mark as Delivered
                </button>
            `;
        default:
            return '';
    }
}

// Confirmation dialog before updating order status
window.confirmUpdateOrderStatus = function(orderId, newStatus) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    
    const orderNum = order.orderId || order.id.slice(0, 8);
    const messages = {
        'confirmed': {
            title: 'Accept Order?',
            message: `Are you sure you want to accept order #${orderNum}?`,
            confirmText: 'Yes, Accept',
            confirmClass: 'btn-primary'
        },
        'cancelled': {
            title: 'Cancel Order?',
            message: `Are you sure you want to cancel order #${orderNum}? This action cannot be undone.`,
            confirmText: 'Yes, Cancel',
            confirmClass: 'btn-danger'
        },
        'delivered': {
            title: 'Mark as Delivered?',
            message: `Confirm that order #${orderNum} has been delivered to the customer?`,
            confirmText: 'Yes, Mark Delivered',
            confirmClass: 'btn-success'
        }
    };
    
    const config = messages[newStatus] || {
        title: 'Update Order Status?',
        message: `Update order #${orderNum} status to ${newStatus}?`,
        confirmText: 'Confirm',
        confirmClass: 'btn-primary'
    };
    
    // Create confirmation modal
    const modal = document.createElement('div');
    modal.className = 'confirm-modal-overlay';
    modal.innerHTML = `
        <div class="confirm-modal">
            <div class="confirm-modal-header">
                <h3><i class="fas fa-exclamation-circle"></i> ${config.title}</h3>
            </div>
            <div class="confirm-modal-body">
                <p>${config.message}</p>
            </div>
            <div class="confirm-modal-actions">
                <button class="btn btn-secondary" onclick="this.closest('.confirm-modal-overlay').remove()">
                    <i class="fas fa-times"></i> Cancel
                </button>
                <button class="btn ${config.confirmClass}" onclick="updateOrderStatus('${orderId}', '${newStatus}'); this.closest('.confirm-modal-overlay').remove();">
                    <i class="fas fa-check"></i> ${config.confirmText}
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close on outside click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
};

window.updateOrderStatus = async function(orderId, newStatus) {
    try {
        // Get order details first
        const order = state.orders.find(o => o.id === orderId);
        
        // Update status field (checkout.js saves as 'status')
        await updateDoc(doc(db, "Orders", orderId), {
            status: newStatus,
            [`${newStatus}At`]: Timestamp.now()
        });
        
        // Notify buyer of order status change (checkout saves userId directly, not in buyerInfo)
        const buyerId = order?.userId || order?.buyerInfo?.userId;
        if (buyerId) {
            await notifyBuyerOfStatusChange(order, newStatus, buyerId);
        }
        
        // Update local state
        if (order) order.status = newStatus;
        
        closeOrderModal();
        renderOrders();
        updateDashboard();
        
        toast(`Order ${formatStatus(newStatus)}`, 'success');
        
    } catch (err) {
        console.error('Error updating order:', err);
        toast('Failed to update order', 'error');
    }
};

// Notify buyer when order status changes
async function notifyBuyerOfStatusChange(order, newStatus, buyerId) {
    try {
        const notificationData = getNotificationData(order, newStatus);
        if (!notificationData) return;
        
        await addDoc(collection(db, "Notifications"), {
            userId: buyerId,
            orderId: order.id,
            type: notificationData.type,
            title: notificationData.title,
            message: notificationData.message,
            amount: order.totalAmount || order.amount,
            read: false,
            createdAt: Timestamp.now()
        });
    } catch (error) {
        console.error('Error sending buyer notification:', error);
    }
}

function getNotificationData(order, status) {
    // Get product name - checkout saves items with productName field
    const productName = order.productName || (order.items && (order.items[0]?.productName || order.items[0]?.name)) || 'Your order';
    
    const notifications = {
        confirmed: {
            type: 'order_confirmed',
            title: 'Order Confirmed! 🎉',
            message: `${productName} has been confirmed by the seller and is being prepared.`
        },
        out_for_delivery: {
            type: 'order_shipped',
            title: 'Order Dispatched! 🚚',
            message: `${productName} is on its way to you.`
        },
        delivered: {
            type: 'order_delivered',
            title: 'Order Delivered! 📦',
            message: `${productName} has been marked as delivered. Please confirm receipt.`
        },
        cancelled: {
            type: 'order_cancelled',
            title: 'Order Cancelled ❌',
            message: `${productName} has been cancelled by the seller.`
        }
    };
    
    return notifications[status] || null;
}

function formatStatus(status) {
    const labels = {
        pending: 'Pending',
        confirmed: 'Confirmed',
        out_for_delivery: 'Dispatched',
        delivered: 'Delivered',
        cancelled: 'Cancelled'
    };
    return labels[status] || status;
}

function closeOrderModal() {
    $('orderModal').classList.remove('active');
}

// ═══════════════════════════════════════════════════════════
// DISPATCH PHOTO
// ═══════════════════════════════════════════════════════════
window.openDispatchModal = function(orderId) {
    state.dispatchOrderId = orderId;
    state.dispatchPhoto = null;
    
    $('dispatchPreview').style.display = 'none';
    $('dispatchPlaceholder').style.display = '';
    $('dispatchUploadArea').classList.remove('has-image');
    $('dispatchNote').value = '';
    $('confirmDispatch').disabled = true;
    
    closeOrderModal();
    $('dispatchModal').classList.add('active');
};

function handleDispatchPhotoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate
    if (!file.type.startsWith('image/')) {
        toast('Please select an image file', 'error');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        toast('Image must be under 5MB', 'error');
        return;
    }
    
    // Preview
    const reader = new FileReader();
    reader.onload = (event) => {
        $('dispatchPreview').src = event.target.result;
        $('dispatchPreview').style.display = 'block';
        $('dispatchPlaceholder').style.display = 'none';
        $('dispatchUploadArea').classList.add('has-image');
        $('confirmDispatch').disabled = false;
        
        state.dispatchPhoto = file;
    };
    reader.readAsDataURL(file);
}

async function confirmDispatch() {
    if (!state.dispatchPhoto || !state.dispatchOrderId) return;
    
    const btn = $('confirmDispatch');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    
    try {
        // Upload photo
        const fileRef = storageRef(storage, `dispatch/${state.user.uid}/${state.dispatchOrderId}_${Date.now()}.jpg`);
        await uploadBytes(fileRef, state.dispatchPhoto);
        const photoUrl = await getDownloadURL(fileRef);
        
        // Update order (checkout.js saves status as 'status' not 'orderStatus')
        await updateDoc(doc(db, "Orders", state.dispatchOrderId), {
            status: 'out_for_delivery',
            dispatchPhoto: photoUrl,
            dispatchNote: $('dispatchNote').value.trim(),
            dispatchedAt: Timestamp.now(),
            dispatchedBy: state.user.uid
        });
        
        // Update local state
        const order = state.orders.find(o => o.id === state.dispatchOrderId);
        if (order) {
            order.status = 'out_for_delivery';
            order.dispatchPhoto = photoUrl;
        }
        
        closeDispatchModal();
        renderOrders();
        updateDashboard();
        
        toast('Order dispatched successfully!', 'success');
        
    } catch (err) {
        console.error('Dispatch error:', err);
        toast('Failed to dispatch order', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-truck"></i> Mark as Dispatched';
    }
}

function closeDispatchModal() {
    $('dispatchModal').classList.remove('active');
    state.dispatchOrderId = null;
    state.dispatchPhoto = null;
    $('dispatchPhotoInput').value = '';
}

// ═══════════════════════════════════════════════════════════
// PRODUCTS SECTION
// ═══════════════════════════════════════════════════════════
function renderProducts() {
    const container = $('productsGrid');
    const filter = $('productStockFilter')?.value || 'all';
    
    let filtered = [...state.products];
    
    if (filter === 'in_stock') {
        filtered = filtered.filter(p => (p.totalStock || 0) >= 10);
    } else if (filter === 'low_stock') {
        filtered = filtered.filter(p => (p.totalStock || 0) > 0 && (p.totalStock || 0) < 10);
    } else if (filter === 'out_of_stock') {
        filtered = filtered.filter(p => (p.totalStock || 0) === 0);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <i class="fas fa-box-open"></i>
                <p>No products found</p>
                <a href="listing.html" class="btn btn-primary" style="margin-top: 16px;">Add Your First Product</a>
            </div>
        `;
        return;
    }
    
    container.innerHTML = filtered.map(p => {
        const stock = p.totalStock || 0;
        let stockClass = 'in-stock';
        let stockText = `${stock} in stock`;
        
        if (stock === 0) {
            stockClass = 'out-of-stock';
            stockText = 'Out of stock';
        } else if (stock < 10) {
            stockClass = 'low-stock';
            stockText = `${stock} left`;
        }
        
        return `
            <div class="product-card">
                <div class="img">
                    <img src="${getImageUrl(p.imageUrls?.[0], 'product')}" alt="${p.name}" data-fallback="product">
                    <span class="stock-badge ${stockClass}">${stockText}</span>
                </div>
                <div class="body">
                    <h4>${p.name}</h4>
                    <span class="price">KES ${(p.originalPrice || p.price || 0).toLocaleString()}</span>
                    <div class="actions">
                        <button onclick="window.location.href='product.html?id=${p.id}'"><i class="fas fa-eye"></i></button>
                        <button onclick="window.location.href='listing.html?edit=${p.id}'"><i class="fas fa-edit"></i></button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ═══════════════════════════════════════════════════════════
// EARNINGS
// ═══════════════════════════════════════════════════════════
function updateEarnings() {
    const completedOrders = state.orders.filter(o => o.orderStatus === 'delivered');
    const pendingOrders = state.orders.filter(o => ['confirmed', 'out_for_delivery'].includes(o.orderStatus));
    
    let available = 0, pending = 0;
    
    completedOrders.forEach(order => {
        order.items?.forEach(item => {
            if (item.sellerId === state.user.uid) {
                available += (item.price || 0) * (item.quantity || 1);
            }
        });
    });
    
    pendingOrders.forEach(order => {
        order.items?.forEach(item => {
            if (item.sellerId === state.user.uid) {
                pending += (item.price || 0) * (item.quantity || 1);
            }
        });
    });
    
    state.earnings = { available, pending, lifetime: available + pending };
    
    $('availableBalance').textContent = `KES ${available.toLocaleString()}`;
    $('pendingEarnings').textContent = `KES ${pending.toLocaleString()}`;
    $('lifetimeEarnings').textContent = `KES ${state.earnings.lifetime.toLocaleString()}`;
}

// ═══════════════════════════════════════════════════════════
// STORE SETTINGS
// ═══════════════════════════════════════════════════════════
function loadStoreSettings() {
    const data = state.userData;
    if (!data) return;
    
    $('storeName').value = data.storeName || data.name || '';
    $('storeDescription').value = data.storeDescription || '';
    $('storeLocation').value = data.location || '';
    $('storePhone').value = data.phone || '';
    $('processingTime').value = data.processingTime || 'same_day';
    
    // Verification status
    const isVerified = data.verified || data.isVerified;
    $('verificationStatus').innerHTML = `
        <div class="verification-badge ${isVerified ? 'verified' : 'unverified'}">
            <i class="fas fa-${isVerified ? 'check-circle' : 'exclamation-circle'}"></i>
            <div>
                <strong>${isVerified ? 'Verified Seller' : 'Not Verified'}</strong>
                <p style="margin: 0; font-size: 13px;">
                    ${isVerified 
                        ? 'Your store has the verified badge visible to buyers.' 
                        : 'Verification gives you a blue tick and increases buyer trust.'}
                </p>
            </div>
        </div>
        ${!isVerified ? `
            <p style="font-size: 13px; color: var(--gray-600); margin-top: 12px;">
                To get verified, ensure you have:<br>
                • Complete profile with photo<br>
                • At least 5 active listings<br>
                • Positive order history<br>
                <br>
                Contact admin for verification review.
            </p>
        ` : ''}
    `;
}

async function handleStoreSettingsSave(e) {
    e.preventDefault();
    
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    
    try {
        await updateDoc(doc(db, "Users", state.user.uid), {
            storeName: $('storeName').value.trim(),
            storeDescription: $('storeDescription').value.trim(),
            location: $('storeLocation').value.trim(),
            phone: $('storePhone').value.trim(),
            processingTime: $('processingTime').value
        });
        
        toast('Store settings saved!', 'success');
        
    } catch (err) {
        console.error('Error saving settings:', err);
        toast('Failed to save settings', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Settings';
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    state.unsubscribers.forEach(unsub => unsub());
});

// ═══════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

function loadNotifications() {
    if (!state.user) return;
    
    const notificationsRef = collection(db, "Notifications");
    const q = query(
        notificationsRef,
        where("userId", "==", state.user.uid),
        orderBy("createdAt", "desc")
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
        state.notifications = [];
        state.unreadCount = 0;
        
        snapshot.forEach(docSnap => {
            const notif = { id: docSnap.id, ...docSnap.data() };
            state.notifications.push(notif);
            if (!notif.read) state.unreadCount++;
        });
        
        updateNotificationBadge();
        renderNotifications();
    }, (error) => {
        console.error("Error loading notifications:", error);
    });
    
    state.unsubscribers.push(unsubscribe);
}

function updateNotificationBadge() {
    const badge = $('notifBadge');
    if (!badge) return;
    
    if (state.unreadCount > 0) {
        badge.textContent = state.unreadCount > 99 ? '99+' : state.unreadCount;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

function toggleNotifications() {
    const dropdown = $('notificationDropdown');
    if (!dropdown) return;
    
    dropdown.classList.toggle('active');
}

function renderNotifications() {
    const list = $('notificationList');
    if (!list) return;
    
    if (state.notifications.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 32px 16px; color: var(--gray-500);">
                <div style="font-size: 48px; margin-bottom: 8px;">🔔</div>
                <p style="margin: 0; font-size: 14px;">No notifications yet</p>
            </div>
        `;
        return;
    }
    
    list.innerHTML = state.notifications.map(notif => `
        <div class="notification-item ${!notif.read ? 'unread' : ''}" 
             data-id="${notif.id}" 
             data-order-id="${notif.orderId || ''}"
             onclick="handleNotificationClick('${notif.id}', '${notif.orderId || ''}')">
            <div class="notification-content">
                <div class="notification-title">${escapeHtml(notif.title || '')}</div>
                <div class="notification-message">${escapeHtml(notif.message || '')}</div>
                <div class="notification-time">${formatTimeAgo(notif.createdAt)}</div>
            </div>
            ${!notif.read ? '<div class="notification-indicator"></div>' : ''}
        </div>
    `).join('');
}

async function handleNotificationClick(notifId, orderId) {
    // Mark as read
    try {
        const notifRef = doc(db, "Notifications", notifId);
        await updateDoc(notifRef, { read: true });
    } catch (err) {
        console.error("Error marking notification as read:", err);
    }
    
    // Close dropdown
    $('notificationDropdown')?.classList.remove('active');
    
    // Navigate to orders if order notification
    if (orderId) {
        switchSection('orders');
        // Highlight the order briefly
        setTimeout(() => {
            const orderCard = document.querySelector(`[data-order-id="${orderId}"]`);
            if (orderCard) {
                orderCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                orderCard.style.animation = 'highlight 1s ease-out';
            }
        }, 300);
    }
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;
    return date.toLocaleDateString();
}

// Make function global for onclick handler
window.handleNotificationClick = handleNotificationClick;
