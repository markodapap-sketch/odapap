// /js/header.js - Unified Header Component
// This file provides consistent header functionality across all pages

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from './firebase.js';

const auth = getAuth(app);
const db = getFirestore(app);

// ===== USER CACHE =====
const USER_CACHE_KEY = 'oda_user_cache';
const USER_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

function getCachedUserData() {
  try {
    const cached = localStorage.getItem(USER_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < USER_CACHE_DURATION) {
        return data;
      }
    }
  } catch (e) {}
  return null;
}

function setCachedUserData(data) {
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch (e) {}
}

export function clearUserCache() {
  localStorage.removeItem(USER_CACHE_KEY);
}

// ===== COUNTERS CACHE =====
const COUNTERS_CACHE_KEY = 'oda_counters_cache';
const COUNTERS_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

function getCachedCounters() {
  try {
    const cached = localStorage.getItem(COUNTERS_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < COUNTERS_CACHE_DURATION) {
        return data;
      }
    }
  } catch (e) {}
  return null;
}

function setCachedCounters(data) {
  try {
    localStorage.setItem(COUNTERS_CACHE_KEY, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch (e) {}
}

// ===== HEADER HTML TEMPLATE =====
export function getHeaderHTML(activePage = '') {
  return `
    <header id="mainHeader" class="oda-header">
      <div class="header-top-bar">
        <div class="header-logo" onclick="location.href='index.html'">
          <img src="images/logo.png" alt="Oda Pap" class="header-logo-img">
          <span class="header-logo-text">Oda Pap</span>
        </div>
        <div class="header-search">
          <form id="headerSearchForm" action="search-results.html" method="GET">
            <input type="text" name="q" id="headerSearchInput" placeholder="Search products..." autocomplete="off">
            <button type="submit"><i class="fas fa-search"></i></button>
          </form>
        </div>
        <div class="header-menu-toggle" onclick="toggleOdaMenu()">
          <i class="fas fa-th-large"></i>
          <span>Menu</span>
        </div>
      </div>
      <div class="header-divider"></div>
      <nav class="header-nav">
        <button class="header-nav-btn ${activePage === 'home' ? 'active' : ''}" onclick="location.href='index.html'">
          <i class="fas fa-home"></i>
        </button>
        <button class="header-nav-btn ${activePage === 'notification' ? 'active' : ''}" onclick="location.href='notification.html'">
          <i class="fas fa-bell"></i>
          <span class="header-nav-counter" id="notifCount"></span>
        </button>
        <button class="header-nav-btn ${activePage === 'cart' ? 'active' : ''}" onclick="location.href='cart.html'">
          <i class="fas fa-shopping-cart"></i>
          <span class="header-nav-counter" id="cartCount"></span>
        </button>
        <button class="header-nav-btn ${activePage === 'wishlist' ? 'active' : ''}" onclick="location.href='wishlist.html'">
          <i class="fas fa-heart"></i>
          <span class="header-nav-counter" id="wishlistCount"></span>
        </button>
        <button class="header-nav-btn ${activePage === 'profile' ? 'active' : ''}" onclick="location.href='profile.html'">
          <i class="fas fa-user-circle"></i>
        </button>
      </nav>
    </header>

    <!-- Mega Menu Overlay -->
    <div class="oda-menu-overlay" id="odaMenuOverlay" onclick="closeOdaMenu()"></div>
    <div class="oda-mega-menu" id="odaMegaMenu">
      <div class="mega-menu-header">
        <h3><i class="fas fa-th-large"></i> Quick Menu</h3>
        <button class="mega-menu-close" onclick="closeOdaMenu()"><i class="fas fa-times"></i></button>
      </div>
      
      <div class="mega-menu-user" id="megaMenuUser">
        <img src="images/profile-placeholder.png" alt="" id="megaUserAvatar">
        <div class="mega-user-info">
          <p class="mega-user-name" id="megaUserName">Welcome!</p>
          <p class="mega-user-status" id="megaUserStatus">Login for full access</p>
        </div>
      </div>

      <div class="mega-menu-stats" id="megaMenuStats" style="display:none;">
        <div class="mega-stat" onclick="location.href='cart.html'">
          <i class="fas fa-shopping-cart"></i>
          <span id="megaCartCount">0</span>
          <small>Cart</small>
        </div>
        <div class="mega-stat" onclick="location.href='wishlist.html'">
          <i class="fas fa-heart"></i>
          <span id="megaWishlistCount">0</span>
          <small>Wishlist</small>
        </div>
        <div class="mega-stat" onclick="location.href='notification.html'">
          <i class="fas fa-envelope"></i>
          <span id="megaNotifCount">0</span>
          <small>Messages</small>
        </div>
      </div>

      <div class="mega-menu-section">
        <h4>Categories</h4>
        <div class="mega-menu-grid">
          <a href="category.html?category=electronics"><i class="fas fa-tv"></i> Electronics</a>
          <a href="category.html?category=fashion"><i class="fas fa-tshirt"></i> Fashion</a>
          <a href="category.html?category=beauty"><i class="fas fa-heart"></i> Beauty</a>
          <a href="category.html?category=phones"><i class="fas fa-mobile-alt"></i> Phones</a>
          <a href="category.html?category=kitchenware"><i class="fas fa-blender"></i> Kitchenware</a>
          <a href="category.html?category=furniture"><i class="fas fa-couch"></i> Furniture</a>
          <a href="category.html?category=foodstuffs"><i class="fas fa-carrot"></i> Foodstuffs</a>
          <a href="category.html?category=accessories"><i class="fas fa-headphones"></i> Accessories</a>
          <a href="category.html?category=kids"><i class="fas fa-hat-wizard"></i> Kids</a>
          <a href="category.html?category=pharmaceutical"><i class="fas fa-pills"></i> Pharma</a>
          <a href="category.html?category=student-centre"><i class="fas fa-graduation-cap"></i> Student</a>
          <a href="category.html?category=service-men"><i class="fas fa-tools"></i> Services</a>
        </div>
      </div>

      <div class="mega-menu-section">
        <h4>Quick Links</h4>
        <div class="mega-menu-links">
          <a href="listing.html"><i class="fas fa-plus-circle"></i> Sell Product</a>
          <a href="seller-dashboard.html"><i class="fas fa-store"></i> Seller Hub</a>
          <a href="deposit.html"><i class="fas fa-wallet"></i> Deposit</a>
          <a href="orderTracking.html"><i class="fas fa-truck"></i> Track Orders</a>
          <a href="referral.html" style="color:#e64a19;font-weight:600;"><i class="fas fa-gift"></i> Refer & Earn 5%</a>
          <a href="compare.html"><i class="fas fa-columns"></i> Compare Products</a>
          <a href="recently_viewed.html"><i class="fas fa-history"></i> Recently Viewed</a>
          <a href="addresses.html"><i class="fas fa-map-marker-alt"></i> My Addresses</a>
          <a href="returns.html"><i class="fas fa-undo-alt"></i> Returns & Refunds</a>
          <a href="profile.html"><i class="fas fa-user-cog"></i> My Account</a>
          <a href="customer_care.html"><i class="fas fa-headset"></i> Help & Support</a>
        </div>
      </div>

      <div class="mega-menu-footer" id="megaMenuFooter">
        <a href="login.html" class="mega-login-btn" id="megaLoginBtn"><i class="fas fa-sign-in-alt"></i> Login</a>
      </div>
    </div>
  `;
}

// ===== MENU FUNCTIONS =====
window.toggleOdaMenu = function() {
  const overlay = document.getElementById('odaMenuOverlay');
  const menu = document.getElementById('odaMegaMenu');
  if (overlay && menu) {
    overlay.classList.add('open');
    menu.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
};

window.closeOdaMenu = function() {
  const overlay = document.getElementById('odaMenuOverlay');
  const menu = document.getElementById('odaMegaMenu');
  if (overlay && menu) {
    overlay.classList.remove('open');
    menu.classList.remove('open');
    document.body.style.overflow = '';
  }
};

// ===== COUNTER UPDATES =====
async function updateCounters(userId) {
  // Try cache first
  const cached = getCachedCounters();
  if (cached && cached.userId === userId) {
    applyCounters(cached);
    return;
  }

  const counters = { userId, cart: 0, wishlist: 0, notifications: 0 };

  try {
    // Batch all counter queries
    const [cartSnap, wishlistSnap, notifSnap] = await Promise.all([
      getDocs(collection(db, `users/${userId}/cart`)),
      getDocs(collection(db, `users/${userId}/wishlist`)),
      getDocs(query(collection(db, 'Messages'), where('recipientId', '==', userId), where('status', '==', 'sent')))
    ]);

    counters.cart = cartSnap.size;
    counters.wishlist = wishlistSnap.size;
    counters.notifications = notifSnap.size;

    setCachedCounters(counters);
    applyCounters(counters);
  } catch (e) {
    console.warn('Error fetching counters:', e);
    // Apply cached or zero counters
    applyCounters(cached || counters);
  }
}

function applyCounters(counters) {
  const { cart, wishlist, notifications } = counters;
  
  // Update all counter elements
  const cartEls = document.querySelectorAll('#cartCount, #cart-count, #megaCartCount, #cartCounter');
  const wishlistEls = document.querySelectorAll('#wishlistCount, #wishlist-count, #megaWishlistCount, #wishlistCounter');
  const notifEls = document.querySelectorAll('#notifCount, #notification-count, #megaNotifCount, #notificationCounter');

  cartEls.forEach(el => {
    el.textContent = cart > 0 ? cart : '';
    if (cart > 0) el.style.display = '';
    else el.style.display = 'none';
  });

  wishlistEls.forEach(el => {
    el.textContent = wishlist > 0 ? wishlist : '';
    if (wishlist > 0) el.style.display = '';
    else el.style.display = 'none';
  });

  notifEls.forEach(el => {
    el.textContent = notifications > 0 ? notifications : '';
    if (notifications > 0) el.style.display = '';
    else el.style.display = 'none';
  });
}

function updateGuestCounters() {
  try {
    const guestCart = JSON.parse(localStorage.getItem('guestCart')) || [];
    const count = guestCart.length;
    
    const cartEls = document.querySelectorAll('#cartCount, #cart-count, #megaCartCount, #cartCounter');
    cartEls.forEach(el => {
      el.textContent = count > 0 ? count : '';
      if (count > 0) el.style.display = '';
      else el.style.display = 'none';
    });
  } catch (e) {}
}

// ===== USER INFO UPDATE =====
async function updateUserInfo(user) {
  // Try cache first
  let userData = getCachedUserData();
  
  if (!userData || userData.uid !== user.uid) {
    try {
      const userDoc = await getDoc(doc(db, "Users", user.uid));
      if (userDoc.exists()) {
        userData = { ...userDoc.data(), uid: user.uid };
        setCachedUserData(userData);
      } else {
        userData = { uid: user.uid, name: user.email?.split('@')[0] || 'User' };
      }
    } catch (e) {
      userData = { uid: user.uid, name: user.email?.split('@')[0] || 'User' };
    }
  }

  // Update mega menu
  const avatar = document.getElementById('megaUserAvatar');
  const name = document.getElementById('megaUserName');
  const status = document.getElementById('megaUserStatus');
  const stats = document.getElementById('megaMenuStats');
  const loginBtn = document.getElementById('megaLoginBtn');
  const footer = document.getElementById('megaMenuFooter');

  if (avatar) avatar.src = userData.profilePicUrl || user.photoURL || 'images/profile-placeholder.png';
  if (name) name.textContent = userData.name || user.displayName || user.email?.split('@')[0] || 'User';
  if (status) status.textContent = userData.county ? `📍 ${userData.county}` : 'Welcome back!';
  if (stats) stats.style.display = 'flex';
  if (loginBtn) loginBtn.style.display = 'none';
  if (footer) {
    footer.innerHTML = `
      <button onclick="odaLogout()" class="mega-logout-btn">
        <i class="fas fa-sign-out-alt"></i> Logout
      </button>
    `;
  }

  // Update counters
  await updateCounters(user.uid);
}

function updateGuestInfo() {
  const name = document.getElementById('megaUserName');
  const status = document.getElementById('megaUserStatus');
  const stats = document.getElementById('megaMenuStats');
  const loginBtn = document.getElementById('megaLoginBtn');

  if (name) name.textContent = 'Welcome!';
  if (status) status.innerHTML = '<a href="login.html" style="color:#ff5722;">Login</a> for full access';
  if (stats) stats.style.display = 'none';
  if (loginBtn) loginBtn.style.display = 'flex';

  updateGuestCounters();
}

// ===== LOGOUT =====
window.odaLogout = async function() {
  try {
    const { signOut } = await import("https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js");
    await signOut(auth);
    clearUserCache();
    localStorage.removeItem(COUNTERS_CACHE_KEY);
    location.href = 'index.html';
  } catch (e) {
    console.error('Logout error:', e);
  }
};

// ===== SEARCH FORM HANDLER =====
function initSearchForm() {
  const form = document.getElementById('headerSearchForm');
  const input = document.getElementById('headerSearchInput');
  
  if (form && input) {
    form.addEventListener('submit', (e) => {
      const query = input.value.trim();
      if (!query) {
        e.preventDefault();
        return;
      }
    });
  }
}

// ===== INITIALIZE HEADER =====
export function initHeader(activePage = '') {
  // Insert header HTML
  const headerContainer = document.getElementById('odaHeaderContainer');
  if (headerContainer) {
    headerContainer.innerHTML = getHeaderHTML(activePage);
  }

  // Listen for auth changes
  onAuthStateChanged(auth, (user) => {
    if (user) {
      updateUserInfo(user);
    } else {
      updateGuestInfo();
    }
  });

  // Initialize search
  initSearchForm();

  // Close menu on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOdaMenu();
  });
}

// Auto-refresh counters when page becomes visible
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const user = auth.currentUser;
    if (user) {
      // Only refresh if cache is stale
      const cached = getCachedCounters();
      if (!cached || Date.now() - cached.timestamp > COUNTERS_CACHE_DURATION) {
        updateCounters(user.uid);
      }
    } else {
      updateGuestCounters();
    }
  }
});

// Export counter update functions for external use
export { updateCounters, updateGuestCounters, applyCounters };
