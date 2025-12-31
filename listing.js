import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { app } from "./js/firebase.js";
import { showNotification } from './notifications.js';
import { categoryHierarchy, brandsByCategory } from './js/categoryData.js';

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ================= RESILIENCE UTILITIES =================
// Debounce: Delays execution until user stops triggering (for input events)
function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle: Limits execution rate (for scroll/resize events)
function throttle(func, limit = 100) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Retry with exponential backoff for network operations
async function withRetry(operation, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            // Don't retry on auth errors or validation errors
            if (error.code === 'permission-denied' || error.code === 'unauthenticated' || 
                error.code === 'invalid-argument' || error.name === 'ValidationError') {
                throw error;
            }
            if (attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
                console.warn(`Attempt ${attempt} failed, retrying in ${Math.round(delay)}ms...`, error.message);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

// Safe localStorage operations with fallback
const safeStorage = {
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            console.warn('localStorage read error:', e);
            return defaultValue;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn('localStorage write error:', e);
            // Handle quota exceeded
            if (e.name === 'QuotaExceededError') {
                this.cleanup();
                try {
                    localStorage.setItem(key, JSON.stringify(value));
                    return true;
                } catch (e2) {
                    return false;
                }
            }
            return false;
        }
    },
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.warn('localStorage remove error:', e);
        }
    },
    cleanup() {
        // Remove old/less important items to free space
        const keysToClean = ['listing_draft_backup', 'old_queue_data'];
        keysToClean.forEach(key => {
            try { localStorage.removeItem(key); } catch (e) {}
        });
    }
};

// Input sanitization to prevent XSS and injection
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input
        .replace(/[<>]/g, '') // Remove angle brackets
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+=/gi, '') // Remove event handlers
        .trim()
        .slice(0, 5000); // Limit length
}

// Validate and sanitize form data
function sanitizeFormData(data) {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
            sanitized[key] = sanitizeInput(value);
        } else if (Array.isArray(value)) {
            sanitized[key] = value.map(item => 
                typeof item === 'string' ? sanitizeInput(item) : item
            );
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

// Network status monitoring
let isOnline = navigator.onLine;
let networkListenersAttached = false;

function setupNetworkMonitoring() {
    if (networkListenersAttached) return;
    networkListenersAttached = true;
    
    window.addEventListener('online', () => {
        isOnline = true;
        showNotification('Connection restored! You can continue working.', 'success');
        // Resume any pending operations
        if (uploadQueue.length > 0 && !isProcessingQueue) {
            processQueue();
        }
    });
    
    window.addEventListener('offline', () => {
        isOnline = false;
        showNotification('You are offline. Changes will be saved locally.', 'warning');
    });
}

// Check if user is online before network operations
function requireOnline() {
    if (!navigator.onLine) {
        throw new Error('No internet connection. Please check your network and try again.');
    }
}

// Mutex/lock for preventing concurrent operations
const operationLocks = new Map();

async function withLock(lockName, operation) {
    if (operationLocks.get(lockName)) {
        console.warn(`Operation "${lockName}" already in progress, skipping.`);
        return null;
    }
    operationLocks.set(lockName, true);
    try {
        return await operation();
    } finally {
        operationLocks.delete(lockName);
    }
}

// Rate limiter for API calls
const rateLimiter = {
    calls: new Map(),
    isAllowed(key, limit = 5, windowMs = 10000) {
        const now = Date.now();
        const windowStart = now - windowMs;
        
        if (!this.calls.has(key)) {
            this.calls.set(key, []);
        }
        
        const callTimes = this.calls.get(key).filter(time => time > windowStart);
        this.calls.set(key, callTimes);
        
        if (callTimes.length >= limit) {
            return false;
        }
        
        callTimes.push(now);
        return true;
    },
    reset(key) {
        this.calls.delete(key);
    }
};

// Global error handler for uncaught promise rejections
window.addEventListener('unhandledrejection', event => {
    console.error('Unhandled promise rejection:', event.reason);
    // Don't show notification for every rejection, only critical ones
    if (event.reason?.message?.includes('network') || 
        event.reason?.message?.includes('firebase')) {
        showNotification('A network error occurred. Please try again.', 'error');
    }
});

// ================= DOM HELPERS (reduce repetitive lookups) =================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
const $q = (sel) => document.querySelector(sel);

// Cache commonly accessed elements (initialized after DOM ready)
let DOM = {};
function cacheDOMElements() {
    DOM = {
        category: $('category'),
        subcategory: $('subcategory'),
        subsubcategory: $('subsubcategory'),
        customSubsubcategory: $('custom-subsubcategory'),
        brandName: $('brand-name'),
        customBrand: $('custom-brand'),
        customBrandGroup: $('custom-brand-group'),
        itemName: $('item-name'),
        description: $('description'),
        itemPrice: $('item-price'),
        initialPrice: $('initial-price'),
        submitButton: $('submit-button'),
        variationsContainer: $('variations-container'),
        bulkTiersContainer: $('bulk-tiers-container'),
        bulkPricingContainer: $('bulk-pricing-container'),
        listingsContainer: $('listings-container'),
        spinner: $('spinner')
    };
}

// Helper to get form field values as object
function getFormValues() {
    return {
        category: DOM.category?.value || '',
        subcategory: DOM.subcategory?.value || '',
        subsubcategory: DOM.subsubcategory?.value || '',
        customSubsubcategory: DOM.customSubsubcategory?.value || '',
        brandName: DOM.brandName?.value || '',
        customBrand: DOM.customBrand?.value || '',
        itemName: DOM.itemName?.value || '',
        description: DOM.description?.value || '',
        itemPrice: DOM.itemPrice?.value || '',
        initialPrice: DOM.initialPrice?.value || ''
    };
}

// Helper to set form field values from object
function setFormValues(data) {
    if (DOM.category && data.category) DOM.category.value = data.category;
    if (DOM.subcategory && data.subcategory) DOM.subcategory.value = data.subcategory;
    if (DOM.subsubcategory && data.subsubcategory) DOM.subsubcategory.value = data.subsubcategory;
    if (DOM.customSubsubcategory) DOM.customSubsubcategory.value = data.customSubsubcategory || '';
    if (DOM.brandName && data.brandName) DOM.brandName.value = data.brandName;
    if (DOM.customBrand) DOM.customBrand.value = data.customBrand || '';
    if (DOM.itemName) DOM.itemName.value = data.itemName || '';
    if (DOM.description) DOM.description.value = data.description || '';
    if (DOM.itemPrice) DOM.itemPrice.value = data.itemPrice || '';
    if (DOM.initialPrice) DOM.initialPrice.value = data.initialPrice || '';
}

// Helper for validation errors (focus + notification)
function showValidationError(message, field = null, step = null) {
    showNotification(message, 'warning');
    if (step !== null && currentStep !== step) {
        currentStep = step;
        showStep(step);
    }
    if (field) {
        setTimeout(() => {
            if (field.classList?.contains('searchable-select-hidden')) {
                const wrapper = field.nextElementSibling;
                if (wrapper?.classList.contains('searchable-dropdown')) {
                    wrapper.querySelector('.dropdown-trigger')?.click();
                    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                }
            }
            field.focus?.();
            field.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
    return false;
}

// Multi-step wizard state
let currentStep = 1;
const totalSteps = 4;
let variations = [];
let variationCounter = 0;
let bulkTiers = [];
let bulkTierCounter = 0;
let additionalImages = [];
const MAX_VARIATIONS = 3;
const MAX_ATTRIBUTES_PER_VARIATION = 5;

// Upload Queue System
let uploadQueue = [];
let isProcessingQueue = false;
const QUEUE_STORAGE_KEY = 'listing_upload_queue';
const DRAFT_STORAGE_KEY = 'listing_draft';
const MAX_RETRIES = 3;
const UPLOAD_TIMEOUT = 60000; // 60 seconds timeout per image
const MAX_IMAGE_SIZE = 1024; // Max width/height for compression
const IMAGE_QUALITY = 0.8; // JPEG quality

// ================= IMAGE COMPRESSION =================
async function compressImage(file, maxSize = MAX_IMAGE_SIZE, quality = IMAGE_QUALITY) {
    return new Promise((resolve, reject) => {
        // Skip compression for small files (< 800KB)
        if (file.size < 800 * 1024) {
            resolve(file);
            return;
        }

        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        img.onload = () => {
            let { width, height } = img;
            
            // Calculate new dimensions
            if (width > height && width > maxSize) {
                height = (height * maxSize) / width;
                width = maxSize;
            } else if (height > maxSize) {
                width = (width * maxSize) / height;
                height = maxSize;
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        const compressedFile = new File([blob], file.name, {
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        });
                        console.log(`Compressed ${file.name}: ${(file.size/1024).toFixed(1)}KB → ${(blob.size/1024).toFixed(1)}KB`);
                        resolve(compressedFile);
                    } else {
                        resolve(file); // Fallback to original
                    }
                },
                'image/jpeg',
                quality
            );
        };

        img.onerror = () => resolve(file); // Fallback to original on error
        img.src = URL.createObjectURL(file);
    });
}

// Upload with timeout
async function uploadWithTimeout(ref, blob, timeoutMs = UPLOAD_TIMEOUT) {
    return Promise.race([
        uploadBytes(ref, blob),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Upload timeout - please check your connection')), timeoutMs)
        )
    ]);
}

// ================= QUEUE MANAGEMENT =================
function initializeQueue() {
    const stored = safeStorage.get(QUEUE_STORAGE_KEY, []);
    if (stored && stored.length > 0) {
        uploadQueue = stored;
        showQueueUI();
        // Delay processing to ensure UI is ready
        setTimeout(() => processQueue(), 1000);
    }
}

function saveQueueToStorage() {
    safeStorage.set(QUEUE_STORAGE_KEY, uploadQueue);
}

function addToQueue(listingData) {
    const queueItem = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        data: listingData,
        status: 'pending',
        retries: 0,
        createdAt: Date.now(),
        progress: 0
    };
    
    uploadQueue.push(queueItem);
    saveQueueToStorage();
    showQueueUI();
    
    if (!isProcessingQueue) {
        processQueue();
    }
    
    return queueItem.id;
}

function updateQueueItemProgress(itemId, progress, status, message = '') {
    const item = uploadQueue.find(q => q.id === itemId);
    if (item) {
        item.message = message;
        item.progress = progress;
        item.status = status;
        saveQueueToStorage();
        updateQueueUI();
    }
}

function removeFromQueue(itemId) {
    uploadQueue = uploadQueue.filter(q => q.id !== itemId);
    saveQueueToStorage();
    updateQueueUI();
    
    if (uploadQueue.length === 0) {
        hideQueueUI();
    }
}

async function processQueue() {
    if (isProcessingQueue || uploadQueue.length === 0) return;
    
    isProcessingQueue = true;
    
    while (uploadQueue.length > 0) {
        const pendingItems = uploadQueue.filter(q => q.status === 'pending' || q.status === 'retrying');
        if (pendingItems.length === 0) break;
        
        const item = pendingItems[0];
        
        try {
            updateQueueItemProgress(item.id, 0, 'uploading');
            await uploadListingFromQueue(item);
            removeFromQueue(item.id);
            showNotification(`✓ Listing "${item.data.itemName}" uploaded successfully!`, 'success');
            
            // Refresh listings to show the real data from Firestore
            // This will replace any preview elements with actual data
            await loadUserListings();
            
        } catch (error) {
            console.error("Error processing queue item:", error);
            
            if (item.retries < MAX_RETRIES) {
                item.retries++;
                item.status = 'retrying';
                updateQueueItemProgress(item.id, 0, 'retrying');
                saveQueueToStorage();
                
                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, item.retries) * 1000));
            } else {
                item.status = 'failed';
                item.error = error.message;
                updateQueueItemProgress(item.id, 0, 'failed');
                showNotification(`Failed to upload "${item.data.itemName}". Keeping in queue for retry.`, 'error');
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    isProcessingQueue = false;
}

