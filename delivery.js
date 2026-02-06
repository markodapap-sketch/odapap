/**
 * Delivery Dashboard - Oda Pap
 * Interface for delivery company to view, manage, and track orders.
 * Shows orders that are confirmed (ready for pickup) or out for delivery.
 */

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
    getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc, orderBy, Timestamp
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from './js/firebase.js';

const auth = getAuth(app);
const db = getFirestore(app);

// State
let orders = [];
let currentFilter = 'active';
let currentUser = null;

// DOM helpers
const $ = id => document.getElementById(id);

// Toast notification
function showToast(msg) {
    const toast = $('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Escape HTML
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Format date relative
function formatDate(timestamp) {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Check if date is today
function isToday(timestamp) {
    if (!timestamp) return false;
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
}

// Load orders from Firestore
async function loadOrders() {
    try {
        $('loadingState').style.display = 'block';
        $('ordersContainer').style.display = 'none';
        $('emptyState').style.display = 'none';

        // Query all orders that are at least confirmed (not pending/cancelled)
        const ordersRef = collection(db, 'Orders');
        const snapshot = await getDocs(ordersRef);

        orders = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            data.id = docSnap.id;
            const status = data.orderStatus || data.status || 'pending';
            // Only include orders relevant to delivery
            if (['confirmed', 'out_for_delivery', 'delivered'].includes(status)) {
                orders.push(data);
            }
        });

        // Sort by date, newest first
        orders.sort((a, b) => {
            const dateA = (a.orderDate || a.createdAt)?.toDate?.() || new Date(0);
            const dateB = (b.orderDate || b.createdAt)?.toDate?.() || new Date(0);
            return dateB - dateA;
        });

        updateStats();
        renderOrders();
    } catch (error) {
        console.error('Error loading orders:', error);
        showToast('Error loading orders');
    } finally {
        $('loadingState').style.display = 'none';
    }
}

// Update stats counters
function updateStats() {
    const ready = orders.filter(o => (o.orderStatus || o.status) === 'confirmed').length;
    const transit = orders.filter(o => (o.orderStatus || o.status) === 'out_for_delivery').length;
    const deliveredToday = orders.filter(o => {
        const status = o.orderStatus || o.status;
        return status === 'delivered' && isToday(o.deliveredAt || o.updatedAt);
    }).length;

    $('readyCount').textContent = ready;
    $('transitCount').textContent = transit;
    $('deliveredCount').textContent = deliveredToday;
}

// Render orders based on current filter
function renderOrders() {
    const container = $('ordersContainer');
    let filtered;

    switch (currentFilter) {
        case 'active':
            filtered = orders.filter(o => {
                const s = o.orderStatus || o.status;
                return s === 'confirmed' || s === 'out_for_delivery';
            });
            break;
        case 'confirmed':
            filtered = orders.filter(o => (o.orderStatus || o.status) === 'confirmed');
            break;
        case 'out_for_delivery':
            filtered = orders.filter(o => (o.orderStatus || o.status) === 'out_for_delivery');
            break;
        case 'delivered':
            filtered = orders.filter(o => {
                const s = o.orderStatus || o.status;
                return s === 'delivered' && isToday(o.deliveredAt || o.updatedAt);
            });
            break;
        case 'all':
        default:
            filtered = orders;
            break;
    }

    if (filtered.length === 0) {
        container.style.display = 'none';
        $('emptyState').style.display = 'block';
        return;
    }

    $('emptyState').style.display = 'none';
    container.style.display = 'flex';
    container.innerHTML = filtered.map(order => renderOrderCard(order)).join('');
}

// Render a single order card
function renderOrderCard(order) {
    const status = order.orderStatus || order.status || 'pending';
    const orderId = order.orderId || order.id.slice(0, 12);
    const buyer = order.buyerDetails || {};
    const deliveryAddress = buyer.deliveryAddress || 'Not provided';
    const buyerLocation = buyer.location || 'N/A';
    const buyerName = buyer.name || 'Customer';
    const buyerPhone = buyer.phone || '';
    const items = order.items || [];
    const total = order.totalAmount || order.total || 0;
    const paymentMethod = order.paymentMethod || 'N/A';
    const isPaid = order.paymentStatus === 'completed' || paymentMethod === 'mpesa' || paymentMethod === 'wallet';
    const orderTime = formatDate(order.orderDate || order.createdAt);

    // Pickup location: seller info (first item's seller or general)
    const sellerName = items[0]?.sellerName || 'Seller';

    const itemsHtml = items.slice(0, 3).map(item => `
        <div class="item-row">
            <img src="${escapeHtml(item.imageUrl || 'images/product-placeholder.png')}" alt="" onerror="this.src='images/product-placeholder.png'">
            <span class="item-name">${escapeHtml(item.productName || item.name || 'Product')}</span>
            <span class="item-qty">×${item.quantity || 1}</span>
        </div>
    `).join('');
    const moreItems = items.length > 3 ? `<div style="font-size:11px;color:var(--gray-500);padding-top:4px;">+${items.length - 3} more item(s)</div>` : '';

    // Action buttons based on status
    let actions = '';
    if (status === 'confirmed') {
        actions = `
            <button class="action-btn mark-transit" onclick="markInTransit('${order.id}')">
                <i class="fas fa-truck"></i> Start Delivery
            </button>`;
    } else if (status === 'out_for_delivery') {
        actions = `
            <button class="action-btn mark-delivered" onclick="markDelivered('${order.id}')">
                <i class="fas fa-check-circle"></i> Mark Delivered
            </button>`;
    }

    // Phone call + navigate buttons
    const contactActions = buyerPhone ? `
        <button class="action-btn call" onclick="window.open('tel:${escapeHtml(buyerPhone)}')">
            <i class="fas fa-phone"></i> Call
        </button>` : '';

    const navigateAction = deliveryAddress !== 'Not provided' ? `
        <button class="action-btn navigate" onclick="window.open('https://www.google.com/maps/search/${encodeURIComponent(deliveryAddress + ', ' + buyerLocation)}','_blank')">
            <i class="fas fa-directions"></i> Navigate
        </button>` : '';

    return `
        <div class="order-card">
            <div class="order-card-header">
                <div>
                    <div class="order-id">#${escapeHtml(orderId)}</div>
                    <div class="order-time">${orderTime}</div>
                </div>
                <span class="status-badge ${escapeHtml(status)}">${
                    status === 'confirmed' ? '📦 Ready' :
                    status === 'out_for_delivery' ? '🚚 In Transit' :
                    status === 'delivered' ? '✅ Delivered' : status
                }</span>
            </div>
            <div class="order-card-body">
                <div class="info-row">
                    <i class="fas fa-user"></i>
                    <div class="info-content">
                        <span class="info-label">${escapeHtml(buyerName)}</span>
                        <span class="info-value">${escapeHtml(buyerPhone)}</span>
                    </div>
                </div>
                <div class="info-row">
                    <i class="fas fa-map-marker-alt" style="color:var(--red);"></i>
                    <div class="info-content">
                        <span class="info-label">Deliver To</span>
                        <span class="info-value">${escapeHtml(deliveryAddress)}</span>
                        <span class="info-value">${escapeHtml(buyerLocation)}</span>
                    </div>
                </div>
                <div class="items-summary">
                    <div class="items-summary-title">Items (${items.length})</div>
                    ${itemsHtml}
                    ${moreItems}
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;">
                    <div class="order-total">KES ${total.toLocaleString()}</div>
                    <span class="payment-badge ${isPaid ? 'paid' : 'cod'}">
                        <i class="fas fa-${isPaid ? 'check-circle' : 'money-bill-wave'}"></i>
                        ${isPaid ? 'Paid' : 'COD'}
                    </span>
                </div>
            </div>
            <div class="order-card-footer">
                ${contactActions}
                ${navigateAction}
                ${actions}
            </div>
        </div>
    `;
}

// Mark order as "out for delivery"
window.markInTransit = async function(orderId) {
    if (!confirm('Start delivery for this order?')) return;
    try {
        await updateDoc(doc(db, 'Orders', orderId), {
            orderStatus: 'out_for_delivery',
            status: 'out_for_delivery',
            outForDeliveryAt: Timestamp.now(),
            deliveryStartedBy: currentUser?.uid || 'delivery',
            updatedAt: Timestamp.now()
        });
        showToast('Order marked as In Transit');
        await loadOrders();
    } catch (error) {
        console.error('Error updating order:', error);
        showToast('Error updating order');
    }
};

// Mark order as delivered
window.markDelivered = async function(orderId) {
    if (!confirm('Confirm this order has been delivered?')) return;
    try {
        await updateDoc(doc(db, 'Orders', orderId), {
            orderStatus: 'delivered',
            status: 'delivered',
            deliveredAt: Timestamp.now(),
            deliveredBy: currentUser?.uid || 'delivery',
            updatedAt: Timestamp.now()
        });
        showToast('Order marked as Delivered ✅');
        await loadOrders();
    } catch (error) {
        console.error('Error updating order:', error);
        showToast('Error updating order');
    }
};

// Filter pills
document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentFilter = pill.dataset.filter;
        renderOrders();
    });
});

// Refresh button
$('refreshBtn').addEventListener('click', () => {
    $('refreshBtn').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    loadOrders().finally(() => {
        $('refreshBtn').innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
    });
});

// Auth check
onAuthStateChanged(auth, async user => {
    if (user) {
        currentUser = user;
        $('authGate').style.display = 'none';
        $('mainContent').style.display = 'block';
        await loadOrders();

        // Auto-refresh every 60 seconds
        setInterval(loadOrders, 60000);
    } else {
        currentUser = null;
        $('authGate').style.display = 'flex';
        $('mainContent').style.display = 'none';
    }
});
