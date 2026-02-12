import { getAuth } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc,
    limit,
    orderBy,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from "./js/firebase.js";
import { showNotification } from './notifications.js';
import { animateButton, animateIconToCart, updateCartCounter, updateWishlistCounter, updateChatCounter, invalidateCartCache, invalidateWishlistCache } from './js/utils.js';
import { escapeHtml, sanitizeUrl, validatePrice, validateQuantity } from './js/sanitize.js';
import authModal from './js/authModal.js';

// Simple placeholder for images
const PLACEHOLDERS = {
    product: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"%3E%3Crect fill="%23f5f5f5" width="200" height="200"/%3E%3Cpath fill="%23ddd" d="M100 40c-33.137 0-60 26.863-60 60s26.863 60 60 60 60-26.863 60-60-26.863-60-60-60zm0 10c27.614 0 50 22.386 50 50s-22.386 50-50 50-50-22.386-50-50 22.386-50 50-50z"/%3E%3C/svg%3E',
    user: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle fill="%23e2e8f0" cx="50" cy="50" r="50"/%3E%3Ccircle fill="%2394a3b8" cx="50" cy="40" r="20"/%3E%3Cellipse fill="%2394a3b8" cx="50" cy="85" rx="35" ry="25"/%3E%3C/svg%3E'
};

// Product display settings from admin
let displaySettings = { showStockCount: false, showStockLowOnly: false, lowStockThreshold: 5 };

