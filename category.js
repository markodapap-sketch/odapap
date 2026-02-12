import { logoutUser, onAuthChange } from "./js/auth.js";
import { app } from "./js/firebase.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getStorage, ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { initializeImageSliders } from './imageSlider.js';
import { showLoader, hideLoader, updateLoaderMessage, setProgress, showSkeletons, getSkeletonCards } from './loader.js';
import { showNotification } from './notifications.js';
import { animateButton, animateIconToCart, updateCartCounter, updateWishlistCounter, updateChatCounter } from './js/utils.js';
import { escapeHtml, sanitizeUrl } from './js/sanitize.js';
import { initLazyLoading } from './js/imageCache.js';

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

// Initialize Firebase services
const auth = getAuth(app);
const storage = getStorage(app);
const firestore = getFirestore(app);

// Caching for Firestore reads
const userCache = new Map();
const USER_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Product display settings from admin
let displaySettings = { showStockCount: false, showStockLowOnly: false, lowStockThreshold: 5 };

async function loadDisplaySettings() {
  try {
    const snap = await getDoc(doc(firestore, 'Settings', 'appSettings'));
    if (snap.exists()) {
      const d = snap.data();
      displaySettings.showStockCount = d.showStockCount === true;
      displaySettings.showStockLowOnly = d.showStockLowOnly === true;
      displaySettings.lowStockThreshold = parseInt(d.lowStockThreshold) || 5;
    }
  } catch (e) { console.warn('Display settings load failed:', e); }
}

function shouldShowStock(stockCount) {
  if (!displaySettings.showStockCount) return false;
  if (displaySettings.showStockLowOnly) {
    return stockCount > 0 && stockCount <= displaySettings.lowStockThreshold;
  }
  return true;
}

function getRetailPerPiece(retailPrice, packQuantity) {
  if (!retailPrice || !packQuantity || packQuantity <= 1) return '';
  const perPiece = Math.ceil(retailPrice / packQuantity);
  return ` (KES ${perPiece.toLocaleString()}/pc)`;
}

// Cached user fetch function
async function getCachedUser(userId) {
  const now = Date.now();
  const cached = userCache.get(userId);
  
  if (cached && (now - cached.time) < USER_CACHE_DURATION) {
    return cached.data;
  }
  
  try {
    const u = await getDoc(doc(firestore, "Users", userId));
    const data = u.exists() ? u.data() : {};
    userCache.set(userId, { data, time: now });
    return data;
  } catch {
    return {};
  }
}

// RateLimiter class definition
class RateLimiter {
  constructor(maxRequests, interval) {
    this.maxRequests = maxRequests;
    this.interval = interval;
    this.requests = [];
  }

  canProceed() {
    const now = Date.now();
    this.requests = this.requests.filter(timestamp => now - timestamp < this.interval);
    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return true;
    }
    return false;
  }
}

// Create centralized error handling
const errorHandler = {
  network: (error) => {
    showNotification('Network error', 'error');
  },
  auth: (error) => {
    showNotification('Authentication error', 'error');
  }
};

// Breadcrumb navigation state
let currentCategory = null;
let currentSubcategory = null;
let currentBrand = null;

// Category hierarchy for breadcrumb navigation
const categoryHierarchy = {
    fashion: {
        label: "Fashion & Apparel",
        subcategories: {
            "mens-wear": { label: "Men's Wear" },
            "womens-wear": { label: "Women's Wear" },
            "kids-wear": { label: "Kids Wear" }
        }
    },
    electronics: {
        label: "Electronics",
        subcategories: {
            "mobile-accessories": { label: "Mobile Accessories" },
            "audio": { label: "Audio Devices" },
            "computers": { label: "Computer Accessories" }
        }
    },
    phones: {
        label: "Mobile Phones & Tablets",
        subcategories: {
            "smartphones": { label: "Smartphones" },
            "tablets": { label: "Tablets" }
        }
    },
    beauty: {
        label: "Beauty & Personal Care",
        subcategories: {
            "skincare": { label: "Skincare" },
            "makeup": { label: "Makeup" },
            "haircare": { label: "Hair Care" }
        }
    },
    kitchenware: {
        label: "Kitchenware & Home",
        subcategories: {
            "cookware": { label: "Cookware" },
            "appliances": { label: "Kitchen Appliances" }
        }
    },
    furniture: {
        label: "Furniture",
        subcategories: {
            "living-room": { label: "Living Room" },
            "bedroom": { label: "Bedroom" }
        }
    },
    accessories: {
        label: "Accessories",
        subcategories: {
            "bags": { label: "Bags" },
            "jewelry": { label: "Jewelry" }
        }
    },
    foodstuffs: {
        label: "Foodstuffs",
        subcategories: {
            "grains": { label: "Grains" },
            "spices": { label: "Spices" }
        }
    },
    pharmaceutical: {
        label: "Pharmaceutical",
        subcategories: {
            "medicines": { label: "Medicines" },
            "supplements": { label: "Supplements" }
        }
    },
    "student-centre": {
        label: "Student Centre",
        subcategories: {
            "textbooks": { label: "Textbooks" },
            "stationery": { label: "Stationery" }
        }
    },
    kids: {
        label: "Kids",
        subcategories: {
            "toys": { label: "Toys" },
            "clothing": { label: "Clothing" }
        }
    },
    rentals: {
        label: "Rentals",
        subcategories: {
            "apartments": { label: "Apartments" },
            "houses": { label: "Houses" }
        }
    },
    "service-men": {
        label: "Service Men",
        subcategories: {
            "plumbing": { label: "Plumbing" },
            "electrical": { label: "Electrical" }
        }
    }
};

