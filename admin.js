import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, getDoc, doc, updateDoc, deleteDoc, setDoc, orderBy, limit, startAfter, Timestamp, addDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from './js/firebase.js';
import { showNotification } from './notifications.js';

const auth = getAuth(app);
const db = getFirestore(app);

// Allowed admin emails - admin@odapap.com is the master admin
const MASTER_ADMIN_EMAIL = 'admin@odapap.com';

class AdminDashboard {
    constructor() {
        this.currentSection = 'dashboard';
        this.currentPage = 1;
        this.itemsPerPage = 20;
        this.charts = {};
        this.orders = [];
        this.users = [];
        this.products = [];
        this.isMasterAdmin = false;
        
        this.initializeAuth();
        this.setupEventListeners();
    }

    async initializeAuth() {
        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                window.location.href = 'login.html';
                return;
            }

            // Check if user is admin
            const isAdmin = await this.checkAdminStatus(user.email, user.uid);
            if (!isAdmin) {
                showNotification('Access denied. Admin privileges required.', 'error');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 2000);
                return;
            }

            this.currentUser = user;
            this.isMasterAdmin = user.email === MASTER_ADMIN_EMAIL;
            await this.loadAdminProfile();
            await this.loadDashboardData();
        });
    }

    async checkAdminStatus(email, uid) {
        try {
            // Master admin always has access
            if (email === MASTER_ADMIN_EMAIL) {
                // Ensure master admin document exists
                const masterAdminRef = doc(db, "Admins", uid);
                const masterAdminDoc = await getDoc(masterAdminRef);
                if (!masterAdminDoc.exists()) {
                    await setDoc(masterAdminRef, {
                        email: MASTER_ADMIN_EMAIL,
                        role: 'master_admin',
                        createdAt: Timestamp.now(),
                        permissions: ['all']
                    });
                }
                return true;
            }
            
            // Check if email is in allowed admins collection
            const adminQuery = query(collection(db, "Admins"), where("email", "==", email));
            const adminSnapshot = await getDocs(adminQuery);
            return !adminSnapshot.empty;
        } catch (error) {
            console.error('Error checking admin status:', error);
            return false;
        }
    }

    async loadAdminProfile() {
        try {
            const userDoc = await getDoc(doc(db, "Users", this.currentUser.uid));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                document.getElementById('adminName').textContent = userData.name || this.currentUser.email;
            } else {
                document.getElementById('adminName').textContent = this.currentUser.email;
            }
        } catch (error) {
            console.error('Error loading admin profile:', error);
        }
    }

    setupEventListeners() {
        // Sidebar navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = item.dataset.section;
                this.switchSection(section);
            });
        });

        // Menu toggle
        document.getElementById('menuToggle').addEventListener('click', () => {
            document.querySelector('.sidebar').classList.toggle('collapsed');
        });

        // Logout
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            if (confirm('Are you sure you want to logout?')) {
                await signOut(auth);
                window.location.href = 'login.html';
            }
        });

        // Order filters
        document.getElementById('orderStatusFilter')?.addEventListener('change', () => {
            this.filterOrders();
        });

        document.getElementById('orderSearch')?.addEventListener('input', (e) => {
            this.searchOrders(e.target.value);
        });

        // Product search
        document.getElementById('productSearch')?.addEventListener('input', (e) => {
            this.searchProducts(e.target.value);
        });

        // User search
        document.getElementById('userSearch')?.addEventListener('input', (e) => {
            this.searchUsers(e.target.value);
        });

        // Close modal
        document.querySelector('.close-modal')?.addEventListener('click', () => {
            document.getElementById('orderDetailModal').style.display = 'none';
        });
    }

    switchSection(section) {
        // Update active nav item
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-section="${section}"]`).classList.add('active');

        // Hide all sections
        document.querySelectorAll('.content-section').forEach(sec => {
            sec.classList.remove('active');
        });

        // Show selected section
        document.getElementById(`${section}-section`).classList.add('active');
        document.getElementById('pageTitle').textContent = this.getSectionTitle(section);

        this.currentSection = section;

        // Load section data
        switch(section) {
            case 'orders':
                this.loadOrders();
                break;
            case 'products':
                this.loadProducts();
                break;
            case 'users':
                this.loadUsers();
                break;
            case 'transactions':
                this.loadTransactions();
                break;
            case 'verifications':
                this.loadVerifications();
                break;
            case 'analytics':
                this.loadAnalytics();
                break;
            case 'settings':
                this.loadAdminList();
                break;
        }
    }

    getSectionTitle(section) {
        const titles = {
            dashboard: 'Dashboard',
            orders: 'Order Management',
            products: 'Product Listings',
            users: 'User Management',
            transactions: 'Transactions',
            verifications: 'Payment Verifications',
            analytics: 'Analytics & Reports',
            settings: 'Settings'
        };
        return titles[section] || 'Dashboard';
    }

    async loadDashboardData() {
        try {
            // Load all statistics
            await Promise.all([
                this.loadOrderStats(),
                this.loadUserStats(),
                this.loadProductStats(),
                this.loadRevenueStats(),
                this.loadRecentOrders()
            ]);

            // Initialize charts
            this.initializeCharts();
        } catch (error) {
            console.error('Error loading dashboard:', error);
        }
    }

    async loadOrderStats() {
        try {
            const ordersSnapshot = await getDocs(collection(db, "Orders"));
            const orders = [];
            let pendingCount = 0;
            let todayCount = 0;
            const today = new Date().setHours(0, 0, 0, 0);

            ordersSnapshot.forEach(doc => {
                const order = doc.data();
                orders.push(order);

                if (order.orderStatus === 'pending') pendingCount++;
                
                const orderDate = order.orderDate?.toDate ? order.orderDate.toDate() : new Date(order.orderDate);
                if (orderDate >= today) todayCount++;
            });

            this.orders = orders;
            document.getElementById('totalOrders').textContent = orders.length;
            document.getElementById('pendingOrders').textContent = pendingCount;
            document.getElementById('todayOrders').textContent = todayCount;
            document.getElementById('pendingOrdersBadge').textContent = pendingCount;
        } catch (error) {
            console.error('Error loading order stats:', error);
        }
    }

    async loadUserStats() {
        try {
            const usersSnapshot = await getDocs(collection(db, "Users"));
            this.users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            document.getElementById('totalUsers').textContent = usersSnapshot.size;
        } catch (error) {
            console.error('Error loading user stats:', error);
        }
    }

    async loadProductStats() {
        try {
            const listingsSnapshot = await getDocs(collection(db, "Listings"));
            document.getElementById('totalListings').textContent = listingsSnapshot.size;
            this.products = listingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error('Error loading product stats:', error);
        }
    }

    async loadRevenueStats() {
        try {
            let totalRevenue = 0;
            this.orders.forEach(order => {
                if (order.paymentStatus === 'completed') {
                    totalRevenue += order.totalAmount;
                }
            });
            document.getElementById('totalRevenue').textContent = `KES ${totalRevenue.toLocaleString()}`;
        } catch (error) {
            console.error('Error loading revenue stats:', error);
        }
    }

    async loadRecentOrders() {
        const recentOrders = this.orders
            .sort((a, b) => {
                const dateA = a.orderDate?.toDate ? a.orderDate.toDate() : new Date(a.orderDate);
                const dateB = b.orderDate?.toDate ? b.orderDate.toDate() : new Date(b.orderDate);
                return dateB - dateA;
            })
            .slice(0, 5);

        const listEl = document.getElementById('recentOrdersList');
        listEl.innerHTML = '';

        if (recentOrders.length === 0) {
            listEl.innerHTML = '<p style="text-align: center; color: #999;">No orders yet</p>';
            return;
        }

        recentOrders.forEach(order => {
            const orderDate = order.orderDate?.toDate ? order.orderDate.toDate() : new Date(order.orderDate);
            const item = document.createElement('div');
            item.className = 'recent-item';
            item.innerHTML = `
                <div>
                    <strong>${order.orderId}</strong>
                    <p>${order.buyerDetails?.name || 'Unknown'}</p>
                </div>
                <div>
                    <span class="status-badge ${order.orderStatus}">${order.orderStatus}</span>
                    <p class="text-small">${orderDate.toLocaleDateString()}</p>
                </div>
                <div>
                    <strong>KES ${order.totalAmount.toLocaleString()}</strong>
                </div>
            `;
            item.addEventListener('click', () => this.viewOrderDetails(order));
            listEl.appendChild(item);
        });
    }

    async loadOrders() {
        try {
            const ordersSnapshot = await getDocs(collection(db, "Orders"));
            this.orders = [];
            
            ordersSnapshot.forEach(doc => {
                this.orders.push({ id: doc.id, ...doc.data() });
            });

            this.displayOrders();
        } catch (error) {
            console.error('Error loading orders:', error);
        }
    }

    displayOrders(ordersToDisplay = this.orders) {
        const tbody = document.getElementById('ordersTableBody');
        tbody.innerHTML = '';

        if (ordersToDisplay.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">No orders found</td></tr>';
            return;
        }

        ordersToDisplay.forEach(order => {
            const orderDate = order.orderDate?.toDate ? order.orderDate.toDate() : new Date(order.orderDate);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${order.orderId}</strong></td>
                <td>${order.buyerDetails?.name || 'N/A'}</td>
                <td>${order.items?.length || 0} items</td>
                <td>KES ${order.totalAmount.toLocaleString()}</td>
                <td><span class="badge ${order.paymentMethod}">${order.paymentMethod}</span></td>
                <td>
                    <select class="status-select" data-order-id="${order.id}" data-current-status="${order.orderStatus}">
                        <option value="pending" ${order.orderStatus === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="confirmed" ${order.orderStatus === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                        <option value="out_for_delivery" ${order.orderStatus === 'out_for_delivery' ? 'selected' : ''}>Out for Delivery</option>
                        <option value="delivered" ${order.orderStatus === 'delivered' ? 'selected' : ''}>Delivered</option>
                        <option value="cancelled" ${order.orderStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                </td>
                <td>${orderDate.toLocaleDateString()}</td>
                <td>
                    <button class="btn-icon" onclick="adminDashboard.viewOrderDetails(${JSON.stringify(order).replace(/"/g, '&quot;')})">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Add change listeners to status selects
        document.querySelectorAll('.status-select').forEach(select => {
            select.addEventListener('change', (e) => {
                this.updateOrderStatus(e.target.dataset.orderId, e.target.value, e.target.dataset.currentStatus);
            });
        });
    }

    async updateOrderStatus(orderId, newStatus, oldStatus) {
        try {
            if (confirm(`Update order status to "${newStatus}"?`)) {
                await updateDoc(doc(db, "Orders", orderId), {
                    orderStatus: newStatus,
                    updatedAt: Timestamp.now()
                });
                showNotification('Order status updated successfully');
                await this.loadOrders();
                await this.loadOrderStats();
            } else {
                // Revert select to old status
                const select = document.querySelector(`[data-order-id="${orderId}"]`);
                if (select) select.value = oldStatus;
            }
        } catch (error) {
            console.error('Error updating order status:', error);
            showNotification('Error updating order status');
        }
    }

    viewOrderDetails(order) {
        const modal = document.getElementById('orderDetailModal');
        const content = document.getElementById('orderDetailContent');
        
        const orderDate = order.orderDate?.toDate ? order.orderDate.toDate() : new Date(order.orderDate);
        
        let itemsHTML = '<div class="order-items-list">';
        order.items.forEach(item => {
            itemsHTML += `
                <div class="order-item-detail">
                    <div>
                        <strong>${item.productName}</strong>
                        ${item.selectedVariation ? `<p class="text-small">${item.selectedVariation.title}: ${item.selectedVariation.attr_name}</p>` : ''}
                    </div>
                    <div>
                        <p>Qty: ${item.quantity}</p>
                        <p>KES ${item.pricePerUnit.toLocaleString()} × ${item.quantity}</p>
                        <strong>KES ${item.totalPrice.toLocaleString()}</strong>
                    </div>
                </div>
            `;
        });
        itemsHTML += '</div>';

        content.innerHTML = `
            <div class="order-detail-header">
                <h2>Order Details</h2>
                <span class="status-badge large ${order.orderStatus}">${order.orderStatus}</span>
            </div>
            <div class="order-detail-grid">
                <div class="detail-section">
                    <h3><i class="fas fa-info-circle"></i> Order Information</h3>
                    <p><strong>Order ID:</strong> ${order.orderId}</p>
                    <p><strong>Date:</strong> ${orderDate.toLocaleString()}</p>
                    <p><strong>Source:</strong> ${order.orderSource || 'cart'}</p>
                </div>
                <div class="detail-section">
                    <h3><i class="fas fa-user"></i> Customer Details</h3>
                    <p><strong>Name:</strong> ${order.buyerDetails?.name || 'N/A'}</p>
                    <p><strong>Phone:</strong> ${order.buyerDetails?.phone || 'N/A'}</p>
                    <p><strong>Location:</strong> ${order.buyerDetails?.location || 'N/A'}</p>
                    <p><strong>Delivery Address:</strong> ${order.buyerDetails?.deliveryAddress || 'N/A'}</p>
                </div>
                <div class="detail-section">
                    <h3><i class="fas fa-credit-card"></i> Payment Information</h3>
                    <p><strong>Method:</strong> ${order.paymentMethod}</p>
                    <p><strong>Status:</strong> <span class="badge ${order.paymentStatus}">${order.paymentStatus}</span></p>
                    ${order.mpesaTransactionId ? `<p><strong>M-Pesa Code:</strong> ${order.mpesaTransactionId}</p>` : ''}
                </div>
            </div>
            <div class="detail-section">
                <h3><i class="fas fa-shopping-bag"></i> Order Items</h3>
                ${itemsHTML}
            </div>
            <div class="detail-section">
                <h3><i class="fas fa-calculator"></i> Order Summary</h3>
                <div class="order-summary-detail">
                    <p><span>Subtotal:</span> <span>KES ${order.subtotal.toLocaleString()}</span></p>
                    <p><span>Shipping Fee:</span> <span>KES ${order.shippingFee.toLocaleString()}</span></p>
                    ${order.discount > 0 ? `<p><span>Discount:</span> <span>- KES ${order.discount.toLocaleString()}</span></p>` : ''}
                    <p class="total-row"><span><strong>Total Amount:</strong></span> <span><strong>KES ${order.totalAmount.toLocaleString()}</strong></span></p>
                </div>
            </div>
        `;

        modal.style.display = 'flex';
    }

    filterOrders() {
        const status = document.getElementById('orderStatusFilter').value;
        let filtered = this.orders;

        if (status !== 'all') {
            filtered = this.orders.filter(order => order.orderStatus === status);
        }

        this.displayOrders(filtered);
    }

    searchOrders(searchTerm) {
        const filtered = this.orders.filter(order => 
            order.orderId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            order.buyerDetails?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            order.buyerDetails?.phone?.includes(searchTerm)
        );
        this.displayOrders(filtered);
    }

    searchProducts(searchTerm) {
        const filtered = this.products.filter(product =>
            product.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            product.brand?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            product.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            product.sellerInfo?.name?.toLowerCase().includes(searchTerm.toLowerCase())
        );
        this.displayProducts(filtered);
    }

    searchUsers(searchTerm) {
        const filtered = this.users.filter(user =>
            user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.phoneNumber?.includes(searchTerm) ||
            user.phone?.includes(searchTerm)
        );
        this.displayUsers(filtered);
    }

    displayUsers(usersToDisplay = this.users) {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';

        if (usersToDisplay.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">No users found</td></tr>';
            return;
        }

        usersToDisplay.forEach(async (user) => {
            // Get user's listing count
            const listingsQuery = query(collection(db, "Listings"), where("uploaderId", "==", user.id));
            const listingsSnapshot = await getDocs(listingsQuery);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <div class="user-cell">
                        <img src="${user.profilePicUrl || 'images/profile-placeholder.png'}" alt="${user.name}" class="user-avatar">
                        <div>
                            <strong>${user.name || 'N/A'}</strong>
                            <span class="text-small">${user.id.slice(0, 8)}...</span>
                        </div>
                    </div>
                </td>
                <td>${user.email || 'N/A'}</td>
                <td>${user.phoneNumber || user.phone || 'N/A'}</td>
                <td>${user.county || 'N/A'}</td>
                <td>${listingsSnapshot.size}</td>
                <td>
                    <span class="badge ${user.isVerified ? 'verified' : 'unverified'}">
                        ${user.isVerified ? '<i class="fas fa-check-circle"></i> Verified' : 'Not Verified'}
                    </span>
                </td>
                <td class="text-small">${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon ${user.isVerified ? 'btn-warning' : 'btn-success'}" 
                            onclick="adminDashboard.toggleVerification('${user.id}', ${user.isVerified || false})"
                            title="${user.isVerified ? 'Remove Verification' : 'Verify Seller'}">
                            <i class="fas fa-${user.isVerified ? 'times-circle' : 'check-circle'}"></i>
                        </button>
                        <button class="btn-icon btn-primary" onclick="adminDashboard.messageUser('${user.id}', '${user.name || 'User'}')" title="Message User">
                            <i class="fas fa-comment"></i>
                        </button>
                        <button class="btn-icon btn-primary" onclick="adminDashboard.viewUserDetails('${user.id}')" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-icon btn-danger" onclick="adminDashboard.deleteUser('${user.id}')" title="Delete User">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    async messageUser(userId, userName) {
        if (!userId) {
            showNotification('User information not available', 'error');
            return;
        }
        
        // Redirect to chat page with user
        window.location.href = `chat.html?userId=${userId}&name=${encodeURIComponent(userName)}`;
    }

    async loadProducts() {
        try {
            const listingsSnapshot = await getDocs(collection(db, "Listings"));
            this.products = [];
            
            for (const docSnap of listingsSnapshot.docs) {
                const product = { id: docSnap.id, ...docSnap.data() };
                
                // Get seller info
                if (product.uploaderId) {
                    const sellerDoc = await getDoc(doc(db, "Users", product.uploaderId));
                    if (sellerDoc.exists()) {
                        product.sellerInfo = sellerDoc.data();
                    }
                }
                
                this.products.push(product);
            }
            
            this.displayProducts();
        } catch (error) {
            console.error('Error loading products:', error);
        }
    }

    displayProducts(productsToDisplay = this.products) {
        const tbody = document.getElementById('listingsTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = '';

        if (productsToDisplay.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align: center;">No listings found</td></tr>';
            return;
        }

        productsToDisplay.forEach(product => {
            const row = document.createElement('tr');
            const isHidden = product.isHidden || false;
            const isSuspended = product.isSuspended || false;
            const createdDate = product.createdAt ? new Date(product.createdAt.toDate ? product.createdAt.toDate() : product.createdAt) : new Date();
            
            if (isHidden) row.classList.add('listing-hidden');
            if (isSuspended) row.classList.add('listing-suspended');
            
            row.innerHTML = `
                <td><img src="${product.photoTraceUrl || product.imageUrls?.[0] || 'images/placeholder.png'}" 
                    alt="${product.name}" class="listing-image-thumb"></td>
                <td><strong>${product.name}</strong><br><small>${product.brand || ''}</small></td>
                <td>
                    <div class="user-cell">
                        <img src="${product.sellerInfo?.profilePicUrl || 'images/profile-placeholder.png'}" 
                            alt="Seller" class="user-avatar" style="width: 30px; height: 30px;">
                        <div>
                            <strong style="font-size: 13px;">${product.sellerInfo?.name || 'Unknown'}</strong>
                            <span class="text-small">${product.uploaderName || ''}</span>
                        </div>
                    </div>
                </td>
                <td>${product.category || 'N/A'}</td>
                <td><strong>KES ${product.price?.toLocaleString() || 0}</strong></td>
                <td>${product.totalStock || 0}</td>
                <td>
                    <span class="status-badge ${isSuspended ? 'suspended' : isHidden ? 'hidden' : 'active'}">
                        ${isSuspended ? 'Suspended' : isHidden ? 'Hidden' : 'Active'}
                    </span>
                </td>
                <td class="text-small">${createdDate.toLocaleDateString()}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon btn-primary" onclick="adminDashboard.editListing('${product.id}')" title="Edit Listing">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon ${isHidden ? 'btn-success' : 'btn-warning'}" 
                            onclick="adminDashboard.toggleListingVisibility('${product.id}', ${isHidden})" 
                            title="${isHidden ? 'Show Listing' : 'Hide Listing'}">
                            <i class="fas fa-eye${isHidden ? '' : '-slash'}"></i>
                        </button>
                        <button class="btn-icon ${isSuspended ? 'btn-success' : 'btn-danger'}" 
                            onclick="adminDashboard.toggleListingSuspension('${product.id}', ${isSuspended})" 
                            title="${isSuspended ? 'Unsuspend' : 'Suspend'}">
                            <i class="fas fa-${isSuspended ? 'check' : 'ban'}"></i>
                        </button>
                        <button class="btn-icon btn-primary" onclick="adminDashboard.messageSellerFromListing('${product.uploaderId}', '${product.sellerInfo?.name || 'Seller'}')" title="Message Seller">
                            <i class="fas fa-comment"></i>
                        </button>
                        <button class="btn-icon btn-danger" onclick="adminDashboard.deleteListing('${product.id}')" title="Delete Listing">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    async toggleListingVisibility(listingId, currentlyHidden) {
        try {
            const newState = !currentlyHidden;
            await updateDoc(doc(db, "Listings", listingId), {
                isHidden: newState,
                hiddenAt: newState ? Timestamp.now() : null,
                hiddenBy: newState ? this.currentUser.uid : null
            });
            showNotification(`Listing ${newState ? 'hidden' : 'shown'} successfully`);
            await this.loadProducts();
        } catch (error) {
            console.error('Error toggling listing visibility:', error);
            showNotification('Error updating listing visibility', 'error');
        }
    }

    async toggleListingSuspension(listingId, currentlySuspended) {
        try {
            const newState = !currentlySuspended;
            const reason = newState ? prompt('Enter suspension reason:') : null;
            
            if (newState && !reason) {
                showNotification('Suspension reason is required', 'error');
                return;
            }
            
            await updateDoc(doc(db, "Listings", listingId), {
                isSuspended: newState,
                suspensionReason: newState ? reason : null,
                suspendedAt: newState ? Timestamp.now() : null,
                suspendedBy: newState ? this.currentUser.uid : null
            });
            showNotification(`Listing ${newState ? 'suspended' : 'unsuspended'} successfully`);
            await this.loadProducts();
        } catch (error) {
            console.error('Error toggling listing suspension:', error);
            showNotification('Error updating listing suspension', 'error');
        }
    }

    async deleteListing(listingId) {
        if (!confirm('Are you sure you want to delete this listing? This action cannot be undone.')) return;
        
        try {
            await deleteDoc(doc(db, "Listings", listingId));
            showNotification('Listing deleted successfully');
            await this.loadProducts();
            await this.loadProductStats();
        } catch (error) {
            console.error('Error deleting listing:', error);
            showNotification('Error deleting listing', 'error');
        }
    }

    async editListing(listingId) {
        const listing = this.products.find(p => p.id === listingId);
        if (!listing) return;
        
        const modal = document.getElementById('orderDetailModal');
        const content = document.getElementById('orderDetailContent');
        
        content.innerHTML = `
            <div class="order-detail-header">
                <h2>Edit Listing</h2>
            </div>
            <div class="edit-listing-form">
                <div class="form-group">
                    <label>Product Name:</label>
                    <input type="text" id="editName" value="${listing.name}" class="form-input">
                </div>
                <div class="form-group">
                    <label>Price (KES):</label>
                    <input type="number" id="editPrice" value="${listing.price}" class="form-input">
                </div>
                <div class="form-group">
                    <label>Stock:</label>
                    <input type="number" id="editStock" value="${listing.totalStock || 0}" class="form-input">
                </div>
                <div class="form-group">
                    <label>Description:</label>
                    <textarea id="editDescription" class="form-input" rows="4">${listing.description || ''}</textarea>
                </div>
                <div class="form-actions">
                    <button class="btn-success" onclick="adminDashboard.saveListingEdit('${listingId}')">
                        <i class="fas fa-save"></i> Save Changes
                    </button>
                    <button class="btn-danger" onclick="document.getElementById('orderDetailModal').style.display='none'">
                        <i class="fas fa-times"></i> Cancel
                    </button>
                </div>
            </div>
        `;
        modal.style.display = 'flex';
    }

    async saveListingEdit(listingId) {
        try {
            const name = document.getElementById('editName').value;
            const price = parseFloat(document.getElementById('editPrice').value);
            const stock = parseInt(document.getElementById('editStock').value);
            const description = document.getElementById('editDescription').value;
            
            if (!name || !price || price < 0 || stock < 0) {
                showNotification('Please fill all fields with valid values', 'error');
                return;
            }
            
            await updateDoc(doc(db, "Listings", listingId), {
                name: name,
                price: price,
                totalStock: stock,
                description: description,
                lastEditedBy: this.currentUser.uid,
                lastEditedAt: Timestamp.now()
            });
            
            document.getElementById('orderDetailModal').style.display = 'none';
            showNotification('Listing updated successfully');
            await this.loadProducts();
        } catch (error) {
            console.error('Error saving listing edit:', error);
            showNotification('Error saving changes', 'error');
        }
    }

    async messageSellerFromListing(sellerId, sellerName) {
        if (!sellerId) {
            showNotification('Seller information not available', 'error');
            return;
        }
        
        // Redirect to chat page with seller
        window.location.href = `chat.html?userId=${sellerId}&name=${encodeURIComponent(sellerName)}`;
    }

    async exportListingsToExcel() {
        try {
            showNotification('Preparing Excel export...');
            
            // Prepare data for export
            const exportData = this.products.map(product => ({
                'Product ID': product.id,
                'Product Name': product.name,
                'Brand': product.brand || 'N/A',
                'Category': product.category || 'N/A',
                'Price (KES)': product.price || 0,
                'Stock': product.totalStock || 0,
                'Seller Name': product.sellerInfo?.name || 'Unknown',
                'Seller Email': product.sellerInfo?.email || 'N/A',
                'Seller Phone': product.sellerInfo?.phoneNumber || product.sellerInfo?.phone || 'N/A',
                'Status': product.isSuspended ? 'Suspended' : product.isHidden ? 'Hidden' : 'Active',
                'Description': product.description || 'N/A',
                'Created Date': product.createdAt ? new Date(product.createdAt.toDate ? product.createdAt.toDate() : product.createdAt).toLocaleDateString() : 'N/A',
                'Views': product.views || 0,
                'Condition': product.condition || 'N/A',
                'Location': product.location || 'N/A'
            }));

            // Convert to CSV
            const headers = Object.keys(exportData[0]);
            const csvContent = [
                headers.join(','),
                ...exportData.map(row => 
                    headers.map(header => {
                        const value = row[header]?.toString() || '';
                        // Escape commas and quotes in CSV
                        return `\"${value.replace(/\"/g, '\"\"')}\"`;
                    }).join(',')
                )
            ].join('\\n');

            // Create download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `OdaPap_Listings_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showNotification('Listings exported successfully!');
        } catch (error) {
            console.error('Error exporting listings:', error);
            showNotification('Error exporting to Excel', 'error');
        }
    }

    async loadUsers() {
        try {
            const usersSnapshot = await getDocs(collection(db, "Users"));
            this.users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.displayUsers();
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }

    async toggleVerification(userId, currentStatus) {
        const action = currentStatus ? 'remove verification from' : 'verify';
        if (!confirm(`Are you sure you want to ${action} this seller?`)) return;
        
        try {
            await updateDoc(doc(db, "Users", userId), {
                isVerified: !currentStatus,
                verifiedAt: !currentStatus ? Timestamp.now() : null,
                verifiedBy: !currentStatus ? this.currentUser.uid : null
            });
            showNotification(`Seller ${currentStatus ? 'unverified' : 'verified'} successfully`);
            await this.loadUserStats();
            await this.loadUsers();
        } catch (error) {
            console.error('Error toggling verification:', error);
            showNotification('Error updating verification status', 'error');
        }
    }

    async viewUserDetails(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;
        
        const modal = document.getElementById('orderDetailModal');
        const content = document.getElementById('orderDetailContent');
        
        // Get user's listings
        const listingsQuery = query(collection(db, "Listings"), where("uploaderId", "==", userId));
        const listingsSnapshot = await getDocs(listingsQuery);
        
        // Get user's orders
        const ordersQuery = query(collection(db, "Orders"), where("userId", "==", userId));
        const ordersSnapshot = await getDocs(ordersQuery);
        
        content.innerHTML = `
            <div class="order-detail-header">
                <h2>User Details</h2>
                <span class="badge ${user.isVerified ? 'verified' : 'unverified'}">
                    ${user.isVerified ? '<i class="fas fa-check-circle"></i> Verified Seller' : 'Not Verified'}
                </span>
            </div>
            <div class="user-detail-profile">
                <img src="${user.profilePicUrl || 'images/profile-placeholder.png'}" alt="${user.name}" class="user-detail-avatar">
                <div>
                    <h3>${user.name || 'No Name'}</h3>
                    <p>${user.email || 'No Email'}</p>
                    <p>${user.phoneNumber || user.phone || 'No Phone'}</p>
                </div>
            </div>
            <div class="order-detail-grid">
                <div class="detail-section">
                    <h3><i class="fas fa-map-marker-alt"></i> Location</h3>
                    <p><strong>County:</strong> ${user.county || 'N/A'}</p>
                    <p><strong>Sub-County:</strong> ${user.subCounty || 'N/A'}</p>
                    <p><strong>Ward:</strong> ${user.ward || 'N/A'}</p>
                </div>
                <div class="detail-section">
                    <h3><i class="fas fa-chart-bar"></i> Statistics</h3>
                    <p><strong>Total Listings:</strong> ${listingsSnapshot.size}</p>
                    <p><strong>Total Orders:</strong> ${ordersSnapshot.size}</p>
                    <p><strong>Joined:</strong> ${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</p>
                </div>
            </div>
        `;
        modal.style.display = 'flex';
    }

    async deleteUser(userId) {
        if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
        if (!confirm('This will also delete all their listings. Continue?')) return;
        
        try {
            // Delete user's listings
            const listingsQuery = query(collection(db, "Listings"), where("uploaderId", "==", userId));
            const listingsSnapshot = await getDocs(listingsQuery);
            for (const docSnap of listingsSnapshot.docs) {
                await deleteDoc(doc(db, "Listings", docSnap.id));
            }
            
            // Delete user document
            await deleteDoc(doc(db, "Users", userId));
            
            showNotification('User and their listings deleted successfully');
            await this.loadUserStats();
            await this.loadUsers();
        } catch (error) {
            console.error('Error deleting user:', error);
            showNotification('Error deleting user', 'error');
        }
    }

    // Admin Account Management
    async addAdminAccount() {
        if (!this.isMasterAdmin) {
            showNotification('Only master admin can add new admins', 'error');
            return;
        }
        
        const emailInput = document.getElementById('newAdminEmail');
        const email = emailInput.value.trim().toLowerCase();
        
        if (!email || !email.includes('@')) {
            showNotification('Please enter a valid email', 'error');
            return;
        }
        
        try {
            // Check if already admin
            const existingQuery = query(collection(db, "Admins"), where("email", "==", email));
            const existingSnapshot = await getDocs(existingQuery);
            
            if (!existingSnapshot.empty) {
                showNotification('This email is already an admin', 'error');
                return;
            }
            
            // Add new admin
            await addDoc(collection(db, "Admins"), {
                email: email,
                role: 'admin',
                createdAt: Timestamp.now(),
                addedBy: this.currentUser.email,
                permissions: ['orders', 'products', 'users', 'verifications']
            });
            
            emailInput.value = '';
            showNotification('Admin account added successfully');
            await this.loadAdminList();
        } catch (error) {
            console.error('Error adding admin:', error);
            showNotification('Error adding admin account', 'error');
        }
    }

    async removeAdminAccount(adminDocId, email) {
        if (!this.isMasterAdmin) {
            showNotification('Only master admin can remove admins', 'error');
            return;
        }
        
        if (email === MASTER_ADMIN_EMAIL) {
            showNotification('Cannot remove master admin', 'error');
            return;
        }
        
        if (!confirm(`Remove admin privileges from ${email}?`)) return;
        
        try {
            await deleteDoc(doc(db, "Admins", adminDocId));
            showNotification('Admin account removed');
            await this.loadAdminList();
        } catch (error) {
            console.error('Error removing admin:', error);
            showNotification('Error removing admin', 'error');
        }
    }

    async loadAdminList() {
        const container = document.getElementById('adminList');
        if (!container) return;
        
        try {
            const adminsSnapshot = await getDocs(collection(db, "Admins"));
            container.innerHTML = '<h4>Current Admins:</h4>';
            
            adminsSnapshot.forEach(docSnap => {
                const admin = docSnap.data();
                const isMaster = admin.email === MASTER_ADMIN_EMAIL;
                const div = document.createElement('div');
                div.className = 'admin-item';
                div.innerHTML = `
                    <span>
                        <i class="fas fa-user-shield"></i>
                        ${admin.email}
                        ${isMaster ? '<span class="badge master">Master</span>' : ''}
                    </span>
                    ${!isMaster && this.isMasterAdmin ? `
                        <button class="btn-icon btn-danger" onclick="adminDashboard.removeAdminAccount('${docSnap.id}', '${admin.email}')">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                `;
                container.appendChild(div);
            });
        } catch (error) {
            console.error('Error loading admin list:', error);
        }
    }

    async loadTransactions() {
        try {
            const transactionsSnapshot = await getDocs(collection(db, "Transactions"));
            const tbody = document.getElementById('transactionsTableBody');
            tbody.innerHTML = '';

            if (transactionsSnapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No transactions found</td></tr>';
                return;
            }

            transactionsSnapshot.forEach(doc => {
                const transaction = doc.data();
                const date = transaction.createdAt?.toDate() || new Date();
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${transaction.mpesaTransactionId || doc.id}</td>
                    <td>${transaction.userId?.slice(0, 8)}...</td>
                    <td>${transaction.phoneNumber || 'N/A'}</td>
                    <td>KES ${transaction.amount?.toLocaleString()}</td>
                    <td><span class="badge ${transaction.status}">${transaction.status}</span></td>
                    <td>${date.toLocaleString()}</td>
                `;
                tbody.appendChild(row);
            });
        } catch (error) {
            console.error('Error loading transactions:', error);
        }
    }

    async loadVerifications() {
        try {
            const verificationsSnapshot = await getDocs(
                query(collection(db, "ManualVerifications"), where("status", "==", "pending"))
            );
            
            const container = document.getElementById('verificationsContainer');
            container.innerHTML = '';

            document.getElementById('verificationsBadge').textContent = verificationsSnapshot.size;

            if (verificationsSnapshot.empty) {
                container.innerHTML = '<p style="text-align: center; color: #999;">No pending verifications</p>';
                return;
            }

            verificationsSnapshot.forEach(doc => {
                const verification = doc.data();
                const card = document.createElement('div');
                card.className = 'verification-card';
                card.innerHTML = `
                    <div class="verification-header">
                        <h4>Manual Verification Request</h4>
                        <span class="badge pending">Pending</span>
                    </div>
                    <div class="verification-body">
                        <p><strong>Transaction Code:</strong> ${verification.transactionCode}</p>
                        <p><strong>Amount:</strong> KES ${verification.amount?.toLocaleString()}</p>
                        <p><strong>Phone:</strong> ${verification.phoneNumber}</p>
                        <p><strong>Date:</strong> ${verification.createdAt?.toDate().toLocaleString()}</p>
                    </div>
                    <div class="verification-actions">
                        <button class="btn-success" onclick="adminDashboard.approveVerification('${doc.id}')">
                            <i class="fas fa-check"></i> Approve
                        </button>
                        <button class="btn-danger" onclick="adminDashboard.rejectVerification('${doc.id}')">
                            <i class="fas fa-times"></i> Reject
                        </button>
                    </div>
                `;
                container.appendChild(card);
            });
        } catch (error) {
            console.error('Error loading verifications:', error);
        }
    }

    async approveVerification(verificationId) {
        try {
            if (confirm('Approve this payment verification?')) {
                await updateDoc(doc(db, "ManualVerifications", verificationId), {
                    status: 'approved',
                    approvedAt: Timestamp.now(),
                    approvedBy: this.currentUser.uid
                });
                showNotification('Verification approved');
                await this.loadVerifications();
            }
        } catch (error) {
            console.error('Error approving verification:', error);
            showNotification('Error approving verification');
        }
    }

    async rejectVerification(verificationId) {
        try {
            if (confirm('Reject this payment verification?')) {
                await updateDoc(doc(db, "ManualVerifications", verificationId), {
                    status: 'rejected',
                    rejectedAt: Timestamp.now(),
                    rejectedBy: this.currentUser.uid
                });
                showNotification('Verification rejected');
                await this.loadVerifications();
            }
        } catch (error) {
            console.error('Error rejecting verification:', error);
            showNotification('Error rejecting verification');
        }
    }

    initializeCharts() {
        // Order Status Chart
        this.createOrderStatusChart();
    }

    createOrderStatusChart() {
        const ctx = document.getElementById('orderStatusChart');
        if (!ctx) return;

        const statusCounts = {
            pending: 0,
            confirmed: 0,
            out_for_delivery: 0,
            delivered: 0,
            cancelled: 0
        };

        this.orders.forEach(order => {
            if (statusCounts.hasOwnProperty(order.orderStatus)) {
                statusCounts[order.orderStatus]++;
            }
        });

        new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Pending', 'Confirmed', 'Out for Delivery', 'Delivered', 'Cancelled'],
                datasets: [{
                    data: Object.values(statusCounts),
                    backgroundColor: ['#ff5722', '#2196F3', '#FFC107', '#4CAF50', '#9E9E9E']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true
            }
        });
    }

    async loadAnalytics() {
        // Placeholder for analytics charts
        showNotification('Analytics section - Charts will be implemented here');
    }
}

// Initialize admin dashboard
const adminDashboard = new AdminDashboard();
window.adminDashboard = adminDashboard; // Make it globally accessible for onclick handlers