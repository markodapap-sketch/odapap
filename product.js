import { getAuth } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc 
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from "./js/firebase.js";
import { showNotification } from './notifications.js';
import { animateButton, animateIconToCart, updateCartCounter, updateWishlistCounter, updateChatCounter } from './js/utils.js';

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
        this.messageSellerBtn = document.getElementById('messageSellerBtn');
        this.copyLinkBtn = document.getElementById('copyLinkBtn');
    }

    setupEventListeners() {
        this.prevBtn?.addEventListener('click', () => this.navigateImage(-1));
        this.nextBtn?.addEventListener('click', () => this.navigateImage(1));
        this.buyNowBtn?.addEventListener('click', () => this.handleBuyNow());
        this.addToCartBtn?.addEventListener('click', () => this.handleAddToCart());
        this.wishlistBtn?.addEventListener('click', () => this.handleWishlist());
        this.messageSellerBtn?.addEventListener('click', () => this.handleMessageSeller());
        this.copyLinkBtn?.addEventListener('click', () => this.handleCopyLink());

        // Touch events for image gallery
        this.mainImage?.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.mainImage?.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        this.mainImage?.addEventListener('touchend', (e) => this.handleTouchEnd(e));
    }

    async initialize() {
        try {
            if (!this.productId) {
                throw new Error('No product ID provided');
            }

            this.showLoading();
            await this.loadProduct();
            await this.loadSimilarProducts();
            if (this.auth.currentUser) {
                await this.updateCartCounter();
                await this.updateWishlistCounter();
                await this.updateChatCounter();
            }
            this.hideLoading();

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
        this.productPriceEl.textContent = `KES ${this.product.price.toLocaleString()}`;
        this.productDescriptionEl.textContent = this.product.description;
        this.productCategoryEl.textContent = this.product.category || 'N/A';
        this.productSubcategoryEl.textContent = this.product.subcategory || 'N/A';
        this.productBrandEl.textContent = this.product.brand || 'N/A';
        this.productTotalStockEl.textContent = this.product.totalStock || 0;
        this.productLocationEl.textContent = `${this.seller?.county || ''}, ${this.seller?.ward || ''}`;
        this.productDateEl.textContent = new Date(this.product.createdAt).toLocaleDateString();

        // Handle initial/retail price and discount
        if (this.product.initialPrice) {
            this.initialPriceContainer.style.display = 'block';
            this.initialPriceEl.textContent = `KES ${this.product.initialPrice.toLocaleString()}`;
            
            const discount = ((this.product.initialPrice - this.product.price) / this.product.initialPrice * 100).toFixed(0);
            this.discountBadge.textContent = `-${discount}%`;
            this.discountBadge.style.display = 'inline-block';
        } else {
            this.initialPriceContainer.style.display = 'none';
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

        this.product.variations.forEach((variation) => {
            // Handle new structure with attributes array
            if (variation.attributes && variation.attributes.length > 0) {
                variation.attributes.forEach((attr) => {
                    const variationCard = document.createElement('div');
                    variationCard.className = 'variation-card';
                    
                    variationCard.innerHTML = `
                        <div class="variation-header">
                            <h4>${variation.title || 'Variation'}</h4>
                            ${attr.photoUrl ? `<img src="${attr.photoUrl}" class="variation-thumb" alt="${attr.attr_name}">` : ''}
                        </div>
                        <div class="variation-details">
                            <p><strong>Type:</strong> ${attr.attr_name}</p>
                            <p><strong>Stock:</strong> ${attr.stock} units</p>
                            <p><strong>Pieces per Unit:</strong> ${attr.piece_count}</p>
                            <p><strong>Total Pieces:</strong> ${attr.stock * attr.piece_count}</p>
                            <p class="variation-price"><strong>Price:</strong> KES ${attr.price.toLocaleString()}/unit</p>
                        </div>
                        <button class="select-variation-btn" data-index="${variationIndex}">
                            Select This Variation
                        </button>
                    `;
                    variationsListEl.appendChild(variationCard);
                    variationIndex++;
                });
            } else {
                // Handle old structure (single attribute per variation)
                const variationCard = document.createElement('div');
                variationCard.className = 'variation-card';
                
                const attrName = variation.attr_name || 'N/A';
                const stock = variation.stock || 0;
                const pieceCount = variation.piece_count || 1;
                const price = variation.price || this.product.price;
                const photoUrl = variation.photoUrl;
                
                variationCard.innerHTML = `
                    <div class="variation-header">
                        <h4>${variation.title || 'Variation'}</h4>
                        ${photoUrl ? `<img src="${photoUrl}" class="variation-thumb" alt="${attrName}">` : ''}
                    </div>
                    <div class="variation-details">
                        <p><strong>Type:</strong> ${attrName}</p>
                        <p><strong>Stock:</strong> ${stock} units</p>
                        <p><strong>Pieces per Unit:</strong> ${pieceCount}</p>
                        <p><strong>Total Pieces:</strong> ${stock * pieceCount}</p>
                        <p class="variation-price"><strong>Price:</strong> KES ${price.toLocaleString()}/unit</p>
                    </div>
                    <button class="select-variation-btn" data-index="${variationIndex}">
                        Select This Variation
                    </button>
                `;
                variationsListEl.appendChild(variationCard);
                variationIndex++;
            }
        });

        // Add event listeners to select buttons
        document.querySelectorAll('.select-variation-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                this.selectVariation(index);
            });
        });

        // Auto-select first variation
        this.selectVariation(0);
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
            this.bulkPricingContainer.style.display = 'none';
            return;
        }

        this.bulkPricingContainer.style.display = 'block';
        const bulkListEl = document.getElementById('bulkPricingList');
        bulkListEl.innerHTML = '';

        this.product.bulkPricing.forEach(tier => {
            const tierEl = document.createElement('div');
            tierEl.className = 'bulk-tier-item';
            tierEl.innerHTML = `
                <span class="tier-range">${tier.min} - ${tier.max || '∞'} units</span>
                <span class="tier-price">KES ${tier.price.toLocaleString()}/unit</span>
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
        }
    }

    setupImageGallery() {
        if (this.imageUrls.length === 0) {
            this.imageUrls.push('images/product-placeholder.png');
        }

        this.thumbnailContainer.innerHTML = '';
        this.totalImagesEl.textContent = this.imageUrls.length;

        this.imageUrls.forEach((url, index) => {
            const thumbnail = document.createElement('img');
            thumbnail.src = url;
            thumbnail.classList.add('thumbnail');
            thumbnail.addEventListener('click', () => this.setMainImage(index));
            this.thumbnailContainer.appendChild(thumbnail);
        });

        this.setMainImage(0);
    }

    setMainImage(index) {
        this.currentImageIndex = index;
        this.mainImage.src = this.imageUrls[index];
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

            // Get all listings
            const allListingsQuery = query(collection(this.db, "Listings"));
            const allListingsSnapshot = await getDocs(allListingsQuery);

            const allProducts = [];
            allListingsSnapshot.forEach(doc => {
                if (doc.id !== this.productId) {
                    allProducts.push({ id: doc.id, ...doc.data() });
                }
            });

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

                // Subcategory match
                if (product.subcategory && this.product.subcategory && 
                    product.subcategory === this.product.subcategory) {
                    score += 30;
                }

                // Category match
                if (product.category && this.product.category && 
                    product.category === this.product.category) {
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
        
        const firstImage = product.photoTraceUrl || 
                          (product.imageUrls && product.imageUrls[0]) || 
                          'images/product-placeholder.png';

        productCard.innerHTML = `
            <div class="product-link" data-product-id="${productId}">
                <div class="product-image">
                    <img src="${firstImage}" alt="${product.name}">
                </div>
                <div class="product-info">
                    <h4 class="product-name">${product.name}</h4>
                    <p class="product-brand">${product.brand || ''}</p>
                    <p class="product-price">KES ${product.price.toLocaleString()}</p>
                    ${product.initialPrice ? `<p class="initial-price">KES ${product.initialPrice.toLocaleString()}</p>` : ''}
                </div>
            </div>
        `;
        
        productCard.querySelector('.product-link').addEventListener('click', () => {
            window.location.href = `product.html?id=${productId}`;
        });
        
        return productCard;
    }

    async handleBuyNow() {
        if (!this.auth.currentUser) {
            showNotification("Please login to purchase items", "warning");
            return;
        }

        if (!this.selectedVariation && this.product.variations && this.product.variations.length > 0) {
            showNotification("Please select a variation first", "warning");
            return;
        }

        // Show quantity modal
        this.showQuantityModal();
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
        
        const modal = document.createElement('div');
        modal.className = 'quantity-modal';
        modal.innerHTML = `
            <div class="quantity-modal-content">
                <h3>Select Quantity</h3>
                <p>Available stock: ${maxStock} units</p>
                <div class="quantity-selector">
                    <button class="qty-btn minus">-</button>
                    <input type="number" id="buyNowQuantity" value="1" min="1" max="${maxStock}">
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
            showNotification("Please login to add items to cart", "warning");
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
            await updateCartCounter(this.db, this.auth.currentUser.uid);
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
            await updateWishlistCounter(this.db, this.auth.currentUser.uid);
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
        this.loadingSpinner.style.display = 'flex';
        this.productContent.style.display = 'none';
        this.errorMessage.style.display = 'none';
    }

    hideLoading() {
        this.loadingSpinner.style.display = 'none';
        this.productContent.style.display = 'grid';
    }

    showError(message) {
        this.loadingSpinner.style.display = 'none';
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