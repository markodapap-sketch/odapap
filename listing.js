import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { app } from "./js/firebase.js";
import { showNotification } from './notifications.js';
import { categoryHierarchy, brandsByCategory } from './js/categoryData.js';

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

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
    const stored = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (stored) {
        try {
            uploadQueue = JSON.parse(stored);
            if (uploadQueue.length > 0) {
                showQueueUI();
                processQueue();
            }
        } catch (e) {
            console.error("Error loading queue:", e);
            localStorage.removeItem(QUEUE_STORAGE_KEY);
        }
    }
}

function saveQueueToStorage() {
    try {
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(uploadQueue));
    } catch (e) {
        console.error("Error saving queue:", e);
    }
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
    let queueContainer = document.getElementById('upload-queue-container');
    
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
    const queueContainer = document.getElementById('upload-queue-container');
    if (queueContainer) {
        queueContainer.style.display = 'none';
    }
}

function updateQueueUI() {
    const queueItems = document.getElementById('queue-items');
    if (!queueItems) return;
    
    // Update queue count
    const queueCount = document.getElementById('queue-count');
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
    const queueItems = document.getElementById('queue-items');
    const icon = document.getElementById('queue-toggle-icon');
    
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

function saveDraft() {
    // Collect image previews (compressed dataURLs)
    const imageDataUrls = [];
    for (let i = 1; i <= 5; i++) {
        const label = document.getElementById(`image-upload-label-${i}`);
        if (label && label.classList.contains('has-image')) {
            // Get the background-image dataURL
            const bgImage = label.style.backgroundImage;
            if (bgImage && bgImage.startsWith('url(')) {
                const dataUrl = bgImage.slice(5, -2); // Remove url(" and ")
                imageDataUrls.push({ index: i, dataUrl: dataUrl });
            }
        }
    }
    
    const draftData = {
        category: document.getElementById('category').value,
        subcategory: document.getElementById('subcategory').value,
        subsubcategory: document.getElementById('subsubcategory').value,
        customSubsubcategory: document.getElementById('custom-subsubcategory').value,
        itemName: document.getElementById('item-name').value,
        brandName: document.getElementById('brand-name').value,
        customBrand: document.getElementById('custom-brand').value,
        description: document.getElementById('description').value,
        itemPrice: document.getElementById('item-price').value,
        initialPrice: document.getElementById('initial-price').value,
        images: imageDataUrls,
        currentStep: currentStep,
        timestamp: Date.now()
    };
    
    try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftData));
    } catch (e) {
        // If storage quota exceeded (likely due to images), save without images
        console.warn("Error saving draft with images, trying without:", e);
        delete draftData.images;
        try {
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftData));
        } catch (e2) {
            console.error("Error saving draft:", e2);
        }
    }
}

function loadDraft() {
    try {
        const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (!stored) return false;
        
        const draft = JSON.parse(stored);
        
        // Only load if draft is less than 7 days old
        if (Date.now() - draft.timestamp > 7 * 24 * 60 * 60 * 1000) {
            localStorage.removeItem(DRAFT_STORAGE_KEY);
            return false;
        }
        
        // Auto-restore without asking - silently restore
        document.getElementById('category').value = draft.category || '';
        updateSearchableDropdownDisplay('category');
        
        // Trigger category change to populate subcategories
        if (draft.category) {
            document.getElementById('category').dispatchEvent(new Event('change'));
        }
        
        // Use setTimeout to allow cascading dropdowns to populate
        setTimeout(() => {
            document.getElementById('subcategory').value = draft.subcategory || '';
            updateSearchableDropdownDisplay('subcategory');
            if (draft.subcategory) {
                document.getElementById('subcategory').dispatchEvent(new Event('change'));
            }
            
            setTimeout(() => {
                document.getElementById('subsubcategory').value = draft.subsubcategory || '';
                updateSearchableDropdownDisplay('subsubcategory');
                document.getElementById('custom-subsubcategory').value = draft.customSubsubcategory || '';
                document.getElementById('brand-name').value = draft.brandName || '';
                updateSearchableDropdownDisplay('brand-name');
                document.getElementById('custom-brand').value = draft.customBrand || '';
            }, 200);
        }, 200);
        
        document.getElementById('item-name').value = draft.itemName || '';
        document.getElementById('description').value = draft.description || '';
        document.getElementById('item-price').value = draft.itemPrice || '';
        document.getElementById('initial-price').value = draft.initialPrice || '';
        
        // Restore saved images (preview only - user will need to re-upload for actual file)
        if (draft.images && draft.images.length > 0) {
            draft.images.forEach(img => {
                const label = document.getElementById(`image-upload-label-${img.index}`);
                if (label && img.dataUrl) {
                    label.style.backgroundImage = `url(${img.dataUrl})`;
                    label.classList.add('has-image');
                    label.classList.add('restored-preview'); // Mark as restored
                    const icon = label.querySelector('i');
                    const uploadText = label.querySelector('.upload-text');
                    if (icon) icon.style.display = 'none';
                    if (uploadText) uploadText.style.display = 'none';
                }
            });
        }
        
        // Restore current step if saved
        if (draft.currentStep && draft.currentStep > 1) {
            currentStep = draft.currentStep;
            showStep(currentStep);
            showNotification('📝 Your progress has been restored', 'success');
        }
        
        return true;
    } catch (e) {
        console.error("Error loading draft:", e);
        localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
    
    return false;
}

// Update searchable dropdown display to match select value
function updateSearchableDropdownDisplay(selectId) {
    const select = document.getElementById(selectId);
    const wrapper = document.getElementById(`${selectId}-searchable`);
    if (!select || !wrapper) return;
    
    const trigger = wrapper.querySelector('.dropdown-trigger');
    const selectedOption = select.options[select.selectedIndex];
    
    if (selectedOption && selectedOption.value) {
        trigger.querySelector('.selected-text').textContent = selectedOption.textContent.replace(' ★', '');
        trigger.querySelector('.selected-text').classList.remove('placeholder');
        
        // Update selected state in dropdown
        const options = wrapper.querySelectorAll('.dropdown-option');
        options.forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === selectedOption.value);
        });
    }
}

