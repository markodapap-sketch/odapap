import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from './js/firebase.js';
import { showLoader, hideLoader } from './loader.js';
import { showNotification } from './notifications.js';
import { setupGlobalImageErrorHandler, getImageUrl } from './js/imageCache.js';

// Initialize Firebase services
const auth = getAuth(app);
const firestore = getFirestore(app);

// Setup image error handling
setupGlobalImageErrorHandler();

const loadOrderDetails = async (orderId) => {
  showLoader();
  try {
    const orderDoc = await getDoc(doc(firestore, "Orders", orderId));
    if (!orderDoc.exists()) {
      throw new Error("Order not found");
    }
    const orderData = { id: orderDoc.id, ...orderDoc.data() };
    displayOrderDetails(orderData);
  } catch (error) {
    console.error("Error loading order details:", error);
    showNotification("Failed to load order details. Please try again later.", "error");
  } finally {
    hideLoader();
  }
};

const displayOrderDetails = (orderData) => {
  const orderDetailsContainer = document.getElementById('orderDetailsContainer');
  const statusClass = orderData.orderStatus || orderData.status || 'pending';
  
  const statusLabels = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
  };
  
  const statusIcons = {
    pending: 'clock',
    confirmed: 'check',
    out_for_delivery: 'truck',
    delivered: 'check-double',
    cancelled: 'times'
  };
  
  orderDetailsContainer.innerHTML = `
    <div class="order-header">
      <h2>Order #${orderData.orderId || orderData.id?.slice(0, 8)}</h2>
      <span class="status-badge ${statusClass}">
        <i class="fas fa-${statusIcons[statusClass] || 'clock'}"></i>
        ${statusLabels[statusClass] || statusClass}
      </span>
    </div>
    
    <div class="order-timeline">
      <div class="timeline-item ${['pending', 'confirmed', 'out_for_delivery', 'delivered'].includes(statusClass) ? 'completed' : ''}">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <h4>Order Placed</h4>
          <p>${orderData.orderDate ? formatDate(orderData.orderDate) : 'N/A'}</p>
        </div>
      </div>
      <div class="timeline-item ${['confirmed', 'out_for_delivery', 'delivered'].includes(statusClass) ? 'completed' : ''}">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <h4>Confirmed</h4>
          <p>${orderData.confirmedAt ? formatDate(orderData.confirmedAt) : 'Pending'}</p>
        </div>
      </div>
      <div class="timeline-item ${['out_for_delivery', 'delivered'].includes(statusClass) ? 'completed' : ''}">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <h4>Dispatched</h4>
          <p>${orderData.dispatchedAt ? formatDate(orderData.dispatchedAt) : 'Pending'}</p>
          ${orderData.dispatchPhoto ? `<img src="${orderData.dispatchPhoto}" alt="Dispatch proof" class="dispatch-photo">` : ''}
        </div>
      </div>
      <div class="timeline-item ${statusClass === 'delivered' ? 'completed' : ''}">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <h4>Delivered</h4>
          <p>${orderData.deliveredAt ? formatDate(orderData.deliveredAt) : 'Pending'}</p>
        </div>
      </div>
    </div>
    
    <div class="order-items">
      <h3>Items</h3>
      <ul>
        ${(orderData.items || []).map(item => `
          <li class="order-item">
            <img src="${getImageUrl(item.imageUrl, 'product')}" alt="${item.name}" data-fallback="product">
            <div class="item-info">
              <p class="item-name">${item.name}</p>
              ${item.variant ? `<p class="item-variant">${item.variant}</p>` : ''}
            </div>
            <div class="item-qty">×${item.quantity || 1}</div>
            <div class="item-price">KES ${((item.price || 0) * (item.quantity || 1)).toLocaleString()}</div>
          </li>
        `).join('')}
      </ul>
    </div>
    
    <div class="order-summary">
      <div class="summary-row"><span>Subtotal</span><span>KES ${(orderData.subtotal || orderData.total || 0).toLocaleString()}</span></div>
      <div class="summary-row"><span>Shipping</span><span>KES ${(orderData.shippingFee || 0).toLocaleString()}</span></div>
      <div class="summary-row total"><span>Total</span><span>KES ${(orderData.total || 0).toLocaleString()}</span></div>
    </div>
    
    ${orderData.shippingAddress || orderData.buyerDetails ? `
      <div class="delivery-info">
        <h3>Delivery Info</h3>
        <p><strong>${orderData.buyerDetails?.name || 'Customer'}</strong></p>
        <p>${orderData.shippingAddress?.address || orderData.buyerDetails?.address || 'N/A'}</p>
        <p>${orderData.buyerDetails?.phone || ''}</p>
      </div>
    ` : ''}
  `;
};

function formatDate(date) {
  if (!date) return 'N/A';
  const d = date.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Load user's orders
const loadUserOrders = async (userId) => {
  showLoader();
  try {
    const q = query(
      collection(firestore, "Orders"),
      where("userId", "==", userId),
      orderBy("orderDate", "desc")
    );
    const snap = await getDocs(q);
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    displayOrdersList(orders);
  } catch (error) {
    console.error("Error loading orders:", error);
    showNotification("Failed to load orders.", "error");
  } finally {
    hideLoader();
  }
};

const displayOrdersList = (orders) => {
  const container = document.getElementById('ordersListContainer');
  if (!container) return;
  
  if (orders.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-box-open"></i>
        <p>No orders yet</p>
        <a href="index.html" class="btn-primary">Start Shopping</a>
      </div>
    `;
    return;
  }
  
  container.innerHTML = orders.map(order => {
    const statusClass = order.orderStatus || order.status || 'pending';
    const firstItem = order.items?.[0];
    
    return `
      <div class="order-card" onclick="location.href='orderTracking.html?orderId=${order.id}'">
        <div class="order-card-header">
          <span class="order-id">#${order.orderId || order.id?.slice(0, 8)}</span>
          <span class="status-badge ${statusClass}">${statusClass.replace(/_/g, ' ')}</span>
        </div>
        <div class="order-card-body">
          ${firstItem ? `<img src="${getImageUrl(firstItem.imageUrl, 'product')}" alt="">` : ''}
          <div class="order-card-info">
            <p class="item-count">${order.items?.length || 0} item${(order.items?.length || 0) !== 1 ? 's' : ''}</p>
            <p class="order-date">${formatDate(order.orderDate)}</p>
          </div>
          <div class="order-total">KES ${(order.total || 0).toLocaleString()}</div>
        </div>
      </div>
    `;
  }).join('');
};

document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const orderId = urlParams.get('orderId');
  if (orderId) {
    loadOrderDetails(orderId);
  } else {
    showNotification("Order ID is missing from the URL.", "error");
  }
});
