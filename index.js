import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs, addDoc, query, limit, orderBy, where } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from "./js/firebase.js";
import { logoutUser, onAuthChange } from "./js/auth.js";
import { showNotification } from './notifications.js';
import { updateCartCounter, updateWishlistCounter, updateChatCounter } from './js/utils.js';
import { categoryHierarchy } from './js/categoryData.js';
import { initializeImageSliders } from './imageSlider.js';
import { escapeHtml, sanitizeUrl, validatePrice, validateQuantity } from './js/sanitize.js';
import { initializePWA, requestNotificationPermission } from './js/pwa.js';
import { showLoader, hideLoader, updateLoaderMessage, setProgress, showSkeletons, getSkeletonCards } from './loader.js';

// Simple placeholder images (no caching)
const PLACEHOLDERS = {
    product: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"%3E%3Crect fill="%23f5f5f5" width="200" height="200"/%3E%3Cpath fill="%23ddd" d="M100 40c-33.137 0-60 26.863-60 60s26.863 60 60 60 60-26.863 60-60-26.863-60-60-60zm0 10c27.614 0 50 22.386 50 50s-22.386 50-50 50-50-22.386-50-50 22.386-50 50-50z"/%3E%3C/svg%3E',
    profile: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle fill="%23e2e8f0" cx="50" cy="50" r="50"/%3E%3Ccircle fill="%2394a3b8" cx="50" cy="40" r="20"/%3E%3Cellipse fill="%2394a3b8" cx="50" cy="85" rx="35" ry="25"/%3E%3C/svg%3E'
};

// Simple getImageUrl without caching
function getImageUrl(src, type = 'product') {
    if (!src || typeof src !== 'string') return PLACEHOLDERS[type] || PLACEHOLDERS.product;
    return src;
}

// Firebase
const auth = getAuth(app);
const db = getFirestore(app);

// ===== ENHANCED CACHING SYSTEM (TEXT DATA ONLY) =====
const CACHE_KEYS = {
  LISTINGS: 'oda_listings_cache',
  USERS: 'oda_users_cache',
  HERO_SLIDES: 'oda_hero_cache',
  CATEGORIES: 'oda_categories_cache'
};

const CACHE_DURATIONS = {
  LISTINGS: 5 * 60 * 1000,      // 5 minutes
  USERS: 10 * 60 * 1000,        // 10 minutes
  HERO_SLIDES: 30 * 60 * 1000,  // 30 minutes
  CATEGORIES: 15 * 60 * 1000    // 15 minutes
};

// State
let allListings = [];
let listingsCache = null;
let listingsCacheTime = 0;

// Memory cache for users
const userCache = new Map();

// ===== LOCAL STORAGE CACHE HELPERS =====
function getLocalCache(key) {
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      return { data, timestamp, valid: true };
    }
  } catch (e) {}
  return { data: null, timestamp: 0, valid: false };
}

function setLocalCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch (e) {
    // Storage full, clear old caches
    Object.values(CACHE_KEYS).forEach(k => {
      if (k !== key) localStorage.removeItem(k);
    });
    try {
      localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e2) {}
  }
}

function isCacheValid(timestamp, duration) {
  return (Date.now() - timestamp) < duration;
}

// Category Icons
const catIcons = {
  'general-shop': 'star', 'fashion': 'tshirt', 'electronics': 'tv', 'phones': 'mobile-alt', 'beauty': 'heart',
  'kitchenware': 'blender', 'furniture': 'couch', 'accessories': 'headphones',
  'foodstuffs': 'carrot', 'pharmaceutical': 'pills', 'kids': 'hat-wizard',
  'rentals': 'building', 'service-men': 'tools', 'student-centre': 'graduation-cap'
};

// Hero Carousel State
let heroSlides = [];
let currentSlide = 0;
let slideInterval = null;

// ===== HELPERS =====
const $ = id => document.getElementById(id);