function clearDraft() {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
}

// Auto-save on input changes
function setupAutoSave() {
    const fields = [
        'category', 'subcategory', 'subsubcategory', 'custom-subsubcategory',
        'item-name', 'brand-name', 'custom-brand', 'description', 
        'item-price', 'initial-price'
    ];
    
    fields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
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
    const categorySelect = document.getElementById('category');
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
    const select = document.getElementById(selectId);
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
        document.querySelectorAll('.dropdown-menu.show').forEach(m => {
            m.classList.remove('show');
            m.closest('.searchable-dropdown').querySelector('.dropdown-trigger').classList.remove('active');
        });
        
        if (!isOpen) {
            menu.classList.add('show');
            trigger.classList.add('active');
            menu.querySelector('input').focus();
        }
    });
    
    // Event: Search
    menu.querySelector('input').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
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
    const select = document.getElementById(selectId);
    const wrapper = document.getElementById(`${selectId}-searchable`);
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
function updateProgressBar() {
    document.querySelectorAll('.progress-step').forEach((step, index) => {
        const stepNum = index + 1;
        step.classList.remove('active', 'completed');
        
        if (stepNum < currentStep) {
            step.classList.add('completed');
        } else if (stepNum === currentStep) {
            step.classList.add('active');
        }
    });
}

function showStep(step) {
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    document.querySelector(`.form-step[data-step="${step}"]`).classList.add('active');
    
    document.getElementById('prev-btn').style.display = step === 1 ? 'none' : 'flex';
    document.getElementById('next-btn').style.display = step === totalSteps ? 'none' : 'flex';
    document.getElementById('submit-button').style.display = step === totalSteps ? 'flex' : 'none';
    
    if (step === 4) {
        updateReviewSummary();
        calculatePricing();
    }
    
    updateProgressBar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateStep(step) {
    const stepElement = document.querySelector(`.form-step[data-step="${step}"]`);
    const requiredFields = stepElement.querySelectorAll('[required]');
    
    for (let field of requiredFields) {
        if (!field.value || (field.tagName === 'SELECT' && field.value === '')) {
            showNotification(`Please fill in all required fields in Step ${step}`);
            field.focus();
            return false;
        }
    }
    
    if (step === 2) {
        // Check for at least one product image
        let hasImage = false;
        let hasRestoredPreview = false;
        for (let i = 1; i <= 5; i++) {
            const imageInput = document.getElementById(`media-upload-${i}`);
            const label = document.getElementById(`image-upload-label-${i}`);
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
                showNotification('Your previous images were restored as previews only. Please re-select your image files to upload them.', 'warning');
            } else {
                showNotification('Please upload at least one product image');
            }
            return false;
        }
    }
    
    if (step === 3) {
        const variationRows = document.querySelectorAll('.variation-row');
        if (variationRows.length === 0) {
            showNotification('Please add at least one product variation');
            return false;
        }
        
        // Check each variation has a type and at least one attribute
        for (let row of variationRows) {
            const variationTitle = getVariationTitle(row);
            if (!variationTitle || variationTitle.trim() === '') {
                showNotification('Please select or enter a variation type for all variations', 'error');
                return false;
            }
            
            const attributes = row.querySelectorAll('.attribute-item');
            if (attributes.length === 0) {
                showNotification(`Please add at least one option for "${variationTitle}"`, 'error');
                return false;
            }
            
            // Check each attribute has required fields with valid values
            for (let attr of attributes) {
                const name = attr.querySelector('.attribute-name').value?.trim();
                const stockValue = attr.querySelector('.attribute-stock').value;
                const priceValue = attr.querySelector('.attribute-price').value;
                
                if (!name || name === '') {
                    showNotification(`Please enter a name for all options in "${variationTitle}"`, 'error');
                    attr.querySelector('.attribute-name').focus();
                    return false;
                }
                
                if (!stockValue || stockValue === '') {
                    showNotification(`Please enter stock for option "${name}"`, 'error');
                    attr.querySelector('.attribute-stock').focus();
                    return false;
                }
                
                const stock = parseInt(stockValue);
                if (isNaN(stock) || stock < 1) {
                    showNotification(`Stock for "${name}" must be at least 1`, 'error');
                    attr.querySelector('.attribute-stock').focus();
                    return false;
                }
                
                if (!priceValue || priceValue === '') {
                    showNotification(`Please enter price for option "${name}"`, 'error');
                    attr.querySelector('.attribute-price').focus();
                    return false;
                }
                
                const price = parseFloat(priceValue);
                if (isNaN(price) || price <= 0) {
                    showNotification(`Price for "${name}" must be greater than 0`, 'error');
                    attr.querySelector('.attribute-price').focus();
                    return false;
                }
            }
        }
    }
    
    return true;
}

