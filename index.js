import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs, addDoc, query, where } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { app } from "./js/firebase.js";
import { logoutUser, onAuthChange } from "./js/auth.js";
import { initializeImageSliders } from './imageSlider.js';
import { showLoader, hideLoader } from './loader.js';
import { showNotification } from './notifications.js';
import { animateButton, animateIconToCart, updateCartCounter, updateWishlistCounter, updateChatCounter } from './js/utils.js';
import { categoryHierarchy, brandsByCategory } from './js/categoryData.js';

// Initialize Firebase services
const auth = getAuth(app);
const firestore = getFirestore(app);

// Category icon mapping - centralized for maintainability
const categoryIcons = {
  'fashion': 'tshirt',
  'electronics': 'tv',
  'phones': 'mobile-alt',
  'beauty': 'heart',
  'health': 'capsules',
  'kitchenware': 'blender',
  'furniture': 'couch',
  'appliances': 'microwave',
  'baby': 'baby-carriage',
  'sports': 'football-ball',
  'automotive': 'car',
  'books': 'book',
  'groceries': 'carrot',
  'pets': 'paw',
  'jewelry': 'ring',
  'office': 'briefcase',
  'garden': 'leaf',
  'industrial': 'hammer',
  'accessories': 'headphones',
  'foodstuffs': 'carrot',
  'pharmaceutical': 'pills',
  'kids': 'hat-wizard',
  'rentals': 'building',
  'service-men': 'tools',
  'student-centre': 'graduation-cap'
};