async function uploadListingFromQueue(queueItem) {
    const { data } = queueItem;
    const user = auth.currentUser;
    
    if (!user) throw new Error("User not authenticated");
    
    const startTime = Date.now();
    
    // Upload product images in PARALLEL for speed
    updateQueueItemProgress(queueItem.id, 5, 'uploading', `Uploading ${data.productImages.length} product images...`);
    
    const imageUrls = [];
    if (data.productImages.length > 0) {
        const uploadPromises = data.productImages.map(async (img, i) => {
            const fileRef = storageRef(storage, `listings/${user.uid}/products/${Date.now()}_${i}_${img.name}`);
            const blob = await fetch(img.dataUrl).then(r => r.blob());
            await uploadWithTimeout(fileRef, blob);
            return getDownloadURL(fileRef);
        });
        
        const results = await Promise.all(uploadPromises);
        imageUrls.push(...results);
        
        updateQueueItemProgress(queueItem.id, 40, 'uploading', 'Product images uploaded!');
    }
    
    // Process variations with attributes - upload variation images in parallel
    updateQueueItemProgress(queueItem.id, 45, 'uploading', 'Processing variation options...');
    const processedVariations = [];
    
    // Collect all variation image uploads
    const variationImageUploads = [];
    const variationImageMap = new Map();
    
    for (let vIdx = 0; vIdx < data.variations.length; vIdx++) {
        const variation = data.variations[vIdx];
        for (let aIdx = 0; aIdx < variation.attributes.length; aIdx++) {
            const attr = variation.attributes[aIdx];
            if (attr.imageFile) {
                const key = `${vIdx}-${aIdx}`;
                const fileRef = storageRef(storage, `listings/${user.uid}/variations/${Date.now()}_${vIdx}_${aIdx}_${attr.imageFile.name}`);
                variationImageUploads.push(
                    fetch(attr.imageFile.dataUrl)
                        .then(r => r.blob())
                        .then(blob => uploadWithTimeout(fileRef, blob))
                        .then(() => getDownloadURL(fileRef))
                        .then(url => variationImageMap.set(key, url))
                );
            }
        }
    }
    
    // Upload all variation images in parallel
    if (variationImageUploads.length > 0) {
        updateQueueItemProgress(queueItem.id, 55, 'uploading', `Uploading ${variationImageUploads.length} variation images...`);
        await Promise.all(variationImageUploads);
    }
    
    updateQueueItemProgress(queueItem.id, 70, 'uploading', 'Finalizing variations...');
    
    // Build processed variations with uploaded URLs
    for (let vIdx = 0; vIdx < data.variations.length; vIdx++) {
        const variation = data.variations[vIdx];
        const variationAttributes = [];
        
        for (let aIdx = 0; aIdx < variation.attributes.length; aIdx++) {
            const attr = variation.attributes[aIdx];
            const key = `${vIdx}-${aIdx}`;
            
            variationAttributes.push({
                attr_name: attr.attr_name,
                stock: attr.stock,
                piece_count: attr.piece_count,
                price: attr.price,
                originalPrice: attr.originalPrice || attr.price,
                retailPrice: attr.retailPrice || null,
                photoUrl: variationImageMap.get(key) || null
            });
        }
        
        processedVariations.push({
            title: variation.title,
            attributes: variationAttributes
        });
    }
    
    // Calculate total stock
    const totalStock = processedVariations.reduce((sum, v) => {
        return sum + v.attributes.reduce((attrSum, attr) => attrSum + attr.stock, 0);
    }, 0);
    
    // Save custom category if needed
    if (data.subsubcategory === 'custom' && data.customSubsubcategory) {
        await saveCustomCategory(data.category, data.subcategory, data.customSubsubcategory);
    }
    
    updateQueueItemProgress(queueItem.id, 85, 'uploading', 'Saving listing to database...');
    
    const listingData = {
        uploaderId: user.uid,
        category: data.category,
        subcategory: data.subcategory,
        subsubcategory: data.finalSubsubcategory,
        name: data.itemName,
        brand: data.brandName,
        description: data.description,
        price: data.finalPrice,
        originalPrice: data.itemPrice,
        initialPrice: data.initialPrice,
        imageUrls,
        variations: processedVariations,
        bulkPricing: data.bulkPricing.length > 0 ? data.bulkPricing : null,
        totalStock,
        updatedAt: new Date().toISOString()
    };
    
    if (data.listingId) {
        await updateDoc(doc(db, "Listings", data.listingId), listingData);
    } else {
        listingData.createdAt = new Date().toISOString();
        await addDoc(collection(db, "Listings"), listingData);
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    updateQueueItemProgress(queueItem.id, 100, 'completed', `Done in ${totalTime}s!`);
}

// ================= QUEUE UI =================
function showQueueUI() {
    let queueContainer = $('upload-queue-container');
    
    if (!queueContainer) {
        queueContainer = document.createElement('div');
        queueContainer.id = 'upload-queue-container';
        queueContainer.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 380px;
            max-height: 450px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 12px 40px rgba(0,0,0,0.2);
            z-index: 10000;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            border: 2px solid #ff5722;
        `;
        
        queueContainer.innerHTML = `
            <div style="padding: 16px; background: linear-gradient(135deg, #ff5722 0%, #e64a19 100%); color: white; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-cloud-upload-alt" style="font-size: 20px;"></i>
                    <div>
                        <strong style="font-size: 15px;">Upload Queue</strong>
                        <div id="queue-count" style="font-size: 11px; opacity: 0.9;"></div>
                    </div>
                </div>
                <button onclick="toggleQueueUI()" style="background: rgba(255,255,255,0.25); border: none; color: white; padding: 6px 10px; border-radius: 6px; cursor: pointer;">
                    <i class="fas fa-chevron-down" id="queue-toggle-icon"></i>
                </button>
            </div>
            <div id="queue-items" style="padding: 12px; overflow-y: auto; max-height: 350px;">
            </div>
        `;
        
        document.body.appendChild(queueContainer);
    }
    
    queueContainer.style.display = 'flex';
    updateQueueUI();
}

function hideQueueUI() {
    const queueContainer = $('upload-queue-container');
    if (queueContainer) {
        queueContainer.style.display = 'none';
    }
}

function updateQueueUI() {
    const queueItems = $('queue-items');
    if (!queueItems) return;
    
    // Update queue count
    const queueCount = $('queue-count');
    const uploading = uploadQueue.filter(q => q.status === 'uploading').length;
    const pending = uploadQueue.filter(q => q.status === 'pending' || q.status === 'retrying').length;
    if (queueCount) {
        if (uploading > 0) {
            queueCount.textContent = `Uploading ${uploading} • ${pending} pending`;
        } else if (pending > 0) {
            queueCount.textContent = `${pending} item(s) waiting`;
        } else {
            queueCount.textContent = 'All uploads complete';
        }
    }
    
    if (uploadQueue.length === 0) {
        queueItems.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No uploads in queue</p>';
        return;
    }
    
    queueItems.innerHTML = uploadQueue.map(item => {
        let statusIcon = '⏳';
        let statusText = 'Pending';
        let statusColor = '#ff9800';
        
        if (item.status === 'uploading') {
            statusIcon = '🔄';
            statusText = 'Uploading';
            statusColor = '#2196F3';
        } else if (item.status === 'completed') {
            statusIcon = '✓';
            statusText = 'Completed';
            statusColor = '#4CAF50';
        } else if (item.status === 'failed') {
            statusIcon = '✗';
            statusText = 'Failed';
            statusColor = '#f44336';
        } else if (item.status === 'retrying') {
            statusIcon = '🔄';
            statusText = `Retry ${item.retries}/${MAX_RETRIES}`;
            statusColor = '#ff9800';
        }
        
        return `
            <div style="background: #f5f5f5; padding: 12px; margin-bottom: 8px; border-radius: 8px; border-left: 4px solid ${statusColor};">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                    <strong style="font-size: 13px; flex: 1;">${item.data.itemName}</strong>
                    ${item.status === 'failed' ? `
                        <button onclick="retryUpload('${item.id}')" style="background: #ff9800; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-left: 8px;">
                            <i class="fas fa-redo"></i> Retry
                        </button>
                    ` : ''}
                    ${item.status === 'pending' || item.status === 'failed' ? `
                        <button onclick="removeQueueItem('${item.id}')" style="background: #f44336; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-left: 4px;">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                </div>
                <div style="display: flex; align-items: center; gap: 8px; font-size: 12px;">
                    <span>${statusIcon}</span>
                    <span style="color: ${statusColor};">${statusText}</span>
                    ${item.progress > 0 ? `<span style="color: #666;">${item.progress}%</span>` : ''}
                </div>
                ${item.message ? `<small style="color: #666; display: block; margin-top: 4px; font-style: italic;">${item.message}</small>` : ''}
                ${item.progress > 0 && item.status === 'uploading' ? `
                    <div style="background: #e0e0e0; height: 6px; border-radius: 3px; margin-top: 8px; overflow: hidden;">
                        <div style="background: linear-gradient(90deg, ${statusColor}, ${statusColor}cc); height: 100%; width: ${item.progress}%; transition: width 0.3s; border-radius: 3px;"></div>
                    </div>
                ` : ''}
                ${item.error ? `<small style="color: #f44336; display: block; margin-top: 4px;">❌ ${item.error}</small>` : ''}
            </div>
        `;
    }).join('');
}

window.toggleQueueUI = function() {
    const queueItems = $('queue-items');
    const icon = $('queue-toggle-icon');
    
    if (queueItems.style.display === 'none') {
        queueItems.style.display = 'block';
        icon.className = 'fas fa-chevron-down';
    } else {
        queueItems.style.display = 'none';
        icon.className = 'fas fa-chevron-up';
    }
};

window.retryUpload = function(itemId) {
    const item = uploadQueue.find(q => q.id === itemId);
    if (item) {
        item.status = 'pending';
        item.retries = 0;
        item.error = null;
        saveQueueToStorage();
        updateQueueUI();
        
        if (!isProcessingQueue) {
            processQueue();
        }
    }
};

window.removeQueueItem = function(itemId) {
    removeFromQueue(itemId);
    showNotification('Upload removed from queue', 'info');
};

// ================= AUTO-SAVE DRAFT =================
let draftSaveTimeout;

// Debounced draft save to prevent excessive writes
const debouncedSaveDraft = debounce(() => {
    saveDraft();
}, 2000);

function saveDraft() {
    // Collect image previews (compressed dataURLs)
    const imageDataUrls = [];
    for (let i = 1; i <= 5; i++) {
        const label = $(`image-upload-label-${i}`);
        if (label && label.classList.contains('has-image')) {
            const bgImage = label.style.backgroundImage;
            if (bgImage && bgImage.startsWith('url(')) {
                const dataUrl = bgImage.slice(5, -2);
                imageDataUrls.push({ index: i, dataUrl });
            }
        }
    }
    
    const draftData = {
        ...getFormValues(),
        images: imageDataUrls,
        currentStep,
        timestamp: Date.now()
    };
    
    // Try to save with images first, fallback to without
    if (!safeStorage.set(DRAFT_STORAGE_KEY, draftData)) {
        console.warn("Error saving draft with images, trying without");
        delete draftData.images;
        safeStorage.set(DRAFT_STORAGE_KEY, draftData);
    }
}

function loadDraft() {
    const draft = safeStorage.get(DRAFT_STORAGE_KEY);
    if (!draft) return false;
    
    // Only load if draft is less than 7 days old
    if (Date.now() - draft.timestamp > 7 * 24 * 60 * 60 * 1000) {
        safeStorage.remove(DRAFT_STORAGE_KEY);
        return false;
    }
    
    // Calculate what data exists in the draft
    const draftInfo = getDraftSummary(draft);
    
    // Show confirmation dialog
    return new Promise((resolve) => {
        showDraftDialog(draft, draftInfo, (accepted) => {
            if (accepted) {
                restoreDraftData(draft);
                resolve(true);
            } else {
                safeStorage.remove(DRAFT_STORAGE_KEY);
                showNotification('Starting fresh - previous draft discarded', 'info');
                resolve(false);
            }
        });
    });
}

// Get summary of draft data for display
function getDraftSummary(draft) {
    const info = {
        hasCategory: !!draft.category,
        hasSubcategory: !!draft.subcategory,
        hasBrand: !!draft.brandName && draft.brandName !== '',
        hasName: !!draft.itemName && draft.itemName.trim() !== '',
        hasDescription: !!draft.description && draft.description.trim() !== '',
        hasImages: draft.images && draft.images.length > 0,
        imageCount: draft.images?.length || 0,
        step: draft.currentStep || 1,
        age: Math.floor((Date.now() - draft.timestamp) / (1000 * 60 * 60)) // hours ago
    };
    
    // Build missing items list
    info.missingItems = [];
    if (!info.hasCategory) info.missingItems.push('Category');
    if (!info.hasSubcategory) info.missingItems.push('Sub-category');
    if (!info.hasBrand) info.missingItems.push('Brand');
    if (!info.hasName) info.missingItems.push('Product Name');
    if (!info.hasDescription) info.missingItems.push('Description');
    if (!info.hasImages) info.missingItems.push('Product Images');
    
    return info;
}

// Show draft resumption dialog
function showDraftDialog(draft, draftInfo, callback) {
    // Remove existing dialog if any
    const existingDialog = $('draft-resume-dialog');
    if (existingDialog) existingDialog.remove();
    
    const ageText = draftInfo.age < 1 ? 'Just now' : 
                    draftInfo.age < 24 ? `${draftInfo.age} hour${draftInfo.age > 1 ? 's' : ''} ago` :
                    `${Math.floor(draftInfo.age / 24)} day${Math.floor(draftInfo.age / 24) > 1 ? 's' : ''} ago`;
    
    const stepNames = ['', 'Classification', 'Product Details', 'Variations', 'Review'];
    
    // Build status items
    let statusHTML = '<div class="draft-status-grid">';
    statusHTML += `<div class="status-item ${draftInfo.hasCategory ? 'complete' : 'missing'}">
        <i class="fas ${draftInfo.hasCategory ? 'fa-check-circle' : 'fa-times-circle'}"></i>
        <span>Category${draftInfo.hasCategory ? `: ${draft.category}` : ''}</span>
    </div>`;
    statusHTML += `<div class="status-item ${draftInfo.hasBrand ? 'complete' : 'missing'}">
        <i class="fas ${draftInfo.hasBrand ? 'fa-check-circle' : 'fa-times-circle'}"></i>
        <span>Brand${draftInfo.hasBrand ? `: ${draft.brandName}` : ''}</span>
    </div>`;
    statusHTML += `<div class="status-item ${draftInfo.hasName ? 'complete' : 'missing'}">
        <i class="fas ${draftInfo.hasName ? 'fa-check-circle' : 'fa-times-circle'}"></i>
        <span>Name${draftInfo.hasName ? `: ${draft.itemName.substring(0, 20)}${draft.itemName.length > 20 ? '...' : ''}` : ''}</span>
    </div>`;
    statusHTML += `<div class="status-item ${draftInfo.hasImages ? 'complete' : 'missing'}">
        <i class="fas ${draftInfo.hasImages ? 'fa-check-circle' : 'fa-times-circle'}"></i>
        <span>Images${draftInfo.hasImages ? ` (${draftInfo.imageCount})` : ''}</span>
    </div>`;
    statusHTML += '</div>';
    
    // Missing items warning
    let missingWarning = '';
    if (draftInfo.missingItems.length > 0) {
        missingWarning = `
            <div class="draft-missing-warning">
                <i class="fas fa-exclamation-triangle"></i>
                <span><strong>Missing:</strong> ${draftInfo.missingItems.join(', ')}</span>
            </div>
        `;
    }
    
    const dialog = document.createElement('div');
    dialog.id = 'draft-resume-dialog';
    dialog.className = 'draft-dialog-overlay';
    dialog.innerHTML = `
        <div class="draft-dialog">
            <div class="draft-dialog-header">
                <i class="fas fa-file-alt"></i>
                <h3>Resume Previous Work?</h3>
            </div>
            <div class="draft-dialog-body">
                <p class="draft-meta">
                    <i class="fas fa-clock"></i> Saved ${ageText} 
                    <span class="draft-step-badge">Step ${draftInfo.step}: ${stepNames[draftInfo.step]}</span>
                </p>
                ${statusHTML}
                ${missingWarning}
            </div>
            <div class="draft-dialog-actions">
                <button type="button" class="draft-btn draft-btn-discard" id="draft-discard-btn">
                    <i class="fas fa-trash-alt"></i> Start Fresh
                </button>
                <button type="button" class="draft-btn draft-btn-resume" id="draft-resume-btn">
                    <i class="fas fa-play"></i> Continue Editing
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Add event listeners
    $('draft-resume-btn').addEventListener('click', () => {
        dialog.remove();
        callback(true);
    });
    
    $('draft-discard-btn').addEventListener('click', () => {
        dialog.remove();
        callback(false);
    });
    
    // Close on overlay click
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            dialog.remove();
            callback(false);
        }
    });
}

// Actually restore the draft data
function restoreDraftData(draft) {
    try {
        // Restore category and trigger cascading dropdowns
        if (DOM.category) {
            DOM.category.value = draft.category || '';
            updateSearchableDropdownDisplay('category');
            if (draft.category) DOM.category.dispatchEvent(new Event('change'));
        }
        
        // Allow cascading dropdowns to populate
        setTimeout(() => {
            if (DOM.subcategory) {
                DOM.subcategory.value = draft.subcategory || '';
                updateSearchableDropdownDisplay('subcategory');
                if (draft.subcategory) DOM.subcategory.dispatchEvent(new Event('change'));
            }
            
            setTimeout(() => {
                if (DOM.subsubcategory) DOM.subsubcategory.value = draft.subsubcategory || '';
                updateSearchableDropdownDisplay('subsubcategory');
                if (DOM.customSubsubcategory) DOM.customSubsubcategory.value = draft.customSubsubcategory || '';
                if (DOM.brandName) DOM.brandName.value = draft.brandName || '';
                updateSearchableDropdownDisplay('brand-name');
                if (DOM.customBrand) DOM.customBrand.value = draft.customBrand || '';
            }, 200);
        }, 200);
        
        // Restore text fields
        if (DOM.itemName) DOM.itemName.value = draft.itemName || '';
        if (DOM.description) DOM.description.value = draft.description || '';
        if (DOM.itemPrice) DOM.itemPrice.value = draft.itemPrice || '';
        if (DOM.initialPrice) DOM.initialPrice.value = draft.initialPrice || '';
        
        // Restore saved images (preview only)
        if (draft.images?.length > 0) {
            draft.images.forEach(img => {
                const label = $(`image-upload-label-${img.index}`);
                if (label && img.dataUrl) {
                    label.style.backgroundImage = `url(${img.dataUrl})`;
                    label.classList.add('has-image', 'restored-preview');
                    const icon = label.querySelector('i');
                    const uploadText = label.querySelector('.upload-text');
                    if (icon) icon.style.display = 'none';
                    if (uploadText) uploadText.style.display = 'none';
                }
            });
        }
        
        // Restore current step if saved
        if (draft.currentStep > 1) {
            currentStep = draft.currentStep;
            showStep(currentStep);
        }
        
        showNotification('📝 Your progress has been restored', 'success');
        
    } catch (e) {
        console.error("Error restoring draft:", e);
        safeStorage.remove(DRAFT_STORAGE_KEY);
    }
}

// Update searchable dropdown display to match select value
function updateSearchableDropdownDisplay(selectId) {
    const select = $(selectId);
    const wrapper = $(`${selectId}-searchable`);
    if (!select || !wrapper) return;
    
    const trigger = wrapper.querySelector('.dropdown-trigger');
    const selectedOption = select.options[select.selectedIndex];
    
    if (selectedOption?.value) {
        trigger.querySelector('.selected-text').textContent = selectedOption.textContent.replace(' ★', '');
        trigger.querySelector('.selected-text').classList.remove('placeholder');
        wrapper.querySelectorAll('.dropdown-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === selectedOption.value);
        });
    }
}

function clearDraft() {
    safeStorage.remove(DRAFT_STORAGE_KEY);
}

// Auto-save on input changes (debounced)
function setupAutoSave() {
    const fields = [
        'category', 'subcategory', 'subsubcategory', 'custom-subsubcategory',
        'item-name', 'brand-name', 'custom-brand', 'description', 
        'item-price', 'initial-price'
    ];
    
    fields.forEach(fieldId => {
        const field = $(fieldId);
        if (field) {
            field.addEventListener('input', () => {
                clearTimeout(draftSaveTimeout);
                draftSaveTimeout = setTimeout(saveDraft, 2000);
            });
        }
    });
}

// ================= INITIALIZE CATEGORIES =================
function initializeCategoryDropdown() {
    const categorySelect = $('category');
    categorySelect.innerHTML = '<option value="">Select a category</option>';
    
    Object.keys(categoryHierarchy).forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = categoryHierarchy[key].label;
        categorySelect.appendChild(option);
    });
    
    // Convert to searchable dropdown
    convertToSearchableDropdown('category');
}

// ================= SEARCHABLE DROPDOWN =================
function convertToSearchableDropdown(selectId) {
    const select = $(selectId);
    if (!select) return;
    
    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-dropdown';
    wrapper.id = `${selectId}-searchable`;
    
    // Create trigger button
    const trigger = document.createElement('div');
    trigger.className = 'dropdown-trigger';
    trigger.innerHTML = `
        <span class="selected-text placeholder">${select.options[0]?.textContent || 'Select...'}</span>
        <i class="fas fa-chevron-down dropdown-arrow"></i>
    `;
    
    // Create dropdown menu
    const menu = document.createElement('div');
    menu.className = 'dropdown-menu';
    menu.innerHTML = `
        <div class="dropdown-search">
            <input type="text" placeholder="Type to search..." autocomplete="off">
        </div>
        <div class="dropdown-options"></div>
    `;
    
    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);
    
    // Insert wrapper after select
    select.parentNode.insertBefore(wrapper, select.nextSibling);
    select.classList.add('searchable-select-hidden');
    
    // Build options
    buildDropdownOptions(select, menu.querySelector('.dropdown-options'));
    
    // Event: Toggle dropdown
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.contains('show');
        
        // Close all other dropdowns
        $$('.dropdown-menu.show').forEach(m => {
            m.classList.remove('show');
            m.closest('.searchable-dropdown').querySelector('.dropdown-trigger').classList.remove('active');
        });
        
        if (!isOpen) {
            menu.classList.add('show');
            trigger.classList.add('active');
            menu.querySelector('input').focus();
        }
    });
    
    // Event: Search (debounced for better performance)
    const searchInput = menu.querySelector('input');
    const handleSearch = debounce((query) => {
        const options = menu.querySelectorAll('.dropdown-option');
        let hasVisible = false;
        
        options.forEach(option => {
            const text = option.querySelector('.option-text')?.textContent.toLowerCase() || '';
            const match = text.includes(query);
            option.style.display = match ? 'flex' : 'none';
            if (match) hasVisible = true;
        });
        
        // Show no results message
        let noResults = menu.querySelector('.no-results');
        if (!hasVisible) {
            if (!noResults) {
                noResults = document.createElement('div');
                noResults.className = 'no-results';
                noResults.textContent = 'No matches found';
                menu.querySelector('.dropdown-options').appendChild(noResults);
            }
            noResults.style.display = 'block';
        } else if (noResults) {
            noResults.style.display = 'none';
        }
    }, 150);
    
    searchInput.addEventListener('input', (e) => {
        handleSearch(e.target.value.toLowerCase());
    });
    
    // Event: Select option
    menu.querySelector('.dropdown-options').addEventListener('click', (e) => {
        const option = e.target.closest('.dropdown-option');
        if (!option) return;
        
        const value = option.dataset.value;
        const text = option.querySelector('.option-text')?.textContent || option.textContent;
        
        // Update select
        select.value = value;
        select.dispatchEvent(new Event('change'));
        
        // Update trigger
        trigger.querySelector('.selected-text').textContent = text;
        trigger.querySelector('.selected-text').classList.remove('placeholder');
        
        // Update selected state
        menu.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        
        // Close menu
        menu.classList.remove('show');
        trigger.classList.remove('active');
        menu.querySelector('input').value = '';
        menu.querySelectorAll('.dropdown-option').forEach(o => o.style.display = 'flex');
    });
    
    // Close on outside click
    document.addEventListener('click', () => {
        menu.classList.remove('show');
        trigger.classList.remove('active');
    });
    
    // Prevent menu clicks from closing
    menu.addEventListener('click', (e) => e.stopPropagation());
}

function buildDropdownOptions(select, container) {
    container.innerHTML = '';
    
    const categoryIcons = {
        'fashion': 'fa-tshirt',
        'electronics': 'fa-laptop',
        'phones': 'fa-mobile-alt',
        'beauty': 'fa-spa',
        'health': 'fa-heartbeat',
        'home': 'fa-home',
        'kitchenware': 'fa-utensils',
        'furniture': 'fa-couch',
        'appliances': 'fa-plug',
        'baby': 'fa-baby',
        'sports': 'fa-futbol',
        'automotive': 'fa-car',
        'books': 'fa-book',
        'groceries': 'fa-shopping-basket',
        'food-beverages': 'fa-hamburger',
        'pets': 'fa-paw',
        'jewelry': 'fa-gem',
        'office': 'fa-briefcase',
        'garden': 'fa-leaf',
        'industrial': 'fa-industry'
    };
    
    Array.from(select.options).forEach((option, index) => {
        if (index === 0 && !option.value) return; // Skip placeholder
        
        const div = document.createElement('div');
        div.className = 'dropdown-option';
        div.dataset.value = option.value;
        
        if (select.value === option.value) {
            div.classList.add('selected');
        }
        
        const icon = categoryIcons[option.value] || 'fa-tag';
        const isCustom = option.dataset.custom === 'true';
        
        div.innerHTML = `
            <div class="option-icon"><i class="fas ${icon}"></i></div>
            <span class="option-text">${option.textContent.replace(' ★', '')}</span>
            ${isCustom ? '<span class="custom-badge">★ USER</span>' : ''}
        `;
        
        container.appendChild(div);
    });
}

// Update searchable dropdown when select options change
function refreshSearchableDropdown(selectId) {
    const select = $(selectId);
    const wrapper = $(`${selectId}-searchable`);
    if (!select || !wrapper) return;
    
    const container = wrapper.querySelector('.dropdown-options');
    const trigger = wrapper.querySelector('.dropdown-trigger');
    
    buildDropdownOptions(select, container);
    
    // Reset trigger text if current value is not in new options
    const currentValue = select.value;
    const hasValue = Array.from(select.options).some(o => o.value === currentValue);
    
    if (!hasValue || !currentValue) {
        trigger.querySelector('.selected-text').textContent = select.options[0]?.textContent || 'Select...';
        trigger.querySelector('.selected-text').classList.add('placeholder');
    }
}

// ================= STEP NAVIGATION =================
const stepNames = {
    1: 'Classification',
    2: 'Product Info', 
    3: 'Inventory',
    4: 'Review'
};

function updateProgressBar() {
    $$('.progress-step').forEach((step, index) => {
        const stepNum = index + 1;
        step.classList.remove('active', 'completed');
        
        if (stepNum < currentStep) {
            step.classList.add('completed');
        } else if (stepNum === currentStep) {
            step.classList.add('active');
        }
    });
    
    // Update floating nav indicator
    updateFloatingNav();
}

function updateFloatingNav() {
    const navIndicator = $('floating-nav-indicator');
    if (navIndicator) {
        const currentStepSpan = navIndicator.querySelector('.current-step');
        if (currentStepSpan) {
            currentStepSpan.textContent = `Step ${currentStep}: ${stepNames[currentStep]}`;
        }
        
        const dots = navIndicator.querySelectorAll('.step-dot');
        dots.forEach((dot, index) => {
            const stepNum = index + 1;
            dot.classList.remove('active', 'completed');
            if (stepNum === currentStep) {
                dot.classList.add('active');
            } else if (stepNum < currentStep) {
                dot.classList.add('completed');
            }
        });
        
        // Show floating nav when scrolled past the progress bar
        const progressBar = $q('.progress-bar');
        if (progressBar) {
            const rect = progressBar.getBoundingClientRect();
            if (rect.bottom < 0) {
                navIndicator.classList.add('visible');
            } else {
                navIndicator.classList.remove('visible');
            }
        }
    }
}

function showStep(step) {
    $$('.form-step').forEach(s => s.classList.remove('active'));
    $q(`.form-step[data-step="${step}"]`)?.classList.add('active');
    
    // Update navigation buttons
    const prevBtn = $('prev-btn');
    const nextBtn = $('next-btn');
    const submitBtn = $('submit-button');
    
    // Always show prev on step > 1
    prevBtn.style.display = step === 1 ? 'none' : 'flex';
    prevBtn.innerHTML = `<i class="fas fa-chevron-left"></i><span class="nav-btn-text">Back to ${stepNames[step - 1] || ''}</span>`;
    
    // Next button with step name
    nextBtn.style.display = step === totalSteps ? 'none' : 'flex';
    nextBtn.innerHTML = `<span class="nav-btn-text">${stepNames[step + 1] || 'Next'}</span><i class="fas fa-chevron-right"></i>`;
    
    // Submit button
    submitBtn.style.display = step === totalSteps ? 'flex' : 'none';
    
    if (step === 4) {
        updateReviewSummary();
        calculatePricing();
    }
    
    updateProgressBar();
    
    // Smooth scroll with offset for sticky nav
    setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
}

function validateStep(step) {
    const stepElement = $q(`.form-step[data-step="${step}"]`);
    if (!stepElement) return false;
    
    const requiredFields = stepElement.querySelectorAll('[required]');
    
    // Field name mapping for user-friendly messages
    const fieldNames = {
        'category': 'Main Category',
        'subcategory': 'Sub-Category',
        'subsubcategory': 'Specific Type',
        'brand-name': 'Brand Name',
        'custom-brand': 'Custom Brand Name',
        'custom-subsubcategory': 'Custom Type',
        'item-name': 'Product Name',
        'description': 'Product Description',
        'item-price': 'Base Price',
        'initial-price': 'Original Retail Price'
    };
    
    // Collect all missing fields for this step
    const missingFields = [];
    
    for (let field of requiredFields) {
        if (!field.value || (field.tagName === 'SELECT' && field.value === '')) {
            const fieldName = fieldNames[field.id] || field.placeholder || 'Required field';
            missingFields.push({ name: fieldName, element: field });
        }
    }
    
    // Step 1 specific validation for fields without HTML required attribute
    if (step === 1) {
        const subsubcategoryGroup = $('subsubcategory-group');
        
        if (subsubcategoryGroup?.style.display !== 'none') {
            if (DOM.subsubcategory?.value === 'Other' || DOM.subsubcategory?.value === 'other') {
                if (!DOM.customSubsubcategory?.value.trim()) {
                    missingFields.push({ name: 'Custom Type', element: DOM.customSubsubcategory });
                }
            } else if (!DOM.subsubcategory?.value) {
                missingFields.push({ name: 'Specific Type', element: DOM.subsubcategory });
            }
        }
        
        // Check brand-name
        if (DOM.brandName?.value === 'Custom/Other' || DOM.brandName?.value === 'Other' || DOM.brandName?.value === 'other') {
            if (DOM.customBrandGroup?.style.display !== 'none' && !DOM.customBrand?.value.trim()) {
                missingFields.push({ name: 'New Brand Name', element: DOM.customBrand });
            }
        } else if (!DOM.brandName?.value) {
            missingFields.push({ name: 'Brand Name', element: DOM.brandName });
        }
    }
    
    // Show combined missing fields message
    if (missingFields.length > 0) {
        const fieldList = missingFields.map(f => f.name).join(', ');
        const message = missingFields.length === 1 
            ? `Please fill in: ${fieldList}`
            : `Missing ${missingFields.length} fields: ${fieldList}`;
        
        showMissingFieldsNotification(message, missingFields);
        return false;
    }
    
    if (step === 2) {
        // Check for at least one product image
        let hasImage = false;
        let hasRestoredPreview = false;
        for (let i = 1; i <= 5; i++) {
            const imageInput = $(`media-upload-${i}`);
            const label = $(`image-upload-label-${i}`);
            if (imageInput && imageInput.files[0]) {
                hasImage = true;
                break;
            }
            // Check if there's a restored preview without actual file
            if (label && label.classList.contains('restored-preview')) {
                hasRestoredPreview = true;
            }
        }
        if (!hasImage) {
            if (hasRestoredPreview) {
                showMissingFieldsNotification(
                    '⚠️ Image files need re-upload. Your previous images were restored as previews only - please re-select them.',
                    [{ name: 'Product Images', element: $('image-upload-label-1') }]
                );
            } else {
                showMissingFieldsNotification(
                    '📸 Please upload at least 1 product image',
                    [{ name: 'Product Images', element: $('image-upload-label-1') }]
                );
            }
            return false;
        }
    }
    
    if (step === 3) {
        const variationRows = $$('.variation-row');
        if (variationRows.length === 0) {
            showMissingFieldsNotification(
                '📦 Please add at least one product variation (e.g., Size, Color)',
                []
            );
            return false;
        }
        
        // Check each variation has a type and at least one attribute
        for (let row of variationRows) {
            const variationTitle = getVariationTitle(row);
            if (!variationTitle || variationTitle.trim() === '') {
                showMissingFieldsNotification(
                    '🏷️ Please select or enter a variation type for all variations',
                    [{ name: 'Variation Type', element: row.querySelector('.variation-type-select') }]
                );
                return false;
            }
            
            const attributes = row.querySelectorAll('.attribute-item');
            if (attributes.length === 0) {
                showMissingFieldsNotification(
                    `📋 Please add at least one option for "${variationTitle}"`,
                    []
                );
                return false;
            }
            
            // Check each attribute has required fields with valid values
            for (let attr of attributes) {
                const nameInput = attr.querySelector('.attribute-name');
                const stockInput = attr.querySelector('.attribute-stock');
                const priceInput = attr.querySelector('.attribute-price');
                
                const name = nameInput?.value?.trim();
                const stockValue = stockInput?.value;
                const priceValue = priceInput?.value;
                
                const attrMissing = [];
                
                if (!name || name === '') {
                    attrMissing.push('Option Name');
                }
                if (!stockValue || stockValue === '' || parseInt(stockValue) < 1) {
                    attrMissing.push('Stock (min 1)');
                }
                if (!priceValue || priceValue === '' || parseFloat(priceValue) <= 0) {
                    attrMissing.push('Price (> 0)');
                }
                
                if (attrMissing.length > 0) {
                    const optionName = name || 'this option';
                    showMissingFieldsNotification(
                        `⚠️ In "${variationTitle}" > ${optionName}: Missing ${attrMissing.join(', ')}`,
                        [{ name: attrMissing[0], element: attrMissing.includes('Option Name') ? nameInput : (attrMissing.includes('Stock') ? stockInput : priceInput) }]
                    );
                    return false;
                }
            }
        }
    }
    
    return true;
}

// Enhanced notification for missing fields
function showMissingFieldsNotification(message, fields) {
    showNotification(message, 'warning');
    
    // Focus and highlight first missing field
    if (fields.length > 0 && fields[0].element) {
        const field = fields[0].element;
        setTimeout(() => {
            // Handle searchable dropdowns
            if (field.classList?.contains('searchable-select-hidden')) {
                const wrapper = field.nextElementSibling;
                if (wrapper?.classList.contains('searchable-dropdown')) {
                    wrapper.querySelector('.dropdown-trigger')?.classList.add('field-error');
                    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => wrapper.querySelector('.dropdown-trigger')?.classList.remove('field-error'), 3000);
                    return;
                }
            }
            
            // Regular fields
            field.classList?.add('field-error');
            field.focus?.();
            field.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            setTimeout(() => field.classList?.remove('field-error'), 3000);
        }, 100);
    }
}

$('next-btn').addEventListener('click', () => {
    if (validateStep(currentStep)) {
        currentStep++;
        showStep(currentStep);
    }
});

$('prev-btn').addEventListener('click', () => {
    currentStep--;
    showStep(currentStep);
});

// Floating nav visibility on scroll
window.addEventListener('scroll', throttle(() => {
    const navIndicator = $('floating-nav-indicator');
    const progressBar = $q('.progress-bar');
    if (navIndicator && progressBar) {
        const rect = progressBar.getBoundingClientRect();
        if (rect.bottom < -50) {
            navIndicator.classList.add('visible');
        } else {
            navIndicator.classList.remove('visible');
        }
    }
}, 100));

// ================= CATEGORY HIERARCHY =================
$('category').addEventListener('change', function() {
    const category = this.value;
    const subcategoryGroup = $('subcategory-group');
    const subcategorySelect = $('subcategory');
    const subsubcategoryGroup = $('subsubcategory-group');
    
    subcategorySelect.innerHTML = '<option value="">Select sub-category</option>';
    subsubcategoryGroup.style.display = 'none';
    $('custom-subsubcategory-group').style.display = 'none';
    
    if (category && categoryHierarchy[category]) {
        subcategoryGroup.style.display = 'block';
        subcategorySelect.disabled = false;
        
        Object.keys(categoryHierarchy[category].subcategories).forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = categoryHierarchy[category].subcategories[key].label;
            subcategorySelect.appendChild(option);
        });
        
        updateBrandDropdown(category);
        
        // Refresh searchable dropdowns
        refreshSearchableDropdown('subcategory');
        refreshSearchableDropdown('brand-name');
    } else {
        subcategoryGroup.style.display = 'none';
        subcategorySelect.disabled = true;
    }
});

$('subcategory').addEventListener('change', async function() {
    const category = DOM.category?.value;
    const subcategory = this.value;
    const subsubcategoryGroup = $('subsubcategory-group');
    const subsubcategorySelect = $('subsubcategory');
    
    subsubcategorySelect.innerHTML = '<option value="">Select specific type</option>';
    $('custom-subsubcategory-group').style.display = 'none';
    
    if (subcategory && categoryHierarchy[category]?.subcategories[subcategory]) {
        subsubcategoryGroup.style.display = 'block';
        subsubcategorySelect.disabled = false;
        
        const defaultTypes = categoryHierarchy[category].subcategories[subcategory].types;
        const customTypes = await loadCustomCategories(category, subcategory);
        const allTypes = [...new Set([...defaultTypes, ...customTypes])];
        
        allTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.toLowerCase().replace(/\s+/g, '-');
            option.textContent = type;
            if (customTypes.includes(type) && !defaultTypes.includes(type)) {
                option.textContent = `${type} ★`;
                option.dataset.custom = 'true';
            }
            subsubcategorySelect.appendChild(option);
        });
        
        refreshSearchableDropdown('subsubcategory');
    } else {
        subsubcategoryGroup.style.display = 'none';
        subsubcategorySelect.disabled = true;
    }
});

$('subsubcategory').addEventListener('change', function() {
    const customGroup = $('custom-subsubcategory-group');
    
    if (this.value === 'custom') {
        customGroup.style.display = 'block';
        $('custom-subsubcategory').required = true;
    } else {
        customGroup.style.display = 'none';
        $('custom-subsubcategory').required = false;
    }
});

async function updateBrandDropdown(category) {
    const brandSelect = DOM.brandName;
    if (!brandSelect) return;
    
    brandSelect.innerHTML = '<option value="">Select brand</option>';
    
    // Add "Add New Brand" option at the TOP
    const addNewOption = document.createElement('option');
    addNewOption.value = 'Custom/Other';
    addNewOption.textContent = '+ Add New Brand';
    addNewOption.style.fontWeight = 'bold';
    addNewOption.className = 'add-new-brand-option';
    brandSelect.appendChild(addNewOption);
    
    // Get default brands
    const defaultBrands = brandsByCategory[category] || ["Generic"];
    
    // Load custom brands from Firestore (category-specific)
    const customBrands = await loadCustomBrands(category);
    
    // Combine brands, excluding Custom/Other from defaults
    const regularBrands = defaultBrands.filter(b => b !== "Custom/Other");
    const allBrands = [...new Set([...regularBrands, ...customBrands])];
    allBrands.sort((a, b) => a.localeCompare(b));
    
    allBrands.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand;
        option.textContent = brand;
        // Mark custom brands with a star
        if (customBrands.includes(brand) && !defaultBrands.includes(brand)) {
            option.textContent = `${brand} ★`;
            option.dataset.custom = 'true';
        }
        brandSelect.appendChild(option);
    });
    
    // Refresh searchable dropdown
    refreshSearchableDropdown('brand-name');
    
    // Store brands for suggestion feature
    window.currentCategoryBrands = allBrands;
}

$('brand-name').addEventListener('change', function() {
    const customBrandGroup = DOM.customBrandGroup;
    
    if (this.value === 'Custom/Other') {
        if (customBrandGroup) customBrandGroup.style.display = 'block';
        if (DOM.customBrand) DOM.customBrand.required = true;
        setupBrandSuggestions();
    } else {
        if (customBrandGroup) customBrandGroup.style.display = 'none';
        if (DOM.customBrand) DOM.customBrand.required = false;
        hideBrandSuggestions();
    }
});

// Brand suggestion system for custom brands
function setupBrandSuggestions() {
    const customBrandInput = DOM.customBrand;
    if (!customBrandInput) return;
    
    let suggestionsContainer = $('brand-suggestions');
    if (!suggestionsContainer) {
        suggestionsContainer = document.createElement('div');
        suggestionsContainer.id = 'brand-suggestions';
        suggestionsContainer.className = 'brand-suggestions-container';
        customBrandInput.parentNode.appendChild(suggestionsContainer);
    }
    
    customBrandInput.addEventListener('input', handleBrandInput);
    customBrandInput.addEventListener('blur', () => {
        setTimeout(hideBrandSuggestions, 200);
    });
}

function handleBrandInput(e) {
    const input = e.target.value.trim().toLowerCase();
    const suggestionsContainer = $('brand-suggestions');
    
    if (!suggestionsContainer || input.length < 2) {
        hideBrandSuggestions();
        return;
    }
    
    const allBrands = window.currentCategoryBrands || [];
    const matchingBrands = allBrands.filter(brand => 
        brand.toLowerCase().includes(input)
    );
    
    // Check for exact match (brand already exists)
    const exactMatch = allBrands.some(brand => 
        brand.toLowerCase() === input
    );
    
    if (matchingBrands.length === 0 && !exactMatch) {
        suggestionsContainer.innerHTML = `
            <div class="brand-suggestion-info">
                <i class="fas fa-check-circle" style="color: #4CAF50;"></i>
                "${e.target.value}" is available as a new brand
            </div>
        `;
        suggestionsContainer.style.display = 'block';
        return;
    }
    
    if (exactMatch) {
        suggestionsContainer.innerHTML = `
            <div class="brand-suggestion-warning">
                <i class="fas fa-exclamation-triangle" style="color: #ff9800;"></i>
                This brand already exists! Select it from the dropdown instead.
            </div>
        `;
        suggestionsContainer.style.display = 'block';
        return;
    }
    
    if (matchingBrands.length > 0) {
        suggestionsContainer.innerHTML = `
            <div class="brand-suggestion-header">
                <i class="fas fa-info-circle"></i> Similar brands exist:
            </div>
            ${matchingBrands.slice(0, 5).map(brand => `
                <div class="brand-suggestion-item" onclick="selectExistingBrand('${brand}')">
                    <i class="fas fa-tag"></i> ${brand}
                </div>
            `).join('')}
            <div class="brand-suggestion-note">
                Click a brand to select it, or continue typing to add a new one
            </div>
        `;
        suggestionsContainer.style.display = 'block';
    }
}

function hideBrandSuggestions() {
    const container = $('brand-suggestions');
    if (container) container.style.display = 'none';
}

window.selectExistingBrand = function(brand) {
    // Set the brand dropdown to the existing brand
    if (DOM.brandName) {
        DOM.brandName.value = brand;
        DOM.brandName.dispatchEvent(new Event('change'));
    }
    
    updateSearchableDropdownDisplay('brand-name');
    
    // Hide the custom brand group
    if (DOM.customBrandGroup) DOM.customBrandGroup.style.display = 'none';
    if (DOM.customBrand) {
        DOM.customBrand.value = '';
        DOM.customBrand.required = false;
    }
    
    hideBrandSuggestions();
    showNotification(`Selected existing brand: ${brand}`, 'success');
};

// ================= METADATA CACHE =================
const metadataCache = {
    categories: {},
    brands: {},
    cacheExpiry: 5 * 60 * 1000 // 5 minutes cache
};

async function saveCustomCategory(category, subcategory, customType) {
    // Validate inputs
    if (!category || !subcategory || !customType) {
        console.warn("saveCustomCategory: Missing required parameters");
        return false;
    }
    
    const normalizedType = String(customType).trim();
    if (!normalizedType) {
        return false;
    }
    
    try {
        const cacheKey = `${category}_${subcategory}`;
        const metadataRef = doc(db, "CategoryMetadata", cacheKey);
        
        // Use cache if available and not expired
        let types = [];
        const cached = metadataCache.categories[cacheKey];
        if (cached && Date.now() - cached.timestamp < metadataCache.cacheExpiry) {
            types = [...cached.types];
        } else {
            try {
                const metadataDoc = await getDoc(metadataRef);
                if (metadataDoc.exists()) {
                    types = metadataDoc.data().types || [];
                }
            } catch (readError) {
                console.warn("Could not read existing categories, will create new:", readError.message);
                types = [];
            }
        }
        
        if (!types.some(t => t.toLowerCase() === normalizedType.toLowerCase())) {
            types.push(normalizedType);
            await setDoc(metadataRef, { 
                types,
                category,
                subcategory,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            
            // Update cache
            metadataCache.categories[cacheKey] = { types, timestamp: Date.now() };
            console.log(`Saved custom type: ${normalizedType}`);
        }
        return true;
    } catch (error) {
        console.error("Error saving custom category:", error);
        // Don't throw - just log and continue
        return false;
    }
}

// Save custom brand to Firestore with caching
async function saveCustomBrand(category, brandName) {
    // Validate inputs
    if (!category || !brandName) {
        console.warn("saveCustomBrand: Missing required parameters");
        return false;
    }
    
    const normalizedBrand = String(brandName).trim();
    if (!normalizedBrand) {
        return false;
    }
    
    try {
        const brandsRef = doc(db, "BrandMetadata", category);
        
        // Use cache if available
        let brands = [];
        const cached = metadataCache.brands[category];
        if (cached && Date.now() - cached.timestamp < metadataCache.cacheExpiry) {
            brands = [...cached.brands];
        } else {
            try {
                const brandsDoc = await getDoc(brandsRef);
                if (brandsDoc.exists()) {
                    brands = brandsDoc.data().brands || [];
                }
            } catch (readError) {
                console.warn("Could not read existing brands, will create new:", readError.message);
                brands = [];
            }
        }
        
        if (!brands.some(b => b.toLowerCase() === normalizedBrand.toLowerCase())) {
            brands.push(normalizedBrand);
            await setDoc(brandsRef, { 
                brands,
                category,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            
            // Update cache
            metadataCache.brands[category] = { brands, timestamp: Date.now() };
            console.log(`Saved custom brand: ${normalizedBrand}`);
        }
        return true;
    } catch (error) {
        console.error("Error saving custom brand:", error);
        // Don't throw - just log and continue
        return false;
    }
}

// Load custom categories from Firestore with caching (mobile-optimized)
async function loadCustomCategories(category, subcategory) {
    if (!category || !subcategory) return [];
    
    const cacheKey = `${category}_${subcategory}`;
    
    // Check cache first - extends cache time on mobile for offline support
    const cached = metadataCache.categories[cacheKey];
    const cacheTime = navigator.onLine ? metadataCache.cacheExpiry : metadataCache.cacheExpiry * 10;
    if (cached && Date.now() - cached.timestamp < cacheTime) {
        return cached.types;
    }
    
    // If offline, return cached or empty
    if (!navigator.onLine) {
        return cached?.types || [];
    }
    
    try {
        const metadataRef = doc(db, "CategoryMetadata", cacheKey);
        const metadataDoc = await getDoc(metadataRef);
        
        if (metadataDoc.exists()) {
            const types = metadataDoc.data().types || [];
            // Store in cache
            metadataCache.categories[cacheKey] = { types, timestamp: Date.now() };
            return types;
        }
    } catch (error) {
        console.warn("Error loading custom categories:", error.message);
        // Return cached data if available on error
        if (cached?.types) return cached.types;
    }
    return [];
}

// Load custom brands from Firestore with caching (mobile-optimized)
async function loadCustomBrands(category) {
    if (!category) return [];
    
    // Check cache first - extends cache time on mobile for offline support
    const cached = metadataCache.brands[category];
    const cacheTime = navigator.onLine ? metadataCache.cacheExpiry : metadataCache.cacheExpiry * 10;
    if (cached && Date.now() - cached.timestamp < cacheTime) {
        return cached.brands;
    }
    
    // If offline, return cached or empty
    if (!navigator.onLine) {
        return cached?.brands || [];
    }
    
    try {
        const brandsRef = doc(db, "BrandMetadata", category);
        const brandsDoc = await getDoc(brandsRef);
        
        if (brandsDoc.exists()) {
            const brands = brandsDoc.data().brands || [];
            // Store in cache
            metadataCache.brands[category] = { brands, timestamp: Date.now() };
            return brands;
        }
    } catch (error) {
        console.warn("Error loading custom brands:", error.message);
        // Return cached data if available on error
        if (cached?.brands) return cached.brands;
    }
    return [];
}

// ================= PRODUCT IMAGES =================
for (let i = 1; i <= 5; i++) {
    $(`media-upload-${i}`).addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const label = $(`image-upload-label-${i}`);
                label.style.backgroundImage = `url(${e.target.result})`;
                label.classList.add('has-image');
                label.classList.remove('restored-preview');
                const icon = label.querySelector('i');
                const uploadText = label.querySelector('.upload-text');
                if (icon) icon.style.display = 'none';
                if (uploadText) uploadText.style.display = 'none';
            };
            reader.readAsDataURL(file);
        }
    });
}

window.removeImage = function(index, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    $(`media-upload-${index}`).value = '';
    const label = $(`image-upload-label-${index}`);
    label.style.backgroundImage = '';
    label.classList.remove('has-image');
    const icon = label.querySelector('i');
    const uploadText = label.querySelector('.upload-text');
    if (icon) icon.style.display = 'flex';
    if (uploadText) uploadText.style.display = 'block';
};

// ================= SMART ATTRIBUTE SUGGESTIONS =================
const attributeSuggestions = {
    'Size': ['Extra Small', 'Small', 'Medium', 'Large', 'Extra Large', 'XXL', 'XXXL', '28', '30', '32', '34', '36', '38', '40', '42'],
    'Color': ['Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Pink', 'Purple', 'Orange', 'Brown', 'Grey', 'Navy', 'Beige', 'Gold', 'Silver'],
    'Weight': ['100g', '250g', '500g', '1kg', '2kg', '5kg', '10kg', '25kg', '50kg'],
    'Volume': ['100ml', '250ml', '500ml', '1L', '2L', '5L', '10L', '20L'],
    'Packaging': ['Single', 'Pack of 3', 'Pack of 5', 'Pack of 10', 'Box of 12', 'Carton of 24', 'Bulk 50', 'Bulk 100'],
    'Material': ['Cotton', 'Polyester', 'Silk', 'Wool', 'Linen', 'Leather', 'Denim', 'Nylon', 'Plastic', 'Metal', 'Wood', 'Glass'],
    'Flavor': ['Original', 'Vanilla', 'Chocolate', 'Strawberry', 'Mango', 'Lemon', 'Orange', 'Mint', 'Coffee', 'Caramel'],
    'Scent': ['Lavender', 'Rose', 'Jasmine', 'Citrus', 'Ocean', 'Vanilla', 'Sandalwood', 'Fresh', 'Unscented'],
    'Pattern': ['Solid', 'Striped', 'Checkered', 'Floral', 'Polka Dots', 'Abstract', 'Geometric', 'Plain'],
    'Capacity': ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB'],
    'Power': ['5W', '10W', '18W', '20W', '30W', '45W', '65W', '100W'],
    'Length': ['1m', '2m', '3m', '5m', '10m', '15m', '20m', '50m', '100m']
};

const variationTypesByCategory = {
    fashion: ['Size', 'Color', 'Material', 'Pattern'],
    electronics: ['Color', 'Capacity', 'Power', 'Length'],
    beauty: ['Volume', 'Scent', 'Packaging'],
    'food-beverages': ['Weight', 'Flavor', 'Packaging'],
    home: ['Size', 'Color', 'Material', 'Packaging'],
    default: ['Size', 'Color', 'Weight', 'Packaging']
};

function getSuggestedVariationTypes() {
    const category = $('category').value;
    return variationTypesByCategory[category] || variationTypesByCategory.default;
}

// ================= VARIATION MATRIX WITH ATTRIBUTES =================
function createVariationRow() {
    if ($$('.variation-row').length >= MAX_VARIATIONS) {
        showNotification(`Maximum ${MAX_VARIATIONS} variations allowed`, 'warning');
        return;
    }

    variationCounter++;
    const suggestedTypes = getSuggestedVariationTypes();
    
    const variationRow = document.createElement('div');
    variationRow.className = 'variation-row';
    variationRow.dataset.variationId = variationCounter;
    
    variationRow.innerHTML = `
        <div class="variation-header">
            <div class="variation-title-section">
                <div class="variation-type-wrapper">
                    <label><i class="fas fa-layer-group"></i> Variation Type *</label>
                    <div class="variation-type-input-group">
                        <select class="variation-type-select" onchange="handleVariationTypeChange(this, ${variationCounter})">
                            <option value="">Choose type or enter custom</option>
                            ${suggestedTypes.map(type => `<option value="${type}">${type}</option>`).join('')}
                            <option value="custom">+ Custom Type</option>
                        </select>
                        <input type="text" class="variation-title-input" placeholder="e.g., Shade, Grade, Style..." style="display:none;" required>
                    </div>
                    <small class="variation-hint">Select a common type or create your own</small>
                </div>
            </div>
            <button type="button" class="remove-variation-btn" onclick="removeVariation(${variationCounter})" title="Remove variation">
                <i class="fas fa-trash-alt"></i>
            </button>
        </div>
        
        <div class="quick-add-section" data-variation-id="${variationCounter}" style="display:none;">
            <div class="quick-add-header">
                <span><i class="fas fa-magic"></i> Quick Add Suggestions</span>
                <button type="button" class="clear-suggestions-btn" onclick="clearQuickAdd(${variationCounter})">
                    <i class="fas fa-times"></i> Clear
                </button>
            </div>
            <div class="quick-add-chips" data-variation-id="${variationCounter}">
                <!-- Suggestion chips will appear here -->
            </div>
        </div>
        
        <div class="attributes-container" data-variation-id="${variationCounter}">
            <div class="attributes-header">
                <div class="attributes-header-left">
                    <h4><i class="fas fa-list-ul"></i> Options</h4>
                    <span class="attribute-count">(0/${MAX_ATTRIBUTES_PER_VARIATION})</span>
                </div>
                <button type="button" class="add-attribute-btn" onclick="addAttribute(${variationCounter})">
                    <i class="fas fa-plus"></i> Add Option
                </button>
            </div>
            <div class="attributes-list" data-variation-id="${variationCounter}">
            </div>
        </div>
        
        <div class="variation-summary" data-calc-id="${variationCounter}">
            <div class="summary-icon"><i class="fas fa-chart-pie"></i></div>
            <div class="summary-content">
                <p class="summary-title">Variation Summary</p>
                <p class="calc-display">Add options to see stock & price breakdown</p>
            </div>
        </div>
    `;
    
    $('variations-container').appendChild(variationRow);
    
    addAttribute(variationCounter);
    
    variations.push({
        id: variationCounter,
        element: variationRow,
        attributes: []
    });
}

window.handleVariationTypeChange = function(select, variationId) {
    const row = $q(`.variation-row[data-variation-id="${variationId}"]`);
    const customInput = row.querySelector('.variation-title-input');
    const quickAddSection = row.querySelector('.quick-add-section');
    const quickAddChips = row.querySelector('.quick-add-chips');
    
    if (select.value === 'custom') {
        customInput.style.display = 'block';
        customInput.focus();
        quickAddSection.style.display = 'none';
    } else if (select.value) {
        customInput.style.display = 'none';
        customInput.value = select.value;
        
        // Show quick add suggestions
        const suggestions = attributeSuggestions[select.value] || [];
        if (suggestions.length > 0) {
            quickAddSection.style.display = 'block';
            quickAddChips.innerHTML = suggestions.map(suggestion => 
                `<button type="button" class="suggestion-chip" data-value="${suggestion}" onclick="quickAddAttribute(${variationId}, '${suggestion}', event)">
                    <i class="fas fa-plus-circle"></i> ${suggestion}
                </button>`
            ).join('');
        } else {
            quickAddSection.style.display = 'none';
        }
    } else {
        customInput.style.display = 'none';
        quickAddSection.style.display = 'none';
    }
};

window.clearQuickAdd = function(variationId) {
    const quickAddSection = $q(`.quick-add-section[data-variation-id="${variationId}"]`);
    if (quickAddSection) {
        quickAddSection.style.display = 'none';
    }
};

window.quickAddAttribute = function(variationId, value, event) {
    const attributesList = $q(`.attributes-list[data-variation-id="${variationId}"]`);
    if (!attributesList) return;
    
    const chip = event?.target?.closest('.suggestion-chip') || $q(`.suggestion-chip[data-value="${value}"]`);
    
    // Check if this value already exists - if so, REMOVE it (toggle behavior)
    const existingAttr = Array.from(attributesList.querySelectorAll('.attribute-item')).find(item => {
        const nameInput = item.querySelector('.attribute-name');
        return nameInput && nameInput.value.toLowerCase() === value.toLowerCase();
    });
    
    if (existingAttr) {
        // Remove existing attribute
        existingAttr.remove();
        // Renumber remaining attributes starting from 1
        const remaining = attributesList.querySelectorAll('.attribute-item');
        remaining.forEach((item, index) => {
            const newIndex = index + 1;
            item.dataset.attributeIndex = newIndex;
            const badge = item.querySelector('.attribute-badge');
            if (badge) badge.textContent = `Option ${newIndex}`;
        });
        updateAttributeCount(variationId);
        updateVariationCalculations();
        
        // Reset the chip
        if (chip) {
            chip.style.opacity = '1';
            chip.style.pointerEvents = 'auto';
            chip.classList.remove('selected');
            chip.innerHTML = `<i class="fas fa-plus-circle"></i> ${value}`;
        }
        return;
    }
    
    // Add new attribute
    const currentAttributes = attributesList.querySelectorAll('.attribute-item').length;
    if (currentAttributes >= MAX_ATTRIBUTES_PER_VARIATION) {
        showNotification(`Maximum ${MAX_ATTRIBUTES_PER_VARIATION} options per variation`, 'warning');
        return;
    }
    
    addAttribute(variationId, value);
    
    // Mark the chip as selected
    if (chip) {
        chip.classList.add('selected');
        chip.innerHTML = `<i class="fas fa-check-circle"></i> ${value}`;
    }
    
    updateAttributeCount(variationId);
};

function updateAttributeCount(variationId) {
    const attributesList = $q(`.attributes-list[data-variation-id="${variationId}"]`);
    const countSpan = $q(`.variation-row[data-variation-id="${variationId}"] .attribute-count`);
    if (attributesList && countSpan) {
        const count = attributesList.querySelectorAll('.attribute-item').length;
        countSpan.textContent = `(${count}/${MAX_ATTRIBUTES_PER_VARIATION})`;
    }
}

function addAttribute(variationId, prefilledName = '') {
    const attributesList = $q(`.attributes-list[data-variation-id="${variationId}"]`);
    
    if (!attributesList) {
        console.error(`Attributes list not found for variation ${variationId}`);
        return;
    }
    
    const currentAttributes = attributesList.querySelectorAll('.attribute-item').length;
    
    if (currentAttributes >= MAX_ATTRIBUTES_PER_VARIATION) {
        showNotification(`Maximum ${MAX_ATTRIBUTES_PER_VARIATION} options per variation allowed`, 'warning');
        return;
    }
    
    const attributeIndex = currentAttributes + 1;
    const isCollapsed = prefilledName ? '' : '';
    
    const attributeDiv = document.createElement('div');
    attributeDiv.className = 'attribute-item';
    attributeDiv.dataset.attributeIndex = attributeIndex;
    attributeDiv.dataset.variationId = variationId;
    
    attributeDiv.innerHTML = `
        <div class="attribute-header-row">
            <div class="attribute-badge">Option ${attributeIndex}</div>
            <input type="text" class="attribute-name" placeholder="Option name (e.g., Small, Red)" value="${prefilledName}" required>
            <button type="button" class="remove-attribute-btn" title="Remove option">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="attribute-fields-grid">
            <div class="attr-field">
                <label><i class="fas fa-boxes"></i> Stock *</label>
                <input type="number" class="attribute-stock" placeholder="100" required min="1">
            </div>
            <div class="attr-field">
                <label><i class="fas fa-tag"></i> Wholesale (KES) *</label>
                <input type="number" class="attribute-price" placeholder="1000" required step="0.01" min="0">
                <small class="price-hint">Your selling price</small>
            </div>
            <div class="attr-field">
                <label><i class="fas fa-store"></i> Retail (KES)</label>
                <input type="number" class="attribute-retail" placeholder="1500" step="0.01" min="0">
                <small class="price-hint">Suggested retail</small>
            </div>
            <div class="attr-field">
                <label><i class="fas fa-cube"></i> Pcs/Unit</label>
                <input type="number" class="attribute-pieces" placeholder="1" value="1" min="1">
            </div>
            <div class="attr-field attr-image-field">
                <label><i class="fas fa-camera"></i> Image</label>
                <div class="image-upload-mini">
                    <input type="file" class="attribute-image" accept="image/*" id="attr-img-${variationId}-${attributeIndex}">
                    <label for="attr-img-${variationId}-${attributeIndex}" class="mini-upload-btn">
                        <i class="fas fa-plus"></i>
                    </label>
                    <img class="attribute-image-preview">
                </div>
            </div>
        </div>
    `;
    
    // Add click handler for remove button
    const removeBtn = attributeDiv.querySelector('.remove-attribute-btn');
    removeBtn.addEventListener('click', function() {
        removeAttributeElement(attributeDiv, variationId);
    });
    
    attributesList.appendChild(attributeDiv);
    
    // Auto-focus on name field if not prefilled
    if (!prefilledName) {
        setTimeout(() => {
            const nameInput = attributeDiv.querySelector('.attribute-name');
            nameInput.focus();
        }, 100);
    }
    
    const imageInput = attributeDiv.querySelector('.attribute-image');
    const imagePreview = attributeDiv.querySelector('.attribute-image-preview');
    const miniUploadBtn = attributeDiv.querySelector('.mini-upload-btn');
    
    imageInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                imagePreview.src = e.target.result;
                imagePreview.style.display = 'block';
                miniUploadBtn.style.display = 'none';
            };
            reader.readAsDataURL(file);
        }
    });
    
    const stockInput = attributeDiv.querySelector('.attribute-stock');
    const piecesInput = attributeDiv.querySelector('.attribute-pieces');
    const priceInput = attributeDiv.querySelector('.attribute-price');
    
    [stockInput, piecesInput, priceInput].forEach(input => {
        input.addEventListener('input', () => updateVariationCalculations());
    });
    
    updateAttributeCount(variationId);
}

window.addAttribute = addAttribute;

// Remove attribute by element reference (works correctly after renumbering)
function removeAttributeElement(attributeElement, variationId) {
    const attributesList = attributeElement.parentElement;
    const attrName = attributeElement.querySelector('.attribute-name')?.value;
    
    // Remove the element
    attributeElement.remove();
    
    // Renumber remaining attributes starting from 1
    const remaining = attributesList.querySelectorAll('.attribute-item');
    remaining.forEach((item, index) => {
        const newIndex = index + 1;
        item.dataset.attributeIndex = newIndex;
        const badge = item.querySelector('.attribute-badge');
        if (badge) badge.textContent = `Option ${newIndex}`;
    });
    
    // Update chip state if it was from quick add
    if (attrName) {
        const chip = $q(`.suggestion-chip[data-value="${attrName}"]`);
        if (chip) {
            chip.classList.remove('selected');
            chip.innerHTML = `<i class="fas fa-plus-circle"></i> ${attrName}`;
        }
    }
    
    updateAttributeCount(variationId);
    updateVariationCalculations();
}

window.removeAttribute = function(variationId, attributeIndex) {
    const attributesList = $q(`.attributes-list[data-variation-id="${variationId}"]`);
    if (attributesList) {
        const attributeItem = attributesList.querySelector(`.attribute-item[data-attribute-index="${attributeIndex}"]`);
        if (attributeItem) {
            removeAttributeElement(attributeItem, variationId);
        }
    }
};

window.removeVariation = function(id) {
    const row = $q(`.variation-row[data-variation-id="${id}"]`);
    if (row) {
        row.remove();
        variations = variations.filter(v => v.id !== id);
    }
};

$('add-variation-btn').addEventListener('click', createVariationRow);

createVariationRow();

// ================= PRICING CALCULATIONS =================
// Throttled version for input events (called frequently)
const throttledUpdateVariationCalculations = throttle(() => {
    updateVariationCalculations();
}, 200);

function updateVariationCalculations() {
    $$('.variation-row').forEach(row => {
        const variationId = row.dataset.variationId;
        const calcDisplay = row.querySelector('.calc-display');
        const variationSummary = row.querySelector('.variation-summary');
        
        const attributes = row.querySelectorAll('.attribute-item');
        let totalStock = 0;
        let totalPieces = 0;
        let totalValue = 0;
        let minPrice = Infinity;
        let maxPrice = 0;
        
        attributes.forEach(attr => {
            const stock = parseFloat(attr.querySelector('.attribute-stock')?.value) || 0;
            const pieces = parseFloat(attr.querySelector('.attribute-pieces')?.value) || 1;
            const attrPrice = parseFloat(attr.querySelector('.attribute-price')?.value) || 0;
            
            totalStock += stock;
            totalPieces += stock * pieces;
            totalValue += attrPrice * stock;
            
            if (attrPrice > 0) {
                minPrice = Math.min(minPrice, attrPrice);
                maxPrice = Math.max(maxPrice, attrPrice);
            }
        });
        
        if (totalStock > 0 && calcDisplay) {
            const avgPrice = totalValue / totalStock;
            const priceRange = minPrice === Infinity ? 'Not set'
                : minPrice === maxPrice 
                    ? `KES ${minPrice.toLocaleString()}`
                    : `KES ${minPrice.toLocaleString()} - ${maxPrice.toLocaleString()}`;
            
            calcDisplay.innerHTML = `
                <span><strong>${attributes.length}</strong> options</span> • 
                <span><strong>${totalStock.toLocaleString()}</strong> total units</span> • 
                <span><strong>${totalPieces.toLocaleString()}</strong> pieces</span> • 
                <span>Price: <strong>${priceRange}</strong></span>
            `;
            
            if (variationSummary) {
                variationSummary.style.display = 'flex';
            }
        } else if (calcDisplay) {
            calcDisplay.textContent = 'Add options to see stock & price breakdown';
        }
    });
}

function calculatePricing() {
    // Now prices are per-variation, just update the calculations
    updateVariationCalculations();
}

// Event listener for variation price changes (no longer tied to base price)
// This is now handled by individual attribute inputs

// ================= BULK PRICING TIERS =================
$('toggle-bulk-pricing').addEventListener('click', function() {
    const container = $('bulk-pricing-container');
    const isVisible = container.style.display !== 'none';
    
    container.style.display = isVisible ? 'none' : 'block';
    this.innerHTML = isVisible 
        ? '<i class="fas fa-plus"></i> Add Bulk Discounts'
        : '<i class="fas fa-minus"></i> Hide Bulk Discounts';
    
    if (!isVisible && bulkTiers.length === 0) {
        addBulkTier();
    }
});

function addBulkTier() {
    bulkTierCounter++;
    
    const tierDiv = document.createElement('div');
    tierDiv.className = 'bulk-tier';
    tierDiv.dataset.tierId = bulkTierCounter;
    
    tierDiv.innerHTML = `
        <div class="tier-header">
            <strong>Tier ${bulkTierCounter}</strong>
            <button type="button" class="remove-tier-btn" onclick="removeBulkTier(${bulkTierCounter})">×</button>
        </div>
        <div class="tier-fields">
            <div class="form-group">
                <label>Min Quantity</label>
                <input type="number" class="tier-min" placeholder="e.g., 10" min="1">
            </div>
            <div class="form-group">
                <label>Max Quantity</label>
                <input type="number" class="tier-max" placeholder="e.g., 50">
            </div>
            <div class="form-group">
                <label>Discounted Price (KES)</label>
                <input type="number" class="tier-price" placeholder="e.g., 950" step="0.01">
            </div>
        </div>
    `;
    
    $('bulk-tiers-container').appendChild(tierDiv);
    bulkTiers.push({ id: bulkTierCounter });
}

window.removeBulkTier = function(id) {
    const tier = $q(`[data-tier-id="${id}"]`);
    if (tier) {
        tier.remove();
        bulkTiers = bulkTiers.filter(t => t.id !== id);
    }
};

$('add-bulk-tier-btn').addEventListener('click', addBulkTier);

// Helper function to get variation title from row
function getVariationTitle(row) {
    const select = row.querySelector('.variation-type-select');
    const input = row.querySelector('.variation-title-input');
    
    if (select && select.value && select.value !== 'custom') {
        return select.value;
    }
    return input ? input.value : 'Variation';
}

// ================= REVIEW SUMMARY =================
function updateReviewSummary() {
    const category = DOM.category?.selectedOptions[0]?.textContent || 'Not selected';
    const subcategory = DOM.subcategory?.selectedOptions[0]?.textContent || 'Not selected';
    const itemName = DOM.itemName?.value || 'Not entered';
    const brand = DOM.brandName?.value === 'Custom/Other' 
        ? DOM.customBrand?.value || 'Not entered'
        : DOM.brandName?.value || 'Not selected';
    const description = DOM.description?.value || 'Not entered';
    
    const variationRows = $$('.variation-row');
    let totalStock = 0;
    let totalPieces = 0;
    let minPrice = Infinity;
    let maxPrice = 0;
    let variationsSummary = '<ul style="margin-left: 20px;">';
    
    variationRows.forEach((row, index) => {
        const title = getVariationTitle(row) || `Variation ${index + 1}`;
        const attributeItems = row.querySelectorAll('.attribute-item');
        
        let variationStockSubtotal = 0;
        let attributesList = '';
        
        attributeItems.forEach(attr => {
            const attrName = attr.querySelector('.attribute-name').value || 'Not specified';
            const stock = parseInt(attr.querySelector('.attribute-stock').value) || 0;
            const pieces = parseInt(attr.querySelector('.attribute-pieces').value) || 1;
            const price = parseFloat(attr.querySelector('.attribute-price').value) || 0;
            const retailPrice = parseFloat(attr.querySelector('.attribute-retail')?.value) || null;
            variationStockSubtotal += stock;
            totalStock += stock;
            totalPieces += stock * pieces;
            
            if (price > 0) {
                minPrice = Math.min(minPrice, price);
                maxPrice = Math.max(maxPrice, price);
            }
            
            let priceDisplay = `KES ${price.toLocaleString()}`;
            if (retailPrice) {
                priceDisplay += ` <span style="color: #888; text-decoration: line-through; font-size: 12px;">RRP: ${retailPrice.toLocaleString()}</span>`;
            }
            attributesList += `<li style="margin: 4px 0;">${attrName} - <strong>${stock}</strong> units × ${pieces} pcs @ ${priceDisplay}</li>`;
        });
        
        variationsSummary += `<li style="margin: 8px 0;"><strong>${title}</strong> (${attributeItems.length} options, ${variationStockSubtotal} units)<ul style="margin-left: 20px; margin-top: 4px;">${attributesList}</ul></li>`;
    });
    variationsSummary += '</ul>';
    
    // Price range display
    const priceRangeDisplay = minPrice === Infinity ? 'Not set' 
        : minPrice === maxPrice ? `KES ${minPrice.toLocaleString()}`
        : `KES ${minPrice.toLocaleString()} - KES ${maxPrice.toLocaleString()}`;
    
    const hasBulkPricing = DOM.bulkPricingContainer?.style.display !== 'none';
    let bulkSummary = '<p style="color: #888;">No bulk pricing tiers</p>';
    
    if (hasBulkPricing) {
        const tiers = $$('.bulk-tier');
        if (tiers.length > 0) {
            bulkSummary = '<ul style="margin-left: 20px;">';
            tiers.forEach(tier => {
                const min = tier.querySelector('.tier-min').value || 'N/A';
                const max = tier.querySelector('.tier-max').value || '∞';
                const price = tier.querySelector('.tier-price').value || 'N/A';
                if (min && price) {
                    bulkSummary += `<li>${min} - ${max} units: KES ${parseFloat(price).toLocaleString()}</li>`;
                }
            });
            bulkSummary += '</ul>';
        }
    }
    
    // Get product images count
    let imagesCount = 0;
    for (let i = 1; i <= 5; i++) {
        const input = $(`media-upload-${i}`);
        if (input?.files[0]) imagesCount++;
    }
    
    const reviewHTML = `
        <div class="review-grid">
            <div class="review-item">
                <span class="review-label"><i class="fas fa-folder"></i> Category</span>
                <span class="review-value">${category} > ${subcategory}</span>
            </div>
            <div class="review-item">
                <span class="review-label"><i class="fas fa-box"></i> Product Name</span>
                <span class="review-value">${itemName}</span>
            </div>
            <div class="review-item">
                <span class="review-label"><i class="fas fa-certificate"></i> Brand</span>
                <span class="review-value">${brand}</span>
            </div>
            <div class="review-item">
                <span class="review-label"><i class="fas fa-images"></i> Images</span>
                <span class="review-value">${imagesCount} photo(s) uploaded</span>
            </div>
            <div class="review-item">
                <span class="review-label"><i class="fas fa-warehouse"></i> Total Stock</span>
                <span class="review-value">${totalStock.toLocaleString()} units (${totalPieces.toLocaleString()} pieces)</span>
            </div>
            <div class="review-item">
                <span class="review-label"><i class="fas fa-tag"></i> Price Range</span>
                <span class="review-value">${priceRangeDisplay}</span>
            </div>
        </div>
        <div class="review-description">
            <span class="review-label"><i class="fas fa-align-left"></i> Description</span>
            <p>${description.substring(0, 200)}${description.length > 200 ? '...' : ''}</p>
        </div>
        <div class="review-variations">
            <span class="review-label"><i class="fas fa-boxes"></i> Variations (${variationRows.length})</span>
            ${variationsSummary}
        </div>
        <div class="review-bulk">
            <span class="review-label"><i class="fas fa-layer-group"></i> Bulk Pricing</span>
            ${bulkSummary}
        </div>
    `;
    
    $('review-summary').innerHTML = reviewHTML;
}

// ================= FORM SUBMISSION WITH QUEUE =================
async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

$('item-listing-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    
    const user = auth.currentUser;
    if (!user) {
        showNotification("You need to be logged in to list products.");
        return;
    }
    
    // Check network connection
    if (!navigator.onLine) {
        showNotification("You're offline. Please check your connection and try again.", 'error');
        return;
    }
    
    // Rate limit submissions (max 3 per minute)
    if (!rateLimiter.isAllowed('form_submit', 3, 60000)) {
        showNotification("Please wait before submitting again.", 'warning');
        return;
    }
    
    // Prevent double submission
    const submitResult = await withLock('form_submission', async () => {
        const submitBtn = DOM.submitButton;
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing upload...';
        
        try {
            // Collect and sanitize form data
            const formData = sanitizeFormData(getFormValues());
            const brandName = formData.brandName === 'Custom/Other' 
                ? formData.customBrand 
                : formData.brandName;
            
            let minPrice = Infinity;
            let maxPrice = 0;
            
            // Handle custom category
            let finalSubsubcategory = formData.subsubcategory;
            if (formData.subsubcategory === 'custom' && formData.customSubsubcategory) {
                finalSubsubcategory = formData.customSubsubcategory.toLowerCase().replace(/\s+/g, '-');
            }
            
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Compressing images...';
            
            // Compress and convert product images to data URLs
            const productImagesData = [];
            for (let i = 1; i <= 5; i++) {
                const file = $(`media-upload-${i}`).files[0];
                if (file) {
                    const compressedFile = await compressImage(file);
                    const dataUrl = await fileToDataUrl(compressedFile);
                    productImagesData.push({
                        name: sanitizeInput(file.name),
                        dataUrl: dataUrl
                    });
                }
            }
            
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing variations...';
            
            // Process variations with attributes
            const variationRows = $$('.variation-row');
            const processedVariations = [];
            
            for (let row of variationRows) {
                const variationTitle = getVariationTitle(row);
                
                // Validate variation title
                if (!variationTitle || variationTitle.trim() === '') {
                    throw new Error('Each variation must have a type selected');
                }
                
                const attributeItems = row.querySelectorAll('.attribute-item');
            if (attributeItems.length === 0) {
                throw new Error(`Variation "${variationTitle}" must have at least one option`);
            }
            
            const variationAttributes = [];
            
            for (let attrItem of attributeItems) {
                const attrName = attrItem.querySelector('.attribute-name').value?.trim();
                const stockValue = attrItem.querySelector('.attribute-stock').value;
                const piecesValue = attrItem.querySelector('.attribute-pieces').value;
                const priceValue = attrItem.querySelector('.attribute-price').value;
                const retailValue = attrItem.querySelector('.attribute-retail')?.value;
                
                // Validate required fields
                if (!attrName || attrName === '') {
                    throw new Error(`All options in "${variationTitle}" must have a name`);
                }
                
                if (!stockValue || stockValue === '') {
                    throw new Error(`Option "${attrName}" must have a stock quantity`);
                }
                
                if (!priceValue || priceValue === '') {
                    throw new Error(`Option "${attrName}" must have a wholesale price`);
                }
                
                const stock = parseInt(stockValue);
                const pieces = parseInt(piecesValue) || 1;
                const attributePrice = parseFloat(priceValue);
                const retailPrice = retailValue ? parseFloat(retailValue) : null;
                
                // Validate values are valid numbers
                if (isNaN(stock) || stock < 1) {
                    throw new Error(`Option "${attrName}" must have a valid stock quantity (minimum 1)`);
                }
                
                if (isNaN(attributePrice) || attributePrice <= 0) {
                    throw new Error(`Option "${attrName}" must have a valid wholesale price greater than 0`);
                }
                
                if (isNaN(pieces) || pieces < 1) {
                    throw new Error(`Option "${attrName}" must have a valid piece count (minimum 1)`);
                }
                
                // Apply 5% platform fee to option price
                const finalAttributePrice = attributePrice * 1.05;
                
                const imageFile = attrItem.querySelector('.attribute-image').files[0];
                
                let imageData = null;
                if (imageFile) {
                    const compressedVarImg = await compressImage(imageFile);
                    const dataUrl = await fileToDataUrl(compressedVarImg);
                    imageData = {
                        name: imageFile.name,
                        dataUrl: dataUrl
                    };
                }
                
                variationAttributes.push({
                    attr_name: attrName,
                    stock,
                    piece_count: pieces,
                    price: finalAttributePrice,
                    originalPrice: attributePrice,
                    retailPrice: retailPrice,
                    imageFile: imageData
                });
                
                // Track min/max prices for the listing
                if (attributePrice > 0) {
                    minPrice = Math.min(minPrice, attributePrice);
                    maxPrice = Math.max(maxPrice, attributePrice);
                }
            }
            
            processedVariations.push({
                title: variationTitle,
                attributes: variationAttributes
            });
        }
        
        // Final validation - ensure we have variations with valid data
        if (processedVariations.length === 0) {
            throw new Error('Please add at least one variation with options');
        }
        
        // Calculate total stock to verify it's valid
        const totalStockCheck = processedVariations.reduce((sum, v) => {
            return sum + v.attributes.reduce((attrSum, attr) => attrSum + attr.stock, 0);
        }, 0);
        
        if (isNaN(totalStockCheck) || totalStockCheck < 1) {
            throw new Error('Total stock must be at least 1. Please check your variation options.');
        }
        
        // Calculate final price from min price (with platform fee)
        const itemPrice = minPrice !== Infinity ? minPrice : 0;
        let finalPrice = itemPrice;
        if (finalPrice < 10000) {
            finalPrice += finalPrice * 0.05;
        } else {
            finalPrice += finalPrice * 0.025;
        }
        const initialPrice = null;
        
        // Process bulk pricing tiers
        const processedBulkTiers = [];
        if (DOM.bulkPricingContainer?.style.display !== 'none') {
            $$('.bulk-tier').forEach(tier => {
                const min = parseInt(tier.querySelector('.tier-min').value);
                const max = parseInt(tier.querySelector('.tier-max').value) || null;
                const price = parseFloat(tier.querySelector('.tier-price').value);
                
                if (min && price) {
                    processedBulkTiers.push({ min, max, price });
                }
            });
        }
        
        const listingId = DOM.submitButton?.dataset.id;
        
        // Save custom brand/category in background (non-blocking)
        // These are "nice to have" saves - don't let them block the main listing
        const metadataSaves = [];
        
        if (formData.brandName === 'Custom/Other') {
            const customBrand = (formData.customBrand || '').trim();
            if (customBrand && formData.category) {
                // Fire and forget - don't await
                metadataSaves.push(
                    saveCustomBrand(formData.category, customBrand)
                        .catch(e => console.warn('Background brand save failed:', e.message))
                );
            }
        }
        
        if (formData.subsubcategory === 'custom' && formData.customSubsubcategory) {
            const customType = (formData.customSubsubcategory || '').trim();
            if (customType && formData.category && formData.subcategory) {
                // Fire and forget - don't await
                metadataSaves.push(
                    saveCustomCategory(formData.category, formData.subcategory, customType)
                        .catch(e => console.warn('Background category save failed:', e.message))
                );
            }
        }
        
        // Let metadata saves run in background, don't wait for them
        if (metadataSaves.length > 0) {
            Promise.allSettled(metadataSaves).then(results => {
                const failed = results.filter(r => r.status === 'rejected').length;
                if (failed > 0) {
                    console.warn(`${failed} metadata save(s) failed - listing still submitted`);
                }
            });
        }
        
        // Create listing data object for queue
        const listingDataForQueue = {
            category: formData.category,
            subcategory: formData.subcategory,
            subsubcategory: formData.subsubcategory,
            customSubsubcategory: formData.customSubsubcategory,
            finalSubsubcategory,
            itemName: formData.itemName,
            brandName,
            description: formData.description,
            itemPrice,
            finalPrice,
            initialPrice,
            productImages: productImagesData,
            variations: processedVariations,
            bulkPricing: processedBulkTiers,
            listingId: listingId || null
        };
        
        // Add to queue
        const queueId = addToQueue(listingDataForQueue);
        
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
        
        showNotification(`✓ Listing "${formData.itemName}" added to upload queue! You can start a new listing now.`, 'success');
        
        // Add the new listing preview immediately
        addNewListingPreview(listingDataForQueue, productImagesData);
        
        resetForm();
        clearDraft();
        
        return true; // Success
        
    } catch (error) {
        console.error("Error preparing listing:", error);
        
        // Show user-friendly error message
        let errorMessage = error.message || 'Unknown error occurred';
        if (errorMessage.includes('undefined')) {
            errorMessage = 'Please ensure all required fields are filled correctly.';
        } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
            errorMessage = 'Network error. Your draft has been saved - please try again.';
            saveDraft(); // Save progress on network error
        } else if (errorMessage.includes('permission')) {
            errorMessage = 'Permission denied. Please refresh and try again.';
        }
        showNotification("Error: " + errorMessage, 'error');
        
        // Reset button state on error
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
        
        return false; // Failed
    }
    });
    
    // Handle null result (lock prevented execution)
    if (submitResult === null) {
        showNotification("Submission already in progress, please wait...", 'info');
    }
});

function resetForm() {
    $('item-listing-form').reset();
    if (DOM.submitButton) {
        DOM.submitButton.innerHTML = '<i class="fas fa-check-circle"></i> Publish Listing';
        DOM.submitButton.dataset.id = '';
    }
    
    currentStep = 1;
    showStep(1);
    variations = [];
    variationCounter = 0;
    bulkTiers = [];
    bulkTierCounter = 0;
    
    if (DOM.variationsContainer) DOM.variationsContainer.innerHTML = '';
    if (DOM.bulkTiersContainer) DOM.bulkTiersContainer.innerHTML = '';
    if (DOM.bulkPricingContainer) DOM.bulkPricingContainer.style.display = 'none';
    
    // Reset photo trace
    const photoTracePreview = $('photo-trace-preview');
    const photoTraceLabel = $('photo-trace-label');
    if (photoTracePreview) photoTracePreview.style.display = 'none';
    if (photoTraceLabel) photoTraceLabel.style.display = 'flex';
    
    // Reset all product images
    for (let i = 1; i <= 5; i++) {
        const label = $(`image-upload-label-${i}`);
        const input = $(`media-upload-${i}`);
        if (label) {
            label.style.backgroundImage = '';
            label.classList.remove('has-image', 'restored-preview');
            const icon = label.querySelector('i');
            const uploadText = label.querySelector('.upload-text');
            if (icon) icon.style.display = 'flex';
            if (uploadText) uploadText.style.display = 'block';
        }
        if (input) input.value = '';
    }
    
    // Reset brand dropdown
    if (DOM.brandName) {
        DOM.brandName.value = '';
        if (DOM.customBrandGroup) DOM.customBrandGroup.style.display = 'none';
        if (DOM.customBrand) {
            DOM.customBrand.value = '';
            DOM.customBrand.required = false;
        }
        refreshSearchableDropdown('brand-name');
        updateSearchableDropdownDisplay('brand-name');
    }
    
    // Reset category dropdowns
    if (DOM.category) {
        DOM.category.value = '';
        $('subcategory-group').style.display = 'none';
        $('subsubcategory-group').style.display = 'none';
        $('custom-subsubcategory-group').style.display = 'none';
        refreshSearchableDropdown('category');
        updateSearchableDropdownDisplay('category');
    }
    
    clearDraft();
    createVariationRow();
}

// ================= ADD NEW LISTING PREVIEW =================
function addNewListingPreview(listingData, productImages) {
    const listingsContainer = DOM.listingsContainer;
    if (!listingsContainer) return;
    
    // Clear "no listings" message if showing
    const noListingsMsg = listingsContainer.querySelector('p[style*="text-align: center"]');
    if (noListingsMsg?.textContent.includes('No listings yet')) {
        listingsContainer.innerHTML = '';
    }
    
    // Create preview element with uploading indicator
    const previewElement = document.createElement('div');
    previewElement.className = 'listing listing-uploading';
    previewElement.id = `preview-${Date.now()}`;
    
    // Build image preview from data URLs
    let imagePreviewHTML = '';
    if (productImages && productImages.length > 0) {
        imagePreviewHTML = '<div class="listing-media">';
        productImages.forEach(img => {
            imagePreviewHTML += `<img src="${img.dataUrl}" class="listing-img" style="opacity: 0.8;" />`;
        });
        imagePreviewHTML += '</div>';
    }
    
    // Calculate totals from variations
    let totalStock = 0;
    let minPrice = Infinity;
    let maxPrice = 0;
    
    listingData.variations.forEach(v => {
        v.attributes.forEach(attr => {
            totalStock += attr.stock;
            if (attr.price > 0) {
                minPrice = Math.min(minPrice, attr.originalPrice || attr.price);
                maxPrice = Math.max(maxPrice, attr.originalPrice || attr.price);
            }
        });
    });
    
    const priceDisplay = minPrice === maxPrice 
        ? `KES ${minPrice.toLocaleString()}` 
        : `KES ${minPrice.toLocaleString()} - ${maxPrice.toLocaleString()}`;
    
    // Build variations summary
    let variationsHTML = '<div style="margin: 12px 0;"><strong>Variations:</strong><ul style="margin: 8px 0 0 20px;">';
    listingData.variations.forEach(v => {
        variationsHTML += `<li><strong>${v.title}:</strong> ${v.attributes.length} options</li>`;
    });
    variationsHTML += '</ul></div>';
    
    previewElement.innerHTML = `
        <div class="upload-status-banner">
            <i class="fas fa-cloud-upload-alt fa-spin"></i>
            <span>Uploading to server...</span>
        </div>
        <div class="listing-header">
            <div>
                <h4>${listingData.itemName}</h4>
                <p style="color: #ff5722; font-weight: 600; margin: 4px 0;">Brand: ${listingData.brandName}</p>
            </div>
        </div>
        ${imagePreviewHTML}
        <p><strong>Category:</strong> ${listingData.category} > ${listingData.subcategory}</p>
        <p><strong>Price:</strong> ${priceDisplay}</p>
        <p><strong>Total Stock:</strong> ${totalStock} units</p>
        ${variationsHTML}
        <p><strong>Description:</strong> ${listingData.description.substring(0, 150)}${listingData.description.length > 150 ? '...' : ''}</p>
    `;
    
    // Insert at the top of listings
    listingsContainer.insertBefore(previewElement, listingsContainer.firstChild);
    
    // Scroll to the new listing
    previewElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ================= LOAD USER LISTINGS =================
async function loadUserListings() {
    const user = auth.currentUser;
    const listingsContainer = $('listings-container');
    
    if (!listingsContainer) return;
    
    listingsContainer.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading listings...</div>';
    
    if (!user) {
        listingsContainer.innerHTML = '<p style="text-align: center; color: #757575; padding: 40px;">Please log in to view your listings.</p>';
        return;
    }
    
    try {
        // Use retry for network resilience
        const querySnapshot = await withRetry(async () => {
            requireOnline();
            const q = query(collection(db, "Listings"), where("uploaderId", "==", user.uid));
            return await getDocs(q);
        }, 3, 1000);
        
        if (querySnapshot.empty) {
            listingsContainer.innerHTML = '<p style="text-align: center; color: #757575; padding: 40px;">No listings yet. Create your first wholesale listing above!</p>';
            return;
        }
        
        listingsContainer.innerHTML = '';
        
        querySnapshot.forEach((docSnap) => {
            const listing = docSnap.data();
            const listingElement = document.createElement('div');
            listingElement.className = 'listing';
            listingElement.dataset.listingId = docSnap.id;
            
            let mediaHTML = '';
            if (listing.photoTraceUrl || (listing.imageUrls && listing.imageUrls.length > 0)) {
                let allImages = [];
                
                if (listing.photoTraceUrl) {
                    allImages.push({ url: listing.photoTraceUrl, title: 'Verification Photo' });
                }
                
                if (listing.imageUrls) {
                    listing.imageUrls.forEach(url => {
                        allImages.push({ url, title: 'Product Image' });
                    });
                }
                
                if (listing.variations) {
                    listing.variations.forEach(variation => {
                        if (variation.attributes) {
                            variation.attributes.forEach(attr => {
                                if (attr.photoUrl) {
                                    allImages.push({ url: attr.photoUrl, title: `${variation.title}: ${attr.attr_name}` });
                                }
                            });
                        }
                    });
                }
                
                // Show first 4 images, rest hidden with "show more"
                const visibleCount = 4;
                const hasMore = allImages.length > visibleCount;
                
                mediaHTML = '<div class="listing-media-gallery">';
                mediaHTML += '<div class="listing-media-grid">';
                
                allImages.forEach((img, index) => {
                    const hiddenClass = index >= visibleCount ? 'hidden-image' : '';
                    mediaHTML += `<img src="${img.url}" class="listing-img ${hiddenClass}" onclick="openModal('${img.url}')" title="${img.title}" />`;
                });
                
                mediaHTML += '</div>';
                
                if (hasMore) {
                    mediaHTML += `
                        <button class="show-more-images-btn" onclick="toggleMoreImages(this)">
                            <i class="fas fa-images"></i> Show ${allImages.length - visibleCount} more
                        </button>
                    `;
                }
                
                mediaHTML += '</div>';
            }
            
            // Build variations with quick edit for each option
            let variationsQuickEditHTML = '';
            if (listing.variations && listing.variations.length > 0) {
                variationsQuickEditHTML = '<div class="variations-quick-edit">';
                listing.variations.forEach((v, vIndex) => {
                    if (v.attributes) {
                        variationsQuickEditHTML += `
                            <div class="variation-quick-edit-group">
                                <h6><i class="fas fa-layer-group"></i> ${v.title}</h6>
                                <div class="variation-options-grid">
                        `;
                        v.attributes.forEach((attr, aIndex) => {
                            variationsQuickEditHTML += `
                                <div class="variation-option-edit" data-variation-index="${vIndex}" data-attr-index="${aIndex}">
                                    <span class="option-name">${attr.attr_name}</span>
                                    <div class="option-fields">
                                        <div class="mini-field">
                                            <label>Stock</label>
                                            <input type="number" class="var-stock" value="${attr.stock}" min="0">
                                        </div>
                                        <div class="mini-field">
                                            <label>Price</label>
                                            <input type="number" class="var-price" value="${attr.originalPrice || attr.price}" step="0.01" min="0">
                                        </div>
                                    </div>
                                </div>
                            `;
                        });
                        variationsQuickEditHTML += '</div></div>';
                    }
                });
                variationsQuickEditHTML += `
                    <button class="save-variations-btn" data-listing-id="${docSnap.id}">
                        <i class="fas fa-save"></i> Save All Changes
                    </button>
                </div>`;
            }
            
            let bulkPricingHTML = '';
            if (listing.bulkPricing && listing.bulkPricing.length > 0) {
                bulkPricingHTML = '<div style="margin: 12px 0;"><strong>Bulk Discounts:</strong><ul style="margin: 8px 0 0 20px;">';
                listing.bulkPricing.forEach(tier => {
                    bulkPricingHTML += `<li>${tier.min} - ${tier.max || '∞'} units: KES ${tier.price.toFixed(2)}</li>`;
                });
                bulkPricingHTML += '</ul></div>';
            }
            
            listingElement.innerHTML = `
                <div class="listing-header">
                    <div>
                        <h4>${listing.name}</h4>
                        <p style="color: #ff5722; font-weight: 600; margin: 4px 0;">Brand: ${listing.brand}</p>
                    </div>
                    <span class="listing-stock-badge">${listing.totalStock || 0} units</span>
                </div>
                ${mediaHTML}
                <p><strong>Category:</strong> ${listing.category} > ${listing.subcategory}</p>
                <p><strong>Description:</strong> ${listing.description.substring(0, 150)}${listing.description.length > 150 ? '...' : ''}</p>
                ${bulkPricingHTML}
                
                <div class="quick-edit-section">
                    <div class="quick-edit-header">
                        <h5><i class="fas fa-bolt"></i> Quick Edit Options</h5>
                        <button class="toggle-quick-edit-btn" onclick="toggleVariationEdit(this)">
                            <i class="fas fa-chevron-down"></i>
                        </button>
                    </div>
                    <div class="quick-edit-body" style="display: none;">
                        ${variationsQuickEditHTML}
                    </div>
                </div>
                
                <div class="listing-actions">
                    <button class="edit-btn" data-id="${docSnap.id}">
                        <i class="fas fa-edit"></i> Full Edit
                    </button>
                    <button class="delete-btn" data-id="${docSnap.id}">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            `;
            
            listingsContainer.appendChild(listingElement);
        });
        
        // Event listeners for save variations buttons
        $$('.save-variations-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const listingId = button.dataset.listingId;
                await quickEditVariations(listingId, button.closest('.listing'));
            });
        });
        
        $$('.edit-btn').forEach(button => {
            button.addEventListener('click', () => loadEditForm(button.dataset.id));
        });
        
        $$('.delete-btn').forEach(button => {
            button.addEventListener('click', () => deleteListing(button.dataset.id));
        });
        
    } catch (error) {
        console.error("Error loading listings:", error);
        let errorMsg = 'Error loading listings. ';
        if (!navigator.onLine) {
            errorMsg += 'You appear to be offline.';
        } else {
            errorMsg += 'Please refresh the page.';
        }
        listingsContainer.innerHTML = `
            <div style="text-align: center; color: #f44336; padding: 40px;">
                <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p>${errorMsg}</p>
                <button onclick="loadUserListings()" style="margin-top: 16px; padding: 10px 20px; background: #ff5722; color: white; border: none; border-radius: 8px; cursor: pointer;">
                    <i class="fas fa-refresh"></i> Retry
                </button>
            </div>
        `;
    }
}

// ================= TOGGLE VARIATION EDIT =================
window.toggleVariationEdit = function(btn) {
    const quickEditBody = btn.closest('.quick-edit-section').querySelector('.quick-edit-body');
    const icon = btn.querySelector('i');
    
    if (quickEditBody.style.display === 'none') {
        quickEditBody.style.display = 'block';
        icon.className = 'fas fa-chevron-up';
    } else {
        quickEditBody.style.display = 'none';
        icon.className = 'fas fa-chevron-down';
    }
};

// ================= QUICK EDIT VARIATIONS =================
async function quickEditVariations(listingId, listingElement) {
    // Check network before attempting
    if (!navigator.onLine) {
        showNotification("You're offline. Please connect to save changes.", 'error');
        return;
    }
    
    // Rate limit updates
    if (!rateLimiter.isAllowed('quick_edit', 10, 60000)) {
        showNotification("Please wait before making more edits.", 'warning');
        return;
    }
    
    const saveBtn = listingElement.querySelector('.save-variations-btn');
    if (!saveBtn) return;
    
    const originalBtnText = saveBtn.innerHTML;
    
    try {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        
        // Use retry for network resilience
        await withRetry(async () => {
            // Get the current listing data
            const docRef = doc(db, "Listings", listingId);
            const docSnap = await getDoc(docRef);
            
            if (!docSnap.exists()) {
                throw new Error("Listing not found");
            }
            
            const listing = docSnap.data();
            
            // Collect updated values from the form
            const optionEdits = listingElement.querySelectorAll('.variation-option-edit');
            let totalStock = 0;
            let minPrice = Infinity;
            let maxPrice = 0;
            
            const updatedVariations = listing.variations.map((v, vIndex) => ({
                ...v,
                attributes: v.attributes.map((attr, aIndex) => {
                    const editElement = listingElement.querySelector(
                        `.variation-option-edit[data-variation-index="${vIndex}"][data-attr-index="${aIndex}"]`
                    );
                    
                    if (editElement) {
                        const newStock = parseInt(editElement.querySelector('.var-stock').value) || 0;
                        const newOriginalPrice = parseFloat(editElement.querySelector('.var-price').value) || attr.originalPrice || attr.price;
                        
                        // Calculate final price with platform fee
                        let newFinalPrice = newOriginalPrice;
                        if (newFinalPrice < 10000) {
                            newFinalPrice += newFinalPrice * 0.05;
                        } else {
                            newFinalPrice += newFinalPrice * 0.025;
                        }
                        
                        totalStock += newStock;
                        if (newOriginalPrice > 0) {
                            minPrice = Math.min(minPrice, newOriginalPrice);
                            maxPrice = Math.max(maxPrice, newOriginalPrice);
                        }
                        
                        return {
                            ...attr,
                            stock: newStock,
                            price: newFinalPrice,
                            originalPrice: newOriginalPrice
                        };
                    }
                    
                    totalStock += attr.stock;
                    return attr;
                })
            }));
            
            // Update in Firestore
            await updateDoc(docRef, {
                variations: updatedVariations,
                totalStock: totalStock,
                price: minPrice !== Infinity ? minPrice * 1.05 : listing.price,
                originalPrice: minPrice !== Infinity ? minPrice : listing.originalPrice,
                updatedAt: new Date().toISOString()
            });
            
            // Update the stock badge without reloading
            const stockBadge = listingElement.querySelector('.listing-stock-badge');
            if (stockBadge) {
                stockBadge.textContent = `${totalStock} units`;
            }
        }, 2, 1000);
        
        showNotification("Variations updated successfully!", 'success');
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnText;
        
    } catch (error) {
        console.error("Error updating variations:", error);
        let errorMsg = "Error updating variations";
        if (!navigator.onLine) {
            errorMsg = "Network error - please try again when connected";
        } else if (error.message) {
            errorMsg = error.message;
        }
        showNotification(errorMsg, 'error');
        
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save All Changes';
    }
}

// ================= QUICK EDIT (LEGACY) =================
async function quickEditListing(listingId, newPrice, newStock) {
    try {
        $('spinner').style.display = 'block';
        
        let finalPrice = newPrice;
        if (finalPrice < 10000) {
            finalPrice += finalPrice * 0.05;
        } else {
            finalPrice += finalPrice * 0.025;
        }
        
        const docRef = doc(db, "Listings", listingId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const listing = docSnap.data();
            
            const updatedVariations = listing.variations ? listing.variations.map(v => ({
                ...v,
                attributes: v.attributes ? v.attributes.map(attr => ({
                    ...attr,
                    price: finalPrice,
                    stock: Math.floor(newStock * (attr.stock / listing.totalStock))
                })) : []
            })) : [];
            
            await updateDoc(docRef, {
                price: finalPrice,
                originalPrice: newPrice,
                totalStock: newStock,
                variations: updatedVariations,
                updatedAt: new Date().toISOString()
            });
            
            showNotification("Listing updated successfully!");
            await loadUserListings();
        }
    } catch (error) {
        console.error("Error in quick edit:", error);
        showNotification("Error updating listing: " + error.message);
    } finally {
        $('spinner').style.display = 'none';
    }
}

// ================= LOAD EDIT FORM =================
async function loadEditForm(listingId) {
    try {
        const docRef = doc(db, "Listings", listingId);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            showNotification("Listing not found!");
            return;
        }
        
        const listing = docSnap.data();
        
        $('category').value = listing.category;
        $('category').dispatchEvent(new Event('change'));
        
        setTimeout(() => {
            $('subcategory').value = listing.subcategory;
            $('subcategory').dispatchEvent(new Event('change'));
            
            setTimeout(() => {
                $('subsubcategory').value = listing.subsubcategory;
            }, 100);
        }, 100);
        
        $('brand-name').value = listing.brand;
        $('item-name').value = listing.name;
        $('description').value = listing.description;
        
        variations = [];
        variationCounter = 0;
        $('variations-container').innerHTML = '';
        
        if (listing.variations && listing.variations.length > 0) {
            listing.variations.forEach(v => {
                createVariationRow();
                const lastRow = $q('.variation-row:last-child');
                
                // Set variation type
                const typeSelect = lastRow.querySelector('.variation-type-select');
                const titleInput = lastRow.querySelector('.variation-title-input');
                
                // Check if the title matches a preset option
                const presetOption = Array.from(typeSelect.options).find(opt => opt.value === v.title);
                if (presetOption) {
                    typeSelect.value = v.title;
                } else {
                    typeSelect.value = 'custom';
                    titleInput.style.display = 'block';
                    titleInput.value = v.title || '';
                }
                
                const attributesList = lastRow.querySelector('.attributes-list');
                attributesList.innerHTML = '';
                
                if (v.attributes) {
                    v.attributes.forEach(attr => {
                        addAttribute(lastRow.dataset.variationId);
                        const newAttr = attributesList.lastElementChild;
                        newAttr.querySelector('.attribute-name').value = attr.attr_name;
                        newAttr.querySelector('.attribute-stock').value = attr.stock;
                        newAttr.querySelector('.attribute-pieces').value = attr.piece_count || 1;
                        newAttr.querySelector('.attribute-price').value = attr.originalPrice || attr.price;
                        
                        // Set retail price if available
                        const retailInput = newAttr.querySelector('.attribute-retail');
                        if (retailInput && attr.retailPrice) {
                            retailInput.value = attr.retailPrice;
                        }
                    });
                }
                
                // Update calculations for this variation
                updateAttributeCount(lastRow.dataset.variationId);
            });
        }
        
        // Update overall calculations
        updateVariationCalculations();
        
        $('submit-button').innerHTML = '<i class="fas fa-save"></i> Update Listing';
        $('submit-button').dataset.id = listingId;
        
        currentStep = 1;
        showStep(1);
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showNotification("Editing listing - update and save when ready");
        
    } catch (error) {
        console.error("Error loading edit form:", error);
        showNotification("Error loading listing: " + error.message);
    }
}

// ================= DELETE LISTING =================
async function deleteListing(listingId) {
    // Confirm before deleting
    const confirmed = confirm('⚠️ Are you sure you want to delete this listing?\n\nThis action cannot be undone. All product data and images will be permanently removed.');
    
    if (!confirmed) {
        return;
    }
    
    // Check network
    if (!navigator.onLine) {
        showNotification("You're offline. Please connect to delete listings.", 'error');
        return;
    }
    
    // Rate limit deletions
    if (!rateLimiter.isAllowed('delete_listing', 5, 60000)) {
        showNotification("Please wait before deleting more listings.", 'warning');
        return;
    }
    
    const spinner = $('spinner');
    
    try {
        if (spinner) spinner.style.display = 'block';
        
        // Use retry for network resilience
        await withRetry(async () => {
            await deleteDoc(doc(db, "Listings", listingId));
        }, 2, 1000);
        
        showNotification("Listing deleted successfully!", 'success');
        
        // Remove from DOM immediately for better UX
        const listingElement = $q(`.listing[data-listing-id="${listingId}"]`);
        if (listingElement) {
            listingElement.style.opacity = '0.5';
            listingElement.style.transition = 'opacity 0.3s';
            setTimeout(() => listingElement.remove(), 300);
        }
        
    } catch (error) {
        console.error("Error deleting listing:", error);
        let errorMsg = "Error deleting listing";
        if (error.code === 'permission-denied') {
            errorMsg = "You don't have permission to delete this listing";
        } else if (!navigator.onLine) {
            errorMsg = "Network error - please try again when connected";
        }
        showNotification(errorMsg, 'error');
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}

// ================= MODAL FUNCTIONS =================
window.openModal = function(imageUrl) {
    $('modal-image').src = imageUrl;
    $('imageModal').style.display = "block";
};

window.closeModal = function() {
    $('imageModal').style.display = "none";
};

// ================= TOGGLE MORE IMAGES =================
window.toggleMoreImages = function(btn) {
    const gallery = btn.closest('.listing-media-gallery');
    const hiddenImages = gallery.querySelectorAll('.hidden-image');
    const isExpanded = btn.dataset.expanded === 'true';
    
    if (isExpanded) {
        hiddenImages.forEach(img => img.style.display = 'none');
        const count = hiddenImages.length;
        btn.innerHTML = `<i class="fas fa-images"></i> Show ${count} more`;
        btn.dataset.expanded = 'false';
    } else {
        hiddenImages.forEach(img => img.style.display = 'block');
        btn.innerHTML = `<i class="fas fa-chevron-up"></i> Show less`;
        btn.dataset.expanded = 'true';
    }
};

window.onclick = function(event) {
    const modal = $('imageModal');
    if (event.target === modal) {
        modal.style.display = "none";
    }
};

// ================= AUTHENTICATION & INITIALIZATION =================
document.addEventListener('DOMContentLoaded', () => {
    // Cache DOM elements first
    cacheDOMElements();
    
    // Setup network monitoring for resilience
    setupNetworkMonitoring();
    
    initializeCategoryDropdown();
    
    // Initialize other searchable dropdowns
    convertToSearchableDropdown('subcategory');
    convertToSearchableDropdown('subsubcategory');
    convertToSearchableDropdown('brand-name');
    
    setupAutoSave();
    initializeQueue();
    
    // Smooth scroll to first form input on page load
    setTimeout(() => {
        const firstFormGroup = $q('.form-step.active .form-group');
        if (firstFormGroup) {
            firstFormGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 500);
    
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        
        try {
            const userDoc = await getDoc(doc(db, "Users", user.uid));
            
            if (userDoc.exists()) {
                const userData = userDoc.data();
                $("profile-pic").src = userData.profilePicUrl || "";
                $("seller-name").textContent = `Name: ${userData.name || "Unknown"}`;
                $("seller-email").textContent = `Email: ${userData.email || "Unknown"}`;
                $("seller-location").textContent = `Location: ${userData.county || "Unknown"}, ${userData.ward || "Unknown"}`;
                
                if (!userData.profilePicUrl || !userData.name || !userData.email || !userData.county || !userData.ward) {
                    $("profile-incomplete-message").style.display = 'block';
                    setTimeout(() => {
                        window.location.href = 'profile.html';
                    }, 5000);
                    return;
                }
            } else {
                $("profile-incomplete-message").style.display = 'block';
                setTimeout(() => {
                    window.location.href = 'profile.html';
                }, 5000);
                return;
            }
            
            loadDraft();
            await loadUserListings();
            
        } catch (error) {
            console.error("Error initializing:", error);
            showNotification("Error loading data: " + error.message);
        }
    });
});