function setCookie(name, value, days = 1) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};expires=${expires};path=/`;
}

function getGuestCart() {
  try { return JSON.parse(localStorage.getItem('guestCart')) || []; }
  catch { return []; }
}

function saveGuestCart(cart) {
  localStorage.setItem('guestCart', JSON.stringify(cart));
}

function addToGuestCart(listingId, listing, qty = 1, variation = null) {
  const cart = getGuestCart();
  const key = listingId + (variation ? JSON.stringify(variation) : '');
  const existing = cart.findIndex(i => i.listingId + (i.selectedVariation ? JSON.stringify(i.selectedVariation) : '') === key);
  
  if (existing >= 0) cart[existing].quantity += qty;
  else cart.push({
    listingId,
    name: listing.name,
    price: variation?.price || listing.price,
    quantity: qty,
    selectedVariation: variation,
    imageUrls: listing.imageUrls,
    addedAt: new Date().toISOString()
  });
  saveGuestCart(cart);
}

// Get minimum price from variations - retail stored as retailPrice in DB
function getMinPriceFromVariations(listing) {
  let minPrice = Infinity;
  let associatedRetail = null;
  let packSize = null;
  
  if (listing.variations?.length) {
    listing.variations.forEach(v => {
      if (v.attributes?.length) {
        v.attributes.forEach(a => {
          const attrPrice = a.price || a.originalPrice;
          if (attrPrice && attrPrice < minPrice) {
            minPrice = attrPrice;
            // Prefer retailPack (total retail value of pack) over retailPrice (per-piece retail)
            associatedRetail = a.retailPack || a.retailPrice || a.retail || null;
            packSize = a.packSize || null;
          }
        });
      } else {
        const varPrice = v.price || v.originalPrice;
        if (varPrice && varPrice < minPrice) {
          minPrice = varPrice;
          associatedRetail = v.retailPack || v.retailPrice || v.retail || null;
          packSize = v.packSize || null;
        }
      }
    });
  }
  
  // Fallback to listing price if no variations found
  if (minPrice === Infinity) {
    minPrice = listing.price || 0;
    associatedRetail = listing.retailPrice || listing.retail || listing.initialPrice || null;
  }
  
  // Only return retail if it's actually greater than wholesale (sanity check)
  const finalRetail = (associatedRetail && associatedRetail > minPrice) ? associatedRetail : null;
  
  return { 
    price: minPrice, 
    retailPrice: finalRetail,
    packSize: packSize
  };
}

// Get pack size info from first/cheapest variation
function getPackInfo(listing) {
  if (listing.variations?.length) {
    // Find the cheapest option and get its pack size
    let minPrice = Infinity;
    let packSize = null;
    
    listing.variations.forEach(v => {
      if (v.attributes?.length) {
        v.attributes.forEach(a => {
          if (a.price && a.price < minPrice) {
            minPrice = a.price;
            packSize = a.packSize || null;
          }
        });
      } else if (v.price && v.price < minPrice) {
        minPrice = v.price;
        packSize = v.packSize || null;
      }
    });
    return packSize;
  }
  return null;
}

// Time greeting
function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  if (h >= 18 && h < 22) return 'Good evening';
  return 'Hello';
}

// ===== UPDATE MEGA MENU USER INFO =====
function updateMegaMenu(user, userData = {}) {
  const userPic = $('megaUserPic');
  const userName = $('megaUserName');
  const userStatus = $('megaUserStatus');
  const quickStats = $('megaQuickStats');
  
  if (user) {
    if (userPic) userPic.src = userData.profilePicUrl || user.photoURL || 'images/profile-placeholder.png';
    if (userName) userName.textContent = userData.name || user.displayName || user.email?.split('@')[0] || 'User';
    if (userStatus) userStatus.textContent = userData.county ? `📍 ${userData.county}` : 'Welcome back!';
    if (quickStats) quickStats.style.display = 'flex';
  } else {
    if (userPic) userPic.src = 'images/profile-placeholder.png';
    if (userName) userName.textContent = 'Welcome!';
    if (userStatus) userStatus.innerHTML = '<a href="login.html" style="color: var(--primary-color);">Login</a> to access all features';
    if (quickStats) quickStats.style.display = 'none';
  }
}

// ===== AUTH STATUS =====
async function updateAuthStatus(user) {
  const el = $('auth-status');
  if (!el) return;
  
  if (user) {
    let name = user.email?.split('@')[0] || 'User';
    let userData = {};
    try {
      const userDoc = await getDoc(doc(db, "Users", user.uid));
      if (userDoc.exists()) {
        userData = userDoc.data();
        name = userData.name || userData.username || name;
      }
    } catch {}
    
    // Update mega menu
    updateMegaMenu(user, userData);
    
    el.innerHTML = `
      <div class="welcome">
        <span class="greeting">👋 ${getGreeting()}, <strong>${escapeHtml(name)}</strong></span>
        <div class="actions">
          <a href="listing.html" class="btn btn-primary"><i class="fas fa-plus"></i> Sell</a>
          <button class="btn btn-logout" onclick="logout()"><i class="fas fa-sign-out-alt"></i></button>
        </div>
      </div>
    `;
  } else {
    updateMegaMenu(null);
    
    const cartCount = getGuestCart().length;
    el.innerHTML = `
      <div class="welcome">
        <span class="greeting">🛒 ${getGreeting()}! Welcome to <strong>Oda Pap</strong></span>
        <div class="actions">
          ${cartCount > 0 ? `<a href="cart.html" class="btn btn-outline"><i class="fas fa-shopping-cart"></i> ${cartCount}</a>` : ''}
          <a href="login.html" class="btn btn-primary">Login</a>
          <a href="signup.html" class="btn btn-outline">Sign Up</a>
        </div>
      </div>
    `;
  }
}

window.logout = async () => {
  await logoutUser();
  localStorage.removeItem(CACHE_KEYS.USERS);
  location.reload();
};

// ===== CACHED USER FETCH =====
async function getCachedUser(userId) {
  // Check memory cache first
  const memCached = userCache.get(userId);
  if (memCached && isCacheValid(memCached.time, CACHE_DURATIONS.USERS)) {
    return memCached.data;
  }
  
  // Check localStorage cache
  const localCache = getLocalCache(CACHE_KEYS.USERS);
  if (localCache.valid && localCache.data?.[userId] && isCacheValid(localCache.timestamp, CACHE_DURATIONS.USERS)) {
    userCache.set(userId, { data: localCache.data[userId], time: localCache.timestamp });
    return localCache.data[userId];
  }
  
  try {
    const u = await getDoc(doc(db, "Users", userId));
    const data = u.exists() ? u.data() : {};
    userCache.set(userId, { data, time: Date.now() });
    
    // Update localStorage cache
    const existingCache = localCache.data || {};
    existingCache[userId] = data;
    setLocalCache(CACHE_KEYS.USERS, existingCache);
    
    return data;
  } catch {
    // Return from stale cache if available
    if (localCache.data?.[userId]) {
      return localCache.data[userId];
    }
    return {};
  }
}

// ===== CACHED LISTINGS FETCH =====
async function getCachedListings() {
  // Check memory cache first
  if (listingsCache && isCacheValid(listingsCacheTime, CACHE_DURATIONS.LISTINGS)) {
    return listingsCache;
  }
  
  // Check localStorage cache
  const localCache = getLocalCache(CACHE_KEYS.LISTINGS);
  if (localCache.valid && localCache.data && isCacheValid(localCache.timestamp, CACHE_DURATIONS.LISTINGS)) {
    listingsCache = localCache.data;
    listingsCacheTime = localCache.timestamp;
    return listingsCache;
  }
  
  // Check if we're offline
  if (!navigator.onLine) {
    // Return stale cache if available
    if (localCache.data) {
      listingsCache = localCache.data;
      listingsCacheTime = localCache.timestamp;
      return listingsCache;
    }
    throw new Error('Offline and no cached data');
  }
  
  try {
    const snap = await getDocs(collection(db, "Listings"));
    listingsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    listingsCacheTime = Date.now();
    
    // Save to localStorage
    setLocalCache(CACHE_KEYS.LISTINGS, listingsCache);
    
    return listingsCache;
  } catch (e) {
    // Return stale cache on error
    if (localCache.data) {
      listingsCache = localCache.data;
      listingsCacheTime = localCache.timestamp;
      return listingsCache;
    }
    throw e;
  }
}

// ===== HERO CAROUSEL - DYNAMIC =====
async function loadHeroSlides() {
  const track = $('carouselTrack');
  const dotsContainer = $('carouselDots');
  if (!track || !dotsContainer) return;
  
  try {
    const snap = await getDocs(query(collection(db, "HeroSlides"), orderBy("order", "asc")));
    heroSlides = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.active !== false);
    
    // Fallback default slides if none exist
    if (heroSlides.length === 0) {
      heroSlides = [
        { title: 'Source. Stock. Sell.', subtitle: 'Wholesale prices on quality products', gradient: 'gradient-1', icon: 'fa-store' },
        { title: 'General Shop', subtitle: 'Hand-picked quality items by our team', btnText: 'Shop Now', btnLink: 'category.html?prime=generalShop', gradient: 'gradient-2', icon: 'fa-star' },
        { title: 'Start Selling Today', subtitle: 'Join 1000+ sellers. List products free!', btnText: 'List Now', btnLink: 'listing.html', gradient: 'gradient-3', icon: 'fa-rocket' }
      ];
    }
    
    // Render slides (escape user-controlled content from Firestore)
    track.innerHTML = heroSlides.map((slide, idx) => `
      <div class="carousel-slide ${idx === 0 ? 'active' : ''}">
        <div class="slide-content ${escapeHtml(slide.gradient || 'gradient-1')}" ${slide.bgImage ? `style="background-image:linear-gradient(rgba(0,0,0,0.3),rgba(0,0,0,0.3)),url(${sanitizeUrl(slide.bgImage)});background-size:cover;background-position:center;"` : ''}>
          <div class="slide-text">
            <h2>${escapeHtml(slide.title || '')}</h2>
            <p>${escapeHtml(slide.subtitle || '')}</p>
            ${slide.btnText ? `<a href="${sanitizeUrl(slide.btnLink || '#', '#')}" class="slide-btn">${escapeHtml(slide.btnText)} <i class="fas fa-arrow-right"></i></a>` : ''}
          </div>
          <div class="slide-icon"><i class="fas ${escapeHtml(slide.icon || 'fa-star')}"></i></div>
        </div>
      </div>
    `).join('');
    
    // Render dots
    dotsContainer.innerHTML = heroSlides.map((_, idx) => 
      `<span class="dot ${idx === 0 ? 'active' : ''}" data-slide="${idx}"></span>`
    ).join('');
    
    // Initialize carousel
    initHeroCarousel();
    
  } catch (err) {
    console.error('Error loading hero slides:', err);
  }
}

function initHeroCarousel() {
  const slides = document.querySelectorAll('.carousel-slide');
  const dots = document.querySelectorAll('.dot');
  const track = $('carouselTrack');
  const carousel = $('heroCarousel');
  
  if (!slides.length) return;
  
  const goToSlide = (n) => {
    slides[currentSlide]?.classList.remove('active');
    dots[currentSlide]?.classList.remove('active');
    currentSlide = (n + slides.length) % slides.length;
    slides[currentSlide]?.classList.add('active');
    dots[currentSlide]?.classList.add('active');
    track.style.transform = `translateX(-${currentSlide * 100}%)`;
  };
  
  // Dot clicks
  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => goToSlide(i));
  });
  
  // Auto-slide
  if (slideInterval) clearInterval(slideInterval);
  slideInterval = setInterval(() => goToSlide(currentSlide + 1), 5000);
  
  // Touch swipe support - improved
  let touchStartX = 0;
  let touchStartY = 0;
  let isSwiping = false;
  
  carousel?.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    isSwiping = true;
  }, { passive: true });
  
  carousel?.addEventListener('touchmove', e => {
    if (!isSwiping) return;
    const diffX = e.changedTouches[0].screenX - touchStartX;
    const diffY = e.changedTouches[0].screenY - touchStartY;
    // If horizontal swipe is greater than vertical, prevent scroll
    if (Math.abs(diffX) > Math.abs(diffY)) {
      e.preventDefault();
    }
  }, { passive: false });
  
  carousel?.addEventListener('touchend', e => {
    if (!isSwiping) return;
    isSwiping = false;
    const diff = touchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) > 50) {
      goToSlide(diff > 0 ? currentSlide + 1 : currentSlide - 1);
    }
  }, { passive: true });
}

// ===== CATEGORIES =====
async function loadCategories() {
  const strip = $('categoryStrip');
  const megaGrid = $('megaCatGrid');
  
  // Use cached listings
  const listings = await getCachedListings();
  
  // Get unique categories from actual listings
  const categoryCounts = {};
  listings.forEach(l => {
    if (l.category) {
      categoryCounts[l.category] = (categoryCounts[l.category] || 0) + 1;
    }
  });
  
  // Sort categories by count (most products first)
  const sortedCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1]);
  
  // Helper to get icon for category
  const getCategoryIcon = (catName) => {
    const iconMap = {
      'Electronics': 'tv',
      'Fashion': 'tshirt',
      'Beauty': 'heart',
      'Phones': 'mobile-alt',
      'Kitchenware': 'blender',
      'Furniture': 'couch',
      'Food': 'carrot',
      'Foodstuffs': 'carrot',
      'Accessories': 'headphones',
      'Pharmaceutical': 'pills',
      'Pharma': 'pills',
      'Student': 'graduation-cap',
      'Rentals': 'building',
      'Kids': 'hat-wizard',
      'Baby Products': 'baby',
      'Service': 'tools',
      'General Shop': 'star'
    };
    return iconMap[catName] || 'box';
  };
  
  // Helper to get short label for category
  const getShortLabel = (catName) => {
    const shortMap = {
      'Electronics': 'Electronics',
      'Kitchenware': 'Kitchen',
      'Foodstuffs': 'Food',
      'Pharmaceutical': 'Pharma',
      'Student Centre': 'Student',
      'Baby Products': 'Baby',
      'Service Men': 'Services'
    };
    return shortMap[catName] || catName;
  };
  
  // Render category strip (exclude general-shop style categories)
  if (strip) {
    strip.innerHTML = sortedCategories
      .filter(([cat]) => cat.toLowerCase() !== 'general shop')
      .map(([cat, count]) => {
        const urlSafe = encodeURIComponent(cat);
        return `
          <a href="category.html?category=${urlSafe}" class="cat-card">
            <i class="fas fa-${escapeHtml(getCategoryIcon(cat))}"></i>
            <span>${escapeHtml(getShortLabel(cat))}</span>
            <span class="count">${parseInt(count) || 0}</span>
          </a>
        `;
      }).join('');
  }
  
  // Render mega menu categories
  if (megaGrid) {
    megaGrid.innerHTML = sortedCategories
      .map(([cat, count]) => {
        const urlSafe = encodeURIComponent(cat);
        const isGeneral = cat.toLowerCase().includes('general');
        return `
          <a href="category.html?category=${urlSafe}" class="mega-cat${isGeneral ? ' featured' : ''}">
            <i class="fas fa-${escapeHtml(getCategoryIcon(cat))}"></i>
            <span>${escapeHtml(getShortLabel(cat))}</span>
            ${isGeneral ? '<small>Curated picks</small>' : ''}
          </a>
        `;
      }).join('');
  }
}

// ===== FEATURED ITEMS (Prime Categories - General Shop) =====
async function loadFeaturedItems() {
  const container = $('featuredItems');
  if (!container) return;
  
  try {
    // Use cached listings and filter for primeCategories.generalShop
    const listings = await getCachedListings();
    const featured = listings.filter(l => l.primeCategories?.generalShop === true);
    
    if (featured.length === 0) {
      // Hide section if no featured items
      const section = container.closest('.featured-section');
      if (section) section.style.display = 'none';
      return;
    }
    
    // Get seller IDs for featured items
    const sellerIds = new Set();
    featured.forEach(l => sellerIds.add(l.uploaderId || l.userId));
    
    // Batch fetch sellers
    const sellers = {};
    await Promise.all([...sellerIds].map(async id => {
      sellers[id] = await getCachedUser(id);
    }));
    
    // Build featured items HTML
    container.innerHTML = featured.map(data => {
      const sellerId = data.uploaderId || data.userId;
      const seller = sellers[sellerId] || {};
      const priceData = getMinPriceFromVariations(data);
      const imageUrls = data.imageUrls || [];
      const mainImg = sanitizeUrl(getImageUrl(imageUrls[0], 'product'));
      const sellerImg = sanitizeUrl(getImageUrl(seller.profilePicUrl, 'profile'));
      const isVerified = seller.isVerified === true || seller.verified === true;
      
      const margin = priceData.retailPrice && priceData.retailPrice > priceData.price 
        ? Math.round(((priceData.retailPrice - priceData.price) / priceData.retailPrice) * 100) 
        : 0;
      
      const safeName = escapeHtml(data.name);
      // Add verification badge to seller name so it appears everywhere
      const safeSellerName = escapeHtml(seller.name || 'Seller');
      const verifiedBadge = isVerified ? ' <svg class="verified-tick" viewBox="0 0 22 22" aria-label="Verified account" role="img"><g><path fill="#1d9bf0" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></g></svg>' : '';
      const safeId = escapeHtml(data.id);
      
      return `
        <article class="featured-card" onclick="location.href='product.html?id=${safeId}'">
          <div class="featured-badge"><i class="fas fa-star"></i> Featured</div>
          <div class="featured-img">
            <img src="${mainImg}" alt="${safeName}" loading="lazy" data-fallback="product">
          </div>
          <div class="featured-info">
            <h3>${safeName}</h3>
            <div class="featured-seller">
              <img src="${sellerImg}" alt="" data-fallback="profile">
              <span>${safeSellerName}${verifiedBadge}</span>
            </div>
            <div class="featured-price">
              <span class="price">Ksh ${priceData.price?.toLocaleString() || '0'}</span>
              ${margin > 0 ? `<span class="margin">+${margin}% margin</span>` : ''}
            </div>
          </div>
        </article>
      `;
    }).join('');
    
  } catch (err) {
    console.error('Featured load error:', err);
  }
}

// ===== POPULARITY SCORE CALCULATION =====
function calculatePopularity(listing) {
  // Popularity based on: views, wishlist adds, orders, recency
  const viewCount = listing.viewCount || 0;
  const wishlistCount = listing.wishlistCount || 0;
  const orderCount = listing.orderCount || 0;
  const daysOld = listing.createdAt 
    ? Math.max(1, (Date.now() - (listing.createdAt.toDate?.() || new Date(listing.createdAt)).getTime()) / (1000 * 60 * 60 * 24))
    : 30;
  
  // Weighted score - orders matter most, then wishlists, then views
  // Decay by age to favor newer items
  const recencyBoost = Math.max(0.5, 1 - (daysOld / 60)); // Decays over 60 days
  const score = ((orderCount * 10) + (wishlistCount * 3) + (viewCount * 0.1)) * recencyBoost;
  
  return score;
}

// ===== PERSONALIZED RECOMMENDATION ALGORITHM =====
function getUserPreferences() {
  try {
    const history = JSON.parse(localStorage.getItem('productViewHistory') || '{}');
    if (Object.keys(history).length === 0) return null;
    
    // Analyze viewing patterns
    const preferences = {
      categories: {},      // category -> interest score
      subcategories: {},   // subcategory -> interest score
      brands: {},          // brand -> interest score
      priceRanges: [],     // price points the user views
      viewedIds: new Set(),// IDs they've seen
      recentIds: [],       // Most recent views
      engagedIds: []       // High engagement (time spent + views)
    };
    
    // Sort by last viewed for recency
    const sortedHistory = Object.entries(history)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => new Date(b.lastViewed) - new Date(a.lastViewed));
    
    // Take most recent 50 for recency list
    preferences.recentIds = sortedHistory.slice(0, 50).map(h => h.id);
    
    // Find high engagement products (multiple views or long time spent)
    preferences.engagedIds = sortedHistory
      .filter(h => h.views >= 2 || h.totalTime >= 60) // Viewed twice or 60+ seconds
      .slice(0, 20)
      .map(h => h.id);
    
    // All viewed IDs
    sortedHistory.forEach(h => preferences.viewedIds.add(h.id));
    
    return preferences;
  } catch (e) {
    console.error('Error getting user preferences:', e);
    return null;
  }
}

function calculateRecommendationScore(listing, preferences, allListings) {
  if (!preferences) return listing.popularity || 0;
  
  let score = 0;
  const weights = {
    sameCategory: 15,
    sameSubcategory: 25,
    sameBrand: 20,
    similarPrice: 10,
    sameSeller: 8,
    notViewed: 30,     // Boost unseen products
    popular: 5,
    hasMargin: 10,
    recentInterest: 40  // Products similar to recently viewed
  };
  
  // Get categories/brands from viewed products
  const viewedListings = allListings.filter(l => preferences.viewedIds.has(l.id));
  const engagedListings = allListings.filter(l => preferences.engagedIds.includes(l.id));
  
  // Build preference maps from actual viewed listings
  const categoryInterest = {};
  const subcategoryInterest = {};
  const brandInterest = {};
  const sellerInterest = {};
  const pricePoints = [];
  
  viewedListings.forEach((l, idx) => {
    const recencyWeight = Math.max(0.3, 1 - (idx / viewedListings.length)); // More recent = higher weight
    const isEngaged = preferences.engagedIds.includes(l.id);
    const engagementBoost = isEngaged ? 2 : 1;
    
    if (l.category) {
      categoryInterest[l.category] = (categoryInterest[l.category] || 0) + recencyWeight * engagementBoost;
    }
    if (l.subcategory) {
      subcategoryInterest[l.subcategory] = (subcategoryInterest[l.subcategory] || 0) + recencyWeight * engagementBoost;
    }
    if (l.brand) {
      brandInterest[l.brand] = (brandInterest[l.brand] || 0) + recencyWeight * engagementBoost;
    }
    if (l.sellerId) {
      sellerInterest[l.sellerId] = (sellerInterest[l.sellerId] || 0) + recencyWeight * engagementBoost * 0.5;
    }
    if (l.minPrice) {
      pricePoints.push(l.minPrice);
    }
  });
  
  // Calculate average price range
  const avgPrice = pricePoints.length > 0 
    ? pricePoints.reduce((a, b) => a + b, 0) / pricePoints.length 
    : 1000;
  const priceRange = { min: avgPrice * 0.5, max: avgPrice * 2 };
  
  // === Score this listing ===
  
  // Category match
  if (listing.category && categoryInterest[listing.category]) {
    score += weights.sameCategory * categoryInterest[listing.category];
  }
  
  // Subcategory match (stronger signal)
  if (listing.subcategory && subcategoryInterest[listing.subcategory]) {
    score += weights.sameSubcategory * subcategoryInterest[listing.subcategory];
  }
  
  // Brand match
  if (listing.brand && brandInterest[listing.brand]) {
    score += weights.sameBrand * brandInterest[listing.brand];
  }
  
  // Same seller as viewed products (they might like their other products)
  if (listing.sellerId && sellerInterest[listing.sellerId]) {
    score += weights.sameSeller * sellerInterest[listing.sellerId];
  }
  
  // Price similarity (within user's typical range)
  if (listing.minPrice >= priceRange.min && listing.minPrice <= priceRange.max) {
    score += weights.similarPrice;
  }
  
  // Boost products NOT yet viewed (discovery)
  if (!preferences.viewedIds.has(listing.id)) {
    score += weights.notViewed;
  }
  
  // Popular products (social proof)
  score += Math.min(weights.popular, (listing.popularity || 0) * 0.1);
  
  // Good margin products (business value)
  if (listing.margin >= 20) {
    score += weights.hasMargin;
  }
  
  // Extra boost if very similar to recently engaged products
  if (engagedListings.length > 0) {
    engagedListings.forEach(engaged => {
      let similarity = 0;
      if (engaged.category === listing.category) similarity += 2;
      if (engaged.subcategory === listing.subcategory) similarity += 3;
      if (engaged.brand === listing.brand) similarity += 2;
      if (engaged.sellerId === listing.sellerId && listing.id !== engaged.id) similarity += 1;
      
      score += similarity * weights.recentInterest / engagedListings.length;
    });
  }
  
  // Add some randomness to prevent staleness (±10%)
  score = score * (0.9 + Math.random() * 0.2);
  
  return score;
}

function sortByRecommendation(listings) {
  const preferences = getUserPreferences();
  
  if (!preferences || preferences.viewedIds.size < 3) {
    // Not enough data - use default sort (margin)
    return listings.sort((a, b) => b.margin - a.margin);
  }
  
  // Calculate recommendation score for each listing
  listings.forEach(listing => {
    listing.recommendationScore = calculateRecommendationScore(listing, preferences, listings);
  });
  
  // Sort by recommendation score
  return listings.sort((a, b) => b.recommendationScore - a.recommendationScore);
}

// ===== PRODUCTS - Match Category Page Gallery Style =====
async function loadProducts() {
  try {
    // Use cached listings
    const listings = await getCachedListings();
    
    // Get unique seller IDs
    const sellerIds = new Set();
    listings.forEach(l => sellerIds.add(l.uploaderId || l.userId));
    
    // Batch fetch sellers using cache
    const sellers = {};
    await Promise.all([...sellerIds].map(async id => {
      sellers[id] = await getCachedUser(id);
    }));
    
    // Build listings
    allListings = listings.map(data => {
      const sellerId = data.uploaderId || data.userId;
      const seller = sellers[sellerId] || {};
      const priceData = getMinPriceFromVariations(data);
      const packInfo = getPackInfo(data);
      
      return {
        id: data.id,
        ...data,
        sellerId,
        sellerName: seller.name || seller.username || 'Seller',
        sellerPic: seller.profilePicUrl || 'images/profile-placeholder.png',
        sellerUid: seller.uid || sellerId,
        isVerified: seller.isVerified === true || seller.verified === true,
        minPrice: priceData.price,
        retailPrice: priceData.retailPrice,
        packInfo: packInfo,
        margin: priceData.retailPrice && priceData.retailPrice > priceData.price 
          ? Math.round(((priceData.retailPrice - priceData.price) / priceData.retailPrice) * 100) 
          : 0,
        popularity: calculatePopularity(data)
      };
    });
    
    // Use personalized recommendation algorithm if user has browsing history
    // Falls back to margin-based sorting if not enough data
    sortByRecommendation(allListings);
    
    renderProducts();
    
  } catch (err) {
    console.error('Load error:', err);
    showNotification('Failed to load products', 'error');
  }
}

// Twitter-like verified badge SVG
function getVerifiedBadge() {
  return `<svg class="verified-tick" viewBox="0 0 22 22" aria-label="Verified account" role="img"><g><path fill="#1d9bf0" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></g></svg>`;
}

function renderProducts() {
  const container = $('listings-container');
  if (!container) return;
  
  if (allListings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-box-open"></i>
        <p>No products yet. Be the first to sell!</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = allListings.map(listing => {
    const imageUrls = listing.imageUrls || [];
    const firstImage = sanitizeUrl(getImageUrl(imageUrls[0], 'product'));
    const sellerPic = sanitizeUrl(getImageUrl(listing.sellerPic, 'profile'));
    
    // Escape user-provided content
    const safeName = escapeHtml(listing.name);
    const safeSellerName = escapeHtml(listing.sellerName);
    const safeDescription = escapeHtml(listing.description || 'No description available');
    const safeSubcategory = escapeHtml(listing.subcategory || '');
    const safeBrand = escapeHtml(listing.brand || '');
    const safeId = escapeHtml(listing.id);
    const safeSellerId = escapeHtml(listing.sellerId);
    const safeSellerUid = escapeHtml(listing.sellerUid);
    const safePackInfo = escapeHtml(listing.packInfo || '');
    
    // Use Twitter-style verified badge
    const verifiedBadge = listing.isVerified ? getVerifiedBadge() : '';
    
    return `
      <div class="listing-item">
        <div class="product-item">
          <div class="profile">
            <img src="${sellerPic}" alt="${safeSellerName}" onclick="goToUserProfile('${safeSellerUid}')" loading="lazy" data-fallback="profile">
            <div class="uploader-info">
              <p class="uploader-name"><strong>${safeSellerName}</strong>${verifiedBadge}</p>
              <p class="product-name">${safeName}</p>
              ${safePackInfo ? `<p class="pack-size"><i class="fas fa-box"></i> ${safePackInfo}</p>` : ''}
            </div>
            <div class="product-actions profile-actions">
              <div>
                <i class="fas fa-comments" onclick="goToChat('${safeSellerId}', '${safeId}')"></i>
                <small>Message</small>
              </div>
              <div>
                <i class="fas fa-share" onclick="shareProduct('${safeId}', '${safeName}', '${escapeHtml((listing.description || '').substring(0, 100))}')"></i>
                <small>Share</small>
              </div>
            </div>
          </div>
          <div class="product-image-container" onclick="goToProduct('${listing.id}')">
            <div class="image-slider">
              ${imageUrls.map((url, index) => `
                <img src="${getImageUrl(url, 'product')}" alt="Product Image" class="product-image" loading="${index === 0 ? 'eager' : 'lazy'}" data-fallback="product">
              `).join('')}
              <div class="product-tags">
                ${listing.subcategory ? `<span>${listing.subcategory}</span>` : ''}
                ${listing.brand ? `<span>${listing.brand}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="product-price">
            <div class="price-row">
              <span class="price-label">Your Price:</span>
              <strong class="wholesale-amount">KES ${listing.minPrice.toLocaleString()}</strong>
            </div>
            ${listing.retailPrice && listing.retailPrice > listing.minPrice ? `
            <div class="price-row retail-row">
              <span class="price-label" title="What shops typically sell this for">Retail Price:</span>
              <span class="retail-amount">KES ${listing.retailPrice.toLocaleString()}</span>
              <span class="profit-badge">Save ${listing.margin}%</span>
            </div>` : ''}
          </div>
          <p class="product-description">${safeDescription}</p>
          <div style="display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:10px;color:#166534;background:#f0fdf4;border-radius:6px;margin:4px 8px;">
            <i class="fas fa-truck" style="color:#16a34a;"></i> Fast delivery in Mombasa
            <span style="margin-left:auto;color:#6b7280;"><i class="fas fa-shield-alt" style="color:#16a34a;"></i> Secure</span>
          </div>
          <div class="product-actions">
            <div>
              <i class="fas fa-cart-plus" onclick="addToCart('${safeId}')"></i>
              <p>Cart</p>
            </div>
            <div>
              <i class="fas fa-bolt" onclick="buyNow('${safeId}')"></i>
              <p>Buy Now</p>
            </div>
            <div>
              <i class="fas fa-heart" onclick="addToWishlist('${safeId}')"></i>
              <p>Wishlist</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // Initialize image sliders
  initializeImageSliders();
}

// Sort products
$('sortSelect')?.addEventListener('change', function() {
  const sortBy = this.value;
  switch (sortBy) {
    case 'price-low': allListings.sort((a, b) => a.minPrice - b.minPrice); break;
    case 'price-high': allListings.sort((a, b) => b.minPrice - a.minPrice); break;
    case 'profit': allListings.sort((a, b) => b.margin - a.margin); break;
    case 'popular': allListings.sort((a, b) => b.popularity - a.popularity); break;
    case 'for-you': sortByRecommendation(allListings); break;
    case 'newest': 
    default: allListings.sort((a, b) => {
      const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
      const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
      return dateB - dateA;
    });
  }
  renderProducts();
});

// Navigation
window.goToProduct = id => location.href = `product.html?id=${id}`;
window.goToUserProfile = id => location.href = `user.html?userId=${id}`;

window.goToChat = function(sellerId, listingId) {
  const user = auth.currentUser;
  if (user) {
    location.href = `chat.html?sellerId=${sellerId}&listingId=${listingId}`;
  } else {
    showNotification('Please login to message seller', 'warning');
  }
};

window.shareProduct = async function(listingId, productName, productDesc) {
  const shareUrl = `${window.location.origin}/product.html?id=${listingId}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: productName, text: productDesc, url: shareUrl });
    } else {
      await navigator.clipboard.writeText(shareUrl);
      showNotification('Link copied!');
    }
  } catch (e) {
    console.error('Share error:', e);
  }
};

