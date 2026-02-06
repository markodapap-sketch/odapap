import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, getDoc, doc, updateDoc, deleteDoc, setDoc, orderBy, limit, Timestamp, addDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { app } from './js/firebase.js';
import { showNotification } from './notifications.js';

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const MASTER_ADMIN_EMAIL = 'admin@odapap.com';

// ============= DOM Elements =============
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ============= State =============
const state = {
    user: null,
    isMaster: false,
    section: 'dashboard',
    orders: [],
    users: [],
    products: [],
    productsPage: 0,
    productsLoaded: 0,
    PRODUCTS_PER_PAGE: 24,
    viewingUserId: null,
    charts: {},
    editImages: [], // For product image management
    imagesToDelete: [] // URLs of images to delete
};

// ============= Initialize =============
document.addEventListener('DOMContentLoaded', () => {
    setupMobileMenu();
    setupNav();
    setupEventListeners();
    updateDate();
    
    onAuthStateChanged(auth, handleAuth);
});

// ============= Auth =============
async function handleAuth(user) {
    if (!user) return window.location.href = 'login.html';
    
    const isAdmin = await checkAdmin(user.email, user.uid);
    if (!isAdmin) {
        showNotification('Access denied. Admin privileges required.', 'error');
        // Log out the non-admin user and redirect to login
        try {
            await signOut(auth);
        } catch (e) {
            console.error('Error signing out:', e);
        }
        return setTimeout(() => window.location.href = 'login.html', 1500);
    }
    
    state.user = user;
    state.isMaster = user.email === MASTER_ADMIN_EMAIL;
    $('adminBadge').textContent = state.isMaster ? 'Master' : 'Admin';
    loadDashboard();
}

async function checkAdmin(email, uid) {
    try {
        if (email === MASTER_ADMIN_EMAIL) {
            const ref = doc(db, "Admins", uid);
            try {
                const snap = await getDoc(ref);
                if (!snap.exists()) {
                    await setDoc(ref, { email, role: 'master_admin', createdAt: Timestamp.now() });
                }
            } catch (e) {
                // If rules block the read/write, master admin is still valid by email
                console.warn('Could not verify/create Admins doc (check Firestore rules):', e.message);
            }
            return true;
        }
        const q = query(collection(db, "Admins"), where("email", "==", email));
        return !(await getDocs(q)).empty;
    } catch (error) {
        console.error('Admin check failed:', error.message);
        // Fallback: allow master admin by email even if Firestore rules block the query
        return email === MASTER_ADMIN_EMAIL;
    }
}

// ============= Mobile Menu =============
function setupMobileMenu() {
    const menuBtn = $('menuBtn');
    const sidebar = $('sidebar');
    const overlay = $('overlay');
    
    const closeSidebar = () => {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    };
    
    menuBtn?.addEventListener('click', () => {
        sidebar.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    });
    
    overlay?.addEventListener('click', closeSidebar);
    
    $$('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 1024) closeSidebar();
        });
    });
}

// ============= Navigation =============
function setupNav() {
    $$('.nav-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const section = link.dataset.section;
            if (section) switchSection(section);
        });
    });
    
    $$('.view-all').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const section = link.dataset.section;
            if (section) switchSection(section);
        });
    });
}

// Expose to window for onclick handlers in HTML
window.switchSection = switchSection;