// Cookie helper functions
function setCookie(name, value, days = 1) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};expires=${expires.toUTCString()};path=/`;
}

// Get the minimum price from variations/attributes and its associated retail price
function getMinPriceFromVariations(listing) {
    let minPrice = Infinity;
    let associatedRetail = null;
    let packQuantity = 0;
    
    if (listing.variations && listing.variations.length > 0) {
        listing.variations.forEach(variation => {
            if (variation.attributes && variation.attributes.length > 0) {
                variation.attributes.forEach(attr => {
                    const attrPrice = attr.price || attr.originalPrice;
                    if (attrPrice && attrPrice < minPrice) {
                        minPrice = attrPrice;
                        associatedRetail = attr.retailPack || attr.retailPrice || attr.retail || null;
                        packQuantity = parseInt(attr.packQuantity) || 0;
                    }
                });
            } else {
                const varPrice = variation.price || variation.originalPrice;
                if (varPrice && varPrice < minPrice) {
                    minPrice = varPrice;
                    associatedRetail = variation.retailPack || variation.retailPrice || variation.retail || null;
                    packQuantity = parseInt(variation.packQuantity) || 0;
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
        packQuantity: packQuantity
    };
}

// Show quantity modal for Buy Now
function showQuantityModal(listingId, listing, isAddToCart = false) {
    let selectedVariation = null;
    let price = getMinPriceFromVariations(listing);
    let maxStock = listing.totalStock || 10;
    const minOrder = listing.minOrderQuantity || 1;

    // Flatten variations with attributes into selectable options
    let allOptions = [];
    const listingImg = listing.imageUrls?.[0] || listing.photoTraceUrl || '';
    if (listing.variations && listing.variations.length > 0) {
        listing.variations.forEach((variation, vIdx) => {
            // Variation-level image (photoUrls array from bulk upload)
            const varImg = variation.photoUrls?.[0] || variation.photoUrl || '';
            if (variation.attributes && variation.attributes.length > 0) {
                variation.attributes.forEach((attr, aIdx) => {
                    allOptions.push({
                        ...attr,
                        variationTitle: variation.title,
                        variationIndex: vIdx,
                        attributeIndex: aIdx,
                        displayName: `${variation.title}: ${attr.attr_name}`,
                        photoUrl: attr.photoUrl || attr.imageUrl || varImg || listingImg,
                        packQuantity: attr.packQuantity || null,
                        unitLabel: attr.unitLabel || 'pieces'
                    });
                });
            } else {
                allOptions.push({
                    ...variation,
                    variationIndex: vIdx,
                    displayName: variation.title || variation.attr_name || `Option ${vIdx + 1}`,
                    photoUrl: variation.photoUrl || variation.imageUrl || varImg || listingImg,
                    packQuantity: variation.packQuantity || null,
                    unitLabel: variation.unitLabel || 'pieces'
                });
            }
        });
    }

    let variationsHTML = '';
    if (allOptions.length > 0) {
        variationsHTML = '<div class="modal-variations"><h4>Select Option:</h4><div class="variations-grid">';
        allOptions.forEach((option, idx) => {
            const optionPrice = option.price || option.originalPrice || listing.price;
            const optionRetail = parseFloat(option.retailPrice || option.retail) || 0;
            const pqty = parseInt(option.packQuantity) || 0;
            const pLabel = pqty ? `<p class="variation-pack"><i class="fas fa-cubes"></i> ${pqty} ${escapeHtml(option.unitLabel || 'pieces')} per unit</p>` : '';
            const retailPP = optionRetail && pqty > 1 ? getRetailPerPiece(optionRetail, pqty) : '';
            const oStock = parseInt(option.stock) || 0;
            variationsHTML += `
                <div class="variation-mini-card ${idx === 0 ? 'selected' : ''}" data-option-index="${idx}">
                    ${option.photoUrl ? `<img src="${option.photoUrl}" alt="${escapeHtml(option.displayName)}">` : '<i class="fas fa-box"></i>'}
                    <p><strong>${escapeHtml(option.displayName)}</strong></p>
                    ${pLabel}
                    <p class="variation-price">KES ${optionPrice.toLocaleString()}${pqty > 1 ? ` <span class="var-per-pc">(KES ${Math.ceil(optionPrice / pqty).toLocaleString()}/pc)</span>` : ''}</p>
                    ${optionRetail ? `<p class="variation-retail">~Retail KES ${optionRetail.toLocaleString()}${retailPP}</p>` : ''}
                    ${shouldShowStock(oStock) ? `<p class="variation-stock">${oStock} in stock</p>` : ''}
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
            ${shouldShowStock(maxStock) ? `<p>Available stock: <span id="modalStock">${maxStock}</span> units</p>` : '<span id="modalStock" style="display:none;"></span>'}
            ${minOrder > 1 ? `<p style="color: #ff5722; font-size: 12px; margin-top: 4px;"><i class="fas fa-info-circle"></i> Minimum order: ${minOrder} units</p>` : ''}
            ${variationsHTML}
            <div class="quantity-selector">
                <button class="qty-btn minus">-</button>
                <input type="number" id="buyNowQuantity" value="${minOrder}" min="${minOrder}" max="${maxStock}">
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
        if (parseInt(quantityInput.value) > minOrder) {
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

    cancelBtn.addEventListener('click', () => {
        modal.remove();
    });

    confirmBtn.addEventListener('click', async () => {
        const quantity = parseInt(quantityInput.value);
        
        // Calculate correct price and image based on variation
        let finalPrice = price;
        let finalImageUrl = listing.photoTraceUrl || (listing.imageUrls && listing.imageUrls[0]);
        
        if (selectedVariation) {
            finalPrice = selectedVariation.price || selectedVariation.originalPrice || listing.price;
            finalImageUrl = selectedVariation.photoUrl || selectedVariation.imageUrl || finalImageUrl;
        }
        
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
                        price: finalPrice,
                        photoTraceUrl: finalImageUrl,
                        addedAt: new Date().toISOString()
                    });
                    showNotification("Item added to cart!");
                    const addToCartBtn = document.querySelector(`[data-listing-id="${listingId}"].add-to-cart-btn`);
                    if (addToCartBtn) {
                        animateButton(addToCartBtn, 'sounds/pop-39222.mp3');
                        animateIconToCart(addToCartBtn, 'cart-icon');
                    }
                    await updateCartCounter(firestore, user.uid);
                } catch (error) {
                    showNotification("Failed to add item to cart. Please try again.");
                }
            }
        } else {
            proceedToBuyNowCheckout(quantity, listing, listingId, selectedVariation);
        }
        modal.remove();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Add this function for Buy Now checkout
