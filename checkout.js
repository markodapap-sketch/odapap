/**
 * Checkout Page Controller - Oda Pap B2B
 * Handles order checkout with M-Pesa payments, shipping calculation,
 * and order creation integrated with Firebase.
 */

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, addDoc, deleteDoc, serverTimestamp, updateDoc, runTransaction } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { app } from './js/firebase.js';
import { showNotification } from './notifications.js';
import { MpesaPaymentManager, normalizePhoneNumber, isValidPhoneNumber, formatPhoneForDisplay, getShippingFee, checkFreeShipping } from './js/mpesa.js';
import { OdaModal } from './js/odaModal.js';
import { setupGlobalImageErrorHandler, getImageUrl } from './js/imageCache.js';
import { escapeHtml, validatePrice, validateQuantity, validateOrder } from './js/sanitize.js';
import authModal from './js/authModal.js';

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Setup global image error handling
setupGlobalImageErrorHandler();

class CheckoutManager {
    constructor() {
        this.user = null;
        this.userData = null;
        this.orderItems = [];
        this.subtotal = 0;
        this.shippingFee = 150; // Default for Mombasa
        this.discount = 0;
        this.total = 0;
        this.paymentMethod = 'mpesa';
        this.orderSource = this.determineOrderSource();
        this.mpesaManager = null;
        this.paymentTimer = null;
        this.paymentTimeRemaining = 300; // 5 minutes
        this.receiptFile = null;
        
        this.initializeElements();
        this.setupEventListeners();
    }

