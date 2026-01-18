/**
 * M-Pesa Payment Module - Robust & Resilient
 * Handles M-Pesa STK Push payments with multiple phone number formats,
 * manual code verification, and concurrent transaction support.
 * 
 * Compatible with: checkout.html, deposit.html
 * 
 * IMPORTANT: Backend API runs on EC2 server at api.odapap.com
 */

import { getFirestore, collection, doc, addDoc, getDoc, updateDoc, serverTimestamp, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from './firebase.js';

const db = getFirestore(app);

// Configuration
const MPESA_CONFIG = {
    TIMEOUT_SECONDS: 300, // 5 minutes
    POLL_INTERVAL: 3000,  // 3 seconds
    MAX_RETRIES: 3,
    MANUAL_CODE_SHOW_AFTER: 60, // Show manual entry after 60 seconds
    
    // Production API endpoint
    API_BASE_URL: "https://api.odapap.com"
};

// Log configuration on load
console.log('🔧 M-Pesa Module Loaded');
console.log('📡 API Endpoint:', MPESA_CONFIG.API_BASE_URL);
console.log('🌐 Current Domain:', window.location.hostname);

/**
 * Normalize phone number to 254XXXXXXXXX format
 * Accepts: 0712345678, +254712345678, 254712345678, 712345678
 */
export function normalizePhoneNumber(phone) {
    if (!phone) return null;
    
    // Remove all non-numeric characters except +
    let cleaned = phone.toString().replace(/[^\d+]/g, '');
    
    // Remove leading +
    if (cleaned.startsWith('+')) {
        cleaned = cleaned.substring(1);
    }
    
    // Handle different formats
    if (cleaned.startsWith('254')) {
        // Already in correct format, validate length
        if (cleaned.length === 12) {
            return cleaned;
        }
    } else if (cleaned.startsWith('0')) {
        // Local format: 0712345678
        if (cleaned.length === 10) {
            return '254' + cleaned.substring(1);
        }
    } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
        // Without prefix: 712345678 or 112345678
        if (cleaned.length === 9) {
            return '254' + cleaned;
        }
    }
    
    // If none of the above worked, try to extract a valid number
    const match = cleaned.match(/(?:254|0)?([17]\d{8})$/);
    if (match) {
        return '254' + match[1];
    }
    
    return null; // Invalid number
}

/**
 * Validate phone number format
 */
export function isValidPhoneNumber(phone) {
    const normalized = normalizePhoneNumber(phone);
    return normalized !== null && /^254[17]\d{8}$/.test(normalized);
}

/**
 * Format phone for display: 254712345678 -> 0712 345 678
 */
export function formatPhoneForDisplay(phone) {
    const normalized = normalizePhoneNumber(phone);
    if (!normalized) return phone;
    
    const local = '0' + normalized.substring(3);
    return `${local.substring(0, 4)} ${local.substring(4, 7)} ${local.substring(7)}`;
}

/**
 * Generate unique transaction reference
 */