function setCookie(name, value, days = 1) {
  const expires = new Date();
  expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};expires=${expires.toUTCString()};path=/`;
}

// Guest Cart Functions (localStorage based)
function getGuestCart() {
  try {
    return JSON.parse(localStorage.getItem('guestCart')) || [];
  } catch { return []; }
}

function saveGuestCart(cart) {
  localStorage.setItem('guestCart', JSON.stringify(cart));
}

// Get the minimum price from variations/attributes and its associated retail price
function getMinPriceFromVariations(listing) {
  let minPrice = listing.price || Infinity;
  let associatedRetail = listing.initialPrice || null;
  
  if (listing.variations && listing.variations.length > 0) {
    listing.variations.forEach(variation => {
      // New structure: variation has attributes array
      if (variation.attributes && variation.attributes.length > 0) {
        variation.attributes.forEach(attr => {
          if (attr.price && attr.price < minPrice) {
            minPrice = attr.price;
            // Use this option's retail price, not a different option's
            associatedRetail = attr.retailPrice || null;
          }
        });
      } else {
        // Old structure: variation has direct price
        if (variation.price && variation.price < minPrice) {
          minPrice = variation.price;
          associatedRetail = variation.retailPrice || null;
        }
      }
    });
  }
  
  return {
    price: minPrice === Infinity ? (listing.price || 0) : minPrice,
    retailPrice: associatedRetail || listing.initialPrice || null
  };
}

function addToGuestCart(listingId, listing, quantity = 1, selectedVariation = null) {
  const cart = getGuestCart();
  const existingIndex = cart.findIndex(item => 
    item.listingId === listingId && 
    JSON.stringify(item.selectedVariation) === JSON.stringify(selectedVariation)
  );
  
  if (existingIndex >= 0) {
    cart[existingIndex].quantity += quantity;
  } else {
    cart.push({
      listingId,
      name: listing.name,
      price: selectedVariation?.price || listing.price,
      initialPrice: listing.initialPrice,
      quantity,
      selectedVariation,
      imageUrls: listing.imageUrls,
      photoTraceUrl: listing.photoTraceUrl,
      addedAt: new Date().toISOString()
    });
  }
  saveGuestCart(cart);
}

function getGuestCartCount() {
  return getGuestCart().reduce((sum, item) => sum + item.quantity, 0);
}

// Product Ranking Engine - ranks products based on user viewing behavior
class ProductRankingEngine {
  constructor() {
    this.viewHistory = this.loadViewHistory();
    this.startTime = Date.now();
    this.currentProduct = null;
  }

  loadViewHistory() {
    const saved = localStorage.getItem('productViewHistory');
    return saved ? JSON.parse(saved) : {};
  }

  saveViewHistory() {
    localStorage.setItem('productViewHistory', JSON.stringify(this.viewHistory));
  }

  startViewingProduct(productId) {
    if (this.currentProduct) this.endViewingProduct();
    this.currentProduct = productId;
    this.startTime = Date.now();
  }

  endViewingProduct() {
    if (!this.currentProduct) return;
    const timeSpent = (Date.now() - this.startTime) / 1000;

    if (timeSpent > 2) {
      const productId = this.currentProduct;
      if (!this.viewHistory[productId]) {
        this.viewHistory[productId] = { views: 0, totalTime: 0, lastViewed: null };
      }
      this.viewHistory[productId].views++;
      this.viewHistory[productId].totalTime += timeSpent;
      this.viewHistory[productId].lastViewed = new Date().toISOString();
      this.saveViewHistory();
    }
    this.currentProduct = null;
  }

  getEngagementScore(productId) {
    if (!this.viewHistory[productId]) return 0;
    const history = this.viewHistory[productId];
    const avgTimePerView = history.totalTime / history.views;
    const score = (history.views * 10) + (Math.min(avgTimePerView, 60) * 0.5);
    return Math.min(score, 100);
  }

  rankProducts(products) {
    return products.map(product => {
      let score = this.getEngagementScore(product.id) * 0.4;
      score += this.getNameSimilarityBoost(product.name) * 0.3;
      return { ...product, rankingScore: score };
    }).sort((a, b) => b.rankingScore - a.rankingScore);
  }

  getNameSimilarityBoost(productName) {
    if (!productName) return 0;
    let boost = 0;
    const weight = 25;
    const words = productName.toLowerCase().split(/\s+/);
    Object.keys(this.viewHistory).forEach(viewedId => {
      words.forEach(word => {
        if (viewedId.toLowerCase().includes(word)) {
          boost += weight / Math.max(Object.keys(this.viewHistory).length, 1);
        }
      });
    });
    return Math.min(boost, weight);
  }

  clearHistory() {
    this.viewHistory = {};
    localStorage.removeItem('productViewHistory');
  }
}

const rankingEngine = new ProductRankingEngine();

// Load and display category cards (only those with items)
async function loadCategoryStrip() {
  const categoryStrip = document.getElementById('categoryStrip');
  if (!categoryStrip) return;

  const listingsSnapshot = await getDocs(collection(firestore, "Listings"));
  const categoryCounts = {};
  listingsSnapshot.forEach(doc => {
    const category = doc.data().category;
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  });

  const fragment = document.createDocumentFragment();
  Object.keys(categoryHierarchy).forEach(categoryKey => {
    const count = categoryCounts[categoryKey] || 0;
    if (count === 0) return;
    
    const categoryData = categoryHierarchy[categoryKey];
    const icon = categoryIcons[categoryKey] || 'box';

    const card = document.createElement('a');
    card.href = `category.html?category=${categoryKey}`;
    card.className = 'category-card';
    card.innerHTML = `
      <div class="category-card-icon">
        <i class="fas fa-${icon}"></i>
      </div>
      <p class="category-card-name">${categoryData.label}</p>
      <span class="category-card-count">${count}</span>
    `;
    
    fragment.appendChild(card);
  });
  
  categoryStrip.appendChild(fragment);
}

window.scrollCategories = function(direction) {
  const strip = document.getElementById('categoryStrip');
  strip?.scrollBy({ left: direction * 300, behavior: 'smooth' });
};

// Auth Status Display
const displayAuthStatus = async (user) => {
  const authStatusDiv = document.getElementById("auth-status");
  if (!authStatusDiv) return;
  
  authStatusDiv.innerHTML = "";
  authStatusDiv.className = "auth-status-bar";

  if (user) {
    let userName = user.email.split('@')[0];
    try {
      const userDoc = await getDoc(doc(firestore, "Users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        userName = userData.name || userData.username || userName;
      }
    } catch (e) { /* fallback to email */ }

    const greeting = getTimeGreeting();
    authStatusDiv.innerHTML = `
      <div class="welcome-content">
        <div class="greeting-section">
          <span class="greeting-icon">👋</span>
          <span class="greeting-text">${greeting}, <strong>${userName}</strong></span>
        </div>
        <div class="quick-actions-bar">
          <a href="listing.html" class="action-pill sell"><i class="fas fa-plus-circle"></i> Sell</a>
          <a href="profile.html" class="action-pill"><i class="fas fa-user"></i> Profile</a>
          <button class="action-pill logout" onclick="logoutAndReload()"><i class="fas fa-sign-out-alt"></i></button>
        </div>
      </div>
    `;
  } else {
    const guestCartCount = getGuestCartCount();
    const greeting = getTimeGreeting();
    authStatusDiv.innerHTML = `
      <div class="welcome-content guest">
        <div class="guest-greeting">
          <span class="greeting-icon">🛒</span>
          <span class="greeting-text">${greeting}! <strong>Oda Pap Wholesale</strong></span>
        </div>
        <div class="auth-buttons">
          ${guestCartCount > 0 ? `<a href="cart.html" class="action-pill"><i class="fas fa-shopping-cart"></i> Cart (${guestCartCount})</a>` : ''}
          <a href="login.html" class="auth-btn login"><i class="fas fa-sign-in-alt"></i> Login</a>
          <a href="signup.html" class="auth-btn signup"><i class="fas fa-user-plus"></i> Sign Up</a>
        </div>
      </div>
    `;
  }
};

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 22) return "Good evening";
  return "Hello";
}

window.logoutAndReload = async () => {
  await logoutUser();
  window.location.reload();
};

onAuthChange(displayAuthStatus);

// Share product functionality
window.shareProduct = async function(listingId, productName, productDescription) {
  const shareUrl = `${window.location.origin}/product.html?id=${listingId}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: productName, text: productDescription, url: shareUrl });
    } else {
      const shareModal = document.createElement('div');
      shareModal.className = 'share-modal';
      shareModal.innerHTML = `
        <div class="share-modal-content">
          <h3>Share via:</h3>
          <div class="share-buttons">
            <a href="https://wa.me/?text=${encodeURIComponent(`${productName}: ${shareUrl}`)}" target="_blank"><i class="fab fa-whatsapp"></i> WhatsApp</a>
            <a href="https://telegram.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(productName)}" target="_blank"><i class="fab fa-telegram"></i> Telegram</a>
            <button onclick="copyToClipboard('${shareUrl}')"><i class="fas fa-copy"></i> Copy</button>
          </div>
          <button onclick="this.parentElement.parentElement.remove()" class="close-modal"><i class="fas fa-times"></i></button>
        </div>
      `;
      document.body.appendChild(shareModal);
    }
  } catch (e) { console.error('Share error:', e); }
};