    determineOrderSource() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('source') || 'cart';
    }

    // Cookie helpers
    setCookie(name, value, days = 1) {
        const expires = new Date();
        expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};expires=${expires.toUTCString()};path=/`;
    }

    getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for(let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) {
                try {
                    return JSON.parse(decodeURIComponent(c.substring(nameEQ.length, c.length)));
                } catch(e) {
                    return null;
                }
            }
        }
        return null;
    }

    deleteCookie(name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
    }

    initializeElements() {
        // Loading & Container
        this.loadingSpinner = document.getElementById('loadingSpinner');
        this.checkoutContainer = document.getElementById('checkoutContainer');
        this.emptyCartState = document.getElementById('emptyCartState');
        this.shippingNotice = document.getElementById('shippingNotice');
        
        // Order Summary
        this.orderItemsEl = document.getElementById('orderItems');
        this.itemCountEl = document.getElementById('itemCount');
        this.subtotalEl = document.getElementById('subtotalAmount');
        this.shippingEl = document.getElementById('shippingAmount');
        this.shippingLocationEl = document.getElementById('shippingLocation');
        this.discountRow = document.getElementById('discountRow');
        this.discountEl = document.getElementById('discountAmount');
        this.totalEl = document.getElementById('totalAmount');
        this.btnTotalEl = document.getElementById('btnTotalAmount');
        
        // Delivery Info
        this.buyerNameEl = document.getElementById('buyerName');
        this.buyerPhoneEl = document.getElementById('buyerPhone');
        this.buyerLocationEl = document.getElementById('buyerLocation');
        this.deliveryAddressEl = document.getElementById('deliveryAddress');
        this.displayShippingFeeEl = document.getElementById('displayShippingFee');
        this.shippingNoteEl = document.getElementById('shippingNote');
        
        // Payment
        this.paymentOptions = document.querySelectorAll('.payment-option');
        this.mpesaSection = document.getElementById('mpesaSection');
        this.mpesaPhoneInput = document.getElementById('mpesaPhone');
        this.phoneValidation = document.getElementById('phoneValidation');
        this.orderNotesEl = document.getElementById('orderNotes');
        
        // Action Button
        this.placeOrderBtn = document.getElementById('placeOrderBtn');
        
        // Payment Modal
        this.paymentModal = document.getElementById('paymentModal');
        this.paymentTimerEl = document.getElementById('paymentTimer');
        this.statusIcon = document.getElementById('statusIcon');
        this.statusTitle = document.getElementById('statusTitle');
        this.statusMessage = document.getElementById('statusMessage');
        this.modalPhoneEl = document.getElementById('modalPhone');
        this.paymentStatusArea = document.getElementById('paymentStatusArea');
        this.manualCodeSection = document.getElementById('manualCodeSection');
        this.mpesaCodeInput = document.getElementById('mpesaCode');
        this.verifyCodeBtn = document.getElementById('verifyCodeBtn');
        this.checkStatusSection = document.getElementById('checkStatusSection');
        this.checkStatusBtn = document.getElementById('checkStatusBtn');
        this.uploadReceiptSection = document.getElementById('uploadReceiptSection');
        this.receiptUpload = document.getElementById('receiptUpload');
        this.uploadPreview = document.getElementById('uploadPreview');
        this.previewImage = document.getElementById('previewImage');
        this.submitReceiptBtn = document.getElementById('submitReceiptBtn');
        this.cancelPaymentBtn = document.getElementById('cancelPaymentBtn');
        
        // Success Modal
        this.successModal = document.getElementById('successModal');
        this.orderRefNumber = document.getElementById('orderRefNumber');
        this.paymentMethodDisplay = document.getElementById('paymentMethodDisplay');
        
        // Progress Steps
        this.progressSteps = document.querySelectorAll('.progress-step');
    }

    setupEventListeners() {
        // Payment method selection
        this.paymentOptions.forEach(option => {
            option.addEventListener('click', () => {
                // Check if option is disabled
                if (option.classList.contains('disabled')) return;
                
                this.paymentOptions.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                const radio = option.querySelector('input[type="radio"]');
                radio.checked = true;
                this.paymentMethod = radio.value;
                
                // Toggle M-Pesa section
                if (this.mpesaSection) {
                    this.mpesaSection.style.display = this.paymentMethod === 'mpesa' ? 'block' : 'none';
                }
                
                // Toggle wallet notice
                this.updateWalletNotice();
            });
        });

        // Phone input validation with real-time feedback
        if (this.mpesaPhoneInput) {
            this.mpesaPhoneInput.addEventListener('input', (e) => {
                this.validatePhoneInput(e.target.value);
            });
            
            this.mpesaPhoneInput.addEventListener('blur', (e) => {
                this.validatePhoneInput(e.target.value, true);
            });
        }

        // Place order button
        if (this.placeOrderBtn) {
            this.placeOrderBtn.addEventListener('click', () => this.handlePlaceOrder());
        }

        // Cancel payment
        if (this.cancelPaymentBtn) {
            this.cancelPaymentBtn.addEventListener('click', () => this.cancelPayment());
        }

        // Verify manual code
        if (this.verifyCodeBtn) {
            this.verifyCodeBtn.addEventListener('click', () => this.verifyManualCode());
        }

        // Check payment status button
        if (this.checkStatusBtn) {
            this.checkStatusBtn.addEventListener('click', () => this.checkPaymentStatusManual());
        }

        // M-Pesa code input - auto uppercase
        if (this.mpesaCodeInput) {
            this.mpesaCodeInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.toUpperCase();
            });
        }

        // Receipt upload
        if (this.receiptUpload) {
            this.receiptUpload.addEventListener('change', (e) => this.handleReceiptUpload(e));
        }

        if (this.submitReceiptBtn) {
            this.submitReceiptBtn.addEventListener('click', () => this.submitReceiptForVerification());
        }
    }

    validatePhoneInput(value, showError = false) {
        const normalized = normalizePhoneNumber(value);
        
        if (!value.trim()) {
            this.phoneValidation.innerHTML = '';
            this.phoneValidation.className = 'phone-validation';
            return;
        }
        
        if (normalized && isValidPhoneNumber(value)) {
            this.phoneValidation.innerHTML = `<i class="fas fa-check-circle"></i> Valid: ${formatPhoneForDisplay(value)}`;
            this.phoneValidation.className = 'phone-validation valid';
        } else if (showError) {
            this.phoneValidation.innerHTML = `<i class="fas fa-times-circle"></i> Invalid phone number format`;
            this.phoneValidation.className = 'phone-validation invalid';
        }
    }

    async initialize() {
        try {
            this.showLoading();
            
            onAuthStateChanged(auth, async (user) => {
                if (!user) {
                    // Show login modal with cart as fallback
                    authModal.show({
                        title: 'Login to Checkout',
                        message: 'Please sign in to complete your purchase',
                        icon: 'fa-credit-card',
                        feature: 'checkout',
                        allowCancel: true,
                        cancelRedirect: 'cart.html'
                    });
                    return;
                }

                this.user = user;
                
                // Initialize M-Pesa manager
                this.mpesaManager = new MpesaPaymentManager({
                    userId: user.uid,
                    onStatusChange: (status, message) => this.handlePaymentStatusChange(status, message),
                    onPaymentComplete: (data) => this.handlePaymentComplete(data),
                    onPaymentFailed: (data) => this.handlePaymentFailed(data),
                    onError: (error) => console.error('M-Pesa Error:', error)
                });
                
                await this.loadUserInfo();
                await this.loadOrderItems();
                this.hideLoading();
            });
        } catch (error) {
            console.error('Error initializing checkout:', error);
            showNotification('Error loading checkout page', 'error');
        }
    }

    async loadUserInfo() {
        try {
            const userDoc = await getDoc(doc(db, "Users", this.user.uid));
            if (userDoc.exists()) {
                this.userData = userDoc.data();
                
                // Store wallet balance
                this.walletBalance = this.userData.walletBalance || 0;
                
                // Update wallet balance display
                const walletBalanceDisplay = document.getElementById('walletBalanceDisplay');
                if (walletBalanceDisplay) {
                    walletBalanceDisplay.textContent = `KES ${this.walletBalance.toLocaleString()}`;
                }
                
                this.buyerNameEl.textContent = this.userData.name || 'Not set';
                // Support both 'phone' and 'phoneNumber' field names
                const userPhone = this.userData.phone || this.userData.phoneNumber || '';
                this.buyerPhoneEl.textContent = userPhone || 'Not set';
                
                const county = this.userData.county || '';
                const subcounty = this.userData.subcounty || this.userData.constituency || '';
                const ward = this.userData.ward || '';
                
                this.buyerLocationEl.textContent = [county, subcounty, ward].filter(Boolean).join(', ') || 'Not set';
                
                // Check if user's county is in enabled delivery areas
                await this.checkDeliveryArea(county);
                
                // Pre-fill saved delivery address if available
                if (this.userData.deliveryAddress && this.deliveryAddressEl) {
                    this.deliveryAddressEl.value = this.userData.deliveryAddress;
                }

                // Pre-fill M-Pesa phone with user's phone (support both field names)
                if (userPhone && this.mpesaPhoneInput) {
                    // Convert to local format for display
                    const normalized = normalizePhoneNumber(userPhone);
                    if (normalized) {
                        // Show without 254 prefix for better UX
                        this.mpesaPhoneInput.value = normalized.substring(3);
                        this.validatePhoneInput(normalized);
                    } else {
                        this.mpesaPhoneInput.value = userPhone.replace(/^254/, '').replace(/^\+254/, '');
                    }
                }
                
                // Calculate shipping fee based on location
                await this.calculateShippingFee(county, subcounty, ward);
            }
        } catch (error) {
            console.error('Error loading user info:', error);
        }
    }

    async checkDeliveryArea(county) {
        try {
            const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js');
            const settingsDoc = await getDoc(doc(db, "Settings", "deliveryAreas"));
            
            let enabledAreas = ['Mombasa']; // Default to Mombasa
            if (settingsDoc.exists()) {
                enabledAreas = settingsDoc.data().enabledCounties || ['Mombasa'];
            }
            
            // Check if user's county is in enabled areas (case-insensitive)
            const isInDeliveryArea = enabledAreas.some(area => 
                county.toLowerCase().includes(area.toLowerCase()) || 
                area.toLowerCase().includes(county.toLowerCase())
            );
            
            if (!isInDeliveryArea && county) {
                this.shippingNotice.style.display = 'flex';
                // Update notice message
                const noticeText = this.shippingNotice.querySelector('p');
                if (noticeText) {
                    const areasList = enabledAreas.join(', ');
                    noticeText.innerHTML = `We currently deliver to <strong>${areasList}</strong> only. Your location (${county}) is outside our delivery area. Please update your profile location.`;
                }
            } else {
                this.shippingNotice.style.display = 'none';
            }
        } catch (error) {
            console.error('Error checking delivery area:', error);
            // Fallback to old behavior
            if (!county.toLowerCase().includes('mombasa')) {
                this.shippingNotice.style.display = 'flex';
            }
        }
    }

    async calculateShippingFee(county, subcounty, ward) {
        try {
            const fee = await getShippingFee(county, subcounty, ward);
            this.baseShippingFee = fee; // Store base fee before free shipping check
            this.shippingFee = fee;
            
            // Check free shipping threshold from Firestore
            try {
                const isFree = await checkFreeShipping(this.subtotal || 0);
                if (isFree) {
                    this.shippingFee = 0;
                }
            } catch {}
            
            this.updateShippingUI(county, subcounty);
            this.updatePriceDisplay();
        } catch (error) {
            console.error('Error calculating shipping fee:', error);
            this.baseShippingFee = 150;
            this.shippingFee = 150;
            this.updatePriceDisplay();
        }
    }

    updateShippingUI(county, subcounty) {
        if (this.displayShippingFeeEl) {
            if (this.shippingFee === 0 && this.baseShippingFee > 0) {
                this.displayShippingFeeEl.innerHTML = `<span style="text-decoration:line-through;color:#9ca3af;">KES ${this.baseShippingFee.toLocaleString()}</span> <span style="color:#16a34a;font-weight:700;">FREE</span>`;
            } else {
                this.displayShippingFeeEl.textContent = `KES ${this.shippingFee.toLocaleString()}`;
            }
        }
        
        if (this.shippingLocationEl) {
            this.shippingLocationEl.textContent = subcounty ? `(${subcounty})` : '';
        }
        
        if (this.shippingNoteEl) {
            if (this.shippingFee === 0) {
                this.shippingNoteEl.innerHTML = `<span style="color:#16a34a;">🎉 Free delivery — order is over the free shipping threshold!</span>`;
            } else if (county && county.toLowerCase().includes('mombasa')) {
                this.shippingNoteEl.textContent = `Delivery within ${subcounty || 'Mombasa'}`;
            } else {
                this.shippingNoteEl.textContent = 'Delivery fee may vary';
            }
        }
    }

    async loadOrderItems() {
        try {
            this.orderItems = [];
            this.subtotal = 0;

            if (this.orderSource === 'buynow') {
                const buyNowData = this.getCookie('buyNowItem');
                
                if (!buyNowData) {
                    showNotification('No item found for checkout', 'warning');
                    window.location.href = 'index.html';
                    return;
                }

                // SECURITY: Verify price from Firebase to prevent manipulation
                const listingDoc = await getDoc(doc(db, 'Listings', buyNowData.listingId));
                if (!listingDoc.exists()) {
                    showNotification('Product not found', 'error');
                    window.location.href = 'index.html';
                    return;
                }
                
                const listingData = listingDoc.data();
                const sellerId = listingData.uploaderId;
                
                // Get verified price from listing/variation
                let verifiedPrice = listingData.price;
                if (buyNowData.selectedVariation) {
                    // Find the matching variation and get its price
                    const variation = listingData.variations?.find(v => 
                        v.name === buyNowData.selectedVariation?.name || 
                        v.id === buyNowData.selectedVariation?.id
                    );
                    if (variation) {
                        verifiedPrice = variation.price || 
                            (variation.attributes?.[0]?.price) || 
                            listingData.price;
                    }
                }
                
                // Validate price
                if (!validatePrice(verifiedPrice)) {
                    showNotification('Invalid product price', 'error');
                    return;
                }

                const itemData = {
                    listingId: buyNowData.listingId,
                    name: listingData.name, // Use name from Firebase
                    price: verifiedPrice, // Use verified price from Firebase
                    quantity: validateQuantity(buyNowData.quantity) || 1,
                    selectedVariation: buyNowData.selectedVariation || null,
                    imageUrl: listingData.photoTraceUrl || listingData.imageUrls?.[0] || 'images/placeholder.png',
                    totalPrice: verifiedPrice * (validateQuantity(buyNowData.quantity) || 1),
                    sellerId: sellerId,
                    minOrderQuantity: listingData.minOrderQuantity || 1
                };
                
                this.orderItems.push(itemData);
                this.subtotal += itemData.totalPrice;

            } else {
                // Load from cart collection
                const cartSnapshot = await getDocs(collection(db, `users/${this.user.uid}/cart`));
                
                if (cartSnapshot.empty) {
                    this.showEmptyCart();
                    return;
                }

                for (const docSnap of cartSnapshot.docs) {
                    const item = docSnap.data();
                    
                    // SECURITY: Verify price from Firebase to prevent manipulation
                    const listingDoc = await getDoc(doc(db, 'Listings', item.listingId));
                    if (!listingDoc.exists()) {
                        // Product no longer exists - skip it
                        console.log(`Product ${item.listingId} not found - skipping`);
                        continue;
                    }
                    
                    const listingData = listingDoc.data();
                    const sellerId = listingData.uploaderId;
                    
                    // Get verified price from listing/variation
                    let verifiedPrice = listingData.price;
                    if (item.selectedVariation) {
                        const variation = listingData.variations?.find(v => 
                            v.name === item.selectedVariation?.name || 
                            v.id === item.selectedVariation?.id
                        );
                        if (variation) {
                            verifiedPrice = variation.price || 
                                (variation.attributes?.[0]?.price) || 
                                listingData.price;
                        }
                    }
                    
                    // Check if product is out of stock
                    const availableStock = listingData.totalStock || 0;
                    if (availableStock < 1) {
                        showNotification(`${listingData.name} is out of stock`, 'warning');
                        continue;
                    }
                    
                    const quantity = Math.min(
                        validateQuantity(item.quantity) || 1,
                        availableStock // Don't exceed available stock
                    );
                    
                    const itemData = {
                        docId: docSnap.id,
                        listingId: item.listingId,
                        name: listingData.name, // Use name from Firebase
                        price: verifiedPrice, // Use verified price from Firebase
                        quantity: quantity,
                        selectedVariation: item.selectedVariation || null,
                        imageUrl: listingData.photoTraceUrl || listingData.imageUrls?.[0] || 'images/placeholder.png',
                        totalPrice: verifiedPrice * quantity,
                        sellerId: sellerId,
                        minOrderQuantity: listingData.minOrderQuantity || 1
                    };
                    
                    this.orderItems.push(itemData);
                    this.subtotal += itemData.totalPrice;
                }
            }

            if (this.orderItems.length === 0) {
                this.showEmptyCart();
                return;
            }

            this.displayOrderItems();
            this.updatePriceDisplay();
            this.updateProgressStep(1);
            
        } catch (error) {
            console.error('Error loading order items:', error);
            showNotification('Error loading order items', 'error');
        }
    }

    showEmptyCart() {
        this.hideLoading();
        if (this.checkoutContainer) this.checkoutContainer.style.display = 'none';
        if (this.emptyCartState) this.emptyCartState.style.display = 'block';
        if (document.querySelector('.checkout-progress')) {
            document.querySelector('.checkout-progress').style.display = 'none';
        }
    }

    displayOrderItems() {
        if (!this.orderItemsEl) return;
        
        this.orderItemsEl.innerHTML = '';

        this.orderItems.forEach(item => {
            const minQty = item.minOrderQuantity || 1;
            const qtyBelowMin = item.quantity < minQty;
            
            const itemEl = document.createElement('div');
            itemEl.className = 'order-item';
            if (qtyBelowMin) itemEl.classList.add('qty-warning');
            
            itemEl.innerHTML = `
                <img src="${item.imageUrl}" alt="${escapeHtml(item.name)}" class="order-item-image" onerror="this.src='images/placeholder.png'">
                <div class="order-item-details">
                    <h4>${escapeHtml(item.name)}</h4>
                    <p class="item-meta">Qty: ${item.quantity}</p>
                    ${minQty > 1 ? `<p class="min-order-note" style="font-size: 0.75rem; color: ${qtyBelowMin ? '#e74c3c' : 'var(--text-muted)'};">Min order: ${minQty} units</p>` : ''}
                    ${item.selectedVariation ? `
                        <span class="item-variation">
                            ${escapeHtml(item.selectedVariation.title || '')}: ${escapeHtml(item.selectedVariation.attr_name || '')}
                        </span>
                    ` : ''}
                </div>
                <div class="order-item-price">
                    <p class="unit-price">KES ${item.price.toLocaleString()} × ${item.quantity}</p>
                    <p class="total-price">KES ${item.totalPrice.toLocaleString()}</p>
                </div>
            `;
            this.orderItemsEl.appendChild(itemEl);
        });

        // Update item count
        if (this.itemCountEl) {
            const totalItems = this.orderItems.reduce((sum, item) => sum + item.quantity, 0);
            this.itemCountEl.textContent = `${totalItems} item${totalItems !== 1 ? 's' : ''}`;
        }
    }

    updatePriceDisplay() {
        // Re-check free shipping when subtotal changes
        if (this.baseShippingFee && this.subtotal > 0) {
            checkFreeShipping(this.subtotal).then(isFree => {
                if (isFree && this.shippingFee !== 0) {
                    this.shippingFee = 0;
                    this.updateShippingUI(this.userData?.county, this.userData?.subcounty);
                    this.renderPriceValues();
                } else if (!isFree && this.shippingFee === 0 && this.baseShippingFee > 0) {
                    this.shippingFee = this.baseShippingFee;
                    this.updateShippingUI(this.userData?.county, this.userData?.subcounty);
                    this.renderPriceValues();
                }
            }).catch(() => {});
        }
        
        this.renderPriceValues();
    }

    renderPriceValues() {
        this.total = this.subtotal + this.shippingFee - this.discount;
        
        if (this.subtotalEl) this.subtotalEl.textContent = `KES ${this.subtotal.toLocaleString()}`;
        if (this.shippingEl) {
            if (this.shippingFee === 0 && this.baseShippingFee > 0) {
                this.shippingEl.innerHTML = `<span style="color:#16a34a;font-weight:600;">FREE</span>`;
            } else {
                this.shippingEl.textContent = `KES ${this.shippingFee.toLocaleString()}`;
            }
        }
        if (this.totalEl) this.totalEl.textContent = `KES ${this.total.toLocaleString()}`;
        if (this.btnTotalEl) this.btnTotalEl.textContent = `KES ${this.total.toLocaleString()}`;
        
        if (this.discount > 0 && this.discountRow) {
            this.discountRow.style.display = 'flex';
            if (this.discountEl) this.discountEl.textContent = `- KES ${this.discount.toLocaleString()}`;
        }
        
        // Update wallet notice after total is calculated
        this.updateWalletNotice();
    }

    // Check and display wallet notice if balance insufficient
    updateWalletNotice() {
        const walletNotice = document.getElementById('walletNotice');
        const walletOption = document.querySelector('[data-method="wallet"]');
        
        if (!walletNotice || !walletOption) return;
        
        const walletBalance = this.walletBalance || 0;
        const insufficientBalance = walletBalance < this.total;
        
        if (this.paymentMethod === 'wallet' && insufficientBalance) {
            walletNotice.style.display = 'block';
        } else {
            walletNotice.style.display = 'none';
        }
        
        // Update wallet option disabled state
        if (insufficientBalance && walletBalance === 0) {
            walletOption.classList.add('disabled');
            walletOption.querySelector('.option-details span').textContent = 'Balance: KES 0 - Top up required';
        } else if (insufficientBalance) {
            walletOption.querySelector('.option-details span').innerHTML = 
                `Balance: <span style="color: #d97706;">KES ${walletBalance.toLocaleString()}</span> <small>(insufficient)</small>`;
        } else {
            walletOption.classList.remove('disabled');
            walletOption.querySelector('.option-details span').textContent = `Balance: KES ${walletBalance.toLocaleString()}`;
        }
    }

    updateProgressStep(step) {
        this.progressSteps.forEach((stepEl, index) => {
            if (index + 1 < step) {
                stepEl.classList.add('completed');
                stepEl.classList.remove('active');
            } else if (index + 1 === step) {
                stepEl.classList.add('active');
                stepEl.classList.remove('completed');
            } else {
                stepEl.classList.remove('active', 'completed');
            }
        });
    }

    async handlePlaceOrder() {
        try {
            // Validate minimum order quantities
            const invalidItems = this.orderItems.filter(item => {
                const minQty = item.minOrderQuantity || 1;
                return item.quantity < minQty;
            });

            if (invalidItems.length > 0) {
                const itemNames = invalidItems.map(item => 
                    `${item.name} (min: ${item.minOrderQuantity})`
                ).join(', ');
                showNotification(`Minimum order quantity not met for: ${itemNames}`, 'warning');
                return;
            }

            // Validate inputs
            if (!this.deliveryAddressEl.value.trim()) {
                showNotification('Please enter your delivery address', 'warning');
                this.deliveryAddressEl.focus();
                return;
            }

            // Store delivery address before async payment (in case element value is lost)
            this.savedDeliveryAddress = this.deliveryAddressEl.value.trim();

            this.updateProgressStep(2);

            if (this.paymentMethod === 'mpesa') {
                // Validate phone number
                const phoneValue = this.mpesaPhoneInput.value.trim();
                const normalizedPhone = normalizePhoneNumber(phoneValue);
                
                if (!normalizedPhone || !isValidPhoneNumber(phoneValue)) {
                    showNotification('Please enter a valid M-Pesa phone number', 'warning');
                    this.mpesaPhoneInput.focus();
                    return;
                }

                this.updateProgressStep(3);
                this.showPaymentModal(normalizedPhone);
                await this.initiateMpesaPayment(normalizedPhone);
            } else if (this.paymentMethod === 'wallet') {
                // Wallet payment - deduct from balance
                if (this.walletBalance < this.total) {
                    showNotification('Insufficient wallet balance. Please top up or choose another payment method.', 'warning');
                    return;
                }
                
                this.setButtonLoading(true);
                await this.processWalletPayment();
            } else {
                // Pay on delivery - create order directly
                await this.createOrder('pay_on_delivery', null);
            }
        } catch (error) {
            console.error('Error placing order:', error);
            showNotification('Error placing order. Please try again.', 'error');
            this.setButtonLoading(false);
        }
    }

    showPaymentModal(phone) {
        if (this.paymentModal) {
            this.paymentModal.classList.add('active');
            if (this.modalPhoneEl) {
                this.modalPhoneEl.textContent = formatPhoneForDisplay(phone);
            }
            this.startPaymentTimer();
        }
    }

    startPaymentTimer() {
        this.paymentTimeRemaining = 300;
        this.updateTimerDisplay();

        this.paymentTimer = setInterval(() => {
            this.paymentTimeRemaining--;
            this.updateTimerDisplay();

            // Show check status button after 30 seconds
            if (this.paymentTimeRemaining === 270 && this.checkStatusSection) {
                this.checkStatusSection.style.display = 'block';
            }

            // Show manual code entry after 1 minute
            if (this.paymentTimeRemaining === 240 && this.manualCodeSection) {
                this.manualCodeSection.style.display = 'block';
            }

            // Show upload receipt option after 2 minutes
            if (this.paymentTimeRemaining === 180 && this.uploadReceiptSection) {
                this.uploadReceiptSection.style.display = 'block';
            }

            if (this.paymentTimeRemaining <= 0) {
                this.handlePaymentTimeout();
            }
        }, 1000);
    }

    updateTimerDisplay() {
        const minutes = Math.floor(this.paymentTimeRemaining / 60);
        const seconds = this.paymentTimeRemaining % 60;
        if (this.paymentTimerEl) {
            this.paymentTimerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    async initiateMpesaPayment(phone) {
        try {
            this.setPaymentStatus('initiating', 'Sending payment request...');
            
            const result = await this.mpesaManager.initiatePayment({
                phoneNumber: phone,
                amount: this.total,
                accountReference: `ORD-${Date.now()}`,
                description: `Oda Pap Order Payment`,
                metadata: {
                    orderSource: this.orderSource,
                    itemCount: this.orderItems.length
                }
            });
            
            if (result.success) {
                this.currentTransactionId = result.transactionId;
                this.setPaymentStatus('stk_sent', 'Check your phone for the M-Pesa prompt');
            }
        } catch (error) {
            console.error('Error initiating M-Pesa:', error);
            this.setPaymentStatus('error', error.message || 'Failed to initiate payment');
            
            // Show manual entry options
            if (this.manualCodeSection) this.manualCodeSection.style.display = 'block';
            if (this.uploadReceiptSection) this.uploadReceiptSection.style.display = 'block';
        }
    }

    handlePaymentStatusChange(status, message) {
        this.setPaymentStatus(status, message);
    }

    setPaymentStatus(status, message) {
        if (this.statusTitle) {
            const titles = {
                'initiating': 'Initiating Payment...',
                'stk_sent': 'Enter Your PIN',
                'waiting': 'Waiting for Payment',
                'verifying': 'Verifying Payment...',
                'completed': 'Payment Successful!',
                'failed': 'Payment Failed',
                'timeout': 'Payment Timeout',
                'error': 'Payment Error',
                'pending_verification': 'Pending Verification'
            };
            this.statusTitle.textContent = titles[status] || 'Processing...';
        }
        
        if (this.statusMessage) {
            this.statusMessage.textContent = message;
        }
        
        // Update status icon
        if (this.statusIcon) {
            this.statusIcon.className = 'status-icon';
            if (status === 'completed') {
                this.statusIcon.classList.add('success');
                this.statusIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
            } else if (status === 'failed' || status === 'error') {
                this.statusIcon.classList.add('error');
                this.statusIcon.innerHTML = '<i class="fas fa-times-circle"></i>';
            } else {
                this.statusIcon.innerHTML = '<div class="pulse-ring"></div><i class="fas fa-mobile-alt"></i>';
            }
        }
        
        // Add status message to area
        if (this.paymentStatusArea && message) {
            const statusClass = ['completed'].includes(status) ? 'success' 
                : ['failed', 'error'].includes(status) ? 'error'
                : ['timeout', 'pending_verification'].includes(status) ? 'warning' 
                : 'info';
            
            this.paymentStatusArea.innerHTML = `
                <div class="status-message ${statusClass}">
                    <i class="fas fa-${statusClass === 'success' ? 'check-circle' : statusClass === 'error' ? 'times-circle' : 'info-circle'}"></i>
                    ${message}
                </div>
            `;
        }
    }

    async handlePaymentComplete(data) {
        try {
            this.clearPaymentTimer();
            
            // Ensure we have valid transaction identifiers (fallback chain)
            const mpesaReceiptNumber = data.mpesaReceiptNumber || data.mpesaCode || null;
            const firestoreTransactionId = data.transactionId || null;
            
            await this.createOrder('mpesa', mpesaReceiptNumber, {
                firestoreTransactionId: firestoreTransactionId,
                mpesaReceiptNumber: mpesaReceiptNumber,
                mpesaAmount: data.amount || this.total,
                mpesaPhone: data.phoneNumber || null,
                paymentStatus: 'completed',
                paymentCompletedAt: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error after payment complete:', error);
            showNotification('Payment received but error creating order. Please contact support.', 'error');
        }
    }

    handlePaymentFailed(data) {
        this.setPaymentStatus('failed', data.reason || 'Payment was not completed');
        
        // Show manual options
        if (this.checkStatusSection) this.checkStatusSection.style.display = 'block';
        if (this.manualCodeSection) this.manualCodeSection.style.display = 'block';
        if (this.uploadReceiptSection) this.uploadReceiptSection.style.display = 'block';
    }

    // Process wallet payment
    async processWalletPayment() {
        const transactionId = `WALLET-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        let previousBalance = 0;
        let newBalance = 0;
        let walletDeducted = false;
        
        try {
            // Step 1: Validate order BEFORE deducting wallet
            const deliveryAddress = this.savedDeliveryAddress || this.deliveryAddressEl?.value?.trim() || '';
            const orderValidation = validateOrder({
                userId: this.user?.uid,
                items: this.orderItems,
                deliveryAddress: deliveryAddress,
                totalAmount: this.total
            });
            
            if (!orderValidation.valid) {
                throw new Error('Order validation failed: ' + orderValidation.errors.join(', '));
            }
            
            // Step 2: Deduct from wallet using transaction
            await runTransaction(db, async (transaction) => {
                const userRef = doc(db, "Users", this.user.uid);
                const userDoc = await transaction.get(userRef);
                
                if (!userDoc.exists()) {
                    throw new Error('User not found');
                }
                
                previousBalance = userDoc.data().walletBalance || 0;
                
                if (previousBalance < this.total) {
                    throw new Error('Insufficient wallet balance');
                }
                
                newBalance = previousBalance - this.total;
                transaction.update(userRef, {
                    walletBalance: newBalance,
                    lastTransactionAt: serverTimestamp()
                });
            });
            
            walletDeducted = true;
            
            // Step 3: Create the order IMMEDIATELY after wallet deduction
            await this.createOrder('wallet', transactionId, {
                paymentStatus: 'completed',
                walletPayment: true,
                walletTransactionId: transactionId,
                walletBalanceBefore: previousBalance,
                walletBalanceAfter: newBalance,
                paymentCompletedAt: new Date().toISOString()
            });
            
            // Step 4: Add wallet transaction record AFTER order is confirmed
            await addDoc(collection(db, "users", this.user.uid, "walletTransactions"), {
                type: 'payment',
                amount: -this.total,
                balanceBefore: previousBalance,
                balanceAfter: newBalance,
                description: `Order payment - ${this.orderItems.length} item(s)`,
                transactionId: transactionId,
                audit: {
                    source: 'wallet_balance',
                    destination: 'order_payment',
                    userId: this.user.uid,
                    amount: this.total,
                    currency: 'KES',
                    balanceBefore: previousBalance,
                    balanceAfter: newBalance,
                    timestamp: new Date().toISOString(),
                    verified: true,
                    verificationMethod: 'firestore_transaction'
                },
                status: 'completed',
                createdAt: serverTimestamp()
            });
            
        } catch (error) {
            console.error('Wallet payment error:', error);
            
            // CRITICAL: Refund wallet if deducted but order creation failed
            if (walletDeducted) {
                try {
                    console.log('Refunding wallet due to order creation failure...');
                    const userRef = doc(db, "Users", this.user.uid);
                    await updateDoc(userRef, {
                        walletBalance: previousBalance,
                        lastTransactionAt: serverTimestamp()
                    });
                    
                    // Record the refund transaction
                    await addDoc(collection(db, "users", this.user.uid, "walletTransactions"), {
                        type: 'refund',
                        amount: this.total,
                        balanceBefore: newBalance,
                        balanceAfter: previousBalance,
                        description: 'Auto-refund: Order creation failed',
                        transactionId: `REFUND-${transactionId}`,
                        originalTransactionId: transactionId,
                        reason: error.message,
                        status: 'completed',
                        createdAt: serverTimestamp()
                    });
                    
                    showNotification('Payment failed - your wallet has been refunded', 'warning');
                } catch (refundError) {
                    console.error('CRITICAL: Failed to refund wallet:', refundError);
                    showNotification('Payment error - please contact support for refund', 'error');
                    // TODO: Alert admin about failed refund
                }
            } else {
                showNotification(error.message || 'Failed to process wallet payment', 'error');
            }
            
            this.setButtonLoading(false);
        }
    }

    async verifyManualCode() {
        const code = this.mpesaCodeInput.value.trim().toUpperCase();
        
        if (!code || code.length < 10) {
            showNotification('Please enter a valid M-Pesa code (10 characters)', 'warning');
            return;
        }
        
        this.verifyCodeBtn.disabled = true;
        this.verifyCodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
        
        try {
            const result = await this.mpesaManager.verifyManualCode(code, this.total);
            
            if (result.success) {
                if (result.pendingVerification) {
                    // Create order as pending verification
                    await this.createOrder('mpesa', code, {
                        paymentStatus: 'pending_verification',
                        verificationMethod: 'manual_code'
                    });
                } else {
                    // Payment verified
                    await this.createOrder('mpesa', code, {
                        paymentStatus: 'completed',
                        verificationMethod: 'manual_code'
                    });
                }
            }
        } catch (error) {
            showNotification(error.message || 'Failed to verify code', 'error');
        } finally {
            this.verifyCodeBtn.disabled = false;
            this.verifyCodeBtn.innerHTML = '<i class="fas fa-check"></i> Verify';
        }
    }

    // Check payment status manually (user-initiated)
    async checkPaymentStatusManual() {
        if (!this.mpesaManager) {
            showNotification('Payment session not active', 'warning');
            return;
        }
        
        this.checkStatusBtn.disabled = true;
        this.checkStatusBtn.classList.add('checking');
        this.checkStatusBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Checking...';
        
        try {
            const result = await this.mpesaManager.checkPaymentStatus();
            
            if (result.success && result.status === 'completed') {
                // Payment found! Process the order
                showNotification('Payment confirmed!', 'success');
                
                await this.createOrder('mpesa', result.data.mpesaReceiptNumber || 'CONFIRMED', {
                    paymentStatus: 'completed',
                    verificationMethod: 'api_query'
                });
            } else if (result.status === 'pending') {
                showNotification('Payment is still being processed. Please wait or enter M-Pesa code manually.', 'info');
            } else {
                showNotification(result.message || 'Payment not completed yet', 'warning');
            }
        } catch (error) {
            showNotification(error.message || 'Could not check status. Please enter M-Pesa code manually.', 'warning');
        } finally {
            this.checkStatusBtn.disabled = false;
            this.checkStatusBtn.classList.remove('checking');
            this.checkStatusBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Check Payment Status';
        }
    }

    handleReceiptUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Validate file
        if (!file.type.startsWith('image/')) {
            showNotification('Please upload an image file', 'warning');
            return;
        }
        
        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            showNotification('File size must be less than 5MB', 'warning');
            return;
        }
        
        this.receiptFile = file;
        
        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            if (this.previewImage) this.previewImage.src = e.target.result;
            if (this.uploadPreview) this.uploadPreview.style.display = 'block';
            if (this.submitReceiptBtn) this.submitReceiptBtn.style.display = 'block';
            
            // Hide upload label
            const uploadLabel = document.querySelector('.upload-label');
            if (uploadLabel) uploadLabel.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    async submitReceiptForVerification() {
        if (!this.receiptFile) {
            showNotification('Please upload a receipt screenshot', 'warning');
            return;
        }
        
        this.submitReceiptBtn.disabled = true;
        this.submitReceiptBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
        
        try {
            // Upload to Firebase Storage
            const fileName = `receipts/${this.user.uid}/${Date.now()}_${this.receiptFile.name}`;
            const storageRefPath = ref(storage, fileName);
            
            await uploadBytes(storageRefPath, this.receiptFile);
            const receiptUrl = await getDownloadURL(storageRefPath);
            
            // Create order with pending verification
            await this.createOrder('mpesa', 'PENDING', {
                paymentStatus: 'pending_verification',
                verificationMethod: 'receipt_upload',
                receiptUrl: receiptUrl
            });
            
        } catch (error) {
            console.error('Error uploading receipt:', error);
            showNotification('Failed to upload receipt. Please try again.', 'error');
            this.submitReceiptBtn.disabled = false;
            this.submitReceiptBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit for Verification';
        }
    }

    async createOrder(paymentMethod, transactionId, paymentData = {}) {
        try {
            // Validate order data before creation
            // Use saved address first (for async callbacks), fall back to element value
            const deliveryAddress = this.savedDeliveryAddress || this.deliveryAddressEl?.value?.trim() || '';
            const orderValidation = validateOrder({
                userId: this.user?.uid,
                items: this.orderItems,
                deliveryAddress: deliveryAddress,
                totalAmount: this.total
            });
            
            if (!orderValidation.valid) {
                showNotification(orderValidation.errors.join('. '), 'error');
                throw new Error('Order validation failed: ' + orderValidation.errors.join(', '));
            }
            
            // Generate order ID
            const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

            // Get primary seller
            const primarySellerId = this.orderItems[0]?.sellerId || null;

            // Update stock for each item if payment is completed
            if (paymentData.paymentStatus === 'completed' || paymentMethod === 'pay_on_delivery') {
                await this.updateProductStock();
            }

            // Prepare order data with sanitized inputs
            // Include both field names for backward compatibility with different pages
            const orderData = {
                orderId,
                userId: this.user.uid,
                sellerId: primarySellerId,
                items: this.orderItems.map(item => ({
                    listingId: item.listingId,
                    // Include both name fields for compatibility
                    productName: escapeHtml(item.name),
                    name: escapeHtml(item.name),
                    selectedVariation: item.selectedVariation,
                    quantity: validateQuantity(item.quantity) || 1,
                    // Include both price fields for compatibility
                    pricePerUnit: validatePrice(item.price) || 0,
                    price: validatePrice(item.price) || 0,
                    totalPrice: validatePrice(item.totalPrice) || 0,
                    imageUrl: item.imageUrl,
                    sellerId: item.sellerId
                })),
                buyerDetails: {
                    name: escapeHtml(this.buyerNameEl?.textContent || ''),
                    phone: this.buyerPhoneEl?.textContent || '',
                    location: escapeHtml(this.buyerLocationEl?.textContent || ''),
                    deliveryAddress: escapeHtml(deliveryAddress)
                },
                paymentMethod,
                paymentStatus: paymentData.paymentStatus || (paymentMethod === 'mpesa' ? 'completed' : 'pending'),
                // M-Pesa transaction identifiers (only include if defined)
                ...(transactionId && { mpesaTransactionId: transactionId }),
                ...(paymentData.firestoreTransactionId && { firestoreTransactionId: paymentData.firestoreTransactionId }),
                ...(paymentData.mpesaReceiptNumber && { mpesaReceiptNumber: paymentData.mpesaReceiptNumber }),
                mpesaPhone: paymentData.mpesaPhone || (this.mpesaPhoneInput ? normalizePhoneNumber(this.mpesaPhoneInput.value) : null),
                // Payment audit trail
                paymentAudit: {
                    method: paymentMethod,
                    initiatedAt: new Date().toISOString(),
                    completedAt: paymentData.paymentCompletedAt || null,
                    amount: validatePrice(this.total) || 0,
                    currency: 'KES',
                    source: paymentMethod === 'mpesa' ? 'mpesa_stk_push' : paymentMethod === 'wallet' ? 'wallet_balance' : 'cash_on_delivery',
                    verificationStatus: paymentData.paymentStatus === 'completed' ? 'verified' : 'pending'
                },
                shippingFee: validatePrice(this.shippingFee) || 0,
                discount: validatePrice(this.discount) || 0,
                subtotal: validatePrice(this.subtotal) || 0,
                // Include both total fields for compatibility
                totalAmount: validatePrice(this.total) || 0,
                total: validatePrice(this.total) || 0,
                orderNotes: escapeHtml((this.orderNotesEl?.value || '').trim().substring(0, 500)),
                orderDate: serverTimestamp(),
                // Include both status fields for compatibility
                status: paymentData.paymentStatus === 'pending_verification' ? 'pending_payment' : 'pending',
                orderStatus: paymentData.paymentStatus === 'pending_verification' ? 'pending_payment' : 'pending',
                orderSource: this.orderSource,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            // Save to Orders collection
            await addDoc(collection(db, "Orders"), orderData);

            // Also save to user's orders subcollection for easy querying
            await addDoc(collection(db, `users/${this.user.uid}/orders`), orderData);

            // Save delivery address to user profile for next checkout
            if (deliveryAddress) {
                try {
                    await updateDoc(doc(db, "Users", this.user.uid), {
                        deliveryAddress: deliveryAddress,
                        updatedAt: serverTimestamp()
                    });
                } catch (e) {
                    console.warn('Could not save delivery address to profile:', e);
                }
            }

            // Create notifications for sellers
            await this.notifySellerOfNewOrder(orderData);

            // Clear cart/buyNow
            await this.clearOrderSource();

            // Show success modal
            this.showSuccessModal(orderId, paymentMethod, paymentData.paymentStatus);

        } catch (error) {
            console.error('Error creating order:', error);
            showNotification('Error creating order. Please contact support.', 'error');
            throw error;
        }
    }

    async clearOrderSource() {
        try {
            if (this.orderSource === 'buynow') {
                this.deleteCookie('buyNowItem');
            } else {
                const snapshot = await getDocs(collection(db, `users/${this.user.uid}/cart`));
                const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
                await Promise.all(deletePromises);
            }
        } catch (error) {
            console.error('Error clearing order source:', error);
        }
    }

    async updateProductStock() {
        const stockErrors = [];
        
        try {
            for (const item of this.orderItems) {
                if (!item.listingId) continue;
                
                const listingRef = doc(db, 'Listings', item.listingId);
                
                // Use transaction to prevent race conditions
                try {
                    await runTransaction(db, async (transaction) => {
                        const listingDoc = await transaction.get(listingRef);
                        
                        if (!listingDoc.exists()) {
                            throw new Error(`Product ${item.name} no longer exists`);
                        }
                        
                        const currentData = listingDoc.data();
                        const currentStock = currentData.totalStock || 0;
                        
                        // Verify stock is sufficient
                        if (currentStock < item.quantity) {
                            throw new Error(`Insufficient stock for ${item.name}. Available: ${currentStock}, Requested: ${item.quantity}`);
                        }
                        
                        const newStock = currentStock - item.quantity;
                        
                        // Update atomically within transaction
                        transaction.update(listingRef, {
                            totalStock: newStock,
                            soldCount: (currentData.soldCount || 0) + item.quantity,
                            updatedAt: serverTimestamp()
                        });
                        
                        console.log(`Updated stock for ${item.name}: ${currentStock} -> ${newStock}`);
                    });
                } catch (txError) {
                    stockErrors.push(txError.message);
                    console.error(`Stock update failed for ${item.name}:`, txError);
                }
            }
            
            if (stockErrors.length > 0) {
                console.warn('Some stock updates failed:', stockErrors);
                // Notify admin of stock discrepancies
            }
        } catch (error) {
            console.error('Error in updateProductStock:', error);
        }
    }

    async notifySellerOfNewOrder(orderData) {
        try {
            // Get unique seller IDs from order items
            const sellerIds = new Set();
            orderData.items.forEach(item => {
                if (item.sellerId) sellerIds.add(item.sellerId);
            });
            
            // Also add primary seller
            if (orderData.sellerId) sellerIds.add(orderData.sellerId);
            
            // Create notification for each seller
            for (const sellerId of sellerIds) {
                // Get items for this seller
                const sellerItems = orderData.items.filter(item => item.sellerId === sellerId);
                const itemNames = sellerItems.map(i => i.productName || i.name).slice(0, 2).join(', ');
                const itemCount = sellerItems.length;
                
                const notification = {
                    userId: sellerId,
                    type: 'new_order',
                    title: '🛒 New Order Received!',
                    message: `You have a new order for ${itemNames}${itemCount > 2 ? ` and ${itemCount - 2} more` : ''}. Order ID: ${orderData.orderId}`,
                    orderId: orderData.orderId,
                    amount: orderData.totalAmount,
                    buyerName: orderData.buyerDetails?.name || 'Customer',
                    read: false,
                    createdAt: serverTimestamp()
                };
                
                await addDoc(collection(db, "Notifications"), notification);
            }
            
            console.log(`Notifications sent to ${sellerIds.size} seller(s)`);
        } catch (error) {
            console.error('Error sending seller notifications:', error);
            // Don't throw - notification failure shouldn't prevent order completion
        }
    }

    showSuccessModal(orderId, paymentMethod, paymentStatus) {
        this.clearPaymentTimer();
        
        if (this.paymentModal) {
            this.paymentModal.classList.remove('active');
        }
        
        if (this.successModal) {
            this.successModal.classList.add('active');
            
            // Set order reference
            if (this.orderRefNumber) {
                this.orderRefNumber.textContent = orderId;
            }
            
            // Set order date
            const orderDateEl = document.getElementById('orderDateDisplay');
            if (orderDateEl) {
                orderDateEl.textContent = new Date().toLocaleDateString('en-KE', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
            
            // Set payment status with appropriate styling
            const paymentBadge = document.getElementById('paymentStatusBadge');
            if (this.paymentMethodDisplay && paymentBadge) {
                let methodText = paymentMethod === 'mpesa' ? 'M-Pesa' : 
                                 paymentMethod === 'wallet' ? 'Wallet' : 'Pay on Delivery';
                let statusIcon = 'fa-check-circle';
                let badgeClass = 'success';
                
                if (paymentStatus === 'pending_verification') {
                    methodText += ' - Pending Verification';
                    statusIcon = 'fa-clock';
                    badgeClass = 'warning';
                } else if (paymentMethod === 'mpesa') {
                    methodText += ' - Confirmed';
                } else if (paymentMethod === 'wallet') {
                    methodText += ' - Paid';
                } else {
                    methodText += ' - Pay when delivered';
                    statusIcon = 'fa-hand-holding-usd';
                    badgeClass = 'info';
                }
                
                paymentBadge.className = `status-badge ${badgeClass}`;
                paymentBadge.innerHTML = `<i class="fas ${statusIcon}"></i><span>${methodText}</span>`;
            }
            
            // Handle repay section for unpaid orders
            const repaySection = document.getElementById('repaySection');
            if (repaySection) {
                if (paymentStatus === 'pending_verification' || paymentStatus === 'failed') {
                    repaySection.style.display = 'block';
                    // Store order info for repay
                    repaySection.dataset.orderId = orderId;
                    repaySection.dataset.amount = this.orderTotal;
                } else {
                    repaySection.style.display = 'none';
                }
            }
            
            // Handle POD notice
            const podNotice = document.getElementById('podNotice');
            const podAmount = document.getElementById('podAmount');
            if (podNotice) {
                if (paymentMethod === 'pay_on_delivery') {
                    podNotice.style.display = 'flex';
                    if (podAmount) {
                        podAmount.textContent = `KSh ${this.orderTotal?.toLocaleString() || '0'}`;
                    }
                } else {
                    podNotice.style.display = 'none';
                }
            }
            
            // Update track order link
            const trackOrderLink = document.getElementById('trackOrderLink');
            if (trackOrderLink) {
                trackOrderLink.href = `orderTracking.html?orderId=${orderId}`;
            }
            
            // Trigger confetti animation
            this.triggerConfetti();
        }
    }
    
    triggerConfetti() {
        const container = document.getElementById('confettiContainer');
        if (!container) return;
        
        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9'];
        const confettiCount = 50;
        
        for (let i = 0; i < confettiCount; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti-piece';
            confetti.style.cssText = `
                position: absolute;
                width: ${Math.random() * 10 + 5}px;
                height: ${Math.random() * 10 + 5}px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                left: ${Math.random() * 100}%;
                animation: confetti-fall ${Math.random() * 2 + 2}s ease-out forwards;
                animation-delay: ${Math.random() * 0.5}s;
                border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
                transform: rotate(${Math.random() * 360}deg);
            `;
            container.appendChild(confetti);
        }
        
        // Clean up confetti after animation
        setTimeout(() => {
            container.innerHTML = '';
        }, 4000);
    }

    async cancelPayment() {
        const confirmed = await OdaModal.confirm({
            title: 'Cancel Payment?',
            message: 'Are you sure you want to cancel this payment? You will need to start the checkout process again.',
            confirmText: 'Yes, Cancel',
            cancelText: 'Continue Payment',
            type: 'warning'
        });
        
        if (confirmed) {
            if (this.mpesaManager) {
                this.mpesaManager.cancel();
            }
            this.clearPaymentTimer();
            if (this.paymentModal) {
                this.paymentModal.classList.remove('active');
            }
            this.updateProgressStep(1);
        }
    }

    async retryPayment() {
        const repaySection = document.getElementById('repaySection');
        if (!repaySection) return;
        
        const orderId = repaySection.dataset.orderId;
        const amount = parseFloat(repaySection.dataset.amount) || 0;
        
        if (!orderId || !amount) {
            OdaModal.alert({
                title: 'Error',
                message: 'Unable to retrieve order details for repayment.',
                type: 'error'
            });
            return;
        }
        
        try {
            // Close success modal
            if (this.successModal) {
                this.successModal.classList.remove('active');
            }
            
            // Initialize M-Pesa payment for this order
            const phoneInput = document.getElementById('mpesaPhone');
            if (!phoneInput || !phoneInput.value) {
                OdaModal.alert({
                    title: 'Phone Required',
                    message: 'Please enter your M-Pesa phone number to retry payment.',
                    type: 'warning'
                });
                // Redirect to checkout with order info
                window.location.href = `checkout.html?retryOrder=${orderId}`;
                return;
            }
            
            // Show payment modal
            if (this.paymentModal) {
                this.paymentModal.classList.add('active');
            }
            
            // Process M-Pesa payment
            if (this.mpesaManager) {
                const paymentResult = await this.mpesaManager.initiatePayment(phoneInput.value, amount);
                
                if (paymentResult.success) {
                    // Update order payment status
                    const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js');
                    const orderRef = doc(db, 'orders', orderId);
                    await updateDoc(orderRef, {
                        paymentStatus: 'paid',
                        mpesaCode: paymentResult.mpesaCode,
                        paidAt: new Date().toISOString()
                    });
                    
                    OdaModal.alert({
                        title: 'Payment Successful!',
                        message: `Your payment of KSh ${amount.toLocaleString()} has been received.`,
                        type: 'success'
                    });
                    
                    // Hide repay section
                    repaySection.style.display = 'none';
                    
                    // Show success modal again
                    this.showSuccessModal(orderId, 'mpesa', 'paid');
                }
            }
        } catch (error) {
            console.error('Retry payment error:', error);
            OdaModal.alert({
                title: 'Payment Failed',
                message: 'Unable to process payment. Please try again or contact support.',
                type: 'error'
            });
        }
    }

    handlePaymentTimeout() {
        this.clearPaymentTimer();
        this.setPaymentStatus('timeout', 'Payment window has expired. If you have already paid, please enter your M-Pesa code below.');
        
        // Show all manual options
        if (this.manualCodeSection) this.manualCodeSection.style.display = 'block';
        if (this.uploadReceiptSection) this.uploadReceiptSection.style.display = 'block';
    }

    clearPaymentTimer() {
        if (this.paymentTimer) {
            clearInterval(this.paymentTimer);
            this.paymentTimer = null;
        }
    }

    setButtonLoading(loading) {
        if (!this.placeOrderBtn) return;
        
        const btnText = this.placeOrderBtn.querySelector('.btn-text');
        const btnLoading = this.placeOrderBtn.querySelector('.btn-loading');
        
        if (loading) {
            this.placeOrderBtn.disabled = true;
            if (btnText) btnText.style.display = 'none';
            if (btnLoading) btnLoading.style.display = 'flex';
        } else {
            this.placeOrderBtn.disabled = false;
            if (btnText) btnText.style.display = 'flex';
            if (btnLoading) btnLoading.style.display = 'none';
        }
    }

    showLoading() {
        if (this.loadingSpinner) this.loadingSpinner.style.display = 'flex';
        if (this.checkoutContainer) this.checkoutContainer.style.display = 'none';
    }

    hideLoading() {
        if (this.loadingSpinner) this.loadingSpinner.style.display = 'none';
        if (this.checkoutContainer) this.checkoutContainer.style.display = 'grid';
    }
}

// Global function for removing receipt preview
window.removePreview = function() {
    const uploadPreview = document.getElementById('uploadPreview');
    const submitReceiptBtn = document.getElementById('submitReceiptBtn');
    const uploadLabel = document.querySelector('.upload-label');
    const receiptUpload = document.getElementById('receiptUpload');
    
    if (uploadPreview) uploadPreview.style.display = 'none';
    if (submitReceiptBtn) submitReceiptBtn.style.display = 'none';
    if (uploadLabel) uploadLabel.style.display = 'flex';
    if (receiptUpload) receiptUpload.value = '';
};

// Global variable to hold checkout manager instance
let checkoutManagerInstance = null;

// Global function for retry payment
window.retryPayment = async function() {
    if (checkoutManagerInstance) {
        await checkoutManagerInstance.retryPayment();
    } else {
        console.error('Checkout manager not initialized');
        OdaModal.alert({
            title: 'Error',
            message: 'Unable to retry payment. Please refresh the page and try again.',
            type: 'error'
        });
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    checkoutManagerInstance = new CheckoutManager();
    checkoutManagerInstance.initialize();
});
