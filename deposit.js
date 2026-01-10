/**
 * Deposit Page Module - Oda Pap
 * Handles wallet deposits via M-Pesa
 */

import { db, auth } from './js/firebase.js';
import { 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    orderBy, 
    limit, 
    onSnapshot,
    updateDoc,
    addDoc,
    serverTimestamp,
    increment,
    runTransaction
} from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';
import { MpesaPaymentManager, normalizePhoneNumber } from './js/mpesa.js';

class DepositManager {
    constructor() {
        this.user = null;
        this.userData = null;
        this.mpesaManager = null;
        this.paymentTimer = null;
        this.timerSeconds = 300; // 5 minutes
        this.unsubscribeTransactions = null;
        this.currentTransactionId = null;
        
        this.init();
    }
    
    async init() {
        this.showLoading(true);
        
        // Wait for auth state
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                this.user = user;
                await this.loadUserData();
                this.setupEventListeners();
                this.loadTransactions();
                this.showLoading(false);
            } else {
                // Redirect to login
                window.location.href = 'login.html?redirect=deposit.html';
            }
        });
    }
    
    async loadUserData() {
        try {
            const userDoc = await getDoc(doc(db, 'users', this.user.uid));
            if (userDoc.exists()) {
                this.userData = userDoc.data();
                this.updateBalanceDisplay();
                this.prefillPhone();
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }
    
    updateBalanceDisplay() {
        const balanceEl = document.getElementById('currentBalance');
        if (balanceEl && this.userData) {
            const balance = this.userData.walletBalance || 0;
            balanceEl.textContent = `KES ${balance.toLocaleString()}`;
        }
    }
    
    prefillPhone() {
        const phoneInput = document.getElementById('mpesaPhone');
        if (phoneInput && this.userData?.phone) {
            let phone = this.userData.phone.toString();
            // Remove country code prefix
            phone = phone.replace(/^\+?254/, '');
            if (phone.startsWith('0')) {
                phone = phone.substring(1);
            }
            phoneInput.value = phone;
            this.validatePhoneDisplay(phone);
        }
    }
    
    setupEventListeners() {
        // Deposit form
        const form = document.getElementById('depositForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleDeposit(e));
        }
        
        // Quick amount buttons
        document.querySelectorAll('.quick-amount-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const amount = parseInt(btn.dataset.amount);
                document.getElementById('depositAmount').value = amount;
                
                // Update active state
                document.querySelectorAll('.quick-amount-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        
        // Phone input validation
        const phoneInput = document.getElementById('mpesaPhone');
        if (phoneInput) {
            phoneInput.addEventListener('input', (e) => {
                // Format: only allow numbers
                let value = e.target.value.replace(/\D/g, '');
                
                // Remove leading 0 if entered
                if (value.startsWith('0')) {
                    value = value.substring(1);
                }
                
                // Remove 254 if entered
                if (value.startsWith('254')) {
                    value = value.substring(3);
                }
                
                // Limit to 9 digits
                value = value.substring(0, 9);
                
                e.target.value = value;
                this.validatePhoneDisplay(value);
            });
        }
        
        // Amount input - clear quick button selection when manually typed
        const amountInput = document.getElementById('depositAmount');
        if (amountInput) {
            amountInput.addEventListener('input', () => {
                const value = parseInt(amountInput.value);
                document.querySelectorAll('.quick-amount-btn').forEach(btn => {
                    if (parseInt(btn.dataset.amount) === value) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
            });
        }
        
        // Payment modal buttons
        document.getElementById('cancelPaymentBtn')?.addEventListener('click', () => {
            this.cancelPayment();
        });
        
        document.getElementById('verifyCodeBtn')?.addEventListener('click', () => {
            this.verifyManualCode();
        });
        
        // M-Pesa code input
        const mpesaCodeInput = document.getElementById('mpesaCode');
        if (mpesaCodeInput) {
            mpesaCodeInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            });
        }
    }
    
    validatePhoneDisplay(phone) {
        const validationEl = document.getElementById('phoneValidation');
        if (!validationEl) return;
        
        if (!phone || phone.length === 0) {
            validationEl.innerHTML = '';
            validationEl.className = 'phone-validation';
            return;
        }
        
        if (phone.length === 9 && /^[17]\d{8}$/.test(phone)) {
            validationEl.innerHTML = '<i class="fas fa-check-circle"></i> Valid phone number';
            validationEl.className = 'phone-validation valid';
        } else if (phone.length < 9) {
            validationEl.innerHTML = `<i class="fas fa-info-circle"></i> ${9 - phone.length} more digits needed`;
            validationEl.className = 'phone-validation';
        } else {
            validationEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Invalid phone number';
            validationEl.className = 'phone-validation invalid';
        }
    }
    
    async handleDeposit(e) {
        e.preventDefault();
        
        const amountInput = document.getElementById('depositAmount');
        const phoneInput = document.getElementById('mpesaPhone');
        const depositBtn = document.getElementById('depositBtn');
        
        const amount = parseInt(amountInput.value);
        let phone = phoneInput.value.replace(/\D/g, '');
        
        // Validate amount
        if (!amount || amount < 10) {
            this.showToast('Minimum deposit is KES 10', 'error');
            return;
        }
        
        if (amount > 150000) {
            this.showToast('Maximum deposit is KES 150,000', 'error');
            return;
        }
        
        // Validate phone
        if (phone.length !== 9 || !/^[17]\d{8}$/.test(phone)) {
            this.showToast('Please enter a valid Safaricom number', 'error');
            return;
        }
        
        // Format phone with country code
        phone = '254' + phone;
        
        // Show loading state
        depositBtn.disabled = true;
        depositBtn.querySelector('.btn-text').style.display = 'none';
        depositBtn.querySelector('.btn-loading').style.display = 'inline-flex';
        
        try {
            // Initialize M-Pesa manager
            this.mpesaManager = new MpesaPaymentManager(
                db,
                this.user.uid,
                amount,
                'deposit'
            );
            
            // Initiate STK Push
            const result = await this.mpesaManager.initiateSTKPush(phone);
            
            if (result.success) {
                this.currentTransactionId = result.transactionId;
                this.openPaymentModal(amount, phone);
                this.startPolling(result.transactionId);
            } else {
                this.showToast(result.message || 'Failed to initiate payment', 'error');
            }
        } catch (error) {
            console.error('Deposit error:', error);
            this.showToast('Failed to process deposit. Please try again.', 'error');
        } finally {
            depositBtn.disabled = false;
            depositBtn.querySelector('.btn-text').style.display = 'inline-flex';
            depositBtn.querySelector('.btn-loading').style.display = 'none';
        }
    }
    
    openPaymentModal(amount, phone) {
        const modal = document.getElementById('paymentModal');
        
        // Update display values
        document.getElementById('modalAmount').textContent = `KES ${amount.toLocaleString()}`;
        document.getElementById('modalPhone').textContent = '+' + phone.replace(/(\d{3})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4');
        
        // Reset status
        this.updatePaymentStatus('pending', 'Processing Payment', 'A payment request has been sent to your phone');
        
        // Hide manual code section initially
        document.getElementById('manualCodeSection').style.display = 'none';
        document.getElementById('mpesaCode').value = '';
        
        // Start timer
        this.timerSeconds = 300;
        this.startTimer();
        
        // Show modal
        modal.classList.add('active');
    }
    
    closePaymentModal() {
        const modal = document.getElementById('paymentModal');
        modal.classList.remove('active');
        
        this.stopTimer();
        this.stopPolling();
    }
    
    startTimer() {
        this.stopTimer();
        
        const timerEl = document.getElementById('paymentTimer');
        
        this.paymentTimer = setInterval(() => {
            this.timerSeconds--;
            
            const minutes = Math.floor(this.timerSeconds / 60);
            const seconds = this.timerSeconds % 60;
            timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            // Change color when low
            if (this.timerSeconds <= 60) {
                timerEl.parentElement.classList.add('warning');
            }
            
            // Show manual code section after 30 seconds
            if (this.timerSeconds <= 270) {
                document.getElementById('manualCodeSection').style.display = 'block';
            }
            
            if (this.timerSeconds <= 0) {
                this.stopTimer();
                this.updatePaymentStatus('timeout', 'Payment Timeout', 'The payment request has expired. Please try again or enter your M-Pesa code manually.');
            }
        }, 1000);
    }
    
    stopTimer() {
        if (this.paymentTimer) {
            clearInterval(this.paymentTimer);
            this.paymentTimer = null;
        }
    }
    
    startPolling(transactionId) {
        // Listen for transaction status changes
        const transactionRef = doc(db, 'MpesaTransactions', transactionId);
        
        this.unsubscribeTransaction = onSnapshot(transactionRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                
                if (data.status === 'completed') {
                    this.handlePaymentSuccess(data);
                } else if (data.status === 'failed') {
                    this.updatePaymentStatus('error', 'Payment Failed', data.failureReason || 'The payment was not completed. Please try again.');
                    document.getElementById('manualCodeSection').style.display = 'block';
                }
            }
        });
    }
    
    stopPolling() {
        if (this.unsubscribeTransaction) {
            this.unsubscribeTransaction();
            this.unsubscribeTransaction = null;
        }
    }
    
    updatePaymentStatus(status, title, message) {
        const statusIcon = document.getElementById('statusIcon');
        const statusTitle = document.getElementById('statusTitle');
        const statusMessage = document.getElementById('statusMessage');
        
        statusTitle.textContent = title;
        statusMessage.textContent = message;
        
        // Update icon state
        statusIcon.className = 'status-icon';
        
        switch (status) {
            case 'pending':
                statusIcon.innerHTML = '<div class="pulse-ring"></div><i class="fas fa-mobile-alt"></i>';
                break;
            case 'success':
                statusIcon.classList.add('success');
                statusIcon.innerHTML = '<i class="fas fa-check"></i>';
                break;
            case 'error':
            case 'timeout':
                statusIcon.classList.add('error');
                statusIcon.innerHTML = '<i class="fas fa-times"></i>';
                break;
        }
    }
    
    async handlePaymentSuccess(transactionData) {
        this.stopTimer();
        this.stopPolling();
        
        this.updatePaymentStatus('success', 'Payment Successful!', 'Your deposit is being processed...');
        
        try {
            // Credit wallet
            await this.creditWallet(transactionData.amount, transactionData.mpesaCode || transactionData.id);
            
            // Close payment modal
            setTimeout(() => {
                this.closePaymentModal();
                this.openSuccessModal(transactionData.amount);
            }, 1500);
        } catch (error) {
            console.error('Error crediting wallet:', error);
            this.showToast('Payment received but wallet update failed. Please contact support.', 'error');
        }
    }
    
    async creditWallet(amount, mpesaCode) {
        const userRef = doc(db, 'users', this.user.uid);
        
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) {
                throw new Error('User document not found');
            }
            
            const currentBalance = userDoc.data().walletBalance || 0;
            const newBalance = currentBalance + amount;
            
            // Update wallet balance
            transaction.update(userRef, {
                walletBalance: newBalance,
                lastDepositAt: serverTimestamp()
            });
            
            // Add to wallet transactions
            const txRef = doc(collection(db, 'users', this.user.uid, 'walletTransactions'));
            transaction.set(txRef, {
                type: 'deposit',
                amount: amount,
                mpesaCode: mpesaCode,
                balanceAfter: newBalance,
                status: 'completed',
                createdAt: serverTimestamp()
            });
            
            // Update local userData
            this.userData.walletBalance = newBalance;
        });
        
        this.updateBalanceDisplay();
    }
    
    async verifyManualCode() {
        const codeInput = document.getElementById('mpesaCode');
        const verifyBtn = document.getElementById('verifyCodeBtn');
        const code = codeInput.value.trim().toUpperCase();
        
        if (!code || code.length !== 10) {
            this.showToast('Please enter a valid 10-character M-Pesa code', 'error');
            return;
        }
        
        // Disable button
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        try {
            const amount = parseInt(document.getElementById('depositAmount').value);
            
            // Create verification request in Firestore
            await addDoc(collection(db, 'PendingPaymentVerifications'), {
                userId: this.user.uid,
                userEmail: this.user.email,
                userName: this.userData?.name || 'Unknown',
                type: 'deposit',
                amount: amount,
                mpesaCode: code,
                originalTransactionId: this.currentTransactionId,
                status: 'pending',
                createdAt: serverTimestamp()
            });
            
            this.showToast('Verification request submitted. You will be notified once verified.', 'success');
            
            // Close modal after delay
            setTimeout(() => {
                this.closePaymentModal();
            }, 2000);
        } catch (error) {
            console.error('Error submitting verification:', error);
            this.showToast('Failed to submit verification. Please try again.', 'error');
        } finally {
            verifyBtn.disabled = false;
            verifyBtn.innerHTML = '<i class="fas fa-check"></i> Verify';
        }
    }
    
    cancelPayment() {
        this.closePaymentModal();
        
        // Mark transaction as cancelled if exists
        if (this.currentTransactionId) {
            updateDoc(doc(db, 'MpesaTransactions', this.currentTransactionId), {
                status: 'cancelled',
                cancelledAt: serverTimestamp()
            }).catch(console.error);
        }
    }
    
    openSuccessModal(amount) {
        const modal = document.getElementById('successModal');
        
        document.getElementById('successAmount').textContent = `KES ${amount.toLocaleString()}`;
        document.getElementById('newBalance').textContent = `KES ${(this.userData?.walletBalance || 0).toLocaleString()}`;
        
        modal.classList.add('active');
    }
    
    loadTransactions() {
        const listEl = document.getElementById('transactionsList');
        const emptyEl = document.getElementById('noTransactions');
        
        // Get recent wallet transactions
        const txQuery = query(
            collection(db, 'users', this.user.uid, 'walletTransactions'),
            where('type', '==', 'deposit'),
            orderBy('createdAt', 'desc'),
            limit(10)
        );
        
        this.unsubscribeTransactions = onSnapshot(txQuery, (snapshot) => {
            if (snapshot.empty) {
                listEl.style.display = 'none';
                emptyEl.style.display = 'block';
                return;
            }
            
            listEl.style.display = 'block';
            emptyEl.style.display = 'none';
            
            listEl.innerHTML = snapshot.docs.map(doc => {
                const data = doc.data();
                const date = data.createdAt?.toDate?.() || new Date();
                const formattedDate = date.toLocaleDateString('en-KE', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                return `
                    <div class="transaction-item">
                        <div class="transaction-info">
                            <span class="transaction-type">M-Pesa Deposit</span>
                            <span class="transaction-date">${formattedDate}</span>
                        </div>
                        <div style="text-align: right;">
                            <div class="transaction-amount credit">KES ${data.amount?.toLocaleString() || 0}</div>
                            <span class="transaction-status ${data.status}">${data.status}</span>
                        </div>
                    </div>
                `;
            }).join('');
        });
    }
    
    showLoading(show) {
        const spinner = document.getElementById('loadingSpinner');
        if (spinner) {
            spinner.style.display = show ? 'flex' : 'none';
        }
    }
    
    showToast(message, type = 'info') {
        // Remove existing toast
        const existingToast = document.querySelector('.toast-notification');
        if (existingToast) {
            existingToast.remove();
        }
        
        const toast = document.createElement('div');
        toast.className = `toast-notification toast-${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        
        // Add toast styles if not present
        if (!document.getElementById('toast-styles')) {
            const style = document.createElement('style');
            style.id = 'toast-styles';
            style.textContent = `
                .toast-notification {
                    position: fixed;
                    bottom: 100px;
                    left: 50%;
                    transform: translateX(-50%);
                    padding: 14px 24px;
                    background: #333;
                    color: white;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    z-index: 4000;
                    font-size: 14px;
                    animation: slideUp 0.3s ease;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                }
                .toast-success { background: #4caf50; }
                .toast-error { background: #f44336; }
                @keyframes slideUp {
                    from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideUp 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// Global function for success modal
window.closeSuccessModal = function() {
    document.getElementById('successModal').classList.remove('active');
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new DepositManager();
});