window.copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    showNotification('Link copied!');
  } catch (e) { console.error('Copy failed:', e); }
};

// Quantity Modal with Variations
function showQuantityModal(listingId, listing, isAddToCart = false) {
  let selectedVariation = null;
  let price = getMinPriceFromVariations(listing);
  let maxStock = listing.totalStock || 10;

  // Flatten variations with attributes into selectable options
  let allOptions = [];
  if (listing.variations && listing.variations.length > 0) {
    listing.variations.forEach((variation, vIdx) => {
      if (variation.attributes && variation.attributes.length > 0) {
        variation.attributes.forEach((attr, aIdx) => {
          allOptions.push({
            ...attr,
            variationTitle: variation.title,
            variationIndex: vIdx,
            attributeIndex: aIdx,
            displayName: `${variation.title}: ${attr.attr_name}`
          });
        });
      } else {
        // Old structure fallback
        allOptions.push({
          ...variation,
          variationIndex: vIdx,
          displayName: variation.title || variation.attr_name || `Option ${vIdx + 1}`
        });
      }
    });
  }

  let variationsHTML = '';
  if (allOptions.length > 0) {
    variationsHTML = `
      <div class="modal-variations">
        <h4><i class="fas fa-palette"></i> Select Option</h4>
        <div class="variations-grid">
    `;
    allOptions.forEach((option, idx) => {
      const optionPrice = option.price || listing.price;
      const optionStock = option.stock || 0;
      variationsHTML += `
        <div class="variation-mini-card ${idx === 0 ? 'selected' : ''}" data-option-index="${idx}">
          <div class="variation-thumb-wrap">
            ${option.photoUrl 
              ? `<img src="${option.photoUrl}" alt="${option.displayName}" class="variation-thumb">` 
              : '<div class="variation-thumb-placeholder"><i class="fas fa-box"></i></div>'}
          </div>
          <div class="variation-info">
            <p class="variation-title">${option.displayName}</p>
            <p class="variation-price">KES ${optionPrice.toLocaleString()}</p>
            ${option.retailPrice ? `<p class="variation-retail"><s>KES ${option.retailPrice.toLocaleString()}</s></p>` : ''}
            <p class="variation-stock"><i class="fas fa-cube"></i> ${optionStock} in stock</p>
          </div>
        </div>
      `;
    });
    variationsHTML += '</div></div>';
    selectedVariation = allOptions[0];
    price = selectedVariation.price || listing.price;
    maxStock = selectedVariation.stock || 10;
  }

  const modal = document.createElement('div');
  modal.className = 'quantity-modal';
  modal.innerHTML = `
    <div class="quantity-modal-content">
      <h3>Select Quantity</h3>
      <p>Available stock: <span id="modalStock">${maxStock}</span> units</p>
      ${variationsHTML}
      <div class="quantity-selector">
        <button class="qty-btn minus">-</button>
        <input type="number" id="buyNowQuantity" value="1" min="1" max="${maxStock}">
        <button class="qty-btn plus">+</button>
      </div>
      <div class="quantity-total">
        <p>Total: <span id="quantityTotal">KES ${price.toLocaleString()}</span></p>
      </div>
      <div class="quantity-actions">
        <button class="cancel-btn">Cancel</button>
        <button class="confirm-btn">${isAddToCart ? 'Add to Cart' : 'Proceed to Checkout'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const quantityInput = modal.querySelector('#buyNowQuantity');
  const totalEl = modal.querySelector('#quantityTotal');
  const minusBtn = modal.querySelector('.minus');
  const plusBtn = modal.querySelector('.plus');
  const cancelBtn = modal.querySelector('.cancel-btn');
  const confirmBtn = modal.querySelector('.confirm-btn');
  const stockEl = modal.querySelector('#modalStock');

  // Select first option by default if present
  if (allOptions.length > 0) {
    const cards = modal.querySelectorAll('.variation-mini-card');
    if (cards.length > 0) {
      cards[0].classList.add('selected');
    }
    cards.forEach((card, idx) => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedVariation = allOptions[idx];
        price = selectedVariation.price || listing.price;
        maxStock = selectedVariation.stock || 10;
        quantityInput.max = maxStock;
        stockEl.textContent = maxStock;
        updateTotal();
      });
    });
  }

  const updateTotal = () => {
    const qty = parseInt(quantityInput.value) || 1;
    totalEl.textContent = `KES ${(price * qty).toLocaleString()}`;
  };

  minusBtn.addEventListener('click', () => {
    if (parseInt(quantityInput.value) > 1) {
      quantityInput.value = parseInt(quantityInput.value) - 1;
      updateTotal();
    }
  });

  plusBtn.addEventListener('click', () => {
    if (parseInt(quantityInput.value) < maxStock) {
      quantityInput.value = parseInt(quantityInput.value) + 1;
      updateTotal();
    }
  });

  quantityInput.addEventListener('input', updateTotal);

  cancelBtn.addEventListener('click', () => modal.remove());

  confirmBtn.addEventListener('click', async () => {
    const quantity = parseInt(quantityInput.value);
    if (isAddToCart) {
      const user = auth.currentUser;
      if (user) {
        try {
          await addDoc(collection(firestore, `users/${user.uid}/cart`), {
            userId: user.uid,
            listingId: listingId,
            quantity: quantity,
            selectedVariation: selectedVariation,
            ...listing,
            addedAt: new Date().toISOString()
          });
          showNotification("Item added to cart!");
          await updateCartCounter(firestore, user.uid);
        } catch (error) {
          showNotification("Failed to add item to cart.", "error");
        }
      } else {
        addToGuestCart(listingId, listing, quantity, selectedVariation);
        showNotification("Item added to cart!");
        displayAuthStatus(null);
      }
    } else {
      proceedToBuyNowCheckout(quantity, listing, listingId, selectedVariation);
    }
    modal.remove();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

function proceedToBuyNowCheckout(quantity, listing, listingId, selectedVariation = null) {
  try {
    setCookie('buyNowItem', {
      listingId,
      name: listing.name,
      price: selectedVariation?.price || listing.price,
      quantity,
      selectedVariation,
      photoTraceUrl: listing.photoTraceUrl,
      imageUrls: listing.imageUrls,
      brand: listing.brand,
      category: listing.category
    }, 1);
    showNotification("Proceeding to checkout!");
    setTimeout(() => window.location.href = "checkout.html?source=buynow", 500);
  } catch (e) {
    console.error("Checkout error:", e);
    showNotification("Failed to proceed. Please try again.", "error");
  }
}

// Navigation
window.goToUserProfile = (userId) => window.location.href = `user.html?userId=${userId}`;
window.goToProduct = (productId) => {
  rankingEngine.startViewingProduct(productId);
  window.location.href = `product.html?id=${productId}`;
};
window.addEventListener('beforeunload', () => rankingEngine.endViewingProduct());

// Load Featured Listings
const loadFeaturedListings = async () => {
  showLoader();
  try {
    const listingsSnapshot = await getDocs(collection(firestore, "Listings"));
    const listingsContainer = document.getElementById("listings-container");
    listingsContainer.innerHTML = "";

    // Batch fetch user data for all listings
    const userIds = new Set();
    listingsSnapshot.docs.forEach(doc => {
      const uploaderId = doc.data().uploaderId || doc.data().userId;
      if (uploaderId) userIds.add(uploaderId);
    });

    // Fetch all user data in parallel
    const userDataMap = {};
    await Promise.all(
      Array.from(userIds).map(async (userId) => {
        try {
          const userDoc = await getDoc(doc(firestore, "Users", userId));
          if (userDoc.exists()) {
            userDataMap[userId] = userDoc.data();
          }
        } catch (error) {
          console.error(`Error fetching user data for ${userId}:`, error);
        }
      })
    );

    // Build listings array
    const allListings = listingsSnapshot.docs.map(listingDoc => {
      const listing = listingDoc.data();
      const uploaderId = listing.uploaderId || listing.userId;
      const userData = userDataMap[uploaderId] || {};
      const displayName = userData?.name || userData?.username || "Unknown User";
      const imageUrls = listing.imageUrls || [];
      const firstImageUrl = imageUrls.length > 0 ? imageUrls[0] : "images/product-placeholder.png";
      const sellerId = listing.uploaderId || listing.userId;

      return {
        id: listingDoc.id,
        ...listing,
        displayName,
        userData,
        imageUrls,
        firstImageUrl,
        sellerId
      };
    });

    // Rank listings based on user preferences
    const rankedListings = rankingEngine.rankProducts(allListings);

    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    rankedListings.forEach(listing => {
      const listingElement = document.createElement("div");
      listingElement.className = "listing-item";
      
      listingElement.innerHTML = `
        <div class="product-item">
          <div class="profile">
            <img src="${listing.userData.profilePicUrl || "images/profile-placeholder.png"}" alt="${listing.displayName}" onclick="goToUserProfile('${listing.userData.uid || listing.uploaderId}')" loading="lazy">
            <div class="uploader-info">
              <p class="uploader-name"><strong>${listing.displayName}</strong></p>
              <p class="product-name">${listing.name}</p>
            </div>
            <div class="product-actions profile-actions">
              <div>
                <i class="fas fa-comments" onclick="goToChat('${listing.sellerId}', '${listing.id}')"></i>
                <small>Message</small>
              </div>
              <div>
                <i class="fas fa-share" onclick="shareProduct('${listing.id}', '${listing.name}', '${listing.description || ''}', '${listing.firstImageUrl}')"></i>
                <small>Share</small>
              </div>
            </div>
          </div>
          <div class="product-image-container" onclick="goToProduct('${listing.id}')">
            <div class="image-slider">
              ${listing.imageUrls.map((url, index) => `
                <img src="${url}" alt="Product Image" class="product-image" loading="${index === 0 ? 'eager' : 'lazy'}">
              `).join('')}
              <div class="product-tags">
                ${listing.subcategory ? `<span class="product-condition">${listing.subcategory}</span>` : ''}
                ${listing.brand ? `<span class="product-age">${listing.brand}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="product-price">
            ${(() => {
              const priceData = getMinPriceFromVariations(listing);
              const minPrice = priceData.price;
              const retailPrice = priceData.retailPrice;
              const hasVariations = listing.variations && listing.variations.length > 0;
              return `
              <div class="price-row">
                <span class="price-label">${hasVariations ? 'From:' : 'Wholesale:'}</span>
                <strong class="wholesale-amount">KES ${minPrice.toLocaleString()}</strong>
              </div>
              ${retailPrice && retailPrice > minPrice ? `
              <div class="price-row retail-row">
                <span class="price-label">Retail:</span>
                <span class="retail-amount">KES ${retailPrice.toLocaleString()}</span>
                <span class="profit-badge">+${Math.round(((retailPrice - minPrice) / minPrice) * 100)}%</span>
              </div>` : ''}`;
            })()}
          </div>
          <p class="product-description">${listing.description || 'No description available'}</p>
          
          <div class="product-actions">
            <div>
              <i class="fas fa-cart-plus" onclick="addToCart('${listing.id}')"></i>
              <p>Cart</p>
            </div>
            <div>
              <i class="fas fa-bolt" onclick="buyNow('${listing.id}')"></i>
              <p>Buy Now</p>
            </div>
            <div>
              <i class="fas fa-heart" onclick="addToWishlist('${listing.id}')"></i>
              <p>Wishlist</p>
            </div>
          </div>
        </div>
      `;

      fragment.appendChild(listingElement);
    });
    
    listingsContainer.appendChild(fragment);
    initializeImageSliders();
    hideLoader();

  } catch (error) {
    console.error("Error loading featured listings:", error);
    showNotification("Failed to load listings. Please try again later.", "error");
    hideLoader();
  }
};