function proceedToBuyNowCheckout(quantity, listing, listingId, selectedVariation = null) {
    try {
        // Determine the correct price and image based on variation selection
        let finalPrice = listing.price;
        let finalImageUrl = listing.photoTraceUrl || (listing.imageUrls && listing.imageUrls[0]);
        
        if (selectedVariation) {
            // Use variation price if available
            finalPrice = selectedVariation.price || selectedVariation.originalPrice || listing.price;
            // Use variation image if available
            finalImageUrl = selectedVariation.photoUrl || selectedVariation.imageUrl || finalImageUrl;
        }

        const buyNowData = {
            listingId: listingId,
            name: listing.name,
            price: finalPrice,
            quantity: quantity,
            selectedVariation: selectedVariation,
            photoTraceUrl: finalImageUrl,
            imageUrls: listing.imageUrls,
            brand: listing.brand,
            category: listing.category,
            uploaderId: listing.uploaderId,
            sellerId: listing.uploaderId
        };
        setCookie('buyNowItem', buyNowData, 1);
        showNotification("Proceeding to checkout!");
        // Optionally animate the Buy Now button if you have a reference
        // animateButton(document.querySelector(`[data-listing-id="${listingId}"] .buy-now-btn`));
        setTimeout(() => {
            window.location.href = "checkout.html?source=buynow";
        }, 500);
    } catch (error) {
        console.error("Error proceeding to checkout:", error);
        showNotification("Failed to proceed to checkout. Please try again.");
    }
}

// Function to render breadcrumb navigation
function renderBreadcrumb() {
  const breadcrumbContainer = document.getElementById('breadcrumb-nav');
  if (!breadcrumbContainer) return;

  let breadcrumbHTML = '<div class="breadcrumb-items">';
  
  // Category level
  breadcrumbHTML += `<span class="breadcrumb-item ${!currentSubcategory ? 'active' : ''}" onclick="resetToCategory()">
    ${escapeHtml(categoryHierarchy[currentCategory]?.label || currentCategory)}
  </span>`;
  
  // Subcategory level
  if (currentSubcategory) {
    breadcrumbHTML += `<i class="fas fa-chevron-right breadcrumb-separator"></i>
    <span class="breadcrumb-item ${!currentBrand ? 'active' : ''}" onclick="resetToSubcategory()">
      ${escapeHtml(categoryHierarchy[currentCategory]?.subcategories[currentSubcategory]?.label || currentSubcategory)}
    </span>`;
  }
  
  // Brand level
  if (currentBrand) {
    breadcrumbHTML += `<i class="fas fa-chevron-right breadcrumb-separator"></i>
    <span class="breadcrumb-item active">${escapeHtml(currentBrand)}</span>`;
  }
  
  breadcrumbHTML += '</div>';
  breadcrumbContainer.innerHTML = breadcrumbHTML;
}

// Store all listings for filter calculations
let allCategoryListings = [];

// Pagination state
const PAGE_SIZE = 24;
let lastVisibleDoc = null;
let hasMoreProducts = true;
let isLoadingMore = false;

// Function to load listings for the current category using Firestore query
async function loadCategoryListings() {
  try {
    // Use Firestore query to filter server-side instead of client-side
    const listingsQuery = query(
      collection(firestore, "Listings"),
      where("category", "==", currentCategory)
    );
    const listingsSnapshot = await getDocs(listingsQuery);
    allCategoryListings = listingsSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error loading category listings:", error);
    allCategoryListings = [];
  }
}