async function loadDisplaySettings() {
  try {
    const snap = await getDoc(doc(db, 'Settings', 'appSettings'));
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

// Module-level Firestore reference for settings
const db = getFirestore(app);

// Simple function to get image URL without caching
function getImageUrl(src, type = 'product') {
    if (!src || typeof src !== 'string') return PLACEHOLDERS[type] || PLACEHOLDERS.product;
    return src;
}

// Get the minimum price from variations/attributes and its associated retail price
function getMinPriceFromVariations(product) {
    let minPrice = product.price || Infinity;
    let associatedRetail = product.initialPrice || null;
    
    if (product.variations && product.variations.length > 0) {
        product.variations.forEach(variation => {
            if (variation.attributes && variation.attributes.length > 0) {
                variation.attributes.forEach(attr => {
                    if (attr.price && attr.price < minPrice) {
                        minPrice = attr.price;
                        // Prefer retailPack (total retail value of pack) over retailPrice (per-piece retail)
                        associatedRetail = attr.retailPack || attr.retailPrice || null;
                    }
                });
            } else {
                if (variation.price && variation.price < minPrice) {
                    minPrice = variation.price;
                    associatedRetail = variation.retailPack || variation.retailPrice || null;
                }
            }
        });
    }
    
    const finalPrice = minPrice === Infinity ? (product.price || 0) : minPrice;
    // Only return retail if it's actually greater than wholesale (sanity check)
    const finalRetail = (associatedRetail && associatedRetail > finalPrice) ? associatedRetail : (product.initialPrice || null);
    
    return {
        price: finalPrice,
        retailPrice: finalRetail
    };
}

class ProductPage {
    constructor() {
        this.auth = getAuth(app);
        this.db = getFirestore(app);
        this.productId = new URLSearchParams(window.location.search).get('id');
        this.currentImageIndex = 0;
        this.imageUrls = [];
        this.product = null;
        this.seller = null;
        this.selectedVariation = null;
        this.selectedQuantity = 1;

        this.initializeElements();
        this.setupEventListeners();
    }

    initializeElements() {
        // Main elements
        this.mainImage = document.getElementById('mainImage');
        this.thumbnailContainer = document.getElementById('thumbnailContainer');
        this.loadingSpinner = document.getElementById('loadingSpinner');
        this.productContent = document.getElementById('productContent');
        this.errorMessage = document.getElementById('errorMessage');

        // Navigation elements
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.currentImageIndexEl = document.getElementById('currentImageIndex');
        this.totalImagesEl = document.getElementById('totalImages');

        // Product details elements
        this.productNameEl = document.getElementById('productName');
        this.productPriceEl = document.getElementById('productPrice');
        this.initialPriceEl = document.getElementById('initialPrice');
        this.initialPriceContainer = document.getElementById('initialPriceContainer');
        this.discountBadge = document.getElementById('discountBadge');
        this.productDateEl = document.getElementById('productDate');
        this.productDescriptionEl = document.getElementById('productDescription');
        this.productCategoryEl = document.getElementById('productCategory');
        this.productSubcategoryEl = document.getElementById('productSubcategory');
        this.productBrandEl = document.getElementById('productBrand');
        this.productTotalStockEl = document.getElementById('productTotalStock');
        this.productLocationEl = document.getElementById('productLocation');
        this.variationsContainer = document.getElementById('variationsContainer');
        this.bulkPricingContainer = document.getElementById('bulkPricingContainer');

        // Seller elements
        this.sellerImageEl = document.getElementById('sellerImage');
        this.sellerNameEl = document.getElementById('sellerName');

        // Action buttons
        this.buyNowBtn = document.getElementById('buyNowBtn');
        this.addToCartBtn = document.getElementById('addToCartBtn');
        this.wishlistBtn = document.getElementById('wishlistBtn');
        this.compareBtn = document.getElementById('compareBtn');
        this.messageSellerBtn = document.getElementById('messageSellerBtn');
        this.copyLinkBtn = document.getElementById('copyLinkBtn');
    }

    setupEventListeners() {
        this.prevBtn?.addEventListener('click', () => this.navigateImage(-1));
        this.nextBtn?.addEventListener('click', () => this.navigateImage(1));
        this.buyNowBtn?.addEventListener('click', () => this.handleBuyNow());
        this.addToCartBtn?.addEventListener('click', () => this.handleAddToCart());
        this.wishlistBtn?.addEventListener('click', () => this.handleWishlist());
        this.compareBtn?.addEventListener('click', () => this.handleCompare());
        this.messageSellerBtn?.addEventListener('click', () => this.handleMessageSeller());
        this.copyLinkBtn?.addEventListener('click', () => this.handleCopyLink());

        // Touch events for image gallery - using passive listeners for better scroll performance
        this.mainImage?.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
        this.mainImage?.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: true });
        this.mainImage?.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: true });
    }

    async initialize() {
        try {
            if (!this.productId) {
                throw new Error('No product ID provided');
            }

            // Show content immediately
            this.productContent.style.display = 'grid';
            
            await this.loadProduct();
            await this.loadSimilarProducts();
            await this.loadReviews();

            // Set compare button state
            const compareList = JSON.parse(localStorage.getItem('oda_compare') || '[]');
            if (compareList.includes(this.productId) && this.compareBtn) {
                this.compareBtn.classList.add('active');
                this.compareBtn.title = 'In comparison';
            }

            if (this.auth.currentUser) {
                await this.updateCartCounter();
                await this.updateWishlistCounter();
                await this.updateChatCounter();
            }

        } catch (error) {
            console.error('Error initializing product page:', error);
            this.showError(error.message);
        }
    }

    async loadProduct() {
        const docRef = doc(this.db, "Listings", this.productId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            throw new Error('Product not found');
        }

        this.product = docSnap.data();
        
        // Build image URLs array from photo trace, additional images, and variation photos
        this.imageUrls = [];
        
        if (this.product.photoTraceUrl) {
            this.imageUrls.push(this.product.photoTraceUrl);
        }
        
        if (this.product.imageUrls && this.product.imageUrls.length > 0) {
            this.imageUrls.push(...this.product.imageUrls);
        }
        
        if (this.product.variations) {
            this.product.variations.forEach(variation => {
                if (variation.photoUrl) {
                    this.imageUrls.push(variation.photoUrl);
                }
            });
        }
        
        await this.loadSellerInfo(this.product.uploaderId);
        this.displayProduct();
        this.setupImageGallery();
        this.displayVariations();
        this.displayBulkPricing();
        
        // Track product view for recently viewed
        this.trackProductView();
    }

    // Track product view in localStorage for recently viewed page
    trackProductView() {
        try {
            const history = JSON.parse(localStorage.getItem('productViewHistory') || '{}');
            const now = new Date().toISOString();
            
            if (history[this.productId]) {
                // Update existing entry
                history[this.productId].views = (history[this.productId].views || 0) + 1;
                history[this.productId].lastViewed = now;
            } else {
                // Create new entry
                history[this.productId] = {
                    views: 1,
                    lastViewed: now,
                    firstViewed: now,
                    totalTime: 0
                };
            }
            
            localStorage.setItem('productViewHistory', JSON.stringify(history));
            
            // Track time spent on page
            this.viewStartTime = Date.now();
            window.addEventListener('beforeunload', () => this.updateTimeSpent());
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    this.updateTimeSpent();
                }
            });
        } catch (error) {
            console.error('Error tracking product view:', error);
        }
    }

    // Update time spent on product page
    updateTimeSpent() {
        try {
            if (!this.viewStartTime) return;
            
            const timeSpent = Math.round((Date.now() - this.viewStartTime) / 1000); // seconds
            const history = JSON.parse(localStorage.getItem('productViewHistory') || '{}');
            
            if (history[this.productId]) {
                history[this.productId].totalTime = (history[this.productId].totalTime || 0) + timeSpent;
                localStorage.setItem('productViewHistory', JSON.stringify(history));
            }
            
            this.viewStartTime = null; // Prevent duplicate updates
        } catch (error) {
            console.error('Error updating time spent:', error);
        }
    }

    async loadSellerInfo(sellerId) {
        const userDoc = await getDoc(doc(this.db, "Users", sellerId));
        if (userDoc.exists()) {
            this.seller = userDoc.data();
            this.seller.id = sellerId;
            this.displaySellerInfo();
        }
    }

    displayProduct() {
        // Basic info
        this.productNameEl.textContent = this.product.name;
        
        // Get minimum price from variations with its associated retail
        const priceData = getMinPriceFromVariations(this.product);
        const minPrice = priceData.price;
        const retailPrice = priceData.retailPrice;
        const hasVariations = this.product.variations && this.product.variations.length > 0;
        
        // Display price with "From:" prefix if multiple variations exist
        const pricePrefix = hasVariations ? 'From: ' : '';
        this.productPriceEl.textContent = `${pricePrefix}KES ${minPrice.toLocaleString()}`;
        
        // Calculate and display wholesale price per piece
        const cheapestPack = this.getCheapestPackQuantity();
        const pricePerItem = document.getElementById('pricePerItem');
        if (pricePerItem && cheapestPack > 1) {
            const perItemPrice = Math.ceil(minPrice / cheapestPack);
            pricePerItem.textContent = `(KES ${perItemPrice.toLocaleString()}/pc × ${cheapestPack} pcs)`;
            pricePerItem.style.display = 'block';
        } else {
            // Fallback to legacy pieceCount
            const pieceCount = this.product.pieceCount || this.product.piece_count || 1;
            if (pricePerItem && pieceCount > 1) {
                const perItemPrice = Math.ceil(minPrice / pieceCount);
                pricePerItem.textContent = `(KES ${perItemPrice.toLocaleString()}/pc × ${pieceCount} pcs)`;
                pricePerItem.style.display = 'block';
            } else if (pricePerItem) {
                pricePerItem.style.display = 'none';
            }
        }
        
        this.productDescriptionEl.textContent = this.product.description;
        
        // Category with link
        const category = this.product.category || 'N/A';
        this.productCategoryEl.textContent = category;
        const categoryLink = document.getElementById('productCategoryLink');
        if (categoryLink && category !== 'N/A') {
            categoryLink.href = `category.html?category=${encodeURIComponent(category.toLowerCase().replace(/\s+/g, '-'))}`;
        }
        
        // Subcategory with link
        const subcategory = this.product.subcategory || 'N/A';
        this.productSubcategoryEl.textContent = subcategory;
        const subcategoryLink = document.getElementById('productSubcategoryLink');
        if (subcategoryLink && subcategory !== 'N/A') {
            subcategoryLink.href = `category.html?category=${encodeURIComponent(category.toLowerCase().replace(/\s+/g, '-'))}&subcategory=${encodeURIComponent(subcategory.toLowerCase().replace(/\s+/g, '-'))}`;
        }
        
        this.productBrandEl.textContent = this.product.brand || 'Unbranded';
        
        // Conditionally show stock based on admin settings
        const totalStock = parseInt(this.product.totalStock) || 0;
        const stockTag = this.productTotalStockEl?.closest('.info-tag');
        if (shouldShowStock(totalStock)) {
            this.productTotalStockEl.textContent = totalStock;
            if (stockTag) stockTag.style.display = '';
        } else {
            if (stockTag) stockTag.style.display = 'none';
        }
        
        this.productLocationEl.textContent = `${this.seller?.county || ''}${this.seller?.ward ? ', ' + this.seller.ward : ''}`;
        this.productDateEl.textContent = new Date(this.product.createdAt).toLocaleDateString();

        // Show min order quantity if > 1
        const minOrder = parseInt(this.product.minOrderQuantity) || 1;
        const minOrderTag = document.getElementById('minOrderTag');
        const minOrderEl = document.getElementById('productMinOrder');
        if (minOrder > 1 && minOrderTag && minOrderEl) {
            minOrderEl.textContent = minOrder;
            minOrderTag.style.display = '';
        }

        // Show total variation count
        let varCount = 0;
        if (this.product.variations?.length) {
            this.product.variations.forEach(v => {
                varCount += (v.attributes?.length) || 1;
            });
        }
        const varCountTag = document.getElementById('variationCountTag');
        const varCountEl = document.getElementById('productVariationCount');
        if (varCount > 1 && varCountTag && varCountEl) {
            varCountEl.textContent = varCount;
            varCountTag.style.display = '';
        }

        // Handle initial/retail price and discount - use the associated retail for min price option
        const pricingExplainer = document.getElementById('pricingExplainer');
        if (retailPrice && retailPrice > minPrice) {
            this.initialPriceContainer.style.display = 'flex';
            this.initialPriceEl.textContent = `~KES ${retailPrice.toLocaleString()}`;
            
            // Show retail per piece if pack has multiple pieces
            const retailPPEl = document.getElementById('retailPerPiece');
            const cheapestPack = this.getCheapestPackQuantity();
            if (retailPPEl && cheapestPack > 1) {
                const perPc = Math.ceil(retailPrice / cheapestPack);
                retailPPEl.textContent = `(KES ${perPc.toLocaleString()}/pc)`;
                retailPPEl.style.display = 'inline';
            } else if (retailPPEl) {
                retailPPEl.style.display = 'none';
            }
            
            const discount = ((retailPrice - minPrice) / retailPrice * 100).toFixed(0);
            this.discountBadge.textContent = `Save ${discount}%`;
            this.discountBadge.style.display = 'inline-block';
            if (pricingExplainer) pricingExplainer.style.display = 'block';
        } else {
            this.initialPriceContainer.style.display = 'none';
            this.discountBadge.style.display = 'none';
            if (pricingExplainer) pricingExplainer.style.display = 'none';
        }

        this.productContent.style.display = 'grid';
    }

    displayVariations() {
        if (!this.product.variations || this.product.variations.length === 0) {
            this.variationsContainer.style.display = 'none';
            return;
        }

        this.variationsContainer.style.display = 'block';
        const variationsListEl = document.getElementById('variationsList');
        variationsListEl.innerHTML = '';

        let variationIndex = 0;

        const productImg = this.product.imageUrls?.[0] || '';

        this.product.variations.forEach((variation) => {
            // Variation-level image (photoUrls array from bulk upload)
            const varImg = variation.photoUrls?.[0] || variation.photoUrl || '';

            // Handle new structure with attributes array
            if (variation.attributes && variation.attributes.length > 0) {
                variation.attributes.forEach((attr) => {
                    const resolvedPhoto = attr.photoUrl || attr.imageUrl || varImg || productImg;
                    const variationCard = document.createElement('div');
                    variationCard.className = 'variation-card';
                    variationCard.dataset.stock = attr.stock;
                    variationCard.dataset.price = attr.price;
                    variationCard.dataset.retailPrice = attr.retailPrice || '';
                    variationCard.dataset.photoUrl = resolvedPhoto;
                    
                    const safeAttrName = escapeHtml(attr.attr_name || 'Option');
                    const safePhotoUrl = sanitizeUrl(resolvedPhoto, '');
                    const pqty = parseInt(attr.packQuantity) || 0;
                    const pLabel = attr.unitLabel || 'pieces';
                    const attrRetail = parseFloat(attr.retailPrice) || 0;
                    const retailPP = attrRetail && pqty > 1 ? getRetailPerPiece(attrRetail, pqty) : '';
                    const attrStock = parseInt(attr.stock) || 0;
                    variationCard.title = `${safeAttrName}${pqty ? ' • ' + pqty + ' ' + pLabel : ''}${shouldShowStock(attrStock) ? ' • Stock: ' + attrStock : ''} • KES ${(attr.price || 0).toLocaleString()}`;
                    
                    variationCard.innerHTML = `
                        ${safePhotoUrl ? `<img src="${safePhotoUrl}" class="variation-thumb" alt="${safeAttrName}" loading="lazy">` : ''}
                        <div class="variation-header">
                            <h4>${safeAttrName}</h4>
                            ${pqty ? `<p class="variation-pack"><i class="fas fa-cubes"></i> ${pqty} ${escapeHtml(pLabel)} per unit</p>` : ''}
                            <p class="variation-price">KES ${(attr.price || 0).toLocaleString()}${pqty > 1 ? ` <span class="var-per-pc">(KES ${Math.ceil((attr.price || 0) / pqty).toLocaleString()}/pc)</span>` : ''}</p>
                            ${attrRetail ? `<p class="variation-retail">~Retail KES ${attrRetail.toLocaleString()}${retailPP}</p>` : ''}
                        </div>
                    `;
                    variationsListEl.appendChild(variationCard);
                    variationIndex++;
                });
            } else {
                // Handle old structure (single attribute per variation)
                const resolvedPhoto = variation.photoUrl || variation.imageUrl || varImg || productImg;
                const variationCard = document.createElement('div');
                variationCard.className = 'variation-card';
                
                const attrName = variation.attr_name || variation.title || 'Option';
                const stock = variation.stock || 0;
                const price = variation.price || this.product.price;
                const pqty = parseInt(variation.packQuantity) || 0;
                const pLabel = variation.unitLabel || 'pieces';
                
                variationCard.dataset.stock = stock;
                variationCard.dataset.price = price;
                variationCard.dataset.photoUrl = resolvedPhoto;
                
                const safeAttrName = escapeHtml(attrName);
                const safePhotoUrl = sanitizeUrl(resolvedPhoto, '');
                const varRetail = parseFloat(variation.retailPrice || variation.retail) || 0;
                const retailPP = varRetail && pqty > 1 ? getRetailPerPiece(varRetail, pqty) : '';
                variationCard.title = `${safeAttrName}${pqty ? ' • ' + pqty + ' ' + pLabel : ''}${shouldShowStock(stock) ? ' • Stock: ' + stock : ''} • KES ${(price || 0).toLocaleString()}`;
                
                variationCard.innerHTML = `
                    ${safePhotoUrl ? `<img src="${safePhotoUrl}" class="variation-thumb" alt="${safeAttrName}" loading="lazy">` : ''}
                    <div class="variation-header">
                        <h4>${safeAttrName}</h4>
                        ${pqty ? `<p class="variation-pack"><i class="fas fa-cubes"></i> ${pqty} ${escapeHtml(pLabel)} per unit</p>` : ''}
                        <p class="variation-price">KES ${(price || 0).toLocaleString()}${pqty > 1 ? ` <span class="var-per-pc">(KES ${Math.ceil((price || 0) / pqty).toLocaleString()}/pc)</span>` : ''}</p>
                        ${varRetail ? `<p class="variation-retail">~Retail KES ${varRetail.toLocaleString()}${retailPP}</p>` : ''}
                    </div>
                `;
                variationsListEl.appendChild(variationCard);
                variationIndex++;
            }
        });

        // Add click event listeners to variation cards
        document.querySelectorAll('.variation-card').forEach((card, index) => {
            card.addEventListener('click', () => {
                this.selectVariation(index);
            });
        });

        // Auto-select first variation
        this.selectVariation(0);
    }

    getCheapestPackQuantity() {
        let minPrice = Infinity;
        let packQty = 0;
        if (this.product.variations?.length) {
            this.product.variations.forEach(v => {
                if (v.attributes?.length) {
                    v.attributes.forEach(a => {
                        if (a.price && a.price < minPrice) {
                            minPrice = a.price;
                            packQty = parseInt(a.packQuantity) || 0;
                        }
                    });
                } else if (v.price && v.price < minPrice) {
                    minPrice = v.price;
                    packQty = parseInt(v.packQuantity) || 0;
                }
            });
        }
        return packQty;
    }

    selectVariation(index) {
        // Build flat array of all variations (both old and new structure)
        let allVariations = [];
        
        this.product.variations.forEach((variation) => {
            if (variation.attributes && variation.attributes.length > 0) {
                variation.attributes.forEach((attr) => {
                    allVariations.push({
                        ...variation,
                        attr_name: attr.attr_name,
                        stock: attr.stock,
                        piece_count: attr.piece_count,
                        price: attr.price,
                        retailPrice: attr.retailPrice,
                        photoUrl: attr.photoUrl
                    });
                });
            } else {
                allVariations.push(variation);
            }
        });

        this.selectedVariation = allVariations[index];
        
        // Update UI to show selected variation
        document.querySelectorAll('.variation-card').forEach((card, i) => {
            if (i === index) {
                card.classList.add('selected');
            } else {
                card.classList.remove('selected');
            }
        });

        // Update main image if variation has a photo
        if (this.selectedVariation.photoUrl) {
            const photoIndex = this.imageUrls.indexOf(this.selectedVariation.photoUrl);
            if (photoIndex !== -1) {
                this.setMainImage(photoIndex);
            }
        }

        // Update price display with attribute-specific price
        const displayPrice = this.selectedVariation.price || this.product.price;
        this.productPriceEl.textContent = `KES ${displayPrice.toLocaleString()}`;
        
        // Update retail price and discount if available
        const retailPrice = this.selectedVariation.retailPack || this.selectedVariation.retailPrice || this.product.initialPrice;
        const pricingExplainer2 = document.getElementById('pricingExplainer');
        if (retailPrice && retailPrice > displayPrice) {
            this.initialPriceContainer.style.display = 'flex';
            this.initialPriceEl.textContent = `~KES ${retailPrice.toLocaleString()}`;
            const discount = ((retailPrice - displayPrice) / retailPrice * 100).toFixed(0);
            this.discountBadge.textContent = `-${discount}%`;
            this.discountBadge.style.display = 'inline-block';
            if (pricingExplainer2) pricingExplainer2.style.display = 'block';
        } else {
            this.initialPriceContainer.style.display = 'none';
            this.discountBadge.style.display = 'none';
            if (pricingExplainer2) pricingExplainer2.style.display = 'none';
        }
        
        // Reset quantity to 1
        this.selectedQuantity = 1;
        const quantityInput = document.getElementById('quantityInput');
        if (quantityInput) {
            quantityInput.value = 1;
            quantityInput.max = this.selectedVariation.stock;
        }

        showNotification(`Selected: ${this.selectedVariation.attr_name || 'Variation'}`);
    }

    displayBulkPricing() {
        if (!this.product.bulkPricing || this.product.bulkPricing.length === 0) {
            if (this.bulkPricingContainer) this.bulkPricingContainer.style.display = 'none';
            return;
        }

        if (this.bulkPricingContainer) this.bulkPricingContainer.style.display = 'block';
        const bulkListEl = document.getElementById('bulkPricingList');
        if (!bulkListEl) return;
        
        bulkListEl.innerHTML = '';

        this.product.bulkPricing.forEach(tier => {
            // Skip invalid tiers
            if (!tier || tier.price === undefined || tier.price === null) return;
            
            const tierEl = document.createElement('div');
            tierEl.className = 'bulk-tier-item';
            const minQty = tier.min || tier.minQty || 1;
            const maxQty = tier.max || tier.maxQty || '∞';
            const price = Number(tier.price) || 0;
            
            tierEl.innerHTML = `
                <span class="tier-range">${minQty} - ${maxQty} units</span>
                <span class="tier-price">KES ${price.toLocaleString()}/unit</span>
            `;
            bulkListEl.appendChild(tierEl);
        });
    }

    displaySellerInfo() {
        if (this.sellerImageEl && this.sellerNameEl && this.seller) {
            this.sellerImageEl.src = this.seller.profilePicUrl || 'images/default-profile.png';
            this.sellerNameEl.textContent = this.seller.name || 'Unknown Seller';
            this.sellerImageEl.addEventListener('click', () => {
                window.location.href = `user.html?userId=${this.seller.id}`;
            });
            
            // Show verified badge if seller is verified
            const isVerified = this.seller.isVerified === true || this.seller.verified === true;
            const verifiedBadge = document.getElementById('sellerVerifiedBadge');
            if (verifiedBadge) {
                verifiedBadge.style.display = isVerified ? 'inline-flex' : 'none';
            }
        }
    }

    async loadReviews() {
        try {
            const reviewsSection = document.getElementById('reviewsSection');
            const reviewsList = document.getElementById('reviewsList');
            const reviewsEmpty = document.getElementById('reviewsEmpty');
            if (!reviewsSection) return;

            const q = query(
                collection(this.db, 'Reviews'),
                where('listingId', '==', this.productId),
                orderBy('createdAt', 'desc'),
                limit(20)
            );

            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                reviewsSection.style.display = 'block';
                reviewsEmpty.style.display = 'block';
                document.getElementById('reviewsSummary').style.display = 'none';
                return;
            }

            const reviews = [];
            const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            let totalRating = 0;

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                reviews.push(data);
                const r = Math.min(5, Math.max(1, Math.round(data.rating || 0)));
                ratingCounts[r]++;
                totalRating += data.rating || 0;
            });

            const avgRating = (totalRating / reviews.length).toFixed(1);
            const totalCount = reviews.length;

            // Update summary
            document.getElementById('avgRating').textContent = avgRating;
            document.getElementById('totalReviews').textContent = `${totalCount} review${totalCount !== 1 ? 's' : ''}`;

            // Render stars for average
            const avgStars = document.getElementById('avgStars');
            avgStars.innerHTML = this.renderStars(Math.round(parseFloat(avgRating)));

            // Rating bars
            const ratingBars = document.getElementById('ratingBars');
            ratingBars.innerHTML = '';
            for (let i = 5; i >= 1; i--) {
                const count = ratingCounts[i];
                const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
                ratingBars.innerHTML += `
                    <div class="rating-bar-row">
                        <span class="bar-label">${i}</span>
                        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
                        <span class="bar-count">${count}</span>
                    </div>`;
            }

            // Render individual reviews
            reviewsList.innerHTML = '';
            const tagLabels = {
                great_quality: 'Great Quality',
                fast_delivery: 'Fast Delivery',
                good_value: 'Good Value',
                as_described: 'As Described',
                great_packaging: 'Great Packaging',
                responsive_seller: 'Responsive Seller'
            };

            reviews.forEach(review => {
                const initial = (review.userName || 'A').charAt(0).toUpperCase();
                const dateStr = review.createdAt?.toDate ? 
                    review.createdAt.toDate().toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : 
                    'Recently';
                const verifiedBadge = review.verified ? '<span class="verified-purchase"><i class="fas fa-check-circle"></i> Verified</span>' : '';

                const tagsHtml = (review.tags || []).map(tag => 
                    `<span class="review-tag">${escapeHtml(tagLabels[tag] || tag)}</span>`
                ).join('');

                const photosHtml = (review.photos || []).map(url => 
                    `<img src="${escapeHtml(url)}" alt="Review photo" loading="lazy" onclick="window.open('${escapeHtml(url)}','_blank')">`
                ).join('');

                reviewsList.innerHTML += `
                    <div class="review-card">
                        <div class="review-card-header">
                            <div class="review-avatar">${initial}</div>
                            <div class="review-meta">
                                <div class="reviewer-name">${escapeHtml(review.userName || 'Anonymous')}${verifiedBadge}</div>
                                <div class="review-date">${dateStr}</div>
                            </div>
                            <div class="review-stars">${this.renderStars(review.rating || 0)}</div>
                        </div>
                        ${review.review ? `<p class="review-text">${escapeHtml(review.review)}</p>` : ''}
                        ${tagsHtml ? `<div class="review-tags">${tagsHtml}</div>` : ''}
                        ${photosHtml ? `<div class="review-photos">${photosHtml}</div>` : ''}
                    </div>`;
            });

            reviewsSection.style.display = 'block';
            reviewsEmpty.style.display = 'none';

        } catch (error) {
            console.error('Error loading reviews:', error);
        }
    }

    renderStars(rating) {
        let html = '';
        for (let i = 1; i <= 5; i++) {
            html += `<i class="fas fa-star" style="color:${i <= rating ? '#f59e0b' : '#e2e8f0'};"></i>`;
        }
        return html;
    }

    setupImageGallery() {
        if (this.imageUrls.length === 0) {
            this.imageUrls.push('images/product-placeholder.png');
        }

        this.thumbnailContainer.innerHTML = '';
        this.totalImagesEl.textContent = this.imageUrls.length;

        this.imageUrls.forEach((url, index) => {
            const thumbnail = document.createElement('img');
            thumbnail.src = url || PLACEHOLDERS.product;
            thumbnail.classList.add('thumbnail');
            thumbnail.loading = 'lazy';
            thumbnail.onerror = () => { thumbnail.src = PLACEHOLDERS.product; };
            thumbnail.addEventListener('click', () => this.setMainImage(index));
            this.thumbnailContainer.appendChild(thumbnail);
        });

        this.setMainImage(0);
        
        // Add click handler to main image for fullscreen view
        this.mainImage.addEventListener('click', () => this.openFullscreenImage());
        
        // Add error handler for main image
        this.mainImage.onerror = () => { this.mainImage.src = PLACEHOLDERS.product; };
    }

    setMainImage(index) {
        this.currentImageIndex = index;
        this.mainImage.src = this.imageUrls[index] || PLACEHOLDERS.product;
        this.currentImageIndexEl.textContent = index + 1;

        document.querySelectorAll('.thumbnail').forEach((thumb, i) => {
            thumb.classList.toggle('active', i === index);
        });

        this.prevBtn.disabled = index === 0;
        this.nextBtn.disabled = index === this.imageUrls.length - 1;
    }

    navigateImage(direction) {
        const newIndex = this.currentImageIndex + direction;
        if (newIndex >= 0 && newIndex < this.imageUrls.length) {
            this.setMainImage(newIndex);
        }
    }

    async loadSimilarProducts() {
        try {
            const similarProductsContainer = document.getElementById('similarProductsContainer');
            similarProductsContainer.innerHTML = '';

            const allProducts = [];
            
            // First, try to get products from the same subcategory (most similar)
            if (this.product.subcategory) {
                const subcategoryQuery = query(
                    collection(this.db, "Listings"),
                    where("subcategory", "==", this.product.subcategory),
                    limit(20)
                );
                const subcatSnapshot = await getDocs(subcategoryQuery);
                subcatSnapshot.forEach(doc => {
                    if (doc.id !== this.productId) {
                        allProducts.push({ id: doc.id, ...doc.data(), source: 'subcategory' });
                    }
                });
            }
            
            // If not enough, also fetch from same category
            if (allProducts.length < 12 && this.product.category) {
                const categoryQuery = query(
                    collection(this.db, "Listings"),
                    where("category", "==", this.product.category),
                    limit(20)
                );
                const catSnapshot = await getDocs(categoryQuery);
                catSnapshot.forEach(doc => {
                    if (doc.id !== this.productId && !allProducts.some(p => p.id === doc.id)) {
                        allProducts.push({ id: doc.id, ...doc.data(), source: 'category' });
                    }
                });
            }

            // Calculate similarity scores
            const scoredProducts = allProducts.map(product => {
                let score = 0;
                
                // Name similarity (highest priority)
                const nameMatch = this.calculateStringSimilarity(
                    this.product.name.toLowerCase(), 
                    product.name.toLowerCase()
                );
                score += nameMatch * 100;

                // Brand match
                if (product.brand && this.product.brand && 
                    product.brand.toLowerCase() === this.product.brand.toLowerCase()) {
                    score += 50;
                }

                // Subcategory match bonus
                if (product.source === 'subcategory') {
                    score += 30;
                }

                // Category match
                if (product.source === 'category') {
                    score += 20;
                }

                return { ...product, similarityScore: score };
            });

            // Sort by similarity score (descending)
            scoredProducts.sort((a, b) => b.similarityScore - a.similarityScore);

            // Display top 12 similar products
            scoredProducts.slice(0, 12).forEach(product => {
                similarProductsContainer.appendChild(this.createProductCard(product.id, product));
            });

            if (scoredProducts.length === 0) {
                similarProductsContainer.innerHTML = '<p style="text-align: center; color: #666;">No similar products found</p>';
            }

        } catch (error) {
            console.error('Error loading similar products:', error);
        }
    }

    calculateStringSimilarity(str1, str2) {
        // Simple word-based similarity
        const words1 = str1.split(/\s+/);
        const words2 = str2.split(/\s+/);
        
        let matches = 0;
        words1.forEach(word1 => {
            if (words2.some(word2 => word2.includes(word1) || word1.includes(word2))) {
                matches++;
            }
        });

        return matches / Math.max(words1.length, words2.length);
    }

    createProductCard(productId, product) {
        const productCard = document.createElement('div');
        productCard.classList.add('similar-product-card');
        
        const firstImage = product.photoTraceUrl || (product.imageUrls && product.imageUrls[0]) || PLACEHOLDERS.product;
        
        const safeName = escapeHtml(product.name);
        const safeBrand = escapeHtml(product.brand || '');
        const safeId = escapeHtml(productId);

        productCard.innerHTML = `
            <div class="product-link" data-product-id="${safeId}">
                <div class="product-image">
                    <img src="${firstImage}" alt="${safeName}" loading="lazy" onerror="this.src='${PLACEHOLDERS.product}'">
                </div>
                <div class="product-info">
                    <h4 class="product-name">${safeName}</h4>
                    <p class="product-brand">${safeBrand}</p>
                    <p class="product-price">KES ${(product.price || 0).toLocaleString()}</p>
                    ${product.initialPrice ? `<p class="initial-price">KES ${product.initialPrice.toLocaleString()}</p>` : ''}
                </div>
            </div>
        `;
        
        productCard.querySelector('.product-link').addEventListener('click', () => {
            window.location.href = `product.html?id=${encodeURIComponent(productId)}`;
        });
        
        return productCard;
    }

    openFullscreenImage() {
        const modal = document.createElement('div');
        modal.className = 'fullscreen-image-modal';
        modal.innerHTML = `
            <div class="fullscreen-image-content">
                <button class="fullscreen-close-btn">
                    <i class="fas fa-times"></i>
                </button>
                <button class="fullscreen-nav-btn fullscreen-prev" ${this.currentImageIndex === 0 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-left"></i>
                </button>
                <img src="${this.imageUrls[this.currentImageIndex] || PLACEHOLDERS.product}" alt="Fullscreen Product Image" onerror="this.src='${PLACEHOLDERS.product}'">
                <button class="fullscreen-nav-btn fullscreen-next" ${this.currentImageIndex === this.imageUrls.length - 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-right"></i>
                </button>
                <div class="fullscreen-counter">
                    <span>${this.currentImageIndex + 1}</span> / <span>${this.imageUrls.length}</span>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('.fullscreen-close-btn');
        const prevBtn = modal.querySelector('.fullscreen-prev');
        const nextBtn = modal.querySelector('.fullscreen-next');
        const img = modal.querySelector('img');

        let currentIndex = this.currentImageIndex;

        const updateImage = (newIndex) => {
            currentIndex = newIndex;
            img.src = this.imageUrls[currentIndex];
            modal.querySelector('.fullscreen-counter span:first-child').textContent = currentIndex + 1;
            prevBtn.disabled = currentIndex === 0;
            nextBtn.disabled = currentIndex === this.imageUrls.length - 1;
        };

        closeBtn.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        prevBtn.addEventListener('click', () => {
            if (currentIndex > 0) updateImage(currentIndex - 1);
        });

        nextBtn.addEventListener('click', () => {
            if (currentIndex < this.imageUrls.length - 1) updateImage(currentIndex + 1);
        });

        // Keyboard navigation
        const handleKeyPress = (e) => {
            if (e.key === 'Escape') modal.remove();
            if (e.key === 'ArrowLeft' && currentIndex > 0) updateImage(currentIndex - 1);
            if (e.key === 'ArrowRight' && currentIndex < this.imageUrls.length - 1) updateImage(currentIndex + 1);
        };

        document.addEventListener('keydown', handleKeyPress);
        modal.addEventListener('remove', () => {
            document.removeEventListener('keydown', handleKeyPress);
        });
    }

    async handleBuyNow() {
        if (!this.auth.currentUser) {
            this.showLoginPrompt('purchase');
            return;
        }

        if (!this.selectedVariation && this.product.variations && this.product.variations.length > 0) {
            showNotification("Please select a variation first", "warning");
            return;
        }

        // Show quantity modal
        this.showQuantityModal();
    }

    // Show login prompt modal using authModal
    showLoginPrompt(action = 'add') {
        const actionText = action === 'purchase' ? 'complete your purchase' : 'add items to cart';
        
        authModal.show({
            title: action === 'purchase' ? 'Login to Purchase' : 'Login to Add to Cart',
            message: `Sign in or create an account to ${actionText}. It only takes a minute!`,
            icon: action === 'purchase' ? 'fa-credit-card' : 'fa-shopping-cart',
            feature: actionText,
            allowCancel: true,
            cancelRedirect: null // Stay on page
        });
    }

    // Cookie helper functions
    setCookie(name, value, days = 1) {
        const expires = new Date();
        expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};expires=${expires.toUTCString()};path=/`;
    }

    showQuantityModal() {
        const maxStock = this.selectedVariation ? this.selectedVariation.stock : this.product.totalStock;
        const displayPrice = this.selectedVariation?.price || this.product.price;
        const minOrder = this.product.minOrderQuantity || 1;
        
        const modal = document.createElement('div');
        modal.className = 'quantity-modal';
        modal.innerHTML = `
            <div class="quantity-modal-content">
                <h3>Select Quantity</h3>
                <p>Available stock: ${maxStock} units</p>
                ${minOrder > 1 ? `<p style="color: #ff5722; font-size: 12px; margin-top: 4px;"><i class="fas fa-info-circle"></i> Minimum order: ${minOrder} units</p>` : ''}
                <div class="quantity-selector">
                    <button class="qty-btn minus">-</button>
                    <input type="number" id="buyNowQuantity" value="${minOrder}" min="${minOrder}" max="${maxStock}">
                    <button class="qty-btn plus">+</button>
                </div>
                <div class="quantity-total">
                    <p>Total: <span id="quantityTotal">KES ${displayPrice.toLocaleString()}</span></p>
                </div>
                <div class="quantity-actions">
                    <button class="cancel-btn">Cancel</button>
                    <button class="confirm-btn">Proceed to Checkout</button>
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

        const updateTotal = () => {
            const qty = parseInt(quantityInput.value) || 1;
            const total = displayPrice * qty;
            totalEl.textContent = `KES ${total.toLocaleString()}`;
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

        confirmBtn.addEventListener('click', () => {
            const quantity = parseInt(quantityInput.value);
            this.proceedToBuyNowCheckout(quantity);
            modal.remove();
        });

        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    proceedToBuyNowCheckout(quantity) {
        try {
            // Get the correct price from selected variation
            const itemPrice = this.selectedVariation?.price || (this.selectedVariation?.attributes && this.selectedVariation.attributes[0]?.price) || this.product.price;
            
            // Store Buy Now item in cookie
            const buyNowData = {
                listingId: this.productId,
                name: this.product.name,
                price: itemPrice,
                quantity: quantity,
                selectedVariation: this.selectedVariation,
                photoTraceUrl: this.product.photoTraceUrl,
                imageUrls: this.product.imageUrls,
                brand: this.product.brand,
                category: this.product.category
            };

            this.setCookie('buyNowItem', buyNowData, 1);
            
            showNotification("Proceeding to checkout!");
            animateButton(this.buyNowBtn);
            
            window.location.href = "checkout.html?source=buynow";
        } catch (error) {
            console.error("Error proceeding to checkout:", error);
            showNotification("Failed to proceed to checkout. Please try again.");
        }
    }

    async handleAddToCart() {
        if (!this.auth.currentUser) {
            this.showLoginPrompt('add');
            return;
        }

        if (!this.selectedVariation && this.product.variations && this.product.variations.length > 0) {
            showNotification("Please select a variation first", "warning");
            return;
        }

        try {
            const cartItem = {
                userId: this.auth.currentUser.uid,
                listingId: this.productId,
                selectedVariation: this.selectedVariation,
                quantity: 1,
                ...this.product,
                addedAt: new Date().toISOString()
            };

            await addDoc(collection(this.db, `users/${this.auth.currentUser.uid}/cart`), cartItem);
            showNotification("Item added to cart!");
            animateButton(this.addToCartBtn, 'sounds/pop-39222.mp3');
            animateIconToCart(this.addToCartBtn, 'cart-icon');
            invalidateCartCache(); // Invalidate cache for counter updates
            await updateCartCounter(this.db, this.auth.currentUser.uid, true); // Force refresh
        } catch (error) {
            console.error("Error adding item to cart:", error);
            showNotification("Failed to add item to cart. Please try again.");
        }
    }

    async handleWishlist() {
        if (!this.auth.currentUser) {
            showNotification("Please login to add items to wishlist", "warning");
            return;
        }

        try {
            const wishlistItem = {
                userId: this.auth.currentUser.uid,
                listingId: this.productId,
                ...this.product,
                addedAt: new Date().toISOString()
            };

            await addDoc(collection(this.db, `users/${this.auth.currentUser.uid}/wishlist`), wishlistItem);
            showNotification("Item added to wishlist!");
            animateButton(this.wishlistBtn, 'sounds/pop-268648.mp3');
            animateIconToCart(this.wishlistBtn, 'wishlist-icon');
            invalidateWishlistCache(); // Invalidate cache for counter updates
            await updateWishlistCounter(this.db, this.auth.currentUser.uid, true); // Force refresh
        } catch (error) {
            console.error("Error adding item to wishlist:", error);
            showNotification("Failed to add item to wishlist. Please try again.");
        }
    }

    async handleMessageSeller() {
        if (!this.auth.currentUser) {
            showNotification("Please login to message the seller", "warning");
            return;
        }
        window.location.href = `chat.html?sellerId=${this.seller.id}&listingId=${this.productId}`;
    }

    handleCompare() {
        const MAX_COMPARE = 4;
        let list = JSON.parse(localStorage.getItem('oda_compare') || '[]');
        const id = this.productId;

        if (list.includes(id)) {
            // Remove from comparison
            list = list.filter(i => i !== id);
            localStorage.setItem('oda_compare', JSON.stringify(list));
            this.compareBtn.classList.remove('active');
            this.compareBtn.title = 'Compare';
            showNotification('Removed from compare list');
        } else {
            if (list.length >= MAX_COMPARE) {
                showNotification(`Compare list is full (${MAX_COMPARE} max). Remove one first.`, 'warning');
                return;
            }
            list.push(id);
            localStorage.setItem('oda_compare', JSON.stringify(list));
            this.compareBtn.classList.add('active');
            this.compareBtn.title = 'In compare list';
            showNotification(`Product added to compare list (${list.length} of ${MAX_COMPARE})`, 'success');
            // After a short delay, ask if they want to go compare now
            if (list.length >= 2) {
                setTimeout(() => {
                    if (confirm(`You have ${list.length} products to compare. View comparison now?`)) {
                        window.location.href = 'compare.html';
                    }
                }, 800);
            }
        }
        window.dispatchEvent(new Event('compare-updated'));
    }

    async handleCopyLink() {
        const productUrl = `${window.location.origin}/product.html?id=${this.productId}`;
        try {
            await navigator.clipboard.writeText(productUrl);
            showNotification("Product link copied to clipboard!");
        } catch (error) {
            console.error("Error copying link:", error);
            showNotification("Failed to copy link. Please try again.");
        }
    }

    showLoading() {
        // No-op - removed loader for faster perceived performance
    }

    hideLoading() {
        this.productContent.style.display = 'grid';
    }

    showError(message) {
        this.productContent.style.display = 'none';
        this.errorMessage.style.display = 'block';
        this.errorMessage.textContent = message;
    }

    handleTouchStart(e) {
        this.touchStartX = e.touches[0].clientX;
    }

    handleTouchMove(e) {
        if (!this.touchStartX) return;
        
        const touchEndX = e.touches[0].clientX;
        const diff = this.touchStartX - touchEndX;
        
        if (Math.abs(diff) > 50) {
            if (diff > 0) {
                this.navigateImage(1);
            } else {
                this.navigateImage(-1);
            }
            this.touchStartX = null;
        }
    }

    handleTouchEnd() {
        this.touchStartX = null;
    }

    async updateCartCounter() {
        if (!this.auth.currentUser) return;
        await updateCartCounter(this.db, this.auth.currentUser.uid);
    }

    async updateWishlistCounter() {
        if (!this.auth.currentUser) return;
        await updateWishlistCounter(this.db, this.auth.currentUser.uid);
    }

    async updateChatCounter() {
        if (!this.auth.currentUser) return;
        await updateChatCounter(this.db, this.auth.currentUser.uid);
    }
}

// Initialize the product page
document.addEventListener('DOMContentLoaded', () => {
    loadDisplaySettings();
    const productPage = new ProductPage();
    productPage.initialize();
});

// Share functionality
document.addEventListener('DOMContentLoaded', () => {
    const shareButtons = document.querySelectorAll('.share-btn');
    const notification = document.getElementById('notification');

    shareButtons.forEach(button => {
        button.addEventListener('click', () => {
            const productUrl = window.location.href;
            navigator.clipboard.writeText(productUrl).then(() => {
                if (notification) {
                    notification.style.display = 'block';
                    setTimeout(() => {
                        notification.style.display = 'none';
                    }, 3000);
                }

                const platform = button.classList[1];
                let redirectUrl = '';
                switch (platform) {
                    case 'whatsapp':
                        redirectUrl = `https://wa.me/?text=${encodeURIComponent(productUrl)}`;
                        break;
                    case 'telegram':
                        redirectUrl = `https://t.me/share/url?url=${encodeURIComponent(productUrl)}`;
                        break;
                    case 'twitter':
                        redirectUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(productUrl)}`;
                        break;
                    case 'copy':
                        return;
                }
                window.open(redirectUrl, '_blank');
            });
        });
    });
});