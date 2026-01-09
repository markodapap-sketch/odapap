import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, addDoc, deleteDoc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from './js/firebase.js';
import { showNotification } from './notifications.js';

const auth = getAuth(app);
const db = getFirestore(app);

class CheckoutManager {
    constructor() {
        this.user = null;
        this.orderItems = [];
        this.subtotal = 0;
        this.shippingFee = 0;
        this.discount = 0;
        this.total = 0;
        this.paymentMethod = 'mpesa';
        this.orderSource = this.determineOrderSource();
        this.paymentTimer = null;
        this.paymentTimeRemaining = 300; // 5 minutes in seconds
        
        this.initializeElements();
        this.setupEventListeners();
    }

    determineOrderSource() {
        // Check if coming from product page (Buy Now) or cart
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('source') || 'cart'; // default to cart
    }

    // Cookie helper functions
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
        this.loadingSpinner = document.getElementById('loadingSpinner');
        this.checkoutContainer = document.getElementById('checkoutContainer');
        this.orderItemsEl = document.getElementById('orderItems');
        this.subtotalEl = document.getElementById('subtotalAmount');
        this.shippingEl = document.getElementById('shippingAmount');
        this.discountEl = document.getElementById('discountAmount');
        this.discountRow = document.getElementById('discountRow');
        this.totalEl = document.getElementById('totalAmount');
        
        this.buyerNameEl = document.getElementById('buyerName');
        this.buyerPhoneEl = document.getElementById('buyerPhone');
        this.buyerLocationEl = document.getElementById('buyerLocation');
        this.deliveryAddressEl = document.getElementById('deliveryAddress');
        this.shippingFeeInput = document.getElementById('shippingFee');
        this.mpesaPhoneInput = document.getElementById('mpesaPhone');
        this.mpesaDetails = document.getElementById('mpesaDetails');
        
        this.placeOrderBtn = document.getElementById('placeOrderBtn');
        this.paymentModal = document.getElementById('paymentModal');
        this.paymentTimerEl = document.getElementById('paymentTimer');
        this.modalPhoneEl = document.getElementById('modalPhone');
        this.paymentStatusEl = document.getElementById('paymentStatus');
        this.manualCodeEntry = document.getElementById('manualCodeEntry');
        this.mpesaCodeInput = document.getElementById('mpesaCode');
        this.verifyCodeBtn = document.getElementById('verifyCodeBtn');
        this.cancelPaymentBtn = document.getElementById('cancelPaymentBtn');
        