// ================= CART, WISHLIST, BUY NOW =================
window.addToCart = async function (listingId) {
  const user = auth.currentUser;
  const listingRef = doc(firestore, `Listings/${listingId}`);
  const snapshot = await getDoc(listingRef);
  const listing = snapshot.data();

  if (listing.variations && listing.variations.length > 0) {
    showQuantityModal(listingId, listing, true);
    return;
  }

  if (user) {
    try {
      await addDoc(collection(firestore, `users/${user.uid}/cart`), {
        userId: user.uid,
        listingId: listingId,
        quantity: 1,
        ...listing,
        addedAt: new Date().toISOString()
      });
      showNotification("Item added to cart!");
      await updateCartCounter(firestore, user.uid);
    } catch (error) {
      console.error("Error adding item to cart:", error);
      showNotification("Failed to add item to cart.", "error");
    }
  } else {
    addToGuestCart(listingId, listing, 1);
    showNotification("Item added to cart!");
    displayAuthStatus(null);
  }
};

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
        ...listing,
        addedAt: new Date().toISOString()
      });
      showNotification("Item added to wishlist!");
      await updateWishlistCounter(firestore, user.uid);
    } catch (error) {
      console.error("Error adding item to wishlist:", error);
      showNotification("Failed to add item to wishlist. Please try again.", "error");
    }
  } else {
    showNotification("Please log in to add items to the wishlist.", "warning");
  }
};

window.buyNow = async function (listingId) {
  const user = auth.currentUser;
  if (user) {
    const listingRef = doc(firestore, `Listings/${listingId}`);
    const snapshot = await getDoc(listingRef);
    const listing = snapshot.data();

    try {
      // Always show quantity modal for better UX (like category.js)
      showQuantityModal(listingId, listing, false);
    } catch (error) {
      console.error("Error proceeding to checkout:", error);
      showNotification("Failed to proceed to checkout. Please try again.", "error");
    }
  } else {
    showNotification("Please log in to buy items.", "warning");
  }
};

window.goToChat = function (sellerId, listingId) {
  const user = auth.currentUser;
  if (user) {
    window.location.href = `chat.html?sellerId=${sellerId}&listingId=${listingId}`;
  } else {
    showNotification("Please log in to message the seller.", "error");
  }
};

// ================= INITIALIZATION =================
document.addEventListener("DOMContentLoaded", async () => {
  await loadCategoryStrip();
  await loadFeaturedListings();

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      await updateCartCounter(firestore, user.uid);
      await updateWishlistCounter(firestore, user.uid);
      await updateChatCounter(firestore, user.uid);
    }
  });
});