function switchSection(section) {
    $$('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector(`[data-section="${section}"]`)?.classList.add('active');
    
    $$('.page').forEach(p => p.classList.remove('active'));
    $(`${section}-page`)?.classList.add('active');
    
    $('mobileTitle').textContent = getTitle(section);
    state.section = section;
    
    // Reset user listings view when switching sections
    if (section !== 'users') {
        hideUserListings();
    }
    
    // Load section data
    const loaders = {
        orders: loadOrders,
        products: loadProducts,
        users: loadUsers,
        analytics: loadAnalytics,
        transactions: loadTransactions,
        verifications: loadVerifications,
        settings: loadSettings,
        notifications: loadNotificationsPage
    };
    loaders[section]?.();
}

function getTitle(s) {
    const t = { dashboard: 'Dashboard', orders: 'Orders', products: 'Products', users: 'Users', analytics: 'Analytics', transactions: 'Transactions', verifications: 'Verifications', settings: 'Settings', notifications: 'Notifications' };
    return t[s] || 'Dashboard';
}

// ============= Event Listeners =============
function setupEventListeners() {
    // Logout
    $('logoutBtn')?.addEventListener('click', async () => {
        if (confirm('Logout?')) {
            await signOut(auth);
            window.location.href = 'login.html';
        }
    });
    
    // Filters
    $('orderFilter')?.addEventListener('change', filterOrders);
    $('orderSearch')?.addEventListener('input', e => searchOrders(e.target.value));
    $('productSearch')?.addEventListener('input', e => searchProducts(e.target.value));
    $('userSearch')?.addEventListener('input', e => searchUsers(e.target.value));
    $('transactionFilter')?.addEventListener('change', filterTransactions);
    $('transactionSearch')?.addEventListener('input', filterTransactions);
    $('analyticsPeriod')?.addEventListener('change', loadAnalytics);
    
    // Products load more
    $('loadMoreProducts')?.addEventListener('click', loadMoreProducts);
    
    // Back to users
    $('backToUsersBtn')?.addEventListener('click', hideUserListings);
    
    // Modal
    $('closeModal')?.addEventListener('click', () => $('orderModal').classList.remove('active'));
    $('orderModal')?.addEventListener('click', e => {
        if (e.target === $('orderModal')) $('orderModal').classList.remove('active');
    });
    
    // Export
    $('exportBtn')?.addEventListener('click', exportProducts);
    $('exportReportBtn')?.addEventListener('click', exportReport);
    
    // Settings
    $('addAdminBtn')?.addEventListener('click', addAdmin);
    
    // Product modal
    $('addProductBtn')?.addEventListener('click', openAddModal);
    $('closeProductModal')?.addEventListener('click', closeProductModal);
    $('productModal')?.addEventListener('click', e => {
        if (e.target === $('productModal')) closeProductModal();
    });
    $('productForm')?.addEventListener('submit', handleProductFormSubmit);
    
    // Image upload handler
    $('imageInput')?.addEventListener('change', e => {
        handleImageUpload(e.target.files);
        e.target.value = ''; // Reset input
    });
}

// Handle product form submit
async function handleProductFormSubmit(e) {
    e.preventDefault();
    
    const id = $('editProductId').value;
    const saveBtn = $('saveProductBtn');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
        // Upload new images first
        const imageUrls = [];
        for (const img of state.editImages) {
            if (img.isExisting && img.url) {
                imageUrls.push(img.url);
            } else if (img.file) {
                // Upload new image
                const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
                const fileRef = storageRef(storage, `listings/${state.user.uid}/${fileName}`);
                await uploadBytes(fileRef, img.file);
                const url = await getDownloadURL(fileRef);
                imageUrls.push(url);
            }
        }
        
        // Delete removed images
        for (const url of state.imagesToDelete) {
            try {
                const imgRef = storageRef(storage, url);
                await deleteObject(imgRef);
            } catch (e) {
                console.warn('Could not delete image:', e);
            }
        }
        
        const data = {
            name: $('editName').value.trim(),
            category: $('editCategory').value.trim(),
            brand: $('editBrand').value.trim(),
            price: Number($('editPrice').value),
            totalStock: Number($('editStock').value),
            description: $('editDescription').value.trim(),
            status: $('editStatus').value,
            imageUrls: imageUrls,
            updatedAt: Timestamp.now()
        };
        
        // Check document size before upload (Firestore limit is ~1MB)
        const docSize = new Blob([JSON.stringify(data)]).size;
        if (docSize > 900000) { // 900KB safety margin
            throw new Error(`Product data too large (${Math.round(docSize/1024)}KB). Try reducing images or description length.`);
        }
        
        if (id) {
            // Update existing
            await updateDoc(doc(db, "Listings", id), data);
            const product = state.products.find(p => p.id === id);
            if (product) Object.assign(product, data);
            showNotification('Product updated');
        } else {
            // Create new
            data.uploaderId = state.user.uid;
            data.createdAt = Timestamp.now();
            const docRef = await addDoc(collection(db, "Listings"), data);
            state.products.unshift({ id: docRef.id, ...data });
            showNotification('Product added');
        }
        
        closeProductModal();
        renderProducts();
        updateMetrics();
    } catch (err) {
        console.error('Save error:', err);
        showNotification('Failed to save product', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}

function updateDate() {
    const now = new Date();
    const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    $('dateDisplay').textContent = now.toLocaleDateString('en-US', opts);
}

// ============= Dashboard =============
async function loadDashboard() {
    try {
        await Promise.all([loadOrders(), loadUsers(), loadProducts()]);
        updateMetrics();
        renderRecentOrders();
        initCharts();
    } catch (err) {
        console.error('Dashboard error:', err);
    }
}

// Pagination limits for admin queries
const ADMIN_PAGE_LIMIT = 100;

async function loadOrders() {
    try {
        // Load orders with pagination - most recent first
        const ordersQuery = query(
            collection(db, "Orders"),
            orderBy("createdAt", "desc"),
            limit(ADMIN_PAGE_LIMIT)
        );
        const snap = await getDocs(ordersQuery);
        state.orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        updateOrdersBadge();
        if (state.section === 'orders') renderOrders();
    } catch (err) {
        console.error('Orders error:', err);
    }
}

async function loadUsers() {
    try {
        // Load users with limit
        const usersQuery = query(
            collection(db, "Users"),
            limit(ADMIN_PAGE_LIMIT)
        );
        const snap = await getDocs(usersQuery);
        state.users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (state.section === 'users') renderUsers();
    } catch (err) {
        console.error('Users error:', err);
    }
}

async function loadProducts() {
    try {
        // Load products with limit
        const productsQuery = query(
            collection(db, "Listings"),
            limit(ADMIN_PAGE_LIMIT)
        );
        const snap = await getDocs(productsQuery);
        state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.productsLoaded = 0;
        state.productsPage = 0;
        if (state.section === 'products') renderProducts();
    } catch (err) {
        console.error('Products error:', err);
    }
}

function updateMetrics() {
    const orders = state.orders;
    const pending = orders.filter(o => o.orderStatus === 'pending').length;
    const delivered = orders.filter(o => o.orderStatus === 'delivered');
    
    let revenue = 0, productsSold = 0;
    delivered.forEach(o => {
        revenue += o.totalAmount || 0;
        o.items?.forEach(i => productsSold += i.quantity || 1);
    });
    
    let storeValue = 0;
    state.products.forEach(p => storeValue += (p.price || 0) * (p.totalStock || 0));
    
    $('metricOrders').textContent = orders.length;
    $('metricPending').textContent = pending;
    $('metricRevenue').textContent = `KES ${revenue.toLocaleString()}`;
    $('metricUsers').textContent = state.users.length;
    $('metricProducts').textContent = state.products.length;
    $('metricStoreValue').textContent = `KES ${storeValue.toLocaleString()}`;
    
    // Update sales statistics
    updateSalesStats();
}

function updateSalesStats() {
    const orders = state.orders;
    const delivered = orders.filter(o => o.orderStatus === 'delivered');
    
    // Calculate totals
    let totalSales = 0;
    let totalRevenue = 0;
    delivered.forEach(o => {
        totalRevenue += o.totalAmount || 0;
        o.items?.forEach(i => totalSales += i.quantity || 1);
    });
    
    // Calculate this month's stats
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    let monthSales = 0;
    let monthRevenue = 0;
    delivered.forEach(o => {
        let orderDate;
        if (o.orderDate?.toDate) {
            orderDate = o.orderDate.toDate();
        } else if (o.orderDate) {
            orderDate = new Date(o.orderDate);
        } else {
            return;
        }
        
        if (orderDate >= firstOfMonth) {
            monthRevenue += o.totalAmount || 0;
            o.items?.forEach(i => monthSales += i.quantity || 1);
        }
    });
    
    // Update DOM
    const totalSalesEl = $('totalSalesCount');
    const totalRevenueEl = $('totalRevenueAmount');
    const monthSalesEl = $('monthSalesCount');
    const monthRevenueEl = $('monthRevenueAmount');
    
    if (totalSalesEl) totalSalesEl.textContent = totalSales.toLocaleString();
    if (totalRevenueEl) totalRevenueEl.textContent = `KES ${totalRevenue.toLocaleString()}`;
    if (monthSalesEl) monthSalesEl.textContent = monthSales.toLocaleString();
    if (monthRevenueEl) monthRevenueEl.textContent = `KES ${monthRevenue.toLocaleString()}`;
}

function updateOrdersBadge() {
    const pending = state.orders.filter(o => o.orderStatus === 'pending').length;
    $('ordersBadge').textContent = pending;
    $('ordersBadge').style.display = pending > 0 ? '' : 'none';
}

// ============= Recent Orders =============
function renderRecentOrders() {
    const container = $('recentOrders');
    const recent = [...state.orders]
        .sort((a, b) => getDate(b.orderDate) - getDate(a.orderDate))
        .slice(0, 5);
    
    if (!recent.length) {
        container.innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:20px;">No orders yet</p>';
        return;
    }
    
    container.innerHTML = recent.map(o => `
        <div class="recent-order" onclick="viewOrder('${escapeAttr(o.id)}')">
            <div>
                <span class="order-id">${escapeHtml(o.orderId || o.id.slice(0, 8))}</span>
                <span class="customer">${escapeHtml(o.buyerDetails?.name || 'N/A')}</span>
            </div>
            <span class="status ${o.orderStatus}">${o.orderStatus}</span>
            <span class="amount">KES ${(o.totalAmount || 0).toLocaleString()}</span>
        </div>
    `).join('');
}

// ============= Charts =============
function initCharts() {
    if (typeof Chart === 'undefined') return;
    
    // Destroy existing charts
    Object.values(state.charts).forEach(c => c?.destroy());
    
    // Status Chart (Doughnut)
    const statusCtx = $('statusChart')?.getContext('2d');
    if (statusCtx) {
        const statusCounts = {
            pending: state.orders.filter(o => o.orderStatus === 'pending').length,
            confirmed: state.orders.filter(o => o.orderStatus === 'confirmed').length,
            out_for_delivery: state.orders.filter(o => o.orderStatus === 'out_for_delivery').length,
            delivered: state.orders.filter(o => o.orderStatus === 'delivered').length,
            cancelled: state.orders.filter(o => o.orderStatus === 'cancelled').length
        };
        
        state.charts.status = new Chart(statusCtx, {
            type: 'doughnut',
            data: {
                labels: ['Pending', 'Confirmed', 'Delivering', 'Delivered', 'Cancelled'],
                datasets: [{
                    data: Object.values(statusCounts),
                    backgroundColor: ['#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } } },
                cutout: '65%'
            }
        });
    }
    
    // Sales Chart (Line)
    const salesCtx = $('salesChart')?.getContext('2d');
    if (salesCtx) {
        const last7Days = getLast7Days();
        const salesByDay = {};
        last7Days.forEach(d => salesByDay[d] = 0);
        
        state.orders.forEach(o => {
            if (o.orderStatus === 'delivered' || o.paymentStatus === 'completed') {
                const date = getDate(o.orderDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                if (salesByDay[date] !== undefined) {
                    salesByDay[date] += o.totalAmount || 0;
                }
            }
        });
        
        state.charts.sales = new Chart(salesCtx, {
            type: 'line',
            data: {
                labels: last7Days,
                datasets: [{
                    label: 'Sales',
                    data: Object.values(salesByDay),
                    borderColor: '#ff5722',
                    backgroundColor: 'rgba(255, 87, 34, 0.1)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
                    x: { grid: { display: false } }
                }
            }
        });
    }
    
    // Category Chart (Bar)
    const categoryCtx = $('categoryChart')?.getContext('2d');
    if (categoryCtx) {
        const categories = {};
        state.products.forEach(p => {
            const cat = p.category || 'Other';
            categories[cat] = (categories[cat] || 0) + 1;
        });
        
        const sortedCats = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 6);
        
        state.charts.category = new Chart(categoryCtx, {
            type: 'bar',
            data: {
                labels: sortedCats.map(c => c[0]),
                datasets: [{
                    data: sortedCats.map(c => c[1]),
                    backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'],
                    borderRadius: 4,
                    barThickness: 20
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, grid: { display: false } },
                    y: { grid: { display: false } }
                }
            }
        });
    }
}

function getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }
    return days;
}

// ============= Orders Page =============
function renderOrders(orders = state.orders) {
    const tbody = $('ordersTable');
    if (!orders.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;">No orders found</td></tr>';
        return;
    }
    
    tbody.innerHTML = orders.sort((a, b) => getDate(b.orderDate) - getDate(a.orderDate)).map(o => `
        <tr>
            <td><strong>${escapeHtml(o.orderId || o.id.slice(0, 8))}</strong></td>
            <td>${escapeHtml(o.buyerDetails?.name || 'N/A')}</td>
            <td class="hide-sm">${o.items?.length || 0}</td>
            <td>KES ${(o.totalAmount || 0).toLocaleString()}</td>
            <td><span class="status ${escapeAttr(o.orderStatus)}">${escapeHtml(o.orderStatus)}</span></td>
            <td class="hide-sm">${formatDate(o.orderDate)}</td>
            <td>
                <div class="action-btns">
                    <button class="action-btn view" onclick="viewOrder('${escapeAttr(o.id)}')" title="View"><i class="fas fa-eye"></i></button>
                    <button class="action-btn edit" onclick="changeStatus('${escapeAttr(o.id)}', '${escapeAttr(o.orderStatus)}')" title="Status"><i class="fas fa-edit"></i></button>
                </div>
            </td>
        </tr>
    `).join('');
}

function filterOrders() {
    const status = $('orderFilter').value;
    const filtered = status === 'all' ? state.orders : state.orders.filter(o => o.orderStatus === status);
    renderOrders(filtered);
}

function searchOrders(q) {
    q = q.toLowerCase();
    const filtered = state.orders.filter(o => 
        o.orderId?.toLowerCase().includes(q) ||
        o.buyerDetails?.name?.toLowerCase().includes(q) ||
        o.buyerDetails?.email?.toLowerCase().includes(q)
    );
    renderOrders(filtered);
}

// View Order
window.viewOrder = function(id) {
    const order = state.orders.find(o => o.id === id);
    if (!order) return;
    
    const content = $('orderModalContent');
    content.innerHTML = `
        <div class="order-detail-header">
            <h3>Order ${escapeHtml(order.orderId || order.id.slice(0, 8))}</h3>
            <span class="status ${escapeAttr(order.orderStatus)}">${escapeHtml(order.orderStatus)}</span>
        </div>
        <div class="order-info-grid">
            <div class="order-info-box">
                <h4>Customer</h4>
                <p><strong>${escapeHtml(order.buyerDetails?.name || 'N/A')}</strong></p>
                <p>${escapeHtml(order.buyerDetails?.email || '')}</p>
                <p>${escapeHtml(order.buyerDetails?.phone || '')}</p>
            </div>
            <div class="order-info-box">
                <h4>Delivery</h4>
                <p>${escapeHtml(order.buyerDetails?.deliveryAddress || order.deliveryDetails?.address || 'N/A')}</p>
                <p>${escapeHtml(order.buyerDetails?.location || order.deliveryDetails?.city || '')}</p>
            </div>
            <div class="order-info-box">
                <h4>Payment</h4>
                <p><strong>${escapeHtml(order.paymentMethod || 'N/A')}</strong></p>
                <p>Status: ${escapeHtml(order.paymentStatus || 'pending')}</p>
                ${order.mpesaTransactionId ? `<p>M-Pesa: ${escapeHtml(order.mpesaTransactionId)}</p>` : ''}
            </div>
            <div class="order-info-box">
                <h4>Date</h4>
                <p>${formatDate(order.orderDate)}</p>
            </div>
        </div>
        <div class="order-items">
            <h4>Items Purchased</h4>
            ${order.items?.map(i => `
                <div class="order-item" style="display: flex; align-items: center; gap: 12px; padding: 10px; background: #f9f9f9; border-radius: 8px; margin-bottom: 8px;">
                    <img src="${escapeAttr(i.imageUrl || 'images/product-placeholder.png')}" alt="${escapeAttr(i.productName || i.name || '')}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px;" onerror="this.src='images/product-placeholder.png'">
                    <div style="flex: 1;">
                        <strong>${escapeHtml(i.productName || i.name || 'Unknown Product')}</strong>
                        ${i.selectedVariation ? `<br><small style="color: #666;">${escapeHtml(i.selectedVariation.title || '')}: ${escapeHtml(i.selectedVariation.attr_name || '')}</small>` : ''}
                        <br><small>Listing ID: ${escapeHtml(i.listingId || 'N/A')}</small>
                    </div>
                    <div style="text-align: right;">
                        <span>× ${i.quantity}</span>
                        <br><strong>KES ${(i.totalPrice || 0).toLocaleString()}</strong>
                    </div>
                </div>
            `).join('') || '<p>No items details available</p>'}
        </div>
        <div class="order-total">
            <div style="display: flex; flex-direction: column; gap: 5px; width: 100%;">
                <div style="display: flex; justify-content: space-between;"><span>Subtotal</span><span>KES ${(order.subtotal || 0).toLocaleString()}</span></div>
                <div style="display: flex; justify-content: space-between;"><span>Shipping</span><span>KES ${(order.shippingFee || 0).toLocaleString()}</span></div>
                ${order.discount ? `<div style="display: flex; justify-content: space-between;"><span>Discount</span><span>-KES ${(order.discount || 0).toLocaleString()}</span></div>` : ''}
                <div style="display: flex; justify-content: space-between; font-weight: bold; border-top: 1px solid #ddd; padding-top: 8px;"><span>Total</span><span>KES ${(order.totalAmount || 0).toLocaleString()}</span></div>
            </div>
        </div>
    `;
    $('orderModal').classList.add('active');
};

// Change Status — opens a dropdown modal instead of prompt()
let pendingStatusOrderId = null;
let pendingStatusCurrent = null;

window.changeStatus = function(id, current) {
    const statusLabels = {
        'pending': 'Pending',
        'seller_confirmed': 'Seller Confirmed',
        'confirmed': 'Admin Confirmed',
        'out_for_delivery': 'Out for Delivery',
        'delivered': 'Delivered',
        'cancelled': 'Cancelled',
        'refund_requested': 'Refund Requested',
        'refunded': 'Refunded',
        'disputed': 'Disputed'
    };
    
    pendingStatusOrderId = id;
    pendingStatusCurrent = current;
    
    const select = $('statusSelect');
    select.innerHTML = Object.entries(statusLabels).map(([k, v]) =>
        `<option value="${k}" ${k === current ? 'selected disabled' : ''}>${v}${k === current ? ' (current)' : ''}</option>`
    ).join('');
    
    $('statusModal').classList.add('active');
};

window.closeStatusModal = function() {
    $('statusModal').classList.remove('active');
    pendingStatusOrderId = null;
    pendingStatusCurrent = null;
};

window.confirmStatusChange = async function() {
    const newStatus = $('statusSelect').value;
    const id = pendingStatusOrderId;
    const current = pendingStatusCurrent;
    
    if (!id || !newStatus || newStatus === current) {
        closeStatusModal();
        return;
    }
    
    const btn = $('confirmStatusBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    
    try {
        // Get order details for notification
        const order = state.orders.find(o => o.id === id);
        
        const updates = { 
            orderStatus: newStatus, 
            status: newStatus,
            updatedAt: Timestamp.now() 
        };
        
        // Add confirmation timestamps
        if (newStatus === 'seller_confirmed') {
            updates.sellerConfirmedAt = Timestamp.now();
            updates.sellerConfirmed = true;
        }
        if (newStatus === 'confirmed') {
            updates.adminConfirmedAt = Timestamp.now();
            updates.adminConfirmed = true;
            updates.confirmedBy = state.user.uid;
        }
        if (newStatus === 'delivered') {
            updates.deliveredAt = Timestamp.now();
        }
        if (newStatus === 'cancelled') {
            updates.cancelledAt = Timestamp.now();
            updates.cancelledBy = state.user.uid;
        }
        if (newStatus === 'refunded') {
            updates.refundedAt = Timestamp.now();
            updates.refundProcessedBy = state.user.uid;
        }
        
        await updateDoc(doc(db, "Orders", id), updates);
        
        // Notify buyer of status change
        if (order && order.buyerInfo && order.buyerInfo.userId) {
            await notifyBuyerOfStatusChange(order, newStatus);
        }
        
        showNotification('Status updated');
        loadOrders().then(() => {
            updateMetrics();
            renderRecentOrders();
        });
    } catch (err) {
        showNotification('Error updating status', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Update Status';
        closeStatusModal();
    }
};

// Notify buyer when admin changes order status
async function notifyBuyerOfStatusChange(order, newStatus) {
    try {
        const notificationData = getAdminNotificationData(order, newStatus);
        if (!notificationData) return;
        
        await addDoc(collection(db, "Notifications"), {
            userId: order.buyerInfo.userId,
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

function getAdminNotificationData(order, status) {
    const productName = order.productName || (order.items && order.items[0]?.name) || 'Your order';
    
    const notifications = {
        confirmed: {
            type: 'order_confirmed',
            title: 'Order Approved! ✅',
            message: `${productName} has been verified by Oda Pap and is ready for dispatch.`
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
            message: `${productName} has been cancelled.`
        },
        refunded: {
            type: 'order_cancelled',
            title: 'Refund Processed 💰',
            message: `Your refund for ${productName} has been processed.`
        }
    };
    
    return notifications[status] || null;
}

// ============= Products Page =============
function renderProducts(products = state.products) {
    const tbody = $('productsTableBody');
    const btn = $('loadMoreProducts');
    
    if (!products.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;">No products found</td></tr>';
        btn.style.display = 'none';
        return;
    }
    
    // Show first batch
    const toShow = products.slice(0, state.PRODUCTS_PER_PAGE);
    state.productsLoaded = toShow.length;
    
    tbody.innerHTML = toShow.map(renderProductRow).join('');
    btn.style.display = state.productsLoaded < products.length ? '' : 'none';
}

function loadMoreProducts() {
    const searchVal = $('productSearch').value.toLowerCase();
    let products = state.products;
    
    if (searchVal) {
        products = products.filter(p => 
            p.name?.toLowerCase().includes(searchVal) ||
            p.category?.toLowerCase().includes(searchVal)
        );
    }
    
    const nextBatch = products.slice(state.productsLoaded, state.productsLoaded + state.PRODUCTS_PER_PAGE);
    const tbody = $('productsTableBody');
    
    nextBatch.forEach(p => tbody.insertAdjacentHTML('beforeend', renderProductRow(p)));
    state.productsLoaded += nextBatch.length;
    
    $('loadMoreProducts').style.display = state.productsLoaded < products.length ? '' : 'none';
}

function renderProductRow(p) {
    const img = p.imageUrls?.[0] || p.imageUrl || 'https://placehold.co/44x44/e2e8f0/64748b?text=N/A';
    const status = p.status || (p.totalStock > 0 ? 'active' : 'out_of_stock');
    
    // Prime tags
    const isGeneral = p.primeCategories?.generalShop || false;
    const isFeatured = p.primeCategories?.featured || false;
    const isBestseller = p.primeCategories?.bestseller || false;
    const isOffers = p.primeCategories?.offers || false;
    
    return `
        <tr data-id="${escapeAttr(p.id)}">
            <td>
                <img src="${escapeAttr(img)}" class="product-thumb" alt="${escapeAttr(p.name || '')}" 
                     onerror="this.src='https://placehold.co/44x44/e2e8f0/64748b?text=N/A'"
                     onclick="window.open('product.html?id=${escapeAttr(p.id)}', '_blank')">
            </td>
            <td class="editable-cell">
                <input type="text" value="${escapeHtml(p.name || '')}" data-field="name" onchange="updateProductField('${escapeAttr(p.id)}', 'name', this.value, this)">
                <span class="cell-save-indicator"><i class="fas fa-check"></i></span>
            </td>
            <td class="editable-cell">
                <input type="text" value="${escapeHtml(p.category || '')}" data-field="category" onchange="updateProductField('${escapeAttr(p.id)}', 'category', this.value, this)">
                <span class="cell-save-indicator"><i class="fas fa-check"></i></span>
            </td>
            <td class="editable-cell">
                <input type="number" value="${p.price || 0}" data-field="price" min="0" onchange="updateProductField('${escapeAttr(p.id)}', 'price', Number(this.value), this)">
                <span class="cell-save-indicator"><i class="fas fa-check"></i></span>
            </td>
            <td class="editable-cell">
                <input type="number" value="${p.totalStock || 0}" data-field="totalStock" min="0" onchange="updateProductField('${escapeAttr(p.id)}', 'totalStock', Number(this.value), this)">
                <span class="cell-save-indicator"><i class="fas fa-check"></i></span>
            </td>
            <td class="editable-cell">
                <input type="text" value="${escapeHtml(p.brand || '')}" data-field="brand" onchange="updateProductField('${escapeAttr(p.id)}', 'brand', this.value, this)">
                <span class="cell-save-indicator"><i class="fas fa-check"></i></span>
            </td>
            <td>
                <div class="prime-tags">
                    <span class="prime-tag ${isGeneral ? 'general' : 'inactive'}" onclick="togglePrimeTag('${escapeAttr(p.id)}', 'generalShop', ${!isGeneral})" title="General Shop">
                        <i class="fas fa-store"></i> Shop
                    </span>
                    <span class="prime-tag ${isFeatured ? 'featured' : 'inactive'}" onclick="togglePrimeTag('${escapeAttr(p.id)}', 'featured', ${!isFeatured})" title="Featured">
                        <i class="fas fa-star"></i> Featured
                    </span>
                    <span class="prime-tag ${isBestseller ? 'bestseller' : 'inactive'}" onclick="togglePrimeTag('${escapeAttr(p.id)}', 'bestseller', ${!isBestseller})" title="Best Seller">
                        <i class="fas fa-fire"></i> Best
                    </span>
                    <span class="prime-tag ${isOffers ? 'offers' : 'inactive'}" onclick="togglePrimeTag('${escapeAttr(p.id)}', 'offers', ${!isOffers})" title="Offers/Deals">
                        <i class="fas fa-percent"></i> Offer
                    </span>
                </div>
            </td>
            <td>
                <select class="status-select ${escapeAttr(status)}" onchange="updateProductField('${escapeAttr(p.id)}', 'status', this.value, this); this.className='status-select '+this.value">
                    <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive</option>
                    <option value="out_of_stock" ${status === 'out_of_stock' ? 'selected' : ''}>Out of Stock</option>
                </select>
            </td>
            <td>
                <div class="action-btns">
                    <button class="action-btn edit" onclick="openEditModal('${escapeAttr(p.id)}')" title="Full Edit"><i class="fas fa-expand"></i></button>
                    <button class="action-btn delete" onclick="deleteProduct('${escapeAttr(p.id)}')" title="Delete"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `;
}

// Toggle prime category tags
window.togglePrimeTag = async function(productId, tag, value) {
    try {
        const product = state.products.find(p => p.id === productId);
        if (!product) return;
        
        // Initialize primeCategories if not exists
        if (!product.primeCategories) {
            product.primeCategories = {};
        }
        
        product.primeCategories[tag] = value;
        
        await updateDoc(doc(db, "Listings", productId), {
            primeCategories: product.primeCategories,
            updatedAt: Timestamp.now()
        });
        
        // Re-render the row
        const row = document.querySelector(`tr[data-id="${productId}"]`);
        if (row) {
            row.outerHTML = renderProductRow(product);
        }
        
        showNotification(`${value ? 'Added to' : 'Removed from'} ${formatTagName(tag)}`, 'success');
    } catch (err) {
        console.error('Toggle prime tag error:', err);
        showNotification('Failed to update tag', 'error');
    }
};

function formatTagName(tag) {
    const names = {
        generalShop: 'General Shop',
        featured: 'Featured',
        bestseller: 'Best Sellers',
        offers: 'Offers'
    };
    return names[tag] || tag;
}

// escapeHtml function defined below in Utilities section

// Update single field
window.updateProductField = async function(id, field, value, inputEl) {
    const cell = inputEl.closest('.editable-cell') || inputEl.parentElement;
    cell.classList.add('changed');
    
    try {
        await updateDoc(doc(db, "Listings", id), { 
            [field]: value,
            updatedAt: Timestamp.now()
        });
        
        // Update local state
        const product = state.products.find(p => p.id === id);
        if (product) product[field] = value;
        
        cell.classList.remove('changed');
        cell.classList.add('saved');
        setTimeout(() => cell.classList.remove('saved'), 1500);
    } catch (err) {
        console.error('Update error:', err);
        showNotification('Failed to update', 'error');
        cell.classList.remove('changed');
    }
};

// Open full edit modal
window.openEditModal = function(id) {
    const product = state.products.find(p => p.id === id);
    if (!product) return;
    
    $('productModalTitle').textContent = 'Edit Product';
    $('editProductId').value = id;
    $('editName').value = product.name || '';
    $('editCategory').value = product.category || '';
    $('editBrand').value = product.brand || '';
    $('editPrice').value = product.price || 0;
    $('editStock').value = product.totalStock || 0;
    $('editDescription').value = product.description || '';
    $('editStatus').value = product.status || 'active';
    $('saveProductBtn').textContent = 'Save Changes';
    
    // Load existing images
    state.editImages = (product.imageUrls || []).map(url => ({ url, isExisting: true }));
    state.imagesToDelete = [];
    renderImageList();
    
    $('productModal').classList.add('active');
};

// Open add new product modal
window.openAddModal = function() {
    $('productModalTitle').textContent = 'Add New Product';
    $('editProductId').value = '';
    $('productForm').reset();
    $('editStatus').value = 'active';
    $('saveProductBtn').textContent = 'Add Product';
    
    // Clear images
    state.editImages = [];
    state.imagesToDelete = [];
    renderImageList();
    
    $('productModal').classList.add('active');
};

window.closeProductModal = function() {
    $('productModal').classList.remove('active');
    state.editImages = [];
    state.imagesToDelete = [];
};

// Image management functions
function renderImageList() {
    const container = $('imageList');
    container.innerHTML = state.editImages.map((img, i) => `
        <div class="image-item ${img.uploading ? 'uploading' : ''}" onclick="removeImage(${i})">
            <img src="${img.url || img.preview}" alt="Product image">
            <div class="image-remove"><i class="fas fa-trash"></i></div>
        </div>
    `).join('');
    
    // Show/hide add button based on max images
    $('imageAddBtn').style.display = state.editImages.length >= 5 ? 'none' : '';
}

window.removeImage = function(index) {
    const img = state.editImages[index];
    if (img.isExisting && img.url) {
        state.imagesToDelete.push(img.url);
    }
    state.editImages.splice(index, 1);
    renderImageList();
};

async function handleImageUpload(files) {
    const maxImages = 5;
    const remaining = maxImages - state.editImages.length;
    const toUpload = Array.from(files).slice(0, remaining);
    
    for (const file of toUpload) {
        if (!file.type.startsWith('image/')) continue;
        
        // Create preview
        const preview = URL.createObjectURL(file);
        const imgObj = { preview, file, uploading: false, isExisting: false };
        state.editImages.push(imgObj);
    }
    
    renderImageList();
}

function searchProducts(q) {
    q = q.toLowerCase();
    const filtered = state.products.filter(p => 
        p.name?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.uploaderId?.toLowerCase().includes(q)
    );
    state.productsLoaded = 0;
    renderProducts(filtered);
}

window.viewProduct = function(id) {
    window.open(`product.html?id=${id}`, '_blank');
};

window.editProduct = function(id) {
    openEditModal(id);
};

window.deleteProduct = async function(id) {
    if (confirm('Delete this product?')) {
        try {
            await deleteDoc(doc(db, "Listings", id));
            showNotification('Product deleted');
            loadProducts();
        } catch (err) {
            showNotification('Error deleting', 'error');
        }
    }
};

function exportProducts() {
    const csv = ['Name,Price,Category,Stock,Brand,Status,UploaderId'];
    state.products.forEach(p => {
        csv.push(`"${sanitizeCSV(p.name || '')}",${p.price || 0},"${sanitizeCSV(p.category || '')}",${p.totalStock || 0},"${sanitizeCSV(p.brand || '')}","${sanitizeCSV(p.status || 'active')}","${sanitizeCSV(p.uploaderId || '')}"`);
    });
    downloadCSV(csv.join('\n'), 'products.csv');
}

// ============= Users Page =============
function renderUsers(users = state.users) {
    const tbody = $('usersTable');
    if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;">No users found</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(u => {
        const listings = state.products.filter(p => p.uploaderId === u.id).length;
        const verifiedBadge = u.verified 
            ? '<svg class="verified-tick" viewBox="0 0 22 22" style="width:14px;height:14px;vertical-align:middle;margin-left:2px;"><path fill="#1d9bf0" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.852-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681.132-.637.075-1.299-.165-1.903.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path></svg>'
            : '';
        return `
            <tr>
                <td>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <img src="${escapeAttr(u.profilePicUrl || 'https://placehold.co/32x32/e2e8f0/64748b?text=U')}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" onerror="this.src='https://placehold.co/32x32/e2e8f0/64748b?text=U'">
                        <span>${escapeHtml(u.name || 'N/A')} ${verifiedBadge}</span>
                    </div>
                </td>
                <td class="hide-sm">${escapeHtml(u.email || 'N/A')}</td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="viewUserListings('${escapeAttr(u.id)}')">${listings} listings</button>
                </td>
                <td class="hide-sm">
                    <button class="btn btn-sm ${u.verified ? 'btn-verified' : 'btn-unverified'}" onclick="toggleUserVerification('${escapeAttr(u.id)}', ${!u.verified})">
                        <i class="fas fa-${u.verified ? 'check-circle' : 'circle'}"></i>
                        ${u.verified ? 'Verified' : 'Unverified'}
                    </button>
                </td>
                <td>
                    <div class="action-btns">
                        <button class="action-btn ${u.verified ? 'unverify' : 'verify'}" onclick="toggleUserVerification('${escapeAttr(u.id)}', ${!u.verified})" title="${u.verified ? 'Remove Verification' : 'Verify User'}">
                            <i class="fas fa-${u.verified ? 'times-circle' : 'badge-check'}"></i>
                        </button>
                        <button class="action-btn view" onclick="viewUserListings('${escapeAttr(u.id)}')" title="View Listings"><i class="fas fa-box"></i></button>
                        <button class="action-btn msg" onclick="messageUser('${escapeAttr(u.id)}')" title="Message"><i class="fas fa-envelope"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Toggle user verification status
window.toggleUserVerification = async function(userId, shouldVerify) {
    try {
        const user = state.users.find(u => u.id === userId);
        if (!user) {
            showNotification('User not found', 'error');
            return;
        }
        
        // Update Firestore
        await updateDoc(doc(db, 'Users', userId), {
            verified: shouldVerify,
            verifiedAt: shouldVerify ? Timestamp.now() : null,
            verifiedBy: shouldVerify ? state.user.uid : null
        });
        
        // Update local state
        user.verified = shouldVerify;
        
        // Re-render users
        renderUsers();
        
        showNotification(
            shouldVerify 
                ? `${user.name || 'User'} has been verified! They now have a blue tick.` 
                : `Verification removed from ${user.name || 'User'}`,
            'success'
        );
    } catch (error) {
        console.error('Error updating verification:', error);
        showNotification('Failed to update verification status', 'error');
    }
};

function searchUsers(q) {
    q = q.toLowerCase();
    const filtered = state.users.filter(u => 
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q)
    );
    renderUsers(filtered);
}

// User Listings View
window.viewUserListings = function(userId) {
    state.viewingUserId = userId;
    const user = state.users.find(u => u.id === userId);
    if (!user) return;
    
    const userProducts = state.products.filter(p => p.uploaderId === userId);
    const sales = state.orders.filter(o => 
        o.items?.some(i => userProducts.some(p => p.id === i.productId))
    );
    let revenue = 0;
    sales.forEach(o => {
        o.items?.forEach(i => {
            if (userProducts.some(p => p.id === i.productId)) {
                revenue += i.totalPrice || 0;
            }
        });
    });
    
    // Update banner
    $('userBannerAvatar').src = user.profilePicUrl || 'https://placehold.co/64x64/e2e8f0/64748b?text=User';
    $('userBannerName').textContent = user.name || 'Unknown';
    $('userBannerEmail').textContent = user.email || '';
    $('userListingCount').textContent = userProducts.length;
    $('userSalesCount').textContent = sales.length;
    $('userRevenue').textContent = revenue.toLocaleString();
    
    // Show user products as table rows
    const tbody = $('userProductsGrid');
    tbody.innerHTML = userProducts.length 
        ? userProducts.map(renderUserProductRow).join('')
        : '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--gray-500);">No listings</td></tr>';
    
    // Toggle views
    $('usersTableView').style.display = 'none';
    $('userListingsView').style.display = 'block';
    $('backToUsersBtn').style.display = '';
    $('usersPageTitle').textContent = `${user.name || 'User'}'s Listings`;
    $('userSearch').style.display = 'none';
};

// Simplified row for user listings view
function renderUserProductRow(p) {
    const img = p.imageUrls?.[0] || p.imageUrl || 'https://placehold.co/44x44/e2e8f0/64748b?text=N/A';
    return `
        <tr>
            <td>
                <img src="${escapeAttr(img)}" class="product-thumb" alt="${escapeAttr(p.name || '')}" 
                     onerror="this.src='https://placehold.co/44x44/e2e8f0/64748b?text=N/A'"
                     onclick="window.open('product.html?id=${escapeAttr(p.id)}', '_blank')">
            </td>
            <td><strong>${escapeHtml(p.name || 'Unnamed')}</strong></td>
            <td>${escapeHtml(p.category || 'N/A')}</td>
            <td>KES ${(p.price || 0).toLocaleString()}</td>
            <td>${p.totalStock || 0}</td>
            <td>
                <div class="action-btns">
                    <button class="action-btn view" onclick="window.open('product.html?id=${escapeAttr(p.id)}', '_blank')" title="View"><i class="fas fa-eye"></i></button>
                    <button class="action-btn edit" onclick="openEditModal('${escapeAttr(p.id)}')" title="Edit"><i class="fas fa-edit"></i></button>
                </div>
            </td>
        </tr>
    `;
}

function hideUserListings() {
    state.viewingUserId = null;
    $('usersTableView').style.display = '';
    $('userListingsView').style.display = 'none';
    $('backToUsersBtn').style.display = 'none';
    $('usersPageTitle').textContent = 'Users';
    $('userSearch').style.display = '';
}

window.messageUser = function(id) {
    const user = state.users.find(u => u.id === id);
    if (user) {
        window.open(`chat.html?userId=${id}`, '_blank');
    }
};

// ============= Analytics =============
async function loadAnalytics() {
    const days = parseInt($('analyticsPeriod')?.value || 30);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    const periodOrders = state.orders.filter(o => getDate(o.orderDate) >= cutoff);
    const prevCutoff = new Date(cutoff);
    prevCutoff.setDate(prevCutoff.getDate() - days);
    const prevOrders = state.orders.filter(o => {
        const d = getDate(o.orderDate);
        return d >= prevCutoff && d < cutoff;
    });
    
    // Calculate metrics
    let sales = 0, prevSales = 0;
    periodOrders.forEach(o => {
        if (o.orderStatus === 'delivered' || o.paymentStatus === 'completed') {
            sales += o.totalAmount || 0;
        }
    });
    prevOrders.forEach(o => {
        if (o.orderStatus === 'delivered' || o.paymentStatus === 'completed') {
            prevSales += o.totalAmount || 0;
        }
    });
    
    const avgOrder = periodOrders.length ? sales / periodOrders.length : 0;
    const newUsers = state.users.filter(u => {
        const joined = u.createdAt?.toDate ? u.createdAt.toDate() : new Date(u.createdAt || 0);
        return joined >= cutoff;
    }).length;
    
    // Update UI
    $('aSales').textContent = `KES ${sales.toLocaleString()}`;
    $('aOrders').textContent = periodOrders.length;
    $('aAvgOrder').textContent = `KES ${Math.round(avgOrder).toLocaleString()}`;
    $('aNewUsers').textContent = newUsers;
    
    // Changes
    updateChange('aSalesChange', sales, prevSales);
    updateChange('aOrdersChange', periodOrders.length, prevOrders.length);
    
    // Revenue Chart
    renderRevenueChart(days);
    
    // Top Sellers & Products
    renderTopSellers();
    renderBestProducts();
}

function updateChange(id, current, prev) {
    const el = $(id);
    if (!el) return;
    const change = prev > 0 ? ((current - prev) / prev * 100).toFixed(1) : 0;
    el.textContent = `${change >= 0 ? '+' : ''}${change}%`;
    el.className = `analytics-change ${change >= 0 ? 'positive' : 'negative'}`;
}

function renderRevenueChart(days) {
    if (state.charts.revenue) state.charts.revenue.destroy();
    
    const ctx = $('revenueChart')?.getContext('2d');
    if (!ctx) return;
    
    // Generate labels
    const labels = [];
    const data = [];
    for (let i = days - 1; i >= 0; i -= Math.ceil(days / 10)) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        
        const dayRevenue = state.orders
            .filter(o => {
                const od = getDate(o.orderDate);
                return od.toDateString() === d.toDateString() && 
                    (o.orderStatus === 'delivered' || o.paymentStatus === 'completed');
            })
            .reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        data.push(dayRevenue);
    }
    
    state.charts.revenue = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Revenue',
                data,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.3,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderTopSellers() {
    const container = $('topSellers');
    
    // Count sales by seller (uploaderId)
    const sellerSales = {};
    state.orders.forEach(o => {
        if (o.orderStatus === 'delivered') {
            o.items?.forEach(i => {
                const product = state.products.find(p => p.id === i.productId);
                if (product?.uploaderId) {
                    if (!sellerSales[product.uploaderId]) {
                        sellerSales[product.uploaderId] = { sales: 0, revenue: 0 };
                    }
                    sellerSales[product.uploaderId].sales++;
                    sellerSales[product.uploaderId].revenue += i.totalPrice || 0;
                }
            });
        }
    });
    
    const sorted = Object.entries(sellerSales)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 5);
    
    if (!sorted.length) {
        container.innerHTML = '<p style="text-align:center;color:var(--gray-500);">No data</p>';
        return;
    }
    
    container.innerHTML = sorted.map(([sellerId, data], i) => {
        const user = state.users.find(u => u.id === sellerId);
        const badge = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'default';
        return `
            <div class="rank-item">
                <span class="rank-badge ${badge}">${i + 1}</span>
                <img src="${user?.profilePicUrl || 'https://placehold.co/36x36/e2e8f0/64748b?text=U'}" alt="" onerror="this.src='https://placehold.co/36x36/e2e8f0/64748b?text=U'">
                <div class="info">
                    <span class="name">${user?.name || 'Unknown'}</span>
                    <span class="stats">${data.sales} sales • KES ${data.revenue.toLocaleString()}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderBestProducts() {
    const container = $('bestProducts');
    
    // Count product sales
    const productSales = {};
    state.orders.forEach(o => {
        if (o.orderStatus === 'delivered') {
            o.items?.forEach(i => {
                if (!productSales[i.productId]) {
                    productSales[i.productId] = { qty: 0, revenue: 0, name: i.productName };
                }
                productSales[i.productId].qty += i.quantity || 1;
                productSales[i.productId].revenue += i.totalPrice || 0;
            });
        }
    });
    
    const sorted = Object.entries(productSales)
        .sort((a, b) => b[1].qty - a[1].qty)
        .slice(0, 5);
    
    if (!sorted.length) {
        container.innerHTML = '<p style="text-align:center;color:var(--gray-500);">No data</p>';
        return;
    }
    
    container.innerHTML = sorted.map(([productId, data], i) => {
        const product = state.products.find(p => p.id === productId);
        const badge = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'default';
        return `
            <div class="rank-item">
                <span class="rank-badge ${badge}">${i + 1}</span>
                <img src="${product?.imageUrls?.[0] || 'https://placehold.co/36x36/e2e8f0/64748b?text=P'}" alt="" onerror="this.src='https://placehold.co/36x36/e2e8f0/64748b?text=P'">
                <div class="info">
                    <span class="name">${data.name || 'Unknown'}</span>
                    <span class="stats">${data.qty} sold • KES ${data.revenue.toLocaleString()}</span>
                </div>
            </div>
        `;
    }).join('');
}

function exportReport() {
    const csv = ['Date,Orders,Revenue,Avg Order'];
    const days = parseInt($('analyticsPeriod')?.value || 30);
    
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dayOrders = state.orders.filter(o => getDate(o.orderDate).toDateString() === d.toDateString());
        const revenue = dayOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const avg = dayOrders.length ? revenue / dayOrders.length : 0;
        csv.push(`${d.toLocaleDateString()},${dayOrders.length},${revenue},${avg.toFixed(0)}`);
    }
    
    downloadCSV(csv.join('\n'), 'analytics-report.csv');
}

// ============= Transactions =============
let allTransactions = [];

async function loadTransactions() {
    const tbody = $('transactionsTable');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;"><div class="loading-spinner"></div></td></tr>';
    
    try {
        // Try to load from Transactions collection first
        const snap = await getDocs(collection(db, "Transactions"));
        allTransactions = snap.docs.map(d => ({ id: d.id, ...d.data(), source: 'transaction' }));
        
        // Also add all orders as transactions for a complete view
        state.orders.forEach(o => {
            // Check if this order isn't already in transactions
            const exists = allTransactions.some(t => t.orderId === o.id || t.id === o.id);
            if (!exists) {
                allTransactions.push({
                    id: o.id,
                    orderId: o.orderId || o.id,
                    userEmail: o.buyerDetails?.email || 'N/A',
                    userName: o.buyerDetails?.name || 'N/A',
                    userPhone: o.buyerDetails?.phone || '',
                    amount: o.totalAmount || 0,
                    status: o.paymentStatus || (o.orderStatus === 'delivered' ? 'completed' : o.orderStatus === 'cancelled' ? 'failed' : 'pending'),
                    paymentMethod: o.paymentMethod || 'N/A',
                    mpesaCode: o.mpesaTransactionId || '',
                    createdAt: o.orderDate || o.createdAt,
                    orderStatus: o.orderStatus,
                    source: 'order'
                });
            }
        });
        
        // Also load wallet transactions if available
        try {
            const walletSnap = await getDocs(collection(db, "WalletTransactions"));
            walletSnap.docs.forEach(d => {
                const data = d.data();
                allTransactions.push({
                    id: d.id,
                    userEmail: data.userEmail || 'N/A',
                    userName: data.userName || 'N/A',
                    amount: data.amount || 0,
                    status: data.status || 'completed',
                    type: data.type || 'wallet',
                    paymentMethod: data.type === 'deposit' ? 'Deposit' : data.type === 'withdrawal' ? 'Withdrawal' : 'Wallet',
                    createdAt: data.createdAt,
                    source: 'wallet'
                });
            });
        } catch (e) {
            // WalletTransactions collection might not exist
        }
        
        renderTransactions(allTransactions);
    } catch (err) {
        console.error('Transactions error:', err);
        // Show transactions from orders as fallback
        allTransactions = state.orders.map(o => ({
            id: o.id,
            orderId: o.orderId || o.id,
            userEmail: o.buyerDetails?.email || 'N/A',
            userName: o.buyerDetails?.name || 'N/A',
            userPhone: o.buyerDetails?.phone || '',
            amount: o.totalAmount || 0,
            status: o.paymentStatus || (o.orderStatus === 'delivered' ? 'completed' : o.orderStatus === 'cancelled' ? 'failed' : 'pending'),
            paymentMethod: o.paymentMethod || 'N/A',
            mpesaCode: o.mpesaTransactionId || '',
            createdAt: o.orderDate || o.createdAt,
            orderStatus: o.orderStatus,
            source: 'order'
        }));
        renderTransactions(allTransactions);
    }
}

function renderTransactions(txns) {
    const tbody = $('transactionsTable');
    if (!txns.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;">No transactions</td></tr>';
        return;
    }
    
    // Sort by date descending (most recent first)
    const sorted = txns.sort((a, b) => getDate(b.createdAt) - getDate(a.createdAt));
    
    tbody.innerHTML = sorted.map(t => {
        const statusClass = t.status === 'completed' ? 'delivered' : t.status === 'failed' ? 'cancelled' : 'pending';
        const typeIcon = t.source === 'wallet' ? 'fa-wallet' : t.source === 'order' ? 'fa-shopping-cart' : 'fa-exchange-alt';
        const formattedDate = formatDateTime(t.createdAt);
        
        return `
            <tr class="transaction-row" onclick="viewTransactionDetails('${escapeAttr(t.id)}', '${escapeAttr(t.source)}')">
                <td>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <i class="fas ${typeIcon}" style="color:var(--gray-400);font-size:12px;"></i>
                        <span>${(t.orderId || t.id).toString().slice(0, 10)}${(t.orderId || t.id).toString().length > 10 ? '...' : ''}</span>
                    </div>
                </td>
                <td class="hide-sm">
                    <div>
                        <strong>${escapeHtml(t.userName || 'N/A')}</strong>
                        <br><small style="color:var(--gray-500);">${escapeHtml(t.userEmail || '')}</small>
                    </div>
                </td>
                <td><strong style="color:${t.status === 'completed' ? 'var(--green)' : t.status === 'failed' ? 'var(--red)' : 'var(--orange)'}">KES ${(t.amount || 0).toLocaleString()}</strong></td>
                <td class="hide-sm">${escapeHtml(t.paymentMethod || 'N/A')}</td>
                <td><span class="status ${statusClass}">${t.status || 'pending'}</span></td>
                <td>
                    <div style="font-size:12px;">
                        <div>${formattedDate.date}</div>
                        <small style="color:var(--gray-500);">${formattedDate.time}</small>
                    </div>
                </td>
                <td>
                    <button class="action-btn view" onclick="event.stopPropagation(); viewTransactionDetails('${escapeAttr(t.id)}', '${escapeAttr(t.source)}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Format date and time separately for better display
function formatDateTime(d) {
    const date = getDate(d);
    return {
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    };
}

// View transaction details
window.viewTransactionDetails = function(id, source) {
    const transaction = allTransactions.find(t => t.id === id);
    if (!transaction) return;
    
    if (source === 'order' && transaction.orderId) {
        // Open order modal for order transactions
        viewOrder(transaction.id);
    } else {
        // Show transaction details modal
        const content = $('orderModalContent');
        content.innerHTML = `
            <div class="order-detail-header">
                <h3>Transaction Details</h3>
                <span class="status ${transaction.status === 'completed' ? 'delivered' : transaction.status === 'failed' ? 'cancelled' : 'pending'}">${transaction.status || 'pending'}</span>
            </div>
            <div class="order-info-grid">
                <div class="order-info-box">
                    <h4>Transaction Info</h4>
                    <p><strong>ID:</strong> ${escapeHtml(transaction.id)}</p>
                    <p><strong>Amount:</strong> KES ${(transaction.amount || 0).toLocaleString()}</p>
                    <p><strong>Method:</strong> ${escapeHtml(transaction.paymentMethod || 'N/A')}</p>
                    ${transaction.mpesaCode ? `<p><strong>M-Pesa Code:</strong> ${escapeHtml(transaction.mpesaCode)}</p>` : ''}
                </div>
                <div class="order-info-box">
                    <h4>User Info</h4>
                    <p><strong>Name:</strong> ${escapeHtml(transaction.userName || 'N/A')}</p>
                    <p><strong>Email:</strong> ${escapeHtml(transaction.userEmail || 'N/A')}</p>
                    ${transaction.userPhone ? `<p><strong>Phone:</strong> ${escapeHtml(transaction.userPhone)}</p>` : ''}
                </div>
                <div class="order-info-box">
                    <h4>Date & Time</h4>
                    <p>${formatDate(transaction.createdAt)}</p>
                    <p>${getDate(transaction.createdAt).toLocaleTimeString()}</p>
                </div>
                <div class="order-info-box">
                    <h4>Source</h4>
                    <p>${transaction.source === 'wallet' ? 'Wallet Transaction' : transaction.source === 'order' ? 'Order Payment' : 'Transaction'}</p>
                    ${transaction.orderStatus ? `<p><strong>Order Status:</strong> ${escapeHtml(transaction.orderStatus)}</p>` : ''}
                </div>
            </div>
        `;
        $('orderModal').classList.add('active');
    }
};

function filterTransactions() {
    const status = $('transactionFilter').value;
    const searchVal = $('transactionSearch')?.value?.toLowerCase() || '';
    
    let filtered = allTransactions;
    
    // Filter by status
    if (status !== 'all') {
        filtered = filtered.filter(t => t.status === status);
    }
    
    // Filter by search
    if (searchVal) {
        filtered = filtered.filter(t => 
            t.id?.toLowerCase().includes(searchVal) ||
            t.orderId?.toLowerCase().includes(searchVal) ||
            t.userName?.toLowerCase().includes(searchVal) ||
            t.userEmail?.toLowerCase().includes(searchVal) ||
            t.mpesaCode?.toLowerCase().includes(searchVal) ||
            t.userPhone?.includes(searchVal)
        );
    }
    
    renderTransactions(filtered);
}

// Setup transaction search
function setupTransactionSearch() {
    $('transactionSearch')?.addEventListener('input', filterTransactions);
}

// ============= Verifications =============
async function loadVerifications() {
    const container = $('verificationsList');
    const filter = $('verificationFilter')?.value || 'pending';
    
    try {
        let verifications = [];
        
        // Query based on filter
        let queryRef;
        if (filter === 'all') {
            queryRef = query(
                collection(db, "PendingPaymentVerifications"),
                orderBy('createdAt', 'desc'),
                limit(50)
            );
        } else {
            queryRef = query(
                collection(db, "PendingPaymentVerifications"),
                where("status", "==", filter),
                orderBy('createdAt', 'desc'),
                limit(50)
            );
        }
        
        const snap = await getDocs(queryRef);
        verifications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        renderVerifications(verifications);
        
        // Update badge count with pending only
        const pendingSnap = await getDocs(query(
            collection(db, "PendingPaymentVerifications"),
            where("status", "==", "pending")
        ));
        const pendingCount = pendingSnap.docs.length;
        $('verifyBadge').textContent = pendingCount;
        $('verifyBadge').style.display = pendingCount > 0 ? '' : 'none';
        
        // Setup filter change listener
        $('verificationFilter')?.removeEventListener('change', handleVerificationFilterChange);
        $('verificationFilter')?.addEventListener('change', handleVerificationFilterChange);
        
        // Setup refresh button
        $('refreshVerificationsBtn')?.removeEventListener('click', loadVerifications);
        $('refreshVerificationsBtn')?.addEventListener('click', loadVerifications);
        
    } catch (err) {
        console.error('Verifications error:', err);
        container.innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:40px;">Unable to load verifications. Check Firestore permissions.</p>';
        $('verifyBadge').style.display = 'none';
    }
}

function handleVerificationFilterChange() {
    loadVerifications();
}

function renderVerifications(items) {
    const container = $('verificationsList');
    
    if (!items.length) {
        const filter = $('verificationFilter')?.value || 'pending';
        container.innerHTML = `<p style="text-align:center;color:var(--gray-500);padding:40px;">No ${filter === 'all' ? '' : filter} verifications found</p>`;
        return;
    }
    
    container.innerHTML = items.map(v => {
        const typeLabel = v.type === 'deposit' ? 'Deposit' : v.type === 'order' ? 'Order Payment' : 'Payment';
        const typeBadgeClass = v.type === 'deposit' ? 'deposit' : 'order';
        
        return `
            <div class="verify-card">
                <div class="verify-card-header">
                    <div>
                        <h4><i class="fas fa-receipt"></i> ${typeLabel} Verification</h4>
                        <span style="font-size:12px;color:var(--gray-500);">ID: ${v.id.substring(0, 8)}...</span>
                    </div>
                    <span class="verify-type-badge ${typeBadgeClass}">${typeLabel}</span>
                </div>
                
                <div class="verify-card-body">
                    <div class="verify-detail">
                        <label>User</label>
                        <span>${escapeHtml(v.userName || v.userEmail || 'Unknown')}</span>
                    </div>
                    <div class="verify-detail">
                        <label>Amount</label>
                        <span>KES ${(v.amount || 0).toLocaleString()}</span>
                    </div>
                    <div class="verify-detail">
                        <label>M-Pesa Code</label>
                        <span class="mpesa-code">${escapeHtml(v.mpesaCode || 'N/A')}</span>
                    </div>
                    <div class="verify-detail">
                        <label>Date</label>
                        <span>${formatDate(v.createdAt)}</span>
                    </div>
                    ${v.orderId ? `
                        <div class="verify-detail">
                            <label>Order ID</label>
                            <span>${v.orderId.substring(0, 12)}...</span>
                        </div>
                    ` : ''}
                    ${v.receiptUrl ? `
                        <div class="verify-receipt-preview">
                            <label style="display:block;margin-bottom:6px;">Receipt</label>
                            <img src="${escapeAttr(v.receiptUrl)}" alt="Receipt" onclick="window.open('${escapeAttr(v.receiptUrl)}', '_blank')">
                        </div>
                    ` : ''}
                </div>
                
                ${v.status === 'pending' ? `
                    <div class="verify-actions">
                        <button class="btn btn-success" onclick="approveVerification('${escapeAttr(v.id)}', '${escapeAttr(v.type)}', ${Number(v.amount) || 0}, '${escapeAttr(v.userId)}', '${escapeAttr(v.orderId || '')}')">
                            <i class="fas fa-check"></i> Approve
                        </button>
                        <button class="btn btn-danger" onclick="rejectVerification('${escapeAttr(v.id)}')">
                            <i class="fas fa-times"></i> Reject
                        </button>
                    </div>
                ` : `
                    <div style="text-align:center;padding:12px;background:${v.status === 'approved' ? '#dcfce7' : '#fee2e2'};border-radius:var(--radius);margin-top:12px;">
                        <span style="color:${v.status === 'approved' ? '#16a34a' : '#dc2626'};font-weight:600;">
                            <i class="fas fa-${v.status === 'approved' ? 'check-circle' : 'times-circle'}"></i>
                            ${v.status.charAt(0).toUpperCase() + v.status.slice(1)}
                        </span>
                    </div>
                `}
            </div>
        `;
    }).join('');
}

window.approveVerification = async function(id, type, amount, userId, orderId) {
    if (!confirm('Approve this payment verification?')) return;
    
    try {
        // Update verification status
        await updateDoc(doc(db, "PendingPaymentVerifications", id), { 
            status: 'approved', 
            approvedAt: Timestamp.now(),
            approvedBy: state.user?.email
        });
        
        // If deposit, credit user wallet
        if (type === 'deposit' && userId && amount) {
            const userRef = doc(db, "users", userId);
            const userDoc = await getDoc(userRef);
            
            if (userDoc.exists()) {
                const currentBalance = userDoc.data().walletBalance || 0;
                await updateDoc(userRef, {
                    walletBalance: currentBalance + amount,
                    lastDepositAt: Timestamp.now()
                });
                
                // Add wallet transaction record
                await addDoc(collection(db, "users", userId, "walletTransactions"), {
                    type: 'deposit',
                    amount: amount,
                    status: 'completed',
                    verifiedBy: state.user?.email,
                    createdAt: Timestamp.now()
                });
            }
        }
        
        // If order payment, update order status
        if (type === 'order' && orderId) {
            await updateDoc(doc(db, "Orders", orderId), {
                paymentStatus: 'verified',
                paymentVerifiedAt: Timestamp.now(),
                paymentVerifiedBy: state.user?.email
            });
        }
        
        showNotification('Payment approved successfully');
        loadVerifications();
    } catch (err) {
        console.error('Error approving verification:', err);
        showNotification('Error approving payment', 'error');
    }
};

window.rejectVerification = async function(id) {
    const reason = prompt('Enter rejection reason (optional):');
    
    if (reason === null) return; // User cancelled
    
    try {
        await updateDoc(doc(db, "PendingPaymentVerifications", id), { 
            status: 'rejected', 
            rejectedAt: Timestamp.now(),
            rejectedBy: state.user?.email,
            rejectionReason: reason || 'No reason provided'
        });
        showNotification('Payment rejected');
        loadVerifications();
    } catch (err) {
        showNotification('Error rejecting payment', 'error');
    }
};

// ============= Settings =============
async function loadSettings() {
    loadAdminList();
    loadHeroSlides();
    loadSurveySettings();
    loadShippingSettings();
    loadDeliveryAreas();
    loadDeliveryStaff();
    loadSystemToggles();
}

// ============= Delivery Areas Management =============
async function loadDeliveryAreas() {
    try {
        // Load delivery areas settings from Firestore
        const settingsDoc = await getDoc(doc(db, "Settings", "deliveryAreas"));
        let enabledAreas = ['Mombasa']; // Default to Mombasa only
        
        if (settingsDoc.exists()) {
            enabledAreas = settingsDoc.data().enabledCounties || ['Mombasa'];
        }
        
        // Update checkboxes based on saved settings
        document.querySelectorAll('.county-toggle input[type="checkbox"]').forEach(checkbox => {
            const county = checkbox.dataset.county;
            checkbox.checked = enabledAreas.includes(county);
        });
        
        updateActiveAreasCount();
        setupDeliveryAreasEventListeners();
    } catch (err) {
        console.error('Error loading delivery areas:', err);
    }
}

function setupDeliveryAreasEventListeners() {
    // Save delivery areas button
    $('saveDeliveryAreasBtn')?.addEventListener('click', saveDeliveryAreas);
    
    // Use event delegation for county toggle changes (handles hidden regions too)
    const deliveryConfig = document.querySelector('.delivery-areas-config');
    if (deliveryConfig) {
        deliveryConfig.addEventListener('change', (e) => {
            if (e.target.matches('.county-toggle input[type="checkbox"]')) {
                updateActiveAreasCount();
            }
        });
    }
    
    // Expand more regions button
    $('expandRegionsBtn')?.addEventListener('click', () => {
        const hiddenRegions = document.querySelector('.hidden-regions');
        const btn = $('expandRegionsBtn');
        if (hiddenRegions.style.display === 'none') {
            hiddenRegions.style.display = 'block';
            btn.innerHTML = '<i class="fas fa-chevron-up"></i> Show Less Regions';
        } else {
            hiddenRegions.style.display = 'none';
            btn.innerHTML = '<i class="fas fa-chevron-down"></i> Show More Regions';
        }
    });
}

function updateActiveAreasCount() {
    const checkedCount = document.querySelectorAll('.county-toggle input[type="checkbox"]:checked').length;
    const countEl = $('activeAreasCount');
    if (countEl) {
        countEl.textContent = checkedCount;
    }
    
    // Update all badge texts based on checkbox state
    document.querySelectorAll('.county-toggle input[type="checkbox"]').forEach(checkbox => {
        const badge = checkbox.closest('.county-toggle').querySelector('.county-badge');
        if (badge) {
            if (checkbox.checked) {
                badge.textContent = 'Active';
                badge.classList.add('active');
            } else {
                badge.textContent = 'Inactive';
                badge.classList.remove('active');
            }
        }
    });
    
    // Update banner color based on count
    const banner = $('areaStatusBanner');
    if (banner) {
        if (checkedCount === 0) {
            banner.style.background = 'linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%)';
            banner.style.color = 'var(--red)';
        } else if (checkedCount === 1) {
            banner.style.background = 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)';
            banner.style.color = 'var(--orange)';
        } else {
            banner.style.background = 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)';
            banner.style.color = 'var(--green)';
        }
    }
}

async function saveDeliveryAreas() {
    const btn = $('saveDeliveryAreasBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;
    
    try {
        const enabledCounties = [];
        document.querySelectorAll('.county-toggle input[type="checkbox"]:checked').forEach(checkbox => {
            enabledCounties.push(checkbox.dataset.county);
        });
        
        if (enabledCounties.length === 0) {
            showNotification('Please select at least one delivery area', 'error');
            return;
        }
        
        await setDoc(doc(db, "Settings", "deliveryAreas"), {
            enabledCounties,
            updatedAt: Timestamp.now(),
            updatedBy: state.user?.email
        }, { merge: true });
        
        showNotification(`Delivery areas updated! Now serving ${enabledCounties.length} ${enabledCounties.length === 1 ? 'county' : 'counties'}.`, 'success');
    } catch (err) {
        console.error('Error saving delivery areas:', err);
        showNotification('Failed to save delivery areas', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ============= System Toggles (Maintenance & Registrations) =============
async function loadSystemToggles() {
    try {
        const settingsDoc = await getDoc(doc(db, "Settings", "appSettings"));
        if (settingsDoc.exists()) {
            const data = settingsDoc.data();
            $('maintenanceMode').checked = data.maintenanceMode === true;
            $('allowRegistrations').checked = data.allowRegistrations !== false; // default true
        }
        
        // Wire up listeners
        $('maintenanceMode')?.removeEventListener('change', handleMaintenanceToggle);
        $('maintenanceMode')?.addEventListener('change', handleMaintenanceToggle);
        $('allowRegistrations')?.removeEventListener('change', handleRegistrationToggle);
        $('allowRegistrations')?.addEventListener('change', handleRegistrationToggle);
    } catch (err) {
        console.error('System toggles error:', err);
    }
}

async function handleMaintenanceToggle(e) {
    const enabled = e.target.checked;
    if (enabled && !confirm('Enable maintenance mode? Users will see a maintenance page.')) {
        e.target.checked = false;
        return;
    }
    try {
        await setDoc(doc(db, "Settings", "appSettings"), {
            maintenanceMode: enabled,
            updatedAt: Timestamp.now(),
            updatedBy: state.user?.email
        }, { merge: true });
        showNotification(enabled ? 'Maintenance mode ON' : 'Maintenance mode OFF');
    } catch (err) {
        console.error('Toggle maintenance error:', err);
        showNotification('Failed to update setting', 'error');
        e.target.checked = !enabled;
    }
}

async function handleRegistrationToggle(e) {
    const enabled = e.target.checked;
    try {
        await setDoc(doc(db, "Settings", "appSettings"), {
            allowRegistrations: enabled,
            updatedAt: Timestamp.now(),
            updatedBy: state.user?.email
        }, { merge: true });
        showNotification(enabled ? 'Registrations enabled' : 'Registrations disabled');
    } catch (err) {
        console.error('Toggle registrations error:', err);
        showNotification('Failed to update setting', 'error');
        e.target.checked = !enabled;
    }
}

// ============= Survey Settings =============
async function loadSurveySettings() {
    try {
        // Load survey toggle state
        const settingsDoc = await getDoc(doc(db, "Settings", "appSettings"));
        if (settingsDoc.exists()) {
            $('surveyEnabled').checked = settingsDoc.data().surveyEnabled === true;
        }
        
        // Setup toggle handler
        $('surveyEnabled')?.removeEventListener('change', handleSurveyToggle);
        $('surveyEnabled')?.addEventListener('change', handleSurveyToggle);
        
        // Load survey statistics
        await loadSurveyStats();
    } catch (err) {
        console.error('Survey settings error:', err);
    }
}

async function handleSurveyToggle(e) {
    const enabled = e.target.checked;
    try {
        await setDoc(doc(db, "Settings", "appSettings"), {
            surveyEnabled: enabled,
            updatedAt: Timestamp.now(),
            updatedBy: state.user?.email
        }, { merge: true });
        
        showNotification(enabled ? 'Signup survey enabled' : 'Signup survey disabled');
    } catch (err) {
        console.error('Toggle survey error:', err);
        showNotification('Failed to update setting', 'error');
        e.target.checked = !enabled; // Revert
    }
}

async function loadSurveyStats() {
    const container = $('surveyStats');
    if (!container) return;
    
    try {
        // Count users with survey data
        const usersSnap = await getDocs(collection(db, "Users"));
        let totalUsers = 0;
        let surveyed = 0;
        const ageGroups = {};
        const genders = {};
        const preferences = {};
        
        usersSnap.docs.forEach(d => {
            totalUsers++;
            const data = d.data();
            if (data.surveyCompleted && data.surveyData) {
                surveyed++;
                const survey = data.surveyData;
                
                // Age distribution
                if (survey.ageRange) {
                    ageGroups[survey.ageRange] = (ageGroups[survey.ageRange] || 0) + 1;
                }
                
                // Gender distribution  
                if (survey.gender) {
                    genders[survey.gender] = (genders[survey.gender] || 0) + 1;
                }
                
                // Shopping preferences
                if (survey.shoppingPreferences && Array.isArray(survey.shoppingPreferences)) {
                    survey.shoppingPreferences.forEach(pref => {
                        preferences[pref] = (preferences[pref] || 0) + 1;
                    });
                }
            }
        });
        
        // Render stats
        const completionRate = totalUsers > 0 ? Math.round((surveyed / totalUsers) * 100) : 0;
        
        // Get top preferences
        const topPrefs = Object.entries(preferences)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([name, count]) => `<span class="stat-tag">${formatPrefName(name)} (${count})</span>`)
            .join('');
        
        container.innerHTML = `
            <div class="survey-stat-grid">
                <div class="survey-stat-item">
                    <span class="survey-stat-value">${surveyed}</span>
                    <span class="survey-stat-label">Responses</span>
                </div>
                <div class="survey-stat-item">
                    <span class="survey-stat-value">${completionRate}%</span>
                    <span class="survey-stat-label">Completion</span>
                </div>
            </div>
            ${topPrefs ? `
                <div style="margin-top:12px;">
                    <small style="color:#666;">Top Interests:</small>
                    <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">
                        ${topPrefs}
                    </div>
                </div>
            ` : '<p style="color:#999;font-size:13px;margin:10px 0 0;">No survey data yet</p>'}
        `;
    } catch (err) {
        console.error('Survey stats error:', err);
        container.innerHTML = '<p style="color:#999;">Unable to load stats</p>';
    }
}

function formatPrefName(pref) {
    const names = {
        'electronics': 'Electronics',
        'fashion': 'Fashion',
        'home': 'Home',
        'beauty': 'Beauty',
        'sports': 'Sports',
        'books': 'Books',
        'groceries': 'Groceries',
        'other': 'Other'
    };
    return names[pref] || pref;
}

// ============= Hero Banner Management =============
let heroSlides = [];

async function loadHeroSlides() {
    const container = $('heroSlidesList');
    try {
        const snap = await getDocs(query(collection(db, "HeroSlides"), orderBy("order", "asc")));
        heroSlides = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderHeroSlides();
    } catch (err) {
        console.error('Load hero slides error:', err);
        container.innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:20px;">No slides yet. Click "Add Slide" to create one.</p>';
    }
}

function renderHeroSlides() {
    const container = $('heroSlidesList');
    
    if (!heroSlides.length) {
        container.innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:20px;">No slides yet. Click "Add Slide" to create one.</p>';
        return;
    }
    
    container.innerHTML = heroSlides.map((slide, idx) => `
        <div class="hero-slide-item" draggable="true" data-id="${escapeAttr(slide.id)}" data-idx="${idx}">
            <div class="hero-slide-preview ${escapeAttr(slide.gradient || 'gradient-1')}" ${slide.bgImage ? `style="background-image:url(${escapeAttr(slide.bgImage)})"` : ''}>
                <i class="fas ${escapeAttr(slide.icon || 'fa-star')}"></i>
            </div>
            <div class="hero-slide-info">
                <h4>${escapeHtml(slide.title || 'Untitled')}</h4>
                <p>${escapeHtml(slide.subtitle || 'No description')}</p>
            </div>
            <span class="hero-slide-status ${slide.active !== false ? 'active' : 'inactive'}">
                ${slide.active !== false ? 'Active' : 'Inactive'}
            </span>
            <div class="hero-slide-actions">
                <button class="edit-btn" onclick="editSlide('${slide.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                <button class="delete-btn" onclick="deleteSlide('${slide.id}')" title="Delete"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join('');
    
    // Add drag-and-drop reordering
    setupSlideDragDrop();
}

function setupSlideDragDrop() {
    const items = $$('.hero-slide-item');
    items.forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
    });
}

let draggedSlide = null;

function handleDragStart(e) {
    draggedSlide = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

async function handleDrop(e) {
    e.preventDefault();
    if (draggedSlide !== this) {
        const allItems = [...$$('.hero-slide-item')];
        const fromIdx = parseInt(draggedSlide.dataset.idx);
        const toIdx = parseInt(this.dataset.idx);
        
        // Reorder array
        const [removed] = heroSlides.splice(fromIdx, 1);
        heroSlides.splice(toIdx, 0, removed);
        
        // Update order in Firestore
        try {
            await Promise.all(heroSlides.map((slide, idx) => 
                updateDoc(doc(db, "HeroSlides", slide.id), { order: idx })
            ));
            renderHeroSlides();
            showNotification('Slides reordered');
        } catch (err) {
            showNotification('Error reordering', 'error');
        }
    }
}

function handleDragEnd() {
    this.classList.remove('dragging');
    draggedSlide = null;
}

// Open modal to add new slide
function openSlideModal() {
    $('slideModalTitle').textContent = 'Add Hero Slide';
    $('editSlideId').value = '';
    $('slideTitle').value = '';
    $('slideSubtitle').value = '';
    $('slideBtnText').value = '';
    $('slideBtnLink').value = '';
    $('slideGradient').value = 'gradient-1';
    $('slideIcon').value = 'fa-store';
    $('slideActive').checked = true;
    $('slideImagePreview').innerHTML = '';
    $('slideModal').classList.add('active');
}

window.closeSlideModal = function() {
    $('slideModal').classList.remove('active');
};

window.editSlide = function(id) {
    const slide = heroSlides.find(s => s.id === id);
    if (!slide) return;
    
    $('slideModalTitle').textContent = 'Edit Hero Slide';
    $('editSlideId').value = id;
    $('slideTitle').value = slide.title || '';
    $('slideSubtitle').value = slide.subtitle || '';
    $('slideBtnText').value = slide.btnText || '';
    $('slideBtnLink').value = slide.btnLink || '';
    $('slideGradient').value = slide.gradient || 'gradient-1';
    $('slideIcon').value = slide.icon || 'fa-store';
    $('slideActive').checked = slide.active !== false;
    $('slideImagePreview').innerHTML = slide.bgImage ? `<img src="${slide.bgImage}">` : '';
    $('slideModal').classList.add('active');
};

window.deleteSlide = async function(id) {
    if (!confirm('Delete this slide?')) return;
    
    try {
        await deleteDoc(doc(db, "HeroSlides", id));
        showNotification('Slide deleted');
        loadHeroSlides();
    } catch (err) {
        showNotification('Error deleting slide', 'error');
    }
};

// Handle slide form submit
$('slideForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const id = $('editSlideId').value;
    const slideData = {
        title: $('slideTitle').value.trim(),
        subtitle: $('slideSubtitle').value.trim(),
        btnText: $('slideBtnText').value.trim(),
        btnLink: $('slideBtnLink').value.trim(),
        gradient: $('slideGradient').value,
        icon: $('slideIcon').value,
        active: $('slideActive').checked,
        updatedAt: Timestamp.now()
    };
    
    // Handle image upload if selected
    const imageFile = $('slideBgImage').files[0];
    if (imageFile) {
        try {
            const imgRef = storageRef(storage, `hero-slides/${Date.now()}_${imageFile.name}`);
            await uploadBytes(imgRef, imageFile);
            slideData.bgImage = await getDownloadURL(imgRef);
        } catch (err) {
            console.error('Image upload error:', err);
        }
    }
    
    try {
        if (id) {
            // Update existing slide
            await updateDoc(doc(db, "HeroSlides", id), slideData);
            showNotification('Slide updated');
        } else {
            // Create new slide
            slideData.order = heroSlides.length;
            slideData.createdAt = Timestamp.now();
            await addDoc(collection(db, "HeroSlides"), slideData);
            showNotification('Slide created');
        }
        
        closeSlideModal();
        loadHeroSlides();
    } catch (err) {
        console.error('Save slide error:', err);
        showNotification('Error saving slide', 'error');
    }
});

// Add slide button
$('addSlideBtn')?.addEventListener('click', openSlideModal);
$('closeSlideModal')?.addEventListener('click', closeSlideModal);

// Image preview
$('slideBgImage')?.addEventListener('change', function() {
    const file = this.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            $('slideImagePreview').innerHTML = `<img src="${e.target.result}">`;
        };
        reader.readAsDataURL(file);
    }
});

async function loadAdminList() {
    try {
        const snap = await getDocs(collection(db, "Admins"));
        const container = $('adminList');
        
        container.innerHTML = snap.docs.map(d => {
            const admin = d.data();
            const isMaster = admin.email === MASTER_ADMIN_EMAIL;
            return `
                <div class="admin-item">
                    <span>${admin.email} ${isMaster ? '<span class="badge">Master</span>' : ''}</span>
                    ${!isMaster && state.isMaster ? `<button class="btn btn-sm btn-danger" onclick="removeAdmin('${d.id}')"><i class="fas fa-trash"></i></button>` : ''}
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Admin list error:', err);
    }
}

async function addAdmin() {
    const email = $('newAdminEmail').value.trim();
    if (!email) return showNotification('Enter an email', 'error');
    
    try {
        // Check if user exists
        const userQuery = query(collection(db, "Users"), where("email", "==", email));
        const userSnap = await getDocs(userQuery);
        
        if (userSnap.empty) {
            return showNotification('User not found', 'error');
        }
        
        const userId = userSnap.docs[0].id;
        await setDoc(doc(db, "Admins", userId), {
            email,
            role: 'admin',
            createdAt: Timestamp.now(),
            addedBy: state.user.email
        });
        
        showNotification('Admin added');
        $('newAdminEmail').value = '';
        loadAdminList();
    } catch (err) {
        showNotification('Error adding admin', 'error');
    }
}

window.removeAdmin = async function(id) {
    if (confirm('Remove this admin?')) {
        try {
            await deleteDoc(doc(db, "Admins", id));
            showNotification('Admin removed');
            loadAdminList();
        } catch (err) {
            showNotification('Error removing admin', 'error');
        }
    }
};

// ============= Shipping Settings =============
let shippingZones = [];
let mombasaSubcounties = [];

async function loadShippingSettings() {
    try {
        // Load Mombasa subcounties from locationData
        const locationModule = await import('./js/locationData.js');
        const counties = locationModule.counties;
        if (counties?.coast?.Mombasa) {
            mombasaSubcounties = Object.keys(counties.coast.Mombasa);
        }
        
        // Load shipping settings from Firestore
        const settingsDoc = await getDoc(doc(db, "Settings", "shipping"));
        if (settingsDoc.exists()) {
            const data = settingsDoc.data();
            $('defaultShippingFee').value = data.defaultFee || 150;
            $('freeShippingThreshold').value = data.freeThreshold || 3000;
            shippingZones = data.zones || [];
        } else {
            // Initialize with defaults
            shippingZones = [];
            $('defaultShippingFee').value = 150;
            $('freeShippingThreshold').value = 3000;
        }
        
        renderShippingZones();
        setupShippingEventListeners();
    } catch (err) {
        console.error('Error loading shipping settings:', err);
        $('shippingZonesList').innerHTML = '<p style="color:var(--red);">Failed to load shipping settings</p>';
    }
}

function setupShippingEventListeners() {
    // Save shipping settings
    $('saveShippingBtn')?.removeEventListener('click', saveShippingSettings);
    $('saveShippingBtn')?.addEventListener('click', saveShippingSettings);
    
    // Add zone button
    $('addShippingZoneBtn')?.removeEventListener('click', showAddZoneDialog);
    $('addShippingZoneBtn')?.addEventListener('click', showAddZoneDialog);
}

function renderShippingZones() {
    const container = $('shippingZonesList');
    
    if (!shippingZones.length) {
        container.innerHTML = `
            <p style="text-align:center;color:var(--gray-500);padding:20px;">
                No shipping zones configured. Using default fee for all locations.
            </p>
        `;
        return;
    }
    
    container.innerHTML = shippingZones.map((zone, index) => `
        <div class="shipping-zone-item" data-index="${index}">
            <div class="zone-location">
                <strong>${zone.subcounty || zone.name || 'Unknown'}</strong>
                <span>${zone.wards?.length ? zone.wards.join(', ') : 'All wards'}</span>
            </div>
            <div class="zone-fee">
                <span>KES</span>
                <input type="number" 
                       value="${zone.fee || 150}" 
                       min="0" 
                       onchange="updateZoneFee(${index}, this.value)">
            </div>
            <div class="zone-actions">
                <button class="delete-zone-btn" onclick="deleteShippingZone(${index})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function showAddZoneDialog() {
    // Create modal for adding zone
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'zoneModal';
    modal.style.display = 'flex';
    
    // Get wards for a selected subcounty
    const getWardsOptions = async (subcounty) => {
        try {
            const locationModule = await import('./js/locationData.js');
            const counties = locationModule.counties;
            const wards = counties?.coast?.Mombasa?.[subcounty] || [];
            return Array.isArray(wards) ? wards : Object.keys(wards);
        } catch {
            return [];
        }
    };
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width:450px;">
            <button class="modal-close" onclick="closeZoneModal()">&times;</button>
            <h3 style="margin-bottom:20px;"><i class="fas fa-map-marker-alt"></i> Add Shipping Zone</h3>
            <form id="zoneForm">
                <div class="form-group">
                    <label>Subcounty</label>
                    <select id="zoneSubcounty" required>
                        <option value="">Select Subcounty</option>
                        ${mombasaSubcounties.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Wards <small>(optional - leave empty for all wards)</small></label>
                    <div id="wardCheckboxes" style="max-height:150px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius);padding:10px;"></div>
                </div>
                <div class="form-group">
                    <label>Shipping Fee (KES)</label>
                    <input type="number" id="zoneFee" min="0" value="150" required>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-outline" onclick="closeZoneModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Add Zone</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Load wards when subcounty changes
    $('zoneSubcounty').addEventListener('change', async (e) => {
        const subcounty = e.target.value;
        const container = $('wardCheckboxes');
        
        if (!subcounty) {
            container.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">Select a subcounty first</p>';
            return;
        }
        
        const wards = await getWardsOptions(subcounty);
        if (wards.length) {
            container.innerHTML = wards.map(ward => `
                <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;">
                    <input type="checkbox" name="wards" value="${ward}">
                    <span>${ward}</span>
                </label>
            `).join('');
        } else {
            container.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">No wards found</p>';
        }
    });
    
    // Form submission
    $('zoneForm').addEventListener('submit', (e) => {
        e.preventDefault();
        
        const subcounty = $('zoneSubcounty').value;
        const fee = parseInt($('zoneFee').value) || 150;
        const wardCheckboxes = document.querySelectorAll('#wardCheckboxes input[name="wards"]:checked');
        const selectedWards = Array.from(wardCheckboxes).map(cb => cb.value);
        
        // Check if zone already exists
        const exists = shippingZones.some(z => 
            z.subcounty === subcounty && 
            JSON.stringify(z.wards?.sort()) === JSON.stringify(selectedWards.sort())
        );
        
        if (exists) {
            showNotification('This zone already exists', 'error');
            return;
        }
        
        shippingZones.push({
            subcounty,
            wards: selectedWards,
            fee
        });
        
        renderShippingZones();
        closeZoneModal();
        showNotification('Zone added. Remember to save changes!');
    });
}

window.closeZoneModal = function() {
    const modal = $('zoneModal');
    if (modal) modal.remove();
};

window.updateZoneFee = function(index, value) {
    if (shippingZones[index]) {
        shippingZones[index].fee = parseInt(value) || 0;
    }
};

window.deleteShippingZone = function(index) {
    if (confirm('Delete this shipping zone?')) {
        shippingZones.splice(index, 1);
        renderShippingZones();
        showNotification('Zone deleted. Remember to save changes!');
    }
};

async function saveShippingSettings() {
    const btn = $('saveShippingBtn');
    const originalText = btn.innerHTML;
    
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        
        const defaultFee = parseInt($('defaultShippingFee').value) || 150;
        const freeThreshold = parseInt($('freeShippingThreshold').value) || 0;
        
        await setDoc(doc(db, "Settings", "shipping"), {
            defaultFee,
            freeThreshold,
            zones: shippingZones,
            updatedAt: Timestamp.now(),
            updatedBy: state.user?.email
        });
        
        showNotification('Shipping settings saved successfully');
    } catch (err) {
        console.error('Error saving shipping settings:', err);
        showNotification('Failed to save settings', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// ============= Push Notifications Management =============
async function loadNotificationsPage() {
    // Setup event listeners for notification form
    setupNotificationListeners();
    
    // Load stats
    await loadNotificationStats();
    
    // Load history
    await loadNotificationHistory();
}

function setupNotificationListeners() {
    // Character counters
    $('notifTitle')?.addEventListener('input', e => {
        $('titleCount').textContent = e.target.value.length;
    });
    
    $('notifBody')?.addEventListener('input', e => {
        $('bodyCount').textContent = e.target.value.length;
    });
    
    // Preview button
    $('previewNotifBtn')?.addEventListener('click', () => {
        const title = $('notifTitle').value || 'Notification Title';
        const body = $('notifBody').value || 'Notification message will appear here';
        
        $('previewTitle').textContent = title;
        $('previewBody').textContent = body;
        $('notifPreviewModal').classList.add('show');
    });
    
    // Close preview on overlay click
    $('notifPreviewModal')?.querySelector('.notif-preview-overlay')?.addEventListener('click', () => {
        $('notifPreviewModal').classList.remove('show');
    });
    
    // Form submit
    $('pushNotificationForm')?.addEventListener('submit', handleSendNotification);
    
    // Refresh history
    $('refreshNotifsBtn')?.addEventListener('click', loadNotificationHistory);
}

async function loadNotificationStats() {
    try {
        // Get total users (subscribers)
        const usersSnap = await getDocs(collection(db, 'Users'));
        $('totalSubscribers').textContent = usersSnap.size;
        
        // Count users with FCM tokens (mobile users estimate)
        let mobileCount = 0;
        try {
            const tokensSnap = await getDocs(query(collection(db, 'FCMTokens'), where('active', '==', true)));
            mobileCount = tokensSnap.size;
        } catch (e) {
            mobileCount = 0;
        }
        $('mobileSubscribers').textContent = mobileCount;
        
        // Get today's sent notifications
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = Timestamp.fromDate(today);
        
        try {
            const sentTodaySnap = await getDocs(
                query(collection(db, 'SentNotifications'), 
                    where('sentAt', '>=', todayTimestamp),
                    orderBy('sentAt', 'desc')
                )
            );
            $('notifsSent').textContent = sentTodaySnap.size;
        } catch (e) {
            // Index might not exist yet
            $('notifsSent').textContent = '0';
        }
        
    } catch (err) {
        console.error('Error loading notification stats:', err);
    }
}

async function loadNotificationHistory() {
    const container = $('notifHistoryList');
    if (!container) return;
    
    container.innerHTML = '<div class="loading-spinner"></div>';
    
    try {
        const snap = await getDocs(
            query(collection(db, 'SentNotifications'), 
                orderBy('sentAt', 'desc'),
                limit(20)
            )
        );
        
        if (snap.empty) {
            container.innerHTML = `
                <div class="notif-empty">
                    <i class="fas fa-bell-slash"></i>
                    <p>No notifications sent yet</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = snap.docs.map(doc => {
            const d = doc.data();
            const sentDate = d.sentAt?.toDate ? d.sentAt.toDate() : new Date();
            const typeIcons = {
                general: 'fa-bullhorn',
                promo: 'fa-tags',
                update: 'fa-sync-alt',
                alert: 'fa-exclamation-triangle'
            };
            
            return `
                <div class="notif-history-item">
                    <div class="notif-history-icon">
                        <i class="fas ${typeIcons[d.type] || 'fa-bell'}"></i>
                    </div>
                    <div class="notif-history-content">
                        <strong>${escapeHtml(d.title)}</strong>
                        <p>${escapeHtml(d.body)}</p>
                        <div class="notif-history-meta">
                            <span><i class="fas fa-clock"></i> ${formatDate(sentDate)}</span>
                            <span><i class="fas fa-users"></i> ${d.recipientCount || 0} recipients</span>
                            <span><i class="fas fa-user"></i> ${escapeHtml(d.sentBy || 'Admin')}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (err) {
        console.error('Error loading notification history:', err);
        container.innerHTML = '<p class="error-text">Failed to load history</p>';
    }
}

async function handleSendNotification(e) {
    e.preventDefault();
    
    const title = $('notifTitle').value.trim();
    const body = $('notifBody').value.trim();
    const url = $('notifUrl').value.trim() || '/notification.html';
    const target = $('notifTarget').value;
    const type = $('notifType').value;
    
    if (!title || !body) {
        showNotification('Please fill in title and message', 'error');
        return;
    }
    
    const sendBtn = $('sendNotifBtn');
    const originalText = sendBtn.innerHTML;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    
    if (!confirm(`Send notification "${title}" to ${target === 'all' ? 'all users' : target}?`)) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = originalText;
        return;
    }
    
    try {
        // Get all users to send notifications to
        const usersSnap = await getDocs(collection(db, 'Users'));
        
        if (usersSnap.empty) {
            showNotification('No users to send to', 'warning');
            sendBtn.disabled = false;
            sendBtn.innerHTML = originalText;
            return;
        }
        
        // Filter users based on target audience
        const sellerUserIds = new Set(state.products.map(p => p.uploaderId).filter(Boolean));
        
        const userIds = [];
        usersSnap.forEach(docSnap => {
            const uid = docSnap.id;
            if (target === 'sellers' && !sellerUserIds.has(uid)) return;
            if (target === 'buyers' && sellerUserIds.has(uid)) return;
            userIds.push(uid);
        });
        
        if (!userIds.length) {
            showNotification(`No ${target} found to send to`, 'warning');
            sendBtn.disabled = false;
            sendBtn.innerHTML = originalText;
            return;
        }
        
        // Create notification record
        const notifData = {
            title,
            body,
            url,
            target,
            type,
            recipientCount: userIds.length,
            sentAt: Timestamp.now(),
            sentBy: state.user?.email || 'Admin',
            status: 'sent'
        };
        
        // Save to SentNotifications collection for history
        const notifRef = await addDoc(collection(db, 'SentNotifications'), notifData);
        
        // Create individual notification records for ALL users
        // This allows them to see it in their notification center
        const batch = [];
        
        userIds.forEach(userId => {
            batch.push(
                addDoc(collection(db, 'Users', userId, 'Notifications'), {
                    title,
                    body,
                    url,
                    type,
                    read: false,
                    createdAt: Timestamp.now(),
                    notificationId: notifRef.id,
                    isGlobal: true
                })
            );
        });
        
        // Also add to global Notifications collection for the notification page
        await addDoc(collection(db, 'Notifications'), {
            title,
            body,
            url,
            type,
            target,
            createdAt: Timestamp.now(),
            sentBy: state.user?.email || 'Admin',
            isGlobal: true
        });
        
        await Promise.all(batch);
        
        showNotification(`Notification sent to ${userIds.length} users!`, 'success');
        
        // Clear form
        $('notifTitle').value = '';
        $('notifBody').value = '';
        $('notifUrl').value = '';
        $('titleCount').textContent = '0';
        $('bodyCount').textContent = '0';
        
        // Reload history
        await loadNotificationHistory();
        await loadNotificationStats();
        
    } catch (err) {
        console.error('Error sending notification:', err);
        showNotification('Failed to send notification: ' + err.message, 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = originalText;
    }
}

// ============= Utilities =============

// HTML escape for user content
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
}

// Escape for HTML attributes (src, onclick, etc.)
function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"'`\/]/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
        "'": '&#039;', '`': '&#96;', '/': '&#47;', '\\': '&#92;'
    }[m] || m));
}

// Sanitize CSV cell to prevent formula injection
function sanitizeCSV(str) {
    if (!str) return '';
    str = String(str);
    // Prefix dangerous chars to prevent Excel formula injection
    if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
    }
    return str;
}
function getDate(d) {
    if (!d) return new Date(0);
    if (d.toDate) return d.toDate();
    return new Date(d);
}

function formatDate(d) {
    return getDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ============= Delivery Staff Management =============
async function loadDeliveryStaff() {
    const list = $('deliveryStaffList');
    if (!list) return;
    try {
        const snap = await getDocs(collection(db, 'DeliveryStaff'));
        if (snap.empty) {
            list.innerHTML = '<p style="color:#6b7280;font-size:13px;">No delivery staff added yet.</p>';
            return;
        }
        list.innerHTML = '';
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const el = document.createElement('div');
            el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;';
            el.innerHTML = `
                <div>
                    <strong style="font-size:13px;">${escapeHtml(data.name || data.email || 'Staff')}</strong>
                    <br><small style="color:#6b7280;">${escapeHtml(data.email || '')} &bull; Added ${data.addedAt ? new Date(data.addedAt.toDate()).toLocaleDateString() : 'N/A'}</small>
                </div>
                <button class="btn btn-outline btn-sm" style="color:#ef4444;border-color:#ef4444;" onclick="removeDeliveryStaff('${docSnap.id}')">
                    <i class="fas fa-trash"></i>
                </button>`;
            list.appendChild(el);
        });
    } catch (error) {
        console.error('Error loading delivery staff:', error);
        list.innerHTML = '<p style="color:#ef4444;font-size:13px;">Error loading delivery staff.</p>';
    }
}

$('addDeliveryStaffBtn')?.addEventListener('click', async () => {
    const emailInput = $('deliveryStaffEmail');
    const email = emailInput?.value?.trim();
    if (!email) {
        showNotification('Please enter an email', 'error');
        return;
    }
    try {
        // Find user by email
        const userQuery = query(collection(db, 'Users'), where('email', '==', email));
        const userSnap = await getDocs(userQuery);
        
        let staffUid = null;
        let staffName = email;
        
        if (!userSnap.empty) {
            const userDoc = userSnap.docs[0];
            staffUid = userDoc.id;
            staffName = userDoc.data().name || email;
        } else {
            showNotification('User not found. They must sign up first.', 'error');
            return;
        }
        
        // Add to DeliveryStaff collection with user's UID as doc ID
        await setDoc(doc(db, 'DeliveryStaff', staffUid), {
            email: email,
            name: staffName,
            addedBy: state.user.uid,
            addedAt: Timestamp.now(),
            active: true
        });
        
        emailInput.value = '';
        showNotification(`${staffName} added as delivery staff`, 'success');
        loadDeliveryStaff();
    } catch (error) {
        console.error('Error adding delivery staff:', error);
        showNotification('Error adding delivery staff', 'error');
    }
});

window.removeDeliveryStaff = async function(staffId) {
    if (!confirm('Remove this delivery staff member?')) return;
    try {
        await deleteDoc(doc(db, 'DeliveryStaff', staffId));
        showNotification('Delivery staff removed', 'success');
        loadDeliveryStaff();
    } catch (error) {
        console.error('Error removing delivery staff:', error);
        showNotification('Error removing staff', 'error');
    }
};