        this.successModal = document.getElementById('successModal');
        this.orderRefNumber = document.getElementById('orderRefNumber');
    }

    setupEventListeners() {
        // Payment method selection
        document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.paymentMethod = e.target.value;
                this.mpesaDetails.style.display = this.paymentMethod === 'mpesa' ? 'block' : 'none';
                // COMMENTED OUT: Discount logic
                // this.calculateDiscount();
            });
        });

        // Shipping fee input
        this.shippingFeeInput.addEventListener('input', () => {
            this.shippingFee = parseFloat(this.shippingFeeInput.value) || 0;
            this.updatePriceDisplay();
        });

        // Place order button
        this.placeOrderBtn.addEventListener('click', () => this.handlePlaceOrder());

        // Cancel payment
        this.cancelPaymentBtn.addEventListener('click', () => this.cancelPayment());

        // Verify manual code
        this.verifyCodeBtn.addEventListener('click', () => this.verifyManualCode());
    }

    async initialize() {
        try {
            this.showLoading();
            
            onAuthStateChanged(auth, async (user) => {
                if (!user) {
                    showNotification('Please login to checkout');
                    window.location.href = 'login.html';
                    return;
                }

                this.user = user;
                await this.loadUserInfo();
                await this.loadOrderItems();
                this.hideLoading();
            });
        } catch (error) {
            console.error('Error initializing checkout:', error);
            showNotification('Error loading checkout page');
        }
    }

    async loadUserInfo() {
        try {
            const userDoc = await getDoc(doc(db, "Users", this.user.uid));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                this.buyerNameEl.textContent = userData.name || 'Not set';
                this.buyerPhoneEl.textContent = userData.phoneNumber || 'Not set';
                const userCounty = (userData.county || '').toLowerCase();
                
                // Check if user is from Mombasa
                if (!userCounty.includes('mombasa')) {
                    showNotification('Currently, we only ship to Mombasa. Support for other areas coming soon!', 'warning');
                    
                    // Show warning message
                    const warningDiv = document.createElement('div');
                    warningDiv.className = 'shipping-warning';
                    warningDiv.innerHTML = `
                        <i class="fas fa-exclamation-triangle"></i>
                        <div>
                            <strong>Shipping Notice:</strong>
                            <p>We currently only ship to Mombasa County. If you're in a different location, 
                            we'll support your area soon! For urgent orders, contact us: 
                            <a href="tel:+254759695025">0759 695 025</a></p>
                        </div>
                    `;
                    this.checkoutContainer.insertBefore(warningDiv, this.checkoutContainer.firstChild);
                }
                
                this.buyerLocationEl.textContent = `${userData.county || ''}, ${userData.ward || ''}`;
                
                // Pre-fill M-Pesa phone with user's phone
                if (userData.phoneNumber) {
                    this.mpesaPhoneInput.value = userData.phoneNumber;
                }
                
                // Set fixed shipping fee for Mombasa
                this.shippingFeeInput.value = '150';
                this.shippingFeeInput.readOnly = true;
                this.shippingFee = 150;
                this.updatePriceDisplay();
            }
        } catch (error) {
            console.error('Error loading user info:', error);
        }
    }

    async loadOrderItems() {
        try {
            this.orderItems = [];
            this.subtotal = 0;

            if (this.orderSource === 'buynow') {
                // Load from cookie (Buy Now from product page)
                const buyNowData = this.getCookie('buyNowItem');
                
                if (!buyNowData) {
                    showNotification('No item found for checkout');
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
                    showNotification('Your cart is empty');
                    window.location.href = 'cart.html';
                    return;
                }

                for (const docSnap of cartSnapshot.docs) {
                    const item = docSnap.data();
                    
                    // Fetch seller info from listing
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

            this.displayOrderItems();
            this.updatePriceDisplay();
        } catch (error) {
            console.error('Error loading order items:', error);
            showNotification('Error loading order items');
        }
    }

    displayOrderItems() {
        this.orderItemsEl.innerHTML = '';

        if (this.orderItems.length === 0) {
            this.orderItemsEl.innerHTML = '<p style="text-align: center; color: #666;">No items to checkout</p>';
            this.placeOrderBtn.disabled = true;
            return;
        }

        this.orderItems.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'order-item';
            itemEl.innerHTML = `
                <img src="${item.imageUrl}" alt="${item.name}" class="order-item-image">
                <div class="order-item-details">
                    <h4>${item.name}</h4>
                    ${item.selectedVariation ? `
                        <div class="item-variation">
                            <strong>${item.selectedVariation.title}:</strong> ${item.selectedVariation.attr_name}
                        </div>
                    ` : ''}
                    <p>Quantity: ${item.quantity}</p>
                    <p>Price: KES ${item.price.toLocaleString()} × ${item.quantity}</p>
                    <p><strong>Total: KES ${item.totalPrice.toLocaleString()}</strong></p>
                </div>
            `;
            this.orderItemsEl.appendChild(itemEl);
        });
    }

    // COMMENTED OUT: Discount calculation (ready for activation)
    /*
    calculateDiscount() {
        if (this.paymentMethod === 'mpesa') {
            this.discount = this.subtotal * 0.05; // 5% discount
            this.discountRow.style.display = 'flex';
        } else {
            this.discount = 0;
            this.discountRow.style.display = 'none';
        }
        this.updatePriceDisplay();
    }
    */

    updatePriceDisplay() {
        this.subtotalEl.textContent = `KES ${this.subtotal.toLocaleString()}`;
        this.shippingEl.textContent = `KES ${this.shippingFee.toLocaleString()}`;
        // this.discountEl.textContent = `- KES ${this.discount.toLocaleString()}`;
        this.total = this.subtotal + this.shippingFee - this.discount;
        this.totalEl.textContent = `KES ${this.total.toLocaleString()}`;
    }

    async handlePlaceOrder() {
        try {
            // Validate inputs
            if (!this.deliveryAddressEl.value.trim()) {
                showNotification('Please enter delivery address');
                this.deliveryAddressEl.focus();
                return;
            }

            if (this.shippingFee === 0) {
                showNotification('Please enter shipping fee');
                this.shippingFeeInput.focus();
                return;
            }

            if (this.paymentMethod === 'mpesa') {
                const phone = this.mpesaPhoneInput.value.trim();
                if (!phone || !phone.match(/^254[0-9]{9}$/)) {
                    showNotification('Please enter valid M-Pesa phone number (254XXXXXXXXX)');
                    this.mpesaPhoneInput.focus();
                    return;
                }

                // Show payment modal and initiate M-Pesa
                this.showPaymentModal();
                await this.initiateMpesaPayment(phone);
            } else {
                // Pay on delivery
                await this.createOrder('pay_on_delivery', null);
            }
        } catch (error) {
            console.error('Error placing order:', error);
            showNotification('Error placing order. Please try again.');
        }
    }

    showPaymentModal() {
        this.paymentModal.classList.add('show');
        this.modalPhoneEl.textContent = this.mpesaPhoneInput.value;
        this.startPaymentTimer();
    }

    startPaymentTimer() {
        this.paymentTimeRemaining = 300; // 5 minutes
        this.updateTimerDisplay();

        this.paymentTimer = setInterval(() => {
            this.paymentTimeRemaining--;
            this.updateTimerDisplay();

            // Show manual code entry after 2 minutes
            if (this.paymentTimeRemaining === 180) {
                this.manualCodeEntry.style.display = 'block';
            }

            if (this.paymentTimeRemaining <= 0) {
                this.handlePaymentTimeout();
            }
        }, 1000);
    }

    updateTimerDisplay() {
        const minutes = Math.floor(this.paymentTimeRemaining / 60);
        const seconds = this.paymentTimeRemaining % 60;
        this.paymentTimerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    async initiateMpesaPayment(phone) {
        try {
            // Call your AWS backend endpoint
            const response = await fetch('/api/mpesa/initiate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    phoneNumber: phone,
                    amount: this.total,
                    userId: this.user.uid
                })
            });

            const data = await response.json();

            if (data.success) {
                this.paymentStatusEl.innerHTML = `
                    <div class="alert alert-success">
                        <i class="fas fa-check-circle"></i>
                        <p>Payment request sent! Please check your phone.</p>
                    </div>
                `;

                // Start polling for payment status
                this.pollPaymentStatus(data.checkoutRequestID);
            } else {
                throw new Error(data.message || 'Failed to initiate payment');
            }
        } catch (error) {
            console.error('Error initiating M-Pesa:', error);
            this.paymentStatusEl.innerHTML = `
                <div class="alert alert-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>${error.message}</p>
                </div>
            `;
            this.manualCodeEntry.style.display = 'block';
        }
    }

    async pollPaymentStatus(checkoutRequestID) {
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/mpesa/status/${checkoutRequestID}`);
                const data = await response.json();

                if (data.status === 'completed') {
                    clearInterval(pollInterval);
                    clearInterval(this.paymentTimer);
                    await this.createOrder('mpesa', data.transactionId);
                } else if (data.status === 'failed') {
                    clearInterval(pollInterval);
                    this.paymentStatusEl.innerHTML = `
                        <div class="alert alert-error">
                            <i class="fas fa-times-circle"></i>
                            <p>Payment failed. Please try again.</p>
                        </div>
                    `;
                    this.manualCodeEntry.style.display = 'block';
                }
            } catch (error) {
                console.error('Error polling payment status:', error);
            }
        }, 3000); // Poll every 3 seconds
    }

    async verifyManualCode() {
        try {
            const code = this.mpesaCodeInput.value.trim().toUpperCase();
            
            if (!code || code.length < 10) {
                showNotification('Please enter a valid M-Pesa transaction code');
                return;
            }

            this.verifyCodeBtn.disabled = true;
            this.verifyCodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';

            // Call your backend to verify the transaction code
            const response = await fetch('/api/mpesa/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    transactionCode: code,
                    amount: this.total,
                    phoneNumber: this.mpesaPhoneInput.value
                })
            });

            const data = await response.json();

            if (data.valid) {
                clearInterval(this.paymentTimer);
                await this.createOrder('mpesa', code);
            } else {
                showNotification('Invalid transaction code. Please contact support.');
                this.paymentStatusEl.innerHTML = `
                    <div class="alert alert-error">
                        <i class="fas fa-times-circle"></i>
                        <p>Could not verify transaction. Please contact support: 0759 695 025</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error verifying code:', error);
            showNotification('Error verifying payment');
        } finally {
            this.verifyCodeBtn.disabled = false;
            this.verifyCodeBtn.innerHTML = '<i class="fas fa-check"></i> Verify Payment';
        }
    }

    async createOrder(paymentMethod, transactionId) {
        try {
            // Generate order ID
            const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

            // Get primary seller (first item's seller for order filtering)
            const primarySellerId = this.orderItems[0]?.sellerId || null;

            // Prepare order data
            const orderData = {
                orderId,
                userId: this.user.uid,
                sellerId: primarySellerId, // For seller order queries
                items: this.orderItems.map(item => ({
                    listingId: item.listingId,
                    productName: item.name,
                    selectedVariation: item.selectedVariation,
                    quantity: item.quantity,
                    pricePerUnit: item.price,
                    totalPrice: item.totalPrice,
                    sellerId: item.sellerId
                })),
                buyerDetails: {
                    name: this.buyerNameEl.textContent,
                    phone: this.buyerPhoneEl.textContent,
                    location: this.buyerLocationEl.textContent,
                    deliveryAddress: this.deliveryAddressEl.value
                },
                paymentMethod,
                paymentStatus: paymentMethod === 'mpesa' ? 'completed' : 'pending',
                mpesaTransactionId: transactionId,
                shippingFee: this.shippingFee,
                discount: this.discount,
                subtotal: this.subtotal,
                totalAmount: this.total,
                orderDate: serverTimestamp(),
                orderStatus: 'pending',
                orderSource: this.orderSource,
                createdAt: serverTimestamp()
            };

            // Save to Firestore Orders collection
            await addDoc(collection(db, "Orders"), orderData);

            // Also save to user's orders subcollection
            await addDoc(collection(db, `users/${this.user.uid}/orders`), orderData);

            // Clear checkout/cart items
            await this.clearOrderSource();

            // Show success modal
            this.showSuccessModal(orderId);

        } catch (error) {
            console.error('Error creating order:', error);
            showNotification('Error creating order. Please contact support.');
            throw error;
        }
    }

    async clearOrderSource() {
        try {
            if (this.orderSource === 'buynow') {
                // Delete the cookie
                this.deleteCookie('buyNowItem');
            } else {
                // Clear cart from Firestore
                const snapshot = await getDocs(collection(db, `users/${this.user.uid}/cart`));
                const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
                await Promise.all(deletePromises);
            }
        } catch (error) {
            console.error('Error clearing order source:', error);
        }
    }

    showSuccessModal(orderId) {
        this.paymentModal.classList.remove('show');
        this.successModal.classList.add('show');
        this.orderRefNumber.textContent = orderId;
        clearInterval(this.paymentTimer);
    }

    cancelPayment() {
        if (confirm('Are you sure you want to cancel this payment?')) {
            clearInterval(this.paymentTimer);
            this.paymentModal.classList.remove('show');
        }
    }

    handlePaymentTimeout() {
        clearInterval(this.paymentTimer);
        this.paymentStatusEl.innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-clock"></i>
                <p>Payment window expired. If you've already paid, please enter your M-Pesa code below, or contact support.</p>
            </div>
        `;
        this.manualCodeEntry.style.display = 'block';
    }

    showLoading() {
        this.loadingSpinner.style.display = 'flex';
        this.checkoutContainer.style.display = 'none';
    }

    hideLoading() {
        this.loadingSpinner.style.display = 'none';
        this.checkoutContainer.style.display = 'grid';
    }
}

// Initialize checkout manager
document.addEventListener('DOMContentLoaded', () => {
    const checkoutManager = new CheckoutManager();
    checkoutManager.initialize();
});