/**
 * Checkout Page Controller - Oda Pap B2B
 * Handles order checkout with M-Pesa payments, shipping calculation,
 * and order creation integrated with Firebase.
 */

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, addDoc, deleteDoc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { app } from './js/firebase.js';
import { showNotification } from './notifications.js';
import { MpesaPaymentManager, normalizePhoneNumber, isValidPhoneNumber, formatPhoneForDisplay, getShippingFee, checkFreeShipping } from './js/mpesa.js';

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

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
                this.paymentOptions.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                const radio = option.querySelector('input[type="radio"]');
                radio.checked = true;
                this.paymentMethod = radio.value;
                
                // Toggle M-Pesa section
                if (this.mpesaSection) {
                    this.mpesaSection.style.display = this.paymentMethod === 'mpesa' ? 'block' : 'none';
                }
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
                    showNotification('Please login to checkout', 'warning');
                    window.location.href = 'login.html';
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
                
                this.buyerNameEl.textContent = this.userData.name || 'Not set';
                // Support both 'phone' and 'phoneNumber' field names
                const userPhone = this.userData.phone || this.userData.phoneNumber || '';
                this.buyerPhoneEl.textContent = userPhone || 'Not set';
                
                const county = this.userData.county || '';
                const subcounty = this.userData.subcounty || this.userData.constituency || '';
                const ward = this.userData.ward || '';
                
                this.buyerLocationEl.textContent = [county, subcounty, ward].filter(Boolean).join(', ') || 'Not set';
                
                // Check if user is from Mombasa
                if (!county.toLowerCase().includes('mombasa')) {
                    this.shippingNotice.style.display = 'flex';
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

    async calculateShippingFee(county, subcounty, ward) {
        try {
            const fee = await getShippingFee(county, subcounty, ward);
            this.shippingFee = fee;
            
            // Update UI
            if (this.displayShippingFeeEl) {
                this.displayShippingFeeEl.textContent = `KES ${fee.toLocaleString()}`;
            }
            
            if (this.shippingLocationEl) {
                this.shippingLocationEl.textContent = subcounty ? `(${subcounty})` : '';
            }
            
            if (this.shippingNoteEl) {
                this.shippingNoteEl.textContent = county.toLowerCase().includes('mombasa') 
                    ? `Delivery within ${subcounty || 'Mombasa'}` 
                    : 'Delivery fee may vary';
            }
            
            this.updatePriceDisplay();
        } catch (error) {
            console.error('Error calculating shipping fee:', error);
            this.shippingFee = 150; // Default fallback
            this.updatePriceDisplay();
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

                // Fetch seller info from listing
                let sellerId = buyNowData.uploaderId || buyNowData.sellerId || null;
                if (!sellerId && buyNowData.listingId) {
                    try {
                        const listingDoc = await getDoc(doc(db, 'Listings', buyNowData.listingId));
                        if (listingDoc.exists()) {
                            sellerId = listingDoc.data().uploaderId;
                        }
                    } catch (e) { console.log('Could not fetch seller:', e); }
                }

                const itemData = {
                    listingId: buyNowData.listingId,
                    name: buyNowData.name,
                    price: buyNowData.price,
                    quantity: buyNowData.quantity || 1,
                    selectedVariation: buyNowData.selectedVariation || null,
                    imageUrl: buyNowData.photoTraceUrl || buyNowData.imageUrls?.[0] || 'images/placeholder.png',
                    totalPrice: buyNowData.price * (buyNowData.quantity || 1),
                    sellerId: sellerId
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
                    
                    let sellerId = item.uploaderId || item.sellerId || null;
                    if (!sellerId && item.listingId) {
                        try {
                            const listingDoc = await getDoc(doc(db, 'Listings', item.listingId));
                            if (listingDoc.exists()) {
                                sellerId = listingDoc.data().uploaderId;
                            }
                        } catch (e) { console.log('Could not fetch seller:', e); }
                    }
                    
                    const itemData = {
                        docId: docSnap.id,
                        listingId: item.listingId,
                        name: item.name,
                        price: item.price,
                        quantity: item.quantity || 1,
                        selectedVariation: item.selectedVariation || null,
                        imageUrl: item.photoTraceUrl || item.imageUrls?.[0] || 'images/placeholder.png',
                        totalPrice: item.price * (item.quantity || 1),
                        sellerId: sellerId
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
            const itemEl = document.createElement('div');
            itemEl.className = 'order-item';
            itemEl.innerHTML = `
                <img src="${item.imageUrl}" alt="${item.name}" class="order-item-image" onerror="this.src='images/placeholder.png'">
                <div class="order-item-details">
                    <h4>${item.name}</h4>
                    <p class="item-meta">Qty: ${item.quantity}</p>
                    ${item.selectedVariation ? `
                        <span class="item-variation">
                            ${item.selectedVariation.title}: ${item.selectedVariation.attr_name}
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
        this.total = this.subtotal + this.shippingFee - this.discount;
        
        if (this.subtotalEl) this.subtotalEl.textContent = `KES ${this.subtotal.toLocaleString()}`;
        if (this.shippingEl) this.shippingEl.textContent = `KES ${this.shippingFee.toLocaleString()}`;
        if (this.totalEl) this.totalEl.textContent = `KES ${this.total.toLocaleString()}`;
        if (this.btnTotalEl) this.btnTotalEl.textContent = `KES ${this.total.toLocaleString()}`;
        
        if (this.discount > 0 && this.discountRow) {
            this.discountRow.style.display = 'flex';
            if (this.discountEl) this.discountEl.textContent = `- KES ${this.discount.toLocaleString()}`;
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
            // Validate inputs
            if (!this.deliveryAddressEl.value.trim()) {
                showNotification('Please enter your delivery address', 'warning');
                this.deliveryAddressEl.focus();
                return;
            }

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
            await this.createOrder('mpesa', data.mpesaReceiptNumber, {
                transactionId: data.transactionId,
                paymentStatus: 'completed'
            });
        } catch (error) {
            console.error('Error after payment complete:', error);
            showNotification('Payment received but error creating order. Please contact support.', 'error');
        }
    }

    handlePaymentFailed(data) {
        this.setPaymentStatus('failed', data.reason || 'Payment was not completed');
        
        // Show manual options
        if (this.manualCodeSection) this.manualCodeSection.style.display = 'block';
        if (this.uploadReceiptSection) this.uploadReceiptSection.style.display = 'block';
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
            // Generate order ID
            const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

            // Get primary seller
            const primarySellerId = this.orderItems[0]?.sellerId || null;

            // Prepare order data
            const orderData = {
                orderId,
                userId: this.user.uid,
                sellerId: primarySellerId,
                items: this.orderItems.map(item => ({
                    listingId: item.listingId,
                    productName: item.name,
                    selectedVariation: item.selectedVariation,
                    quantity: item.quantity,
                    pricePerUnit: item.price,
                    totalPrice: item.totalPrice,
                    imageUrl: item.imageUrl,
                    sellerId: item.sellerId
                })),
                buyerDetails: {
                    name: this.buyerNameEl.textContent,
                    phone: this.buyerPhoneEl.textContent,
                    location: this.buyerLocationEl.textContent,
                    deliveryAddress: this.deliveryAddressEl.value.trim()
                },
                paymentMethod,
                paymentStatus: paymentData.paymentStatus || (paymentMethod === 'mpesa' ? 'completed' : 'pending'),
                mpesaTransactionId: transactionId,
                mpesaPhone: this.mpesaPhoneInput ? normalizePhoneNumber(this.mpesaPhoneInput.value) : null,
                ...paymentData,
                shippingFee: this.shippingFee,
                discount: this.discount,
                subtotal: this.subtotal,
                totalAmount: this.total,
                orderNotes: this.orderNotesEl?.value?.trim() || '',
                orderDate: serverTimestamp(),
                status: paymentData.paymentStatus === 'pending_verification' ? 'pending_payment' : 'pending',
                orderSource: this.orderSource,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            // Save to Orders collection
            await addDoc(collection(db, "Orders"), orderData);

            // Also save to user's orders subcollection for easy querying
            await addDoc(collection(db, `users/${this.user.uid}/orders`), orderData);

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

    showSuccessModal(orderId, paymentMethod, paymentStatus) {
        this.clearPaymentTimer();
        
        if (this.paymentModal) {
            this.paymentModal.classList.remove('active');
        }
        
        if (this.successModal) {
            this.successModal.classList.add('active');
            if (this.orderRefNumber) {
                this.orderRefNumber.textContent = orderId;
            }
            if (this.paymentMethodDisplay) {
                let methodText = paymentMethod === 'mpesa' ? 'M-Pesa' : 'Pay on Delivery';
                if (paymentStatus === 'pending_verification') {
                    methodText += ' (Pending Verification)';
                }
                this.paymentMethodDisplay.textContent = methodText;
            }
        }
    }

    cancelPayment() {
        if (confirm('Are you sure you want to cancel this payment?')) {
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

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    const checkoutManager = new CheckoutManager();
    checkoutManager.initialize();
});