document.getElementById('next-btn').addEventListener('click', () => {
    if (validateStep(currentStep)) {
        currentStep++;
        showStep(currentStep);
    }
});

document.getElementById('prev-btn').addEventListener('click', () => {
    currentStep--;
    showStep(currentStep);
});

// ================= CATEGORY HIERARCHY =================
document.getElementById('category').addEventListener('change', function() {
    const category = this.value;
    const subcategoryGroup = document.getElementById('subcategory-group');
    const subcategorySelect = document.getElementById('subcategory');
    const subsubcategoryGroup = document.getElementById('subsubcategory-group');
    
    subcategorySelect.innerHTML = '<option value="">Select sub-category</option>';
    subsubcategoryGroup.style.display = 'none';
    document.getElementById('custom-subsubcategory-group').style.display = 'none';
    
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

document.getElementById('subcategory').addEventListener('change', async function() {
    const category = document.getElementById('category').value;
    const subcategory = this.value;
    const subsubcategoryGroup = document.getElementById('subsubcategory-group');
    const subsubcategorySelect = document.getElementById('subsubcategory');
    
    subsubcategorySelect.innerHTML = '<option value="">Select specific type</option>';
    document.getElementById('custom-subsubcategory-group').style.display = 'none';
    
    if (subcategory && categoryHierarchy[category]?.subcategories[subcategory]) {
        subsubcategoryGroup.style.display = 'block';
        subsubcategorySelect.disabled = false;
        
        // Get default types from categoryData
        const defaultTypes = categoryHierarchy[category].subcategories[subcategory].types;
        
        // Load custom types from Firestore
        const customTypes = await loadCustomCategories(category, subcategory);
        
        // Combine and deduplicate
        const allTypes = [...new Set([...defaultTypes, ...customTypes])];
        
        allTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.toLowerCase().replace(/\s+/g, '-');
            option.textContent = type;
            // Mark custom types
            if (customTypes.includes(type) && !defaultTypes.includes(type)) {
                option.textContent = `${type} ★`;
                option.dataset.custom = 'true';
            }
            subsubcategorySelect.appendChild(option);
        });
        
        // Refresh searchable dropdown
        refreshSearchableDropdown('subsubcategory');
    } else {
        subsubcategoryGroup.style.display = 'none';
        subsubcategorySelect.disabled = true;
    }
});

document.getElementById('subsubcategory').addEventListener('change', function() {
    const customGroup = document.getElementById('custom-subsubcategory-group');
    
    if (this.value === 'custom') {
        customGroup.style.display = 'block';
        document.getElementById('custom-subsubcategory').required = true;
    } else {
        customGroup.style.display = 'none';
        document.getElementById('custom-subsubcategory').required = false;
    }
});

async function updateBrandDropdown(category) {
    const brandSelect = document.getElementById('brand-name');
    brandSelect.innerHTML = '<option value="">Select brand</option>';
    
    // Get default brands
    const defaultBrands = brandsByCategory[category] || ["Generic", "Custom/Other"];
    
    // Load custom brands from Firestore
    const customBrands = await loadCustomBrands(category);
    
    // Combine brands, ensuring Custom/Other is always last
    const regularBrands = defaultBrands.filter(b => b !== "Custom/Other");
    const allBrands = [...new Set([...regularBrands, ...customBrands])];
    allBrands.sort((a, b) => a.localeCompare(b));
    
    allBrands.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand;
        option.textContent = brand;
        // Mark custom brands
        if (customBrands.includes(brand) && !defaultBrands.includes(brand)) {
            option.textContent = `${brand} ★`;
            option.dataset.custom = 'true';
        }
        brandSelect.appendChild(option);
    });
    
    // Always add Custom/Other at the end
    const customOption = document.createElement('option');
    customOption.value = 'Custom/Other';
    customOption.textContent = '+ Add New Brand';
    customOption.style.fontWeight = 'bold';
    brandSelect.appendChild(customOption);
    
    // Refresh searchable dropdown
    refreshSearchableDropdown('brand-name');
}

document.getElementById('brand-name').addEventListener('change', function() {
    const customBrandGroup = document.getElementById('custom-brand-group');
    
    if (this.value === 'Custom/Other') {
        customBrandGroup.style.display = 'block';
        document.getElementById('custom-brand').required = true;
    } else {
        customBrandGroup.style.display = 'none';
        document.getElementById('custom-brand').required = false;
    }
});