export function generateTransactionRef(prefix = 'TXN') {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

/**
 * M-Pesa Payment Manager Class
 * Handles the complete payment flow with resilience and error recovery
 */
export class MpesaPaymentManager {
    constructor(options = {}) {
        this.userId = options.userId;
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onPaymentComplete = options.onPaymentComplete || (() => {});
        this.onPaymentFailed = options.onPaymentFailed || (() => {});
        this.onError = options.onError || console.error;
        
        this.currentTransaction = null;
        this.pollTimer = null;
        this.timeoutTimer = null;
        this.unsubscribeSnapshot = null;
        this.retryCount = 0;
    }

    /**
     * Initiate M-Pesa STK Push Payment
     */
    async initiatePayment(params) {
        const { phoneNumber, amount, accountReference, description, metadata = {} } = params;
        
        // Validate phone number
        const normalizedPhone = normalizePhoneNumber(phoneNumber);
        if (!normalizedPhone) {
            throw new Error('Invalid phone number format. Please use format: 0712345678 or 254712345678');
        }
        
        // Validate amount
        const amountNum = parseFloat(amount);
        if (isNaN(amountNum) || amountNum < 1) {
            throw new Error('Invalid amount. Minimum is KES 1');
        }
        
        const transactionRef = generateTransactionRef('PAY');
        
        try {
            this.onStatusChange('initiating', 'Initiating payment request...');
            
            // Create transaction record in Firestore first
            const transactionData = {
                transactionRef,
                userId: this.userId,
                phoneNumber: normalizedPhone,
                amount: amountNum,
                accountReference: accountReference || transactionRef,
                description: description || 'Payment',
                status: 'pending',
                paymentMethod: 'mpesa_stk',
                metadata,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };
            
            const transactionDocRef = await addDoc(collection(db, 'MpesaTransactions'), transactionData);
            
            this.currentTransaction = {
                id: transactionDocRef.id,
                ref: transactionRef,
                phone: normalizedPhone,
                amount: amountNum
            };
            
            // Call backend to initiate STK Push - FIXED ENDPOINT
            const response = await this.callBackendAPI('/api/mpesa/stkpush', {
                transactionId: transactionDocRef.id,
                phoneNumber: normalizedPhone,
                amount: amountNum,
                accountReference: accountReference || transactionRef,
                transactionDesc: description || 'Payment'
            });
            
            if (response.success) {
                // Update transaction with checkout request ID
                await updateDoc(transactionDocRef, {
                    checkoutRequestId: response.checkoutRequestId,
                    merchantRequestId: response.merchantRequestId,
                    status: 'stk_sent',
                    updatedAt: serverTimestamp()
                });
                
                this.onStatusChange('stk_sent', 'Payment request sent to your phone. Please enter your M-Pesa PIN.');
                
                // Start listening for payment completion
                this.startPaymentListener(transactionDocRef.id);
                
                return {
                    success: true,
                    transactionId: transactionDocRef.id,
                    transactionRef,
                    checkoutRequestId: response.checkoutRequestId
                };
            } else {
                throw new Error(response.error || response.message || 'Failed to initiate payment');
            }
            
        } catch (error) {
            console.error('M-Pesa initiation error:', error);
            this.onStatusChange('error', error.message);
            this.onError(error);
            
            // If we have a transaction, mark it as failed
            if (this.currentTransaction?.id) {
                await this.updateTransactionStatus(this.currentTransaction.id, 'initiation_failed', error.message);
            }
            
            throw error;
        }
    }

    /**
     * Start listening for payment status changes
     */
    startPaymentListener(transactionId) {
        // Use Firestore real-time listener for immediate updates
        const docRef = doc(db, 'MpesaTransactions', transactionId);
        
        this.unsubscribeSnapshot = onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                this.handleStatusUpdate(data);
            }
        }, (error) => {
            console.error('Snapshot listener error:', error);
            // Fallback to polling on listener error
            this.startPolling(transactionId);
        });
        
        // Also start active status checking via API (as backup for callback failures)
        this.startActiveStatusCheck(transactionId);
        
        // Set timeout for payment window
        this.timeoutTimer = setTimeout(() => {
            this.handleTimeout();
        }, MPESA_CONFIG.TIMEOUT_SECONDS * 1000);
    }

    /**
     * Actively check payment status via M-Pesa API
     * This handles cases where callback doesn't reach the server
     */
    startActiveStatusCheck(transactionId) {
        // Wait 15 seconds then start checking
        setTimeout(() => {
            this.activeCheckTimer = setInterval(async () => {
                await this.queryPaymentStatus(transactionId);
            }, 10000); // Check every 10 seconds
        }, 15000);
    }

    /**
     * Query M-Pesa API for payment status
     */
    async queryPaymentStatus(transactionId) {
        try {
            // Get the transaction to find checkoutRequestId
            const docRef = doc(db, 'MpesaTransactions', transactionId);
            const snapshot = await getDoc(docRef);
            
            if (!snapshot.exists()) return;
            
            const data = snapshot.data();
            
            // Skip if already completed or failed
            if (['completed', 'success', 'failed', 'cancelled'].includes(data.status)) {
                this.stopActiveStatusCheck();
                return;
            }
            
            const checkoutRequestId = data.checkoutRequestId;
            if (!checkoutRequestId || checkoutRequestId.startsWith('FALLBACK')) return;
            
            console.log('🔍 Querying M-Pesa status for:', checkoutRequestId);
            
            const response = await this.callBackendAPI('/api/mpesa/query', {
                checkoutRequestId
            }, 1); // Only 1 retry for query
            
            if (response.success && response.data) {
                const resultCode = response.data.ResultCode;
                
                if (resultCode === '0' || resultCode === 0) {
                    // Payment successful - the callback should arrive with the receipt
                    // First check if the document already has the receipt from callback
                    const currentDoc = await getDoc(docRef);
                    const currentData = currentDoc.exists() ? currentDoc.data() : {};
                    
                    // If callback already processed and has receipt, use that
                    if (currentData.mpesaReceiptNumber) {
                        console.log('📝 M-Pesa Receipt (from callback):', currentData.mpesaReceiptNumber);
                        // Just update status if needed
                        if (currentData.status !== 'completed') {
                            await updateDoc(docRef, {
                                status: 'completed',
                                resultCode: 0,
                                updatedAt: serverTimestamp()
                            });
                        }
                    } else {
                        // Try to extract from query response (some sandbox environments)
                        let mpesaReceiptNumber = response.data.MpesaReceiptNumber || 
                                                  response.data.mpesaReceiptNumber ||
                                                  null;
                        
                        // Check CallbackMetadata if available
                        const callbackMetadata = response.data.CallbackMetadata?.Item || [];
                        for (const item of callbackMetadata) {
                            if (item.Name === 'MpesaReceiptNumber') {
                                mpesaReceiptNumber = item.Value;
                                break;
                            }
                        }
                        
                        console.log('📝 M-Pesa Receipt (from query):', mpesaReceiptNumber || 'pending callback');
                        
                        // Update Firestore - receipt will come from callback
                        await updateDoc(docRef, {
                            status: 'completed',
                            resultCode: 0,
                            resultDesc: 'Payment confirmed via query',
                            ...(mpesaReceiptNumber && { mpesaReceiptNumber }),
                            queryConfirmedAt: serverTimestamp(),
                            updatedAt: serverTimestamp()
                        });
                    }
                    console.log('✅ Payment confirmed via API query');
                } else if (resultCode !== undefined && resultCode !== '1032' && resultCode !== 1032) {
                    // Failed (but not user cancellation which we might want to retry)
                    await updateDoc(docRef, {
                        status: 'failed',
                        resultCode: parseInt(resultCode),
                        resultDesc: response.data.ResultDesc || 'Payment failed',
                        updatedAt: serverTimestamp()
                    });
                    console.log('❌ Payment failed via API query:', response.data.ResultDesc);
                }
            }
        } catch (error) {
            // Query failed - this is ok, callback might still come through
            console.log('Query status check failed (will retry):', error.message);
        }
    }

    /**
     * Stop active status checking
     */
    stopActiveStatusCheck() {
        if (this.activeCheckTimer) {
            clearInterval(this.activeCheckTimer);
            this.activeCheckTimer = null;
        }
    }

    /**
     * Manually check payment status (user-initiated)
     */
    async checkPaymentStatus() {
        if (!this.currentTransaction?.id) {
            throw new Error('No active transaction to check');
        }
        
        this.onStatusChange('checking', 'Checking payment status...');
        
        try {
            await this.queryPaymentStatus(this.currentTransaction.id);
            
            // Re-fetch the transaction to get updated status
            const docRef = doc(db, 'MpesaTransactions', this.currentTransaction.id);
            const snapshot = await getDoc(docRef);
            
            if (snapshot.exists()) {
                const data = snapshot.data();
                
                if (data.status === 'completed' || data.status === 'success') {
                    return { success: true, status: 'completed', data };
                } else if (data.status === 'failed' || data.status === 'cancelled') {
                    return { success: false, status: data.status, message: data.resultDesc };
                } else {
                    return { success: false, status: 'pending', message: 'Payment is still being processed' };
                }
            }
        } catch (error) {
            console.error('Status check error:', error);
            throw new Error('Could not check payment status. Please try again or enter M-Pesa code manually.');
        }
    }

    /**
     * Handle status updates from Firestore
     */
    handleStatusUpdate(data) {
        const status = data.status;
        const resultCode = data.resultCode;
        
        // User-friendly messages for specific M-Pesa result codes
        const resultMessages = {
            1032: 'You cancelled the payment request',
            1037: 'Payment request timed out. Please try again.',
            2001: 'Wrong M-Pesa PIN entered',
            1: 'Insufficient M-Pesa balance',
            1025: 'Invalid phone number format',
            1019: 'Transaction expired. Please try again.'
        };
        
        switch (status) {
            case 'completed':
            case 'success':
                this.cleanup();
                this.onStatusChange('completed', 'Payment successful!');
                
                // Get receipt from Firestore data (callback updates this)
                const mpesaReceiptNumber = data.mpesaReceiptNumber || data.mpesaCode || null;
                
                console.log('Payment complete:', {
                    transactionId: this.currentTransaction?.id,
                    mpesaReceiptNumber: mpesaReceiptNumber,
                    amount: data.amount,
                    phoneNumber: data.phoneNumber
                });
                
                this.onPaymentComplete({
                    transactionId: this.currentTransaction?.id,
                    mpesaReceiptNumber: mpesaReceiptNumber,
                    mpesaCode: mpesaReceiptNumber, // Alias for compatibility
                    amount: data.amount,
                    phoneNumber: data.phoneNumber,
                    // Include raw transaction data for audit
                    rawTransactionData: {
                        checkoutRequestId: data.checkoutRequestId,
                        merchantRequestId: data.merchantRequestId,
                        transactionDate: data.transactionDate,
                        completedAt: data.completedAt
                    }
                });
                break;
                
            case 'failed':
            case 'cancelled':
                this.cleanup();
                const userMessage = resultMessages[resultCode] || data.resultDescription || 'Payment was not completed';
                this.onStatusChange('failed', userMessage);
                this.onPaymentFailed({
                    transactionId: this.currentTransaction?.id,
                    reason: userMessage,
                    resultCode: resultCode
                });
                break;
                
            case 'stk_sent':
                this.onStatusChange('waiting', 'Waiting for you to enter M-Pesa PIN...');
                break;
                
            default:
                // Still pending
                break;
        }
    }

    /**
     * Fallback polling mechanism
     */
    startPolling(transactionId) {
        if (this.pollTimer) return;
        
        this.pollTimer = setInterval(async () => {
            try {
                const docRef = doc(db, 'MpesaTransactions', transactionId);
                const snapshot = await getDoc(docRef);
                
                if (snapshot.exists()) {
                    this.handleStatusUpdate(snapshot.data());
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
        }, MPESA_CONFIG.POLL_INTERVAL);
    }

    /**
     * Handle payment timeout
     */
    handleTimeout() {
        this.onStatusChange('timeout', 'Payment window expired. You can enter your M-Pesa code manually if you have already paid.');
        
        if (this.currentTransaction?.id) {
            this.updateTransactionStatus(this.currentTransaction.id, 'timeout', 'Payment window expired');
        }
    }

    /**
     * Verify manual M-Pesa code
     */
    async verifyManualCode(mpesaCode, expectedAmount = null) {
        if (!mpesaCode || mpesaCode.length < 10) {
            throw new Error('Please enter a valid M-Pesa transaction code (10 characters)');
        }
        
        const code = mpesaCode.trim().toUpperCase();
        
        this.onStatusChange('verifying', 'Verifying your payment...');
        
        try {
            // Check if code was already used
            const existingQuery = query(
                collection(db, 'MpesaTransactions'),
                where('mpesaReceiptNumber', '==', code),
                where('status', '==', 'completed')
            );
            const existingSnapshot = await getDocs(existingQuery);
            
            if (!existingSnapshot.empty) {
                throw new Error('This transaction code has already been used');
            }
            
            // Call backend to verify with Safaricom - FIXED ENDPOINT
            try {
                const response = await this.callBackendAPI('/api/mpesa/verify', {
                    mpesaCode: code,
                    expectedAmount: expectedAmount || this.currentTransaction?.amount,
                    phoneNumber: this.currentTransaction?.phone
                });
                
                if (response.success && response.data?.verified) {
                    // Update transaction as completed
                    if (this.currentTransaction?.id) {
                        await this.updateTransactionStatus(this.currentTransaction.id, 'completed', null, {
                            mpesaReceiptNumber: code,
                            verificationMethod: 'manual_code'
                        });
                    }
                    
                    this.cleanup();
                    this.onStatusChange('completed', 'Payment verified successfully!');
                    this.onPaymentComplete({
                        transactionId: this.currentTransaction?.id,
                        mpesaReceiptNumber: code,
                        amount: expectedAmount || this.currentTransaction?.amount,
                        verificationMethod: 'manual'
                    });
                    
                    return { success: true, code };
                } else {
                    throw new Error(response.error || response.message || 'Could not verify transaction');
                }
            } catch (apiError) {
                // If API verification fails, create a pending verification for admin review
                console.log('API verification failed, creating pending verification:', apiError);
                
                const verificationData = {
                    mpesaCode: code,
                    transactionId: this.currentTransaction?.id,
                    transactionRef: this.currentTransaction?.ref,
                    userId: this.userId,
                    phoneNumber: this.currentTransaction?.phone,
                    expectedAmount: expectedAmount || this.currentTransaction?.amount,
                    status: 'pending_verification',
                    submittedAt: serverTimestamp()
                };
                
                await addDoc(collection(db, 'PendingPaymentVerifications'), verificationData);
                
                // Update main transaction
                if (this.currentTransaction?.id) {
                    await this.updateTransactionStatus(this.currentTransaction.id, 'pending_verification', null, {
                        manualCode: code,
                        verificationMethod: 'manual_pending'
                    });
                }
                
                this.onStatusChange('pending_verification', 'Your payment code has been submitted for verification. You will be notified once verified.');
                
                return { 
                    success: true, 
                    pendingVerification: true,
                    code 
                };
            }
        } catch (error) {
            this.onStatusChange('verification_failed', error.message);
            throw error;
        }
    }

    /**
     * Call backend API with retry logic
     */
    async callBackendAPI(endpoint, data, retries = MPESA_CONFIG.MAX_RETRIES) {
        const url = `${MPESA_CONFIG.API_BASE_URL}${endpoint}`;
        
        console.log('🔄 M-Pesa API Request:');
        console.log('   URL:', url);
        console.log('   Endpoint:', endpoint);
        console.log('   Data:', data);
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    mode: 'cors',
                    credentials: 'omit',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                
                console.log('📥 Response received:');
                console.log('   Status:', response.status, response.statusText);
                console.log('   Headers:', Object.fromEntries(response.headers.entries()));
                
                // Check if response is JSON
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    const text = await response.text();
                    console.error('❌ Non-JSON response received:', text.substring(0, 200));
                    throw new Error('Server returned non-JSON response. Backend may not be running.');
                }
                
                const result = await response.json();
                console.log('📦 JSON Response:', result);
                
                if (!response.ok) {
                    throw new Error(result.error || result.message || `HTTP ${response.status}`);
                }
                
                console.log('✅ API call successful');
                return result;
                
            } catch (error) {
                console.error(`❌ API attempt ${attempt}/${retries} failed:`);
                console.error('   Error type:', error.name);
                console.error('   Error message:', error.message);
                console.error('   URL was:', url);
                
                if (attempt === retries) {
                    console.warn('⚠️ All API attempts failed, using fallback mode');
                    return this.getFallbackResponse(endpoint, data);
                }
                
                // Wait before retrying (exponential backoff)
                const waitTime = Math.pow(2, attempt) * 1000;
                console.log(`⏳ Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    /**
     * Fallback response for when backend is unavailable
     * This allows the system to continue functioning with manual verification
     */
    getFallbackResponse(endpoint, data) {
        console.log('🔄 Using fallback response for:', endpoint);
        
        if (endpoint === '/api/mpesa/stkpush') {
            return {
                success: true,
                checkoutRequestId: `FALLBACK-${Date.now()}`,
                merchantRequestId: `MR-${Date.now()}`,
                message: 'Payment initiated in offline mode. Please enter your M-Pesa code after paying.'
            };
        }
        
        if (endpoint === '/api/mpesa/verify') {
            return {
                success: false,
                message: 'Automatic verification unavailable. Your code has been submitted for manual review.'
            };
        }
        
        return { success: false, error: 'Service temporarily unavailable' };
    }

    /**
     * Update transaction status in Firestore
     */
    async updateTransactionStatus(transactionId, status, resultDescription = null, additionalData = {}) {
        try {
            const docRef = doc(db, 'MpesaTransactions', transactionId);
            await updateDoc(docRef, {
                status,
                ...(resultDescription && { resultDescription }),
                ...additionalData,
                updatedAt: serverTimestamp()
            });
        } catch (error) {
            console.error('Failed to update transaction status:', error);
        }
    }

    /**
     * Cancel current payment
     */
    cancel() {
        if (this.currentTransaction?.id) {
            this.updateTransactionStatus(this.currentTransaction.id, 'cancelled', 'Cancelled by user');
        }
        this.cleanup();
        this.onStatusChange('cancelled', 'Payment cancelled');
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        if (this.unsubscribeSnapshot) {
            this.unsubscribeSnapshot();
            this.unsubscribeSnapshot = null;
        }
        
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        
        this.stopActiveStatusCheck();
    }

    /**
     * Destroy instance
     */
    destroy() {
        this.cleanup();
        this.currentTransaction = null;
    }
}

/**
 * Get shipping fee based on location
 * Uses settings from admin panel with zone-based pricing
 */
export async function getShippingFee(county, subcounty, ward) {
    try {
        // Try to get from Firestore settings
        const settingsDoc = await getDoc(doc(db, 'Settings', 'shipping'));
        
        if (settingsDoc.exists()) {
            const settings = settingsDoc.data();
            const zones = settings.zones || [];
            
            // Check for matching zone
            for (const zone of zones) {
                // Check if subcounty matches
                if (zone.subcounty === subcounty) {
                    // If zone has specific wards, check if our ward is included
                    if (zone.wards && zone.wards.length > 0) {
                        if (zone.wards.includes(ward)) {
                            return zone.fee;
                        }
                    } else {
                        // Zone applies to all wards in subcounty
                        return zone.fee;
                    }
                }
            }
            
            // No specific zone found, use default
            return settings.defaultFee || 150;
        }
    } catch (error) {
        console.error('Error fetching shipping fee:', error);
    }
    
    // Default pricing for Mombasa subcounties (fallback)
    const mombasaPricing = {
        'Mvita': 100,
        'Nyali': 120,
        'Kisauni': 150,
        'Likoni': 180,
        'Changamwe': 150,
        'Jomvu': 150
    };
    
    if (county?.toLowerCase().includes('mombasa') && mombasaPricing[subcounty]) {
        return mombasaPricing[subcounty];
    }
    
    return 150; // Default
}

/**
 * Check if order qualifies for free shipping
 */
export async function checkFreeShipping(orderTotal) {
    try {
        const settingsDoc = await getDoc(doc(db, 'Settings', 'shipping'));
        
        if (settingsDoc.exists()) {
            const settings = settingsDoc.data();
            const threshold = settings.freeThreshold || 0;
            
            if (threshold > 0 && orderTotal >= threshold) {
                return true;
            }
        }
    } catch (error) {
        console.error('Error checking free shipping:', error);
    }
    
    return false;
}

export default MpesaPaymentManager;