// ===== CART, WISHLIST, BUY =====
window.addToCart = async (id) => {
  const listing = allListings.find(l => l.id === id);
  if (!listing) return;
  
  if (listing.variations?.length) {
    showQuantityModal(id, listing, true);
    return;
  }
  
  const user = auth.currentUser;
  if (user) {
    try {
      await addDoc(collection(db, `users/${user.uid}/cart`), {
        userId: user.uid,
        listingId: id,
        quantity: 1,
        ...listing,
        addedAt: new Date().toISOString()
      });
      showNotification('Added to cart!');
      updateCartCounter(db, user.uid);
    } catch { showNotification('Failed to add', 'error'); }
  } else {
    addToGuestCart(id, listing);
    showNotification('Added to cart!');
    updateAuthStatus(null);
  }
};

window.addToWishlist = async (id) => {
  const user = auth.currentUser;
  if (!user) { showNotification('Please login first', 'warning'); return; }
  
  const listing = allListings.find(l => l.id === id);
  if (!listing) return;
  
  try {
    await addDoc(collection(db, `users/${user.uid}/wishlist`), {
      userId: user.uid,
      listingId: id,
      ...listing,
      addedAt: new Date().toISOString()
    });
    showNotification('Saved to wishlist!');
    updateWishlistCounter(db, user.uid);
  } catch { showNotification('Failed to save', 'error'); }
};