// Function to render subcategory cards - only shows subcategories with products
async function renderSubcategoryCards() {
  const subcategoryContainer = document.getElementById('subcategory-cards');
  if (!subcategoryContainer) return;

  if (currentSubcategory || currentBrand) {
    subcategoryContainer.style.display = 'none';
    return;
  }

  const subcategories = categoryHierarchy[currentCategory]?.subcategories || {};
  if (Object.keys(subcategories).length === 0) {
    subcategoryContainer.style.display = 'none';
    return;
  }

  // Get subcategories that have at least one product
  const subcategoriesWithProducts = Object.keys(subcategories).filter(key => {
    return allCategoryListings.some(listing => listing.subcategory === key);
  });

  if (subcategoriesWithProducts.length === 0) {
    subcategoryContainer.style.display = 'none';
    return;
  }

  // Check localStorage for selected subcategory
  const savedFilters = JSON.parse(localStorage.getItem('categoryFilters') || '{}');
  if (savedFilters[currentCategory]?.subcategory && subcategoriesWithProducts.includes(savedFilters[currentCategory].subcategory)) {
    selectSubcategory(savedFilters[currentCategory].subcategory, false);
    return;
  }

  subcategoryContainer.style.display = 'grid';
  subcategoryContainer.innerHTML = '<h4 class="filter-section-title"><i class="fas fa-layer-group"></i> Subcategories</h4>';

  subcategoriesWithProducts.forEach(key => {
    const subcategory = subcategories[key];
    const productCount = allCategoryListings.filter(listing => listing.subcategory === key).length;
    const card = document.createElement('div');
    card.className = 'filter-card';
    card.innerHTML = `
      <i class="fas fa-folder"></i>
      <p>${escapeHtml(subcategory.label)}</p>
      <span class="filter-count">${parseInt(productCount) || 0}</span>
    `;
    card.onclick = () => selectSubcategory(key);
    subcategoryContainer.appendChild(card);
  });
}

// Function to render brand cards - only shows brands with products
async function renderBrandCards() {
  const brandContainer = document.getElementById('brand-cards');
  if (!brandContainer) return;

  if (currentBrand) {
    brandContainer.style.display = 'none';
    return;
  }

  // Get unique brands from listings in current category/subcategory
  const brandsMap = new Map();
  allCategoryListings.forEach(listing => {
    if (currentSubcategory && listing.subcategory !== currentSubcategory) return;
    if (listing.brand) {
      brandsMap.set(listing.brand, (brandsMap.get(listing.brand) || 0) + 1);
    }
  });

  if (brandsMap.size === 0) {
    brandContainer.style.display = 'none';
    return;
  }

  // Check localStorage for selected brand
  const savedFilters = JSON.parse(localStorage.getItem('categoryFilters') || '{}');
  if (savedFilters[currentCategory]?.brand && brandsMap.has(savedFilters[currentCategory].brand)) {
    selectBrand(savedFilters[currentCategory].brand, false);
    return;
  }

  brandContainer.style.display = 'grid';
  brandContainer.innerHTML = '<h4 class="filter-section-title"><i class="fas fa-tags"></i> Brands</h4>';

  const allBrands = Array.from(brandsMap.entries()).sort((a, b) => b[1] - a[1]);
  const MAX_VISIBLE_BRANDS = 12;
  const visibleBrands = allBrands.slice(0, MAX_VISIBLE_BRANDS);
  const hasMore = allBrands.length > MAX_VISIBLE_BRANDS;
  
  visibleBrands.forEach(([brand, count]) => {
      const card = document.createElement('div');
      card.className = 'filter-card';
      card.innerHTML = `
        <i class="fas fa-tag"></i>
        <p>${escapeHtml(brand)}</p>
        <span class="filter-count">${parseInt(count) || 0}</span>
      `;
      card.onclick = () => selectBrand(brand);
      brandContainer.appendChild(card);
    });
    
  // Add expand button if there are more brands
  if (hasMore) {
    const expandBtn = document.createElement('div');
    expandBtn.className = 'brand-expand-btn';
    expandBtn.innerHTML = `<i class="fas fa-chevron-down"></i> Show ${allBrands.length - MAX_VISIBLE_BRANDS} more`;
    expandBtn.onclick = () => {
      brandContainer.classList.toggle('expanded');
      if (brandContainer.classList.contains('expanded')) {
        expandBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Show less';
        // Add remaining brands
        allBrands.slice(MAX_VISIBLE_BRANDS).forEach(([brand, count]) => {
          const card = document.createElement('div');
          card.className = 'filter-card extra-brand';
          card.innerHTML = `<i class="fas fa-tag"></i><p>${escapeHtml(brand)}</p><span class="filter-count">${parseInt(count) || 0}</span>`;
          card.onclick = () => selectBrand(brand);
          brandContainer.insertBefore(card, expandBtn);
        });
      } else {
        expandBtn.innerHTML = `<i class="fas fa-chevron-down"></i> Show ${allBrands.length - MAX_VISIBLE_BRANDS} more`;
        brandContainer.querySelectorAll('.extra-brand').forEach(el => el.remove());
      }
    };
    brandContainer.appendChild(expandBtn);
  }
}

// Helper function to save filters to localStorage
function saveFiltersToStorage() {
  const savedFilters = JSON.parse(localStorage.getItem('categoryFilters') || '{}');
  savedFilters[currentCategory] = {
    subcategory: currentSubcategory,
    brand: currentBrand
  };
  localStorage.setItem('categoryFilters', JSON.stringify(savedFilters));
}

// Helper function to clear filters from localStorage
function clearFiltersFromStorage() {
  const savedFilters = JSON.parse(localStorage.getItem('categoryFilters') || '{}');
  delete savedFilters[currentCategory];
  localStorage.setItem('categoryFilters', JSON.stringify(savedFilters));
}

// Navigation functions
window.resetToCategory = function() {
  currentSubcategory = null;
  currentBrand = null;
  clearFiltersFromStorage();
  renderBreadcrumb();
  renderSubcategoryCards();
  renderBrandCards();
  loadFeaturedListings();
};