async function saveCustomCategory(category, subcategory, customType) {
    try {
        const metadataRef = doc(db, "CategoryMetadata", `${category}_${subcategory}`);
        const metadataDoc = await getDoc(metadataRef);
        
        let types = [];
        if (metadataDoc.exists()) {
            types = metadataDoc.data().types || [];
        }
        
        const normalizedType = customType.trim();
        if (normalizedType && !types.some(t => t.toLowerCase() === normalizedType.toLowerCase())) {
            types.push(normalizedType);
            await setDoc(metadataRef, { 
                types,
                category,
                subcategory,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log(`Saved custom type: ${normalizedType}`);
        }
    } catch (error) {
        console.error("Error saving custom category:", error);
    }
}

// Save custom brand to Firestore
async function saveCustomBrand(category, brandName) {
    try {
        const brandsRef = doc(db, "BrandMetadata", category);
        const brandsDoc = await getDoc(brandsRef);
        
        let brands = [];
        if (brandsDoc.exists()) {
            brands = brandsDoc.data().brands || [];
        }
        
        const normalizedBrand = brandName.trim();
        if (normalizedBrand && !brands.some(b => b.toLowerCase() === normalizedBrand.toLowerCase())) {
            brands.push(normalizedBrand);
            await setDoc(brandsRef, { 
                brands,
                category,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log(`Saved custom brand: ${normalizedBrand}`);
        }
    } catch (error) {
        console.error("Error saving custom brand:", error);
    }
}

// Load custom categories from Firestore
async function loadCustomCategories(category, subcategory) {
    try {
        const metadataRef = doc(db, "CategoryMetadata", `${category}_${subcategory}`);
        const metadataDoc = await getDoc(metadataRef);
        
        if (metadataDoc.exists()) {
            return metadataDoc.data().types || [];
        }
    } catch (error) {
        console.error("Error loading custom categories:", error);
    }
    return [];
}

// Load custom brands from Firestore
async function loadCustomBrands(category) {
    try {
        const brandsRef = doc(db, "BrandMetadata", category);
        const brandsDoc = await getDoc(brandsRef);
        
        if (brandsDoc.exists()) {
            return brandsDoc.data().brands || [];
        }
    } catch (error) {
        console.error("Error loading custom brands:", error);
    }
    return [];
}

// ================= PRODUCT IMAGES =================
for (let i = 1; i <= 5; i++) {
    document.getElementById(`media-upload-${i}`).addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const label = document.getElementById(`image-upload-label-${i}`);
                label.style.backgroundImage = `url(${e.target.result})`;
                label.classList.add('has-image');
                label.classList.remove('restored-preview'); // Clear restored flag when actual file selected
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
    document.getElementById(`media-upload-${index}`).value = '';
    const label = document.getElementById(`image-upload-label-${index}`);
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
    const category = document.getElementById('category').value;
    return variationTypesByCategory[category] || variationTypesByCategory.default;
}

// ================= VARIATION MATRIX WITH ATTRIBUTES =================
function createVariationRow() {
    if (document.querySelectorAll('.variation-row').length >= MAX_VARIATIONS) {
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
    
    document.getElementById('variations-container').appendChild(variationRow);
    
    addAttribute(variationCounter);
    
    variations.push({
        id: variationCounter,
        element: variationRow,
        attributes: []
    });
}

window.handleVariationTypeChange = function(select, variationId) {
    const row = document.querySelector(`.variation-row[data-variation-id="${variationId}"]`);
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
    const quickAddSection = document.querySelector(`.quick-add-section[data-variation-id="${variationId}"]`);
    if (quickAddSection) {
        quickAddSection.style.display = 'none';
    }
};

window.quickAddAttribute = function(variationId, value, event) {
    const attributesList = document.querySelector(`.attributes-list[data-variation-id="${variationId}"]`);
    if (!attributesList) return;
    
    const chip = event?.target?.closest('.suggestion-chip') || document.querySelector(`.suggestion-chip[data-value="${value}"]`);
    
    // Check if this value already exists - if so, REMOVE it (toggle behavior)
    const existingAttr = Array.from(attributesList.querySelectorAll('.attribute-item')).find(item => {
        const nameInput = item.querySelector('.attribute-name');
        return nameInput && nameInput.value.toLowerCase() === value.toLowerCase();
    });
    
    if (existingAttr) {
        // Remove existing attribute
        existingAttr.remove();
        // Renumber remaining attributes
        const remaining = attributesList.querySelectorAll('.attribute-item');
        remaining.forEach((item, index) => {
            item.dataset.attributeIndex = index + 1;
            const badge = item.querySelector('.attribute-badge');
            if (badge) badge.textContent = `#${index + 1}`;
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
    const attributesList = document.querySelector(`.attributes-list[data-variation-id="${variationId}"]`);
    const countSpan = document.querySelector(`.variation-row[data-variation-id="${variationId}"] .attribute-count`);
    if (attributesList && countSpan) {
        const count = attributesList.querySelectorAll('.attribute-item').length;
        countSpan.textContent = `(${count}/${MAX_ATTRIBUTES_PER_VARIATION})`;
    }
}

function addAttribute(variationId, prefilledName = '') {
    const attributesList = document.querySelector(`.attributes-list[data-variation-id="${variationId}"]`);
    
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
            <div class="attribute-badge">#${attributeIndex}</div>
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
    
    // Renumber remaining attributes
    const remaining = attributesList.querySelectorAll('.attribute-item');
    remaining.forEach((item, index) => {
        item.dataset.attributeIndex = index + 1;
        const badge = item.querySelector('.attribute-badge');
        if (badge) badge.textContent = `#${index + 1}`;
    });
    
    // Update chip state if it was from quick add
    if (attrName) {
        const chip = document.querySelector(`.suggestion-chip[data-value="${attrName}"]`);
        if (chip) {
            chip.classList.remove('selected');
            chip.innerHTML = `<i class="fas fa-plus-circle"></i> ${attrName}`;
        }
    }
    
    updateAttributeCount(variationId);
    updateVariationCalculations();
}

window.removeAttribute = function(variationId, attributeIndex) {
    const attributesList = document.querySelector(`.attributes-list[data-variation-id="${variationId}"]`);
    if (attributesList) {
        const attributeItem = attributesList.querySelector(`.attribute-item[data-attribute-index="${attributeIndex}"]`);
        if (attributeItem) {
            removeAttributeElement(attributeItem, variationId);
        }
    }
};

window.removeVariation = function(id) {
    const row = document.querySelector(`.variation-row[data-variation-id="${id}"]`);
    if (row) {
        row.remove();
        variations = variations.filter(v => v.id !== id);
    }
};

document.getElementById('add-variation-btn').addEventListener('click', createVariationRow);

createVariationRow();

// ================= PRICING CALCULATIONS =================
function updateVariationCalculations() {
    const basePrice = parseFloat(document.getElementById('item-price').value) || 0;
    if (basePrice === 0) return;
    
    document.querySelectorAll('.variation-row').forEach(row => {
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
            const stock = parseFloat(attr.querySelector('.attribute-stock').value) || 0;
            const pieces = parseFloat(attr.querySelector('.attribute-pieces').value) || 1;
            const attrPrice = parseFloat(attr.querySelector('.attribute-price').value) || basePrice;
            
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
            const priceRange = minPrice === maxPrice 
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
    const basePrice = parseFloat(document.getElementById('item-price').value) || 0;
    let finalPrice = basePrice;
    
    if (finalPrice < 10000) {
        finalPrice += finalPrice * 0.05;
    } else {
        finalPrice += finalPrice * 0.025;
    }
    
    // Price breakdown removed - retail prices are now per-option
    updateVariationCalculations();
}

document.getElementById('item-price').addEventListener('input', () => {
    calculatePricing();
    updateVariationCalculations();
});

// ================= BULK PRICING TIERS =================
document.getElementById('toggle-bulk-pricing').addEventListener('click', function() {
    const container = document.getElementById('bulk-pricing-container');
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
    
    document.getElementById('bulk-tiers-container').appendChild(tierDiv);
    bulkTiers.push({ id: bulkTierCounter });
}

window.removeBulkTier = function(id) {
    const tier = document.querySelector(`[data-tier-id="${id}"]`);
    if (tier) {
        tier.remove();
        bulkTiers = bulkTiers.filter(t => t.id !== id);
    }
};

document.getElementById('add-bulk-tier-btn').addEventListener('click', addBulkTier);

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
    const category = document.getElementById('category').selectedOptions[0]?.textContent || 'Not selected';
    const subcategory = document.getElementById('subcategory').selectedOptions[0]?.textContent || 'Not selected';
    const itemName = document.getElementById('item-name').value || 'Not entered';
    const brand = document.getElementById('brand-name').value || 'Not selected';
    const description = document.getElementById('description').value || 'Not entered';
    
    const variationRows = document.querySelectorAll('.variation-row');
    let totalStock = 0;
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
            
            let priceDisplay = `KES ${price.toLocaleString()}`;
            if (retailPrice) {
                priceDisplay += ` <span style="color: #888; text-decoration: line-through;">Retail: ${retailPrice.toLocaleString()}</span>`;
            }
            attributesList += `<li>${attrName} - ${stock} units @ ${priceDisplay} (${pieces} pcs/unit)</li>`;
        });
        
        variationsSummary += `<li><strong>${title}</strong> (${attributeItems.length} options, ${variationStockSubtotal} units)<ul style="margin-left: 20px; margin-top: 4px;">${attributesList}</ul></li>`;
    });
    variationsSummary += '</ul>';
    
    const hasBulkPricing = document.getElementById('bulk-pricing-container').style.display !== 'none';
    let bulkSummary = '<p>No bulk pricing tiers</p>';
    
    if (hasBulkPricing) {
        bulkSummary = '<ul style="margin-left: 20px;">';
        document.querySelectorAll('.bulk-tier').forEach(tier => {
            const min = tier.querySelector('.tier-min').value || 'N/A';
            const max = tier.querySelector('.tier-max').value || '∞';
            const price = tier.querySelector('.tier-price').value || 'N/A';
            bulkSummary += `<li>${min} - ${max} units: KES ${price}</li>`;
        });
        bulkSummary += '</ul>';
    }
    
    const reviewHTML = `
        <p><strong>Category:</strong> ${category} > ${subcategory}</p>
        <p><strong>Product Name:</strong> ${itemName}</p>
        <p><strong>Brand:</strong> ${brand}</p>
        <p><strong>Description:</strong> ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}</p>
        <p><strong>Total Stock:</strong> ${totalStock} units across ${variationRows.length} variation(s)</p>
        <p><strong>Variations:</strong></p>
        ${variationsSummary}
        <p><strong>Bulk Pricing:</strong></p>
        ${bulkSummary}
    `;
    
    document.getElementById('review-summary').innerHTML = reviewHTML;
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

document.getElementById('item-listing-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    
    const user = auth.currentUser;
    if (!user) {
        showNotification("You need to be logged in to list products.");
        return;
    }
    
    // Show loading state on submit button
    const submitBtn = document.getElementById('submit-button');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing upload...';
    
    try {
        // Collect form data
        const category = document.getElementById('category').value;
        const subcategory = document.getElementById('subcategory').value;
        const subsubcategory = document.getElementById('subsubcategory').value;
        const customSubsubcategory = document.getElementById('custom-subsubcategory').value;
        const itemName = document.getElementById('item-name').value;
        const brandName = document.getElementById('brand-name').value === 'Custom/Other' 
            ? document.getElementById('custom-brand').value 
            : document.getElementById('brand-name').value;
        const description = document.getElementById('description').value;
        const itemPrice = parseFloat(document.getElementById('item-price').value);
        const initialPrice = parseFloat(document.getElementById('initial-price').value) || null;
        
        // Calculate final price
        let finalPrice = itemPrice;
        if (finalPrice < 10000) {
            finalPrice += finalPrice * 0.05;
        } else {
            finalPrice += finalPrice * 0.025;
        }
        
        // Handle custom category
        let finalSubsubcategory = subsubcategory;
        if (subsubcategory === 'custom' && customSubsubcategory) {
            finalSubsubcategory = customSubsubcategory.toLowerCase().replace(/\s+/g, '-');
        }
        
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Compressing images...';
        
        // Compress and convert product images to data URLs
        const productImagesData = [];
        for (let i = 1; i <= 5; i++) {
            const file = document.getElementById(`media-upload-${i}`).files[0];
            if (file) {
                const compressedFile = await compressImage(file);
                const dataUrl = await fileToDataUrl(compressedFile);
                productImagesData.push({
                    name: file.name,
                    dataUrl: dataUrl
                });
            }
        }
        
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing variations...';
        
        // Process variations with attributes
        const variationRows = document.querySelectorAll('.variation-row');
        const processedVariations = [];
        
        for (let row of variationRows) {
            const variationTitle = getVariationTitle(row);
            
            // Validate variation title
            if (!variationTitle || variationTitle.trim() === '') {
                throw new Error('Each variation must have a type selected');
            }
            
            const attributeItems = row.querySelectorAll('.attribute-item');
            
            // Validate at least one attribute
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
        
        // Process bulk pricing tiers
        const processedBulkTiers = [];
        if (document.getElementById('bulk-pricing-container').style.display !== 'none') {
            document.querySelectorAll('.bulk-tier').forEach(tier => {
                const min = parseInt(tier.querySelector('.tier-min').value);
                const max = parseInt(tier.querySelector('.tier-max').value) || null;
                const price = parseFloat(tier.querySelector('.tier-price').value);
                
                if (min && price) {
                    processedBulkTiers.push({ min, max, price });
                }
            });
        }
        
        const listingId = document.getElementById('submit-button').dataset.id;
        
        // Save custom brand if user added a new one
        if (document.getElementById('brand-name').value === 'Custom/Other') {
            const customBrand = document.getElementById('custom-brand').value.trim();
            if (customBrand) {
                await saveCustomBrand(category, customBrand);
            }
        }
        
        // Save custom subcategory if user added a new one
        if (subsubcategory === 'custom' && customSubsubcategory) {
            await saveCustomCategory(category, subcategory, customSubsubcategory);
        }
        
        // Create listing data object for queue
        const listingDataForQueue = {
            category,
            subcategory,
            subsubcategory,
            customSubsubcategory,
            finalSubsubcategory,
            itemName,
            brandName,
            description,
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
        
        // Reset button state
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
        
        // Show success notification
        showNotification(`✓ Listing "${itemName}" added to upload queue! You can start a new listing now.`, 'success');
        
        // Reset form immediately
        resetForm();
        clearDraft();
        
        // Reload listings after a short delay
        setTimeout(() => {
            loadUserListings();
        }, 2000);
        
    } catch (error) {
        console.error("Error preparing listing:", error);
        showNotification("Error: " + error.message);
        
        // Reset button state on error
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
    }
});

function resetForm() {
    document.getElementById('item-listing-form').reset();
    document.getElementById('submit-button').innerText = 'Publish Listing';
    document.getElementById('submit-button').dataset.id = '';
    currentStep = 1;
    showStep(1);
    variations = [];
    variationCounter = 0;
    bulkTiers = [];
    bulkTierCounter = 0;
    document.getElementById('variations-container').innerHTML = '';
    document.getElementById('bulk-tiers-container').innerHTML = '';
    document.getElementById('bulk-pricing-container').style.display = 'none';
    document.getElementById('photo-trace-preview').style.display = 'none';
    document.getElementById('photo-trace-label').style.display = 'flex';
    
    for (let i = 1; i <= 5; i++) {
        const label = document.getElementById(`image-upload-label-${i}`);
        if (label) {
            label.style.backgroundImage = '';
            const icon = label.querySelector('i');
            if (icon) icon.style.display = 'flex';
        }
    }
    
    createVariationRow();
}

// ================= LOAD USER LISTINGS =================
async function loadUserListings() {
    const user = auth.currentUser;
    const listingsContainer = document.getElementById('listings-container');
    listingsContainer.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading listings...</div>';
    
    if (!user) return;
    
    try {
        const q = query(collection(db, "Listings"), where("uploaderId", "==", user.uid));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            listingsContainer.innerHTML = '<p style="text-align: center; color: #757575; padding: 40px;">No listings yet. Create your first wholesale listing above!</p>';
            return;
        }
        
        listingsContainer.innerHTML = '';
        
        querySnapshot.forEach((docSnap) => {
            const listing = docSnap.data();
            const listingElement = document.createElement('div');
            listingElement.className = 'listing';
            
            let mediaHTML = '';
            if (listing.photoTraceUrl || (listing.imageUrls && listing.imageUrls.length > 0)) {
                mediaHTML = '<div class="listing-media">';
                
                if (listing.photoTraceUrl) {
                    mediaHTML += `<img src="${listing.photoTraceUrl}" class="listing-img" onclick="openModal('${listing.photoTraceUrl}')" title="Verification Photo" />`;
                }
                
                if (listing.imageUrls) {
                    listing.imageUrls.forEach(url => {
                        mediaHTML += `<img src="${url}" class="listing-img" onclick="openModal('${url}')" />`;
                    });
                }
                
                if (listing.variations) {
                    listing.variations.forEach(variation => {
                        if (variation.attributes) {
                            variation.attributes.forEach(attr => {
                                if (attr.photoUrl) {
                                    mediaHTML += `<img src="${attr.photoUrl}" class="listing-img" onclick="openModal('${attr.photoUrl}')" title="${variation.title}: ${attr.attr_name}" />`;
                                }
                            });
                        }
                    });
                }
                
                mediaHTML += '</div>';
            }
            
            let variationsHTML = '';
            if (listing.variations && listing.variations.length > 0) {
                variationsHTML = '<div style="margin: 12px 0;"><strong>Variations:</strong><ul style="margin: 8px 0 0 20px;">';
                listing.variations.forEach(v => {
                    if (v.attributes) {
                        variationsHTML += `<li><strong>${v.title}:</strong><ul style="margin-left: 15px;">`;
                        v.attributes.forEach(attr => {
                            variationsHTML += `<li>${attr.attr_name} - ${attr.stock} units (${attr.piece_count} pcs/unit) @ KES ${attr.price.toFixed(2)}</li>`;
                        });
                        variationsHTML += '</ul></li>';
                    }
                });
                variationsHTML += '</ul></div>';
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
                </div>
                ${mediaHTML}
                <p><strong>Category:</strong> ${listing.category} > ${listing.subcategory}</p>
                <p><strong>Price per Unit:</strong> KES ${listing.price.toFixed(2)}</p>
                ${listing.initialPrice ? `<p><strong>Original Retail Price:</strong> KES ${listing.initialPrice.toFixed(2)}</p>` : ''}
                <p><strong>Total Stock:</strong> ${listing.totalStock || 0} units</p>
                ${variationsHTML}
                ${bulkPricingHTML}
                <p><strong>Description:</strong> ${listing.description.substring(0, 150)}${listing.description.length > 150 ? '...' : ''}</p>
                
                <div class="quick-edit-section">
                    <h5><i class="fas fa-bolt"></i> Quick Edit</h5>
                    <div class="quick-edit-fields">
                        <div class="form-group">
                            <label>New Price (KES)</label>
                            <input type="number" class="quick-edit-price" value="${listing.originalPrice || listing.price}" step="0.01">
                        </div>
                        <div class="form-group">
                            <label>Update Stock</label>
                            <input type="number" class="quick-edit-stock" value="${listing.totalStock || 0}" min="0">
                        </div>
                        <button class="quick-edit-btn" data-listing-id="${docSnap.id}">
                            <i class="fas fa-save"></i> Save
                        </button>
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
        
        document.querySelectorAll('.quick-edit-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const listingId = button.dataset.listingId;
                const priceInput = button.parentElement.querySelector('.quick-edit-price');
                const stockInput = button.parentElement.querySelector('.quick-edit-stock');
                
                await quickEditListing(listingId, parseFloat(priceInput.value), parseInt(stockInput.value));
            });
        });
        
        document.querySelectorAll('.edit-btn').forEach(button => {
            button.addEventListener('click', () => loadEditForm(button.dataset.id));
        });
        
        document.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', () => deleteListing(button.dataset.id));
        });
        
    } catch (error) {
        console.error("Error loading listings:", error);
        listingsContainer.innerHTML = '<p style="text-align: center; color: #f44336; padding: 40px;">Error loading listings. Please refresh the page.</p>';
    }
}

// ================= QUICK EDIT =================
async function quickEditListing(listingId, newPrice, newStock) {
    try {
        document.getElementById('spinner').style.display = 'block';
        
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
        document.getElementById('spinner').style.display = 'none';
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
        
        document.getElementById('category').value = listing.category;
        document.getElementById('category').dispatchEvent(new Event('change'));
        
        setTimeout(() => {
            document.getElementById('subcategory').value = listing.subcategory;
            document.getElementById('subcategory').dispatchEvent(new Event('change'));
            
            setTimeout(() => {
                document.getElementById('subsubcategory').value = listing.subsubcategory;
            }, 100);
        }, 100);
        
        document.getElementById('brand-name').value = listing.brand;
        document.getElementById('item-name').value = listing.name;
        document.getElementById('description').value = listing.description;
        document.getElementById('item-price').value = listing.originalPrice || listing.price;
        
        if (listing.initialPrice) {
            document.getElementById('initial-price').value = listing.initialPrice;
        }
        
        variations = [];
        variationCounter = 0;
        document.getElementById('variations-container').innerHTML = '';
        
        if (listing.variations && listing.variations.length > 0) {
            listing.variations.forEach(v => {
                createVariationRow();
                const lastRow = document.querySelector('.variation-row:last-child');
                lastRow.querySelector('.variation-title-input').value = v.title || '';
                
                const attributesList = lastRow.querySelector('.attributes-list');
                attributesList.innerHTML = '';
                
                if (v.attributes) {
                    v.attributes.forEach(attr => {
                        addAttribute(lastRow.dataset.variationId);
                        const newAttr = attributesList.lastElementChild;
                        newAttr.querySelector('.attribute-name').value = attr.attr_name;
                        newAttr.querySelector('.attribute-stock').value = attr.stock;
                        newAttr.querySelector('.attribute-pieces').value = attr.piece_count;
                        newAttr.querySelector('.attribute-price').value = attr.price;
                    });
                }
            });
        }
        
        document.getElementById('submit-button').innerHTML = '<i class="fas fa-save"></i> Update Listing';
        document.getElementById('submit-button').dataset.id = listingId;
        
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
    try {
        document.getElementById('spinner').style.display = 'block';
        await deleteDoc(doc(db, "Listings", listingId));
        showNotification("Listing deleted successfully!", 'success');
        await loadUserListings();
    } catch (error) {
        console.error("Error deleting listing:", error);
        showNotification("Error deleting listing: " + error.message, 'error');
    } finally {
        document.getElementById('spinner').style.display = 'none';
    }
}

// ================= MODAL FUNCTIONS =================
window.openModal = function(imageUrl) {
    document.getElementById('modal-image').src = imageUrl;
    document.getElementById('imageModal').style.display = "block";
};

window.closeModal = function() {
    document.getElementById('imageModal').style.display = "none";
};

window.onclick = function(event) {
    const modal = document.getElementById('imageModal');
    if (event.target === modal) {
        modal.style.display = "none";
    }
};

// ================= AUTHENTICATION & INITIALIZATION =================
document.addEventListener('DOMContentLoaded', () => {
    initializeCategoryDropdown();
    
    // Initialize other searchable dropdowns
    convertToSearchableDropdown('subcategory');
    convertToSearchableDropdown('subsubcategory');
    convertToSearchableDropdown('brand-name');
    
    setupAutoSave();
    initializeQueue();
    
    // Smooth scroll to first form input on page load
    setTimeout(() => {
        const firstFormGroup = document.querySelector('.form-step.active .form-group');
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
                document.getElementById("profile-pic").src = userData.profilePicUrl || "";
                document.getElementById("seller-name").textContent = `Name: ${userData.name || "Unknown"}`;
                document.getElementById("seller-email").textContent = `Email: ${userData.email || "Unknown"}`;
                document.getElementById("seller-location").textContent = `Location: ${userData.county || "Unknown"}, ${userData.ward || "Unknown"}`;
                
                if (!userData.profilePicUrl || !userData.name || !userData.email || !userData.county || !userData.ward) {
                    document.getElementById("profile-incomplete-message").style.display = 'block';
                    setTimeout(() => {
                        window.location.href = 'profile.html';
                    }, 5000);
                    return;
                }
            } else {
                document.getElementById("profile-incomplete-message").style.display = 'block';
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