window.buyNow = async (id) => {
  const listing = allListings.find(l => l.id === id);
  if (!listing) return;
  showQuantityModal(id, listing, false);
};

// ===== QUANTITY MODAL =====
function showQuantityModal(id, listing, isCart) {
  // Get all variation options
  const options = [];
  if (listing.variations?.length) {
    listing.variations.forEach((v, vi) => {
      if (v.attributes?.length) {
        v.attributes.forEach((a, ai) => {
          options.push({
            ...a,
            varTitle: v.title,
            display: `${v.title}: ${a.attr_name}`,
            // Check both retailPrice and retail field names
            retailPrice: a.retailPrice || a.retail || null,
            photoUrl: a.photoUrl || a.imageUrl || null,
            vi, ai
          });
        });
      } else {
        options.push({ 
          ...v, 
          display: v.title || `Option ${vi + 1}`, 
          retailPrice: v.retailPrice || v.retail || null,
          photoUrl: v.photoUrl || v.imageUrl || null,
          vi 
        });
      }
    });
  }
  
  let selected = options[0] || null;
  let price = selected?.price || selected?.originalPrice || listing.minPrice;
  let maxStock = selected?.stock || listing.stock || 10;
  const minOrder = listing.minOrderQuantity || 1;
  
  const modal = document.createElement('div');
  modal.className = 'quantity-modal';
  modal.innerHTML = `
    <div class="quantity-modal-content">
      <h3>Select Options</h3>
      <p>Stock: <strong id="modalStock">${maxStock}</strong> units</p>
      ${minOrder > 1 ? `<p style="color: #ff5722; font-size: 12px; margin-top: 4px;"><i class="fas fa-info-circle"></i> Minimum order: ${minOrder} units</p>` : ''}
      ${options.length ? `
        <div class="modal-variations">
          <h4>Select Option:</h4>
          <div class="variations-grid">
            ${options.map((o, i) => `
              <div class="variation-mini-card ${i === 0 ? 'selected' : ''}" data-idx="${i}">
                ${o.photoUrl ? `<img src="${sanitizeUrl(o.photoUrl)}" alt="">` : '<i class="fas fa-box"></i>'}
                <p><strong>${escapeHtml(o.display)}</strong></p>
                <p class="variation-price">KES ${(parseFloat(o.price || o.originalPrice || listing.minPrice) || 0).toLocaleString()}</p>
                ${o.retailPrice ? `<p class="variation-retail">Retail: KES ${(parseFloat(o.retailPrice) || 0).toLocaleString()}</p>` : ''}
                <p class="variation-stock">${parseInt(o.stock) || 0} units</p>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      <div class="quantity-selector">
        <button class="qty-btn" id="qtyMinus">-</button>
        <input type="number" id="qtyInput" value="${minOrder}" min="${minOrder}" max="${maxStock}">
        <button class="qty-btn" id="qtyPlus">+</button>
      </div>
      <div class="quantity-total">Total: <span id="qtyTotal">KES ${price.toLocaleString()}</span></div>
      <div class="quantity-actions">
        <button class="cancel-btn" id="qtyCancel">Cancel</button>
        <button class="confirm-btn" id="qtyConfirm">${isCart ? 'Add to Cart' : 'Buy Now'}</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const input = modal.querySelector('#qtyInput');
  const total = modal.querySelector('#qtyTotal');
  const stock = modal.querySelector('#modalStock');
  
  const updateTotal = () => total.textContent = `KES ${(price * (parseInt(input.value) || 1)).toLocaleString()}`;
  
  // Variation selection
  modal.querySelectorAll('.variation-mini-card').forEach((card, i) => {
    card.onclick = () => {
      modal.querySelectorAll('.variation-mini-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selected = options[i];
      price = selected.price || listing.minPrice;
      maxStock = selected.stock || 10;
      input.max = maxStock;
      stock.textContent = maxStock;
      updateTotal();
    };
  });
  
  modal.querySelector('#qtyMinus').onclick = () => {
    if (parseInt(input.value) > minOrder) { input.value = parseInt(input.value) - 1; updateTotal(); }
  };
  modal.querySelector('#qtyPlus').onclick = () => {
    if (parseInt(input.value) < maxStock) { input.value = parseInt(input.value) + 1; updateTotal(); }
  };
  input.oninput = updateTotal;
  
  modal.querySelector('#qtyCancel').onclick = () => modal.remove();
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  
  modal.querySelector('#qtyConfirm').onclick = async () => {
    const qty = parseInt(input.value) || 1;
    
    if (isCart) {
      const user = auth.currentUser;
      if (user) {
        try {
          await addDoc(collection(db, `users/${user.uid}/cart`), {
            userId: user.uid,
            listingId: id,
            quantity: qty,
            selectedVariation: selected,
            ...listing,
            addedAt: new Date().toISOString()
          });
          showNotification('Added to cart!');
          updateCartCounter(db, user.uid);
        } catch { showNotification('Failed', 'error'); }
      } else {
        addToGuestCart(id, listing, qty, selected);
        showNotification('Added to cart!');
        updateAuthStatus(null);
      }
    } else {
      // Buy now
      const user = auth.currentUser;
      if (!user) { showNotification('Please login to buy', 'warning'); modal.remove(); return; }
      
      setCookie('buyNowItem', {
        listingId: id,
        name: listing.name,
        price: selected?.price || listing.minPrice,
        quantity: qty,
        selectedVariation: selected,
        imageUrls: listing.imageUrls,
        brand: listing.brand,
        category: listing.category
      });
      location.href = 'checkout.html?source=buynow';
    }
    modal.remove();
  };
}

// ===== SEARCH =====
function setupSearch() {
  // Import and initialize dynamic search
  import('./js/dynamicSearch.js').then(module => {
    // Full header search form
    const searchInput = $('searchInput');
    if (searchInput) {
      module.initDynamicSearch('searchInput', {
        maxSuggestions: 6,
        minChars: 1,
        showCategories: true,
        showRecent: true
      });
    }
    
    // Compact header search
    const compactSearchInput = $('compactSearchInput');
    if (compactSearchInput) {
      module.initDynamicSearch('compactSearchInput', {
        maxSuggestions: 5,
        minChars: 1,
        showCategories: true,
        showRecent: true
      });
    }
  }).catch(err => {
    console.log('Dynamic search not available, using fallback:', err);
    setupFallbackSearch();
  });
}

function setupFallbackSearch() {
  // Full header search form
  const searchForm = $('searchForm');
  const searchInput = $('searchInput');
  
  if (searchForm) {
    searchForm.addEventListener('submit', e => {
      e.preventDefault();
      const q = searchInput?.value.trim();
      if (q) location.href = `search-results.html?q=${encodeURIComponent(q)}`;
    });
  }
  
  // Compact header search
  const compactSearchInput = $('compactSearchInput');
  if (compactSearchInput) {
    compactSearchInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = compactSearchInput.value.trim();
        if (q) location.href = `search-results.html?q=${encodeURIComponent(q)}`;
      }
    });
    
    // Also listen for search icon click
    const compactSearch = compactSearchInput.closest('.compact-search');
    if (compactSearch) {
      const icon = compactSearch.querySelector('i.fa-search');
      if (icon) {
        icon.style.cursor = 'pointer';
        icon.addEventListener('click', () => {
          const q = compactSearchInput.value.trim();
          if (q) location.href = `search-results.html?q=${encodeURIComponent(q)}`;
        });
      }
    }
  }
}

// ===== SYNC BADGE COUNTS =====
function syncBadgeCounts() {
  // Sync cart count from main nav to compact header and mega menu
  const mainCart = document.getElementById('cart-count');
  const compactCart = document.getElementById('cart-count-compact');
  const megaCart = document.getElementById('megaCartCount');
  
  if (mainCart && compactCart) compactCart.textContent = mainCart.textContent || '';
  if (mainCart && megaCart) megaCart.textContent = mainCart.textContent || '0';
  
  // Sync wishlist
  const mainWish = document.getElementById('wishlist-count');
  const megaWish = document.getElementById('megaWishlistCount');
  if (mainWish && megaWish) megaWish.textContent = mainWish.textContent || '0';
  
  // Sync notifications
  const mainNotif = document.getElementById('notification-count');
  const compactNotif = document.getElementById('notif-count-compact');
  const megaNotif = document.getElementById('megaNotifCount');
  if (mainNotif && compactNotif) compactNotif.textContent = mainNotif.textContent || '';
  if (mainNotif && megaNotif) megaNotif.textContent = mainNotif.textContent || '0';
}

// Observer to sync badges when they change
const badgeObserver = new MutationObserver(syncBadgeCounts);
['cart-count', 'wishlist-count', 'notification-count'].forEach(id => {
  const el = document.getElementById(id);
  if (el) badgeObserver.observe(el, { childList: true, characterData: true, subtree: true });
});

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  // Show skeleton loaders immediately for fast visual feedback
  showSkeletons();
  
  // Show non-blocking progress toast
  showLoader('main');
  updateLoaderMessage('Loading your feed...', 'stream');
  
  // Initialize PWA (service worker, install prompt, push notifications)
  initializePWA().then(() => {
    console.log('[App] PWA initialized');
  }).catch(err => {
    console.warn('[App] PWA init failed:', err);
  });
  
  // Setup search handlers
  setupSearch();
  
  // Load hero slides first for fast initial display
  setProgress(10);
  updateLoaderMessage('Loading banner...', 'image');
  loadHeroSlides();
  
  setProgress(30);
  updateLoaderMessage('Fetching categories...', 'th-large');
  
  try {
    await Promise.all([loadCategories(), loadProducts(), loadFeaturedItems()]);
    setProgress(90);
    updateLoaderMessage('Almost ready...', 'check');
  } catch (err) {
    console.error('Load error:', err);
    updateLoaderMessage('Loaded with some errors', 'exclamation-triangle');
  }
  
  // Mark containers as loaded
  ['listings-container', 'featuredItems', 'categoryStrip', 'carouselTrack'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dataset.loaded = 'true';
  });
  
  // Hide loader
  hideLoader();
  
  // Initialize lazy loading for images
  initLazyLoading();
  
  // Initial badge sync
  setTimeout(syncBadgeCounts, 500);
  
  onAuthStateChanged(auth, async user => {
    updateAuthStatus(user);
    
    // Show "How It Works" only for unlogged users
    const howItWorks = document.getElementById('howItWorks');
    if (howItWorks) {
      howItWorks.style.display = user ? 'none' : 'block';
    }
    
    if (user) {
      updateCartCounter(db, user.uid);
      updateWishlistCounter(db, user.uid);
      updateChatCounter(db, user.uid);
      // Sync after counters update
      setTimeout(syncBadgeCounts, 1000);
      
      // Request notification permission for logged-in users (after a delay)
      setTimeout(() => {
        if (Notification.permission === 'default') {
          showNotificationPrompt();
        }
      }, 5000);
    }
  });
});

// Show notification permission prompt
function showNotificationPrompt() {
  const prompt = document.createElement('div');
  prompt.id = 'notification-prompt';
  prompt.innerHTML = `
    <div class="notif-prompt-content">
      <i class="fas fa-bell"></i>
      <div class="notif-prompt-text">
        <strong>Enable Notifications</strong>
        <span>Get updates on orders, deals & messages</span>
      </div>
      <button id="enable-notif-btn">Enable</button>
      <button id="dismiss-notif-btn">×</button>
    </div>
  `;
  document.body.appendChild(prompt);
  
  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    #notification-prompt {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      z-index: 99998;
      padding: 12px 16px;
      max-width: 350px;
      animation: slideUp 0.3s ease;
    }
    @keyframes slideUp {
      from { transform: translateX(-50%) translateY(100px); opacity: 0; }
      to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    .notif-prompt-content {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .notif-prompt-content > i {
      font-size: 24px;
      color: #ff5722;
    }
    .notif-prompt-text {
      flex: 1;
    }
    .notif-prompt-text strong { display: block; font-size: 14px; color: #333; }
    .notif-prompt-text span { font-size: 12px; color: #666; }
    #enable-notif-btn {
      background: #ff5722;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 20px;
      font-weight: 600;
      cursor: pointer;
    }
    #dismiss-notif-btn {
      background: none;
      border: none;
      font-size: 20px;
      color: #999;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
  
  document.getElementById('enable-notif-btn').addEventListener('click', async () => {
    const result = await requestNotificationPermission();
    if (result.success) {
      showNotification('Notifications enabled!', 'success');
    } else if (result.reason === 'denied') {
      showNotification('Notifications blocked. Enable in browser settings.', 'warning');
    }
    prompt.remove();
  });
  
  document.getElementById('dismiss-notif-btn').addEventListener('click', () => {
    prompt.remove();
    localStorage.setItem('notif-prompt-dismissed', Date.now());
  });
}

onAuthChange(updateAuthStatus);