window.resetToSubcategory = function() {
  currentBrand = null;
  saveFiltersToStorage();
  renderBreadcrumb();
  renderBrandCards();
  loadFeaturedListings();
};

function selectSubcategory(subcategory, saveToStorage = true) {
  currentSubcategory = subcategory;
  currentBrand = null;
  if (saveToStorage) saveFiltersToStorage();
  renderBreadcrumb();
  renderSubcategoryCards();
  renderBrandCards();
  loadFeaturedListings();
}

function selectBrand(brand, saveToStorage = true) {
  currentBrand = brand;
  if (saveToStorage) saveFiltersToStorage();
  renderBreadcrumb();
  renderSubcategoryCards();
  renderBrandCards();
  loadFeaturedListings();
}

// Function to load and display filtered listings based on category and filter criteria
const loadFeaturedListings = async (filterCriteria = {}, isInitialLoad = false) => {
  showLoader();
  try {
    const listingsContainer = document.querySelector(".listings-container") || document.getElementById("listings-container");
    const urlParams = new URLSearchParams(window.location.search);
    const category = urlParams.get('category');
    const primeCategory = urlParams.get('prime'); // Check for prime category filter
    
    if (!category && !primeCategory) {
      throw new Error("Category is not defined");
    }
    
    if (!listingsContainer) {
      console.warn('Listings container not found');
      hideLoader();
      return;
    }
    
    currentCategory = category || primeCategory;
    listingsContainer.dataset.category = currentCategory;
    listingsContainer.innerHTML = "";

    // Update category title and description
    const categoryTitle = document.getElementById('category-title');
    const categoryDescription = document.getElementById('category-description');
    
    // Handle prime categories
    if (primeCategory) {
      const primeTitles = {
        generalShop: 'General Shop',
        featured: 'Featured Items',
        bestseller: 'Best Sellers',
        offers: 'Special Offers'
      };
      const primeDescs = {
        generalShop: 'Hand-picked quality items curated by our team',
        featured: 'Hot and trending products you\'ll love',
        bestseller: 'Top rated products by our customers',
        offers: 'Big deals and special discounts'
      };
      categoryTitle.textContent = primeTitles[primeCategory] || primeCategory;
      categoryDescription.textContent = primeDescs[primeCategory] || '';
      
      // Load listings for prime category using Firestore query
      const primeQuery = query(
        collection(firestore, "Listings"),
        where(`primeCategories.${primeCategory}`, "==", true)
      );
      const listingsSnapshot = await getDocs(primeQuery);
      allCategoryListings = listingsSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      categoryTitle.textContent = (categoryHierarchy[category]?.label || category.replace(/-/g, ' ')).toUpperCase();
      categoryDescription.textContent = `Browse the best deals and offers in the ${categoryHierarchy[category]?.label || category.replace(/-/g, ' ')} category.`;
      
      // Load all category listings if this is initial load or not already loaded
      if (isInitialLoad || allCategoryListings.length === 0) {
        await loadCategoryListings();
      }
    }

    // Filter listings based on subcategory and brand from allCategoryListings
    let filteredListings = [...allCategoryListings];
    
    if (currentSubcategory) {
      filteredListings = filteredListings.filter(listing => listing.subcategory === currentSubcategory);
    }
    
    if (currentBrand) {
      filteredListings = filteredListings.filter(listing => listing.brand === currentBrand);
    }

    // Apply additional filter criteria
    if (filterCriteria.orderBy) {
      filteredListings.sort((a, b) => {
        if (filterCriteria.orderDirection === 'desc') {
          return b[filterCriteria.orderBy] - a[filterCriteria.orderBy];
        }
        return a[filterCriteria.orderBy] - b[filterCriteria.orderBy];
      });
    }
    if (filterCriteria.priceRange) {
      const [minPrice, maxPrice] = filterCriteria.priceRange.split('-').map(Number);
      filteredListings = filteredListings.filter(listing => listing.price >= minPrice && listing.price <= maxPrice);
    }

    if (filteredListings.length === 0) {
      listingsContainer.innerHTML = "<p>No listings found in this category.</p>";
      hideLoader();
      return;
    }

    // Batch fetch all unique user IDs first (reduces reads)
    const uniqueUserIds = [...new Set(filteredListings.map(l => l.uploaderId || l.userId).filter(Boolean))];
    const userDataMap = {};
    
    // Fetch all users in parallel using cache
    await Promise.all(uniqueUserIds.map(async (userId) => {
      userDataMap[userId] = await getCachedUser(userId);
    }));

    // Twitter-like verified badge SVG
    const getVerifiedBadge = () => `<svg class="verified-tick" viewBox="0 0 22 22" aria-label="Verified account" role="img"><g><path fill="#1d9bf0" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></g></svg>`;

    for (const listing of filteredListings) {
      const uploaderId = listing.uploaderId || listing.userId;
      const userData = userDataMap[uploaderId] || {};

      const displayName = escapeHtml(userData.name || userData.username || "Unknown User");
      const isVerified = userData.isVerified === true || userData.verified === true;
      const verifiedBadge = isVerified ? getVerifiedBadge() : '';
      const imageUrls = listing.imageUrls || [];
      const firstImageUrl = sanitizeUrl(getImageUrl(imageUrls[0], 'product'));
      const sellerPic = sanitizeUrl(getImageUrl(userData.profilePicUrl, 'profile'));
      const sellerId = escapeHtml(listing.uploaderId || listing.userId);
      
      // Escape all user-provided content
      const safeName = escapeHtml(listing.name);
      const safeDescription = escapeHtml((listing.description || '').substring(0, 100));
      const safeId = escapeHtml(listing.id);
      const safeSubcategory = escapeHtml(listing.subcategory || '');
      const safeBrand = escapeHtml(listing.brand || '');
      const safePackInfo = escapeHtml(listing.packInfo || '');

      const listingElement = document.createElement("div");
      listingElement.className = "listing-item";
      listingElement.innerHTML = `
        <div class="product-item">
          <div class="profile">
            <img src="${sellerPic}" alt="${displayName}" onclick="goToUserProfile('${escapeHtml(uploaderId)}')" loading="lazy" data-fallback="profile">
            <div class="uploader-info">
              <p class="uploader-name"><strong>${displayName}</strong>${verifiedBadge}</p>
              <p class="product-name">${safeName}</p>
              ${safePackInfo ? `<p class="pack-size"><i class="fas fa-box"></i> ${safePackInfo}</p>` : ''}
            </div>
            <div class="product-actions profile-actions">
              <div>
                <i class="fas fa-comments" onclick="goToChat('${sellerId}', '${safeId}')"></i>
                <small>Message</small>
              </div>
              <div>
                <i class="fas fa-share" onclick="shareProduct('${safeId}', '${safeName}', '${safeDescription}', '${firstImageUrl}')"></i>
                <small>Share</small>
              </div>
            </div>
          </div>
          <div class="product-image-container" onclick="goToProduct('${safeId}')">
            <div class="image-slider">
              ${imageUrls.map((url, index) => `
                <img src="${sanitizeUrl(getImageUrl(url, 'product'))}" alt="Product Image" class="product-image" loading="${index === 0 ? 'eager' : 'lazy'}" data-fallback="product">
              `).join('')}
              <div class="product-tags">
                ${safeSubcategory ? `<span class="product-condition">${safeSubcategory}</span>` : ''}
                ${safeBrand ? `<span class="product-brand">${safeBrand}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="product-price">
            ${(() => {
              const priceData = getMinPriceFromVariations(listing);
              const minPrice = priceData.price;
              const retailPrice = priceData.retailPrice;
              const pq = priceData.packQuantity || 0;
              return `
              <div class="price-row">
                <span class="price-label">Your Price:</span>
                <strong class="wholesale-amount">KES ${minPrice.toLocaleString()}</strong>
                ${pq > 1 ? `<span class="wholesale-per-pc">(KES ${Math.ceil(minPrice / pq).toLocaleString()}/pc)</span>` : ''}
              </div>
              ${retailPrice && retailPrice > minPrice ? `
              <div class="price-row retail-row">
                <span class="retail-hint">Est. Retail ~KES ${retailPrice.toLocaleString()}${pq > 1 ? ` (KES ${Math.ceil(retailPrice / pq).toLocaleString()}/pc)` : ''}</span>
                <span class="profit-badge">Save ${Math.round(((retailPrice - minPrice) / retailPrice) * 100)}%</span>
              </div>` : ''}`;
            })()}
          </div>
          <p class="product-description">${escapeHtml(listing.description || 'No description available')}</p>
          <div style="display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:10px;color:#166534;background:#f0fdf4;border-radius:6px;margin:4px 8px;">
            <i class="fas fa-truck" style="color:#16a34a;"></i> Fast delivery in Mombasa
            <span style="margin-left:auto;color:#6b7280;"><i class="fas fa-shield-alt" style="color:#16a34a;"></i> Secure</span>
          </div>
          <div class="product-actions">
            <div>
              <i class="fas fa-cart-plus add-to-cart-btn" data-listing-id="${safeId}"></i>
              <p>Cart</p>
            </div>
            <div>
              <i class="fas fa-bolt buy-now-btn" data-listing-id="${safeId}"></i>
              <p>Buy Now</p>
            </div>
            <div>
              <i class="fas fa-heart wishlist-btn" data-listing-id="${safeId}"></i>
              <p>Wishlist</p>
            </div>
          </div>
        </div>
      `;

      listingsContainer.appendChild(listingElement);
    }

    // Initialize image sliders after content is loaded
    initializeImageSliders();
    
    // Add event listeners for cart, wishlist, and buy now buttons
    document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        addToCart(btn.dataset.listingId, btn);
      });
    });
    
    document.querySelectorAll('.wishlist-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        addToWishlist(btn.dataset.listingId, btn);
      });
    });
    
    document.querySelectorAll('.buy-now-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        buyNow(btn.dataset.listingId, btn);
      });
    });

    hideLoader();

  } catch (error) {
    console.error("Error loading featured listings:", error);
    showNotification("Failed to load listings. Please try again later.", "error");
    hideLoader();
  }
};

// Add product navigation function
window.goToProduct = function(productId) {
  window.location.href = `product.html?id=${productId}`;
};

// Function to change images in the gallery
window.changeImage = function (direction, listingId) {
  const galleryImage = document.getElementById(`galleryImage-${listingId}`);
  const imageUrls = JSON.parse(galleryImage.dataset.imageUrls);
  let currentIndex = imageUrls.indexOf(galleryImage.src);

  currentIndex = (currentIndex + direction + imageUrls.length) % imageUrls.length;
  galleryImage.src = imageUrls[currentIndex];
};

async function addToCart(listingId, buttonElement) {
  const user = auth.currentUser;
  if (user) {
    const listingRef = doc(firestore, `Listings/${listingId}`);
    const snapshot = await getDoc(listingRef);
    const listing = snapshot.data();

    try {
      if (listing.variations && listing.variations.length > 0) {
        showQuantityModal(listingId, listing, true);
      } else {
        await addDoc(collection(firestore, `users/${user.uid}/cart`), {
          userId: user.uid,
          listingId: listingId,
          quantity: 1,
          ...listing,
          addedAt: new Date().toISOString()
        });
        showNotification("Item added to cart!");
        if (buttonElement) {
          animateButton(buttonElement, 'sounds/pop-39222.mp3');
          const cartIcon = document.querySelector('#cart-icon');
          if (cartIcon) {
            animateIconToCart(buttonElement, cartIcon);
          }
        }
        await updateCartCounter(firestore, user.uid);
      }
    } catch (error) {
      showNotification("Failed to add item to cart. Please try again.", "error");
    }
  } else {
    showNotification("Please log in to add items to the cart.", "error");
  }
}

async function addToWishlist(listingId, buttonElement) {
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
      
      if (buttonElement) {
        animateButton(buttonElement, 'sounds/pop-268648.mp3');
        
        const wishlistIcon = document.querySelector('#wishlist-icon');
        if (wishlistIcon) {
          animateIconToCart(buttonElement, wishlistIcon);
        }
      }
      
      await updateWishlistCounter(firestore, user.uid);
    } catch (error) {
      console.error("Error adding item to wishlist:", error);
      showNotification("Failed to add item to wishlist. Please try again.", "error");
    }
  } else {
    showNotification("Please log in to add items to the wishlist.", "error");
  }
}

async function buyNow(listingId, buttonElement) {
  const user = auth.currentUser;
  if (user) {
    const listingRef = doc(firestore, `Listings/${listingId}`);
    const snapshot = await getDoc(listingRef);
    const listing = snapshot.data();

    try {
      showQuantityModal(listingId, listing, false);
    } catch (error) {
      showNotification("Failed to proceed to checkout. Please try again.", "error");
    }
  } else {
    showNotification("Please log in to buy items.", "error");
  }
}

// Function to redirect to chat with seller
window.goToChat = function (sellerId, listingId) {
  const user = auth.currentUser;
  if (user) {
    window.location.href = `chat.html?sellerId=${sellerId}&listingId=${listingId}`;
  } else {
    showNotification("Please log in to message the seller.", "error");
  }
};

// Function to redirect to user profile page
window.goToUserProfile = function(userId) {
  window.location.href = `user.html?userId=${userId}`;
};

// Function to share product
window.shareProduct = function (listingId, name, description, imageUrl) {
  const productUrl = `${window.location.origin}/product.html?id=${encodeURIComponent(listingId)}`;
  if (navigator.share) {
    navigator.share({
      title: name,
      text: description,
      url: productUrl,
    }).then(() => {
      console.log('Thanks for sharing!');
    }).catch(console.error);
  } else {
    navigator.clipboard.writeText(productUrl).then(() => {
      showNotification('Product link copied to clipboard!');
    }).catch(() => {
      showNotification('Unable to copy link', 'error');
    });
  }
};

// Search functionality
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const searchSuggestions = document.getElementById('searchSuggestions');

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Implement rate limiting for search
const rateLimiter = new RateLimiter(10, 1000);

const performSearch = async (searchTerm) => {
  if (!rateLimiter.canProceed()) {
    showNotification('Too many requests. Please try again later.', 'error');
    return;
  }

  if (!searchTerm || searchTerm.length < 2) {
    searchSuggestions.style.display = 'none';
    return;
  }
  try {
    const listingsRef = collection(firestore, "Listings");
    const q = query(
      listingsRef, 
      where("name", ">=", searchTerm.toLowerCase()),
      where("name", "<=", searchTerm.toLowerCase() + '\uf8ff')
    );
    const querySnapshot = await getDocs(q);
    searchSuggestions.innerHTML = '';
    
    if (querySnapshot.empty) {
      searchSuggestions.style.display = 'none';
      return;
    }

    querySnapshot.forEach((doc) => {
      const listing = doc.data();
      const div = document.createElement('div');
      div.className = 'suggestion-item';
      div.innerHTML = `
        <img src="${sanitizeUrl(listing.imageUrls?.[0])}" alt="${escapeHtml(listing.name)}">
        <span>${escapeHtml(listing.name)}</span>
        <span>KES ${(parseFloat(listing.price) || 0).toLocaleString()}</span>
      `;
      div.addEventListener('click', () => {
        window.location.href = `product.html?id=${encodeURIComponent(doc.id)}`;
      });
      searchSuggestions.appendChild(div);
    });
    searchSuggestions.style.display = 'block';
  } catch (error) {
    errorHandler.network(error);
  }
};

const debouncedSearch = debounce((e) => {
  performSearch(e.target.value);
}, 300);

// Load categories dynamically for mega menu
async function loadMegaMenuCategories() {
  const megaMenuGrid = document.getElementById('categoryMegaMenuGrid');
  if (!megaMenuGrid) return;
  
  try {
    // Fetch all listings to get unique categories (using 'Listings' collection with capital L)
    const listingsQuery = query(collection(firestore, 'Listings'));
    const listingsSnapshot = await getDocs(listingsQuery);
    
    // Get unique categories and their counts
    const categoryCounts = {};
    listingsSnapshot.forEach(doc => {
      const listing = doc.data();
      if (listing.category) {
        categoryCounts[listing.category] = (categoryCounts[listing.category] || 0) + 1;
      }
    });
    
    // Sort by count (most popular first)
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
    
    // Helper to get short label
    const getShortLabel = (catName) => {
      const shortMap = {
        'Kitchenware': 'Kitchen',
        'Foodstuffs': 'Food',
        'Pharmaceutical': 'Pharma',
        'Student Centre': 'Student',
        'Baby Products': 'Baby',
        'Service Men': 'Services'
      };
      return shortMap[catName] || catName;
    };
    
    // Render categories
    megaMenuGrid.innerHTML = sortedCategories
      .map(([cat, count]) => {
        const urlSafe = encodeURIComponent(cat);
        return `<a href="category.html?category=${urlSafe}"><i class="fas fa-${escapeHtml(getCategoryIcon(cat))}"></i> ${escapeHtml(getShortLabel(cat))}</a>`;
      }).join('');
      
  } catch (error) {
    console.error('Error loading mega menu categories:', error);
    // Fallback to empty state
    megaMenuGrid.innerHTML = '<p style="text-align:center;color:#999;">Categories unavailable</p>';
  }
}

// Initialize everything when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
  // Show skeleton loaders and progress toast immediately
  const listingsContainer = document.getElementById('listings-container');
  if (listingsContainer) {
    listingsContainer.innerHTML = getSkeletonCards(8);
  }
  showLoader('category');
  updateLoaderMessage('Loading category...', 'folder-open');
  
  // Load display settings (non-blocking)
  loadDisplaySettings();
  
  // Load mega menu categories dynamically
  loadMegaMenuCategories();
  
  // Get category from URL
  const urlParams = new URLSearchParams(window.location.search);
  const category = urlParams.get('category');
  
  if (category) {
    currentCategory = category;
    updateLoaderMessage(`Loading ${category}...`, 'boxes');
    setProgress(20);
    
    // Load all category listings first
    await loadCategoryListings();
    setProgress(50);
    
    // Check localStorage for saved filters
    const savedFilters = JSON.parse(localStorage.getItem('categoryFilters') || '{}');
    if (savedFilters[category]) {
      if (savedFilters[category].subcategory) {
        currentSubcategory = savedFilters[category].subcategory;
      }
      if (savedFilters[category].brand) {
        currentBrand = savedFilters[category].brand;
      }
    }
    
    // Render breadcrumb with restored state
    renderBreadcrumb();
  }
  
  setProgress(70);
  updateLoaderMessage('Loading products...', 'box');
  await loadFeaturedListings({}, true);
  
  setProgress(85);
  updateLoaderMessage('Setting up filters...', 'filter');
  // Render filter cards after listings are loaded
  await renderSubcategoryCards();
  await renderBrandCards();
  
  // Mark container as loaded
  if (listingsContainer) listingsContainer.dataset.loaded = 'true';
  
  setProgress(100);
  hideLoader();
  
  // Initialize lazy loading
  initLazyLoading();

  // Setup search event listeners
  if (searchInput) {
    searchInput.addEventListener('input', debouncedSearch);
  }

  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const searchTerm = searchInput.value;
      window.location.href = `search-results.html?q=${encodeURIComponent(searchTerm)}`;
    });
  }

  // Setup click outside listener for search suggestions
  document.addEventListener('click', (e) => {
    if (searchSuggestions && !searchSuggestions.contains(e.target) && !searchInput.contains(e.target)) {
      searchSuggestions.style.display = 'none';
    }
  });

  // Ensure counters are always available
  if (auth.currentUser) {
    await updateCartCounter(firestore, auth.currentUser.uid);
    await updateWishlistCounter(firestore, auth.currentUser.uid);
    await updateChatCounter(firestore, auth.currentUser.uid);
  }

  // Check if user profile is set up
  const user = auth.currentUser;
  if (user) {
    const userDoc = await getDoc(doc(firestore, "Users", user.uid));
    const userData = userDoc.data();
    if (userData && (!userData.name || !userData.phone)) {
      const profileNotif = document.getElementById('profile-notification');
      if (profileNotif) {
        profileNotif.style.display = 'flex';
      }
    }
  }
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userDoc = await getDoc(doc(firestore, "Users", user.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      if (!userData.name || !userData.phone) {
        const profileNotif = document.getElementById('profile-notification');
        if (profileNotif) {
          profileNotif.style.display = 'flex';
        }
      }
    }
  }
});

// Add filter functionality
const filterForm = document.getElementById('filterForm');
const filterToggleButton = document.getElementById('filterToggleButton');

if (filterToggleButton) {
  filterToggleButton.addEventListener('click', () => {
    if (filterForm.style.display === 'none' || filterForm.style.display === '') {
      filterForm.style.display = 'block';
      filterToggleButton.innerHTML = '<i class="fas fa-times"></i>';
    } else {
      filterForm.style.display = 'none';
      filterToggleButton.innerHTML = '<i class="fas fa-filter"></i>';
    }
  });
}

if (filterForm) {
  filterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const orderBy = document.querySelector('input[name="orderBy"]:checked')?.value;
    const orderDirection = document.querySelector('input[name="orderDirection"]:checked')?.value;
    const priceRange = document.getElementById('priceRange')?.value;
    await loadFeaturedListings({ orderBy, orderDirection, priceRange });
    
    // Close filter after applying
    filterForm.style.display = 'none';
    filterToggleButton.innerHTML = '<i class="fas fa-filter"></i>';
  });
}