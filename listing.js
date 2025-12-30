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

function updateQueueItemProgress(itemId, progress, status) {
    const item = uploadQueue.find(q => q.id === itemId);
    if (item) {
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
    
    // Upload photo trace
    updateQueueItemProgress(queueItem.id, 10, 'uploading');
    const photoTraceRef = storageRef(storage, `listings/${user.uid}/photo-trace/${Date.now()}_${data.photoTraceFile.name}`);
    const photoTraceBlob = await fetch(data.photoTraceFile.dataUrl).then(r => r.blob());
    await uploadBytes(photoTraceRef, photoTraceBlob);
    const photoTraceUrl = await getDownloadURL(photoTraceRef);
    
    // Upload additional images
    updateQueueItemProgress(queueItem.id, 30, 'uploading');
    const imageUrls = [];
    for (let i = 0; i < data.additionalImages.length; i++) {
        const img = data.additionalImages[i];
        const fileRef = storageRef(storage, `listings/${user.uid}/additional/${Date.now()}_${img.name}`);
        const blob = await fetch(img.dataUrl).then(r => r.blob());
        await uploadBytes(fileRef, blob);
        const fileUrl = await getDownloadURL(fileRef);
        imageUrls.push(fileUrl);
        
        const progressPercent = 30 + (i / data.additionalImages.length) * 30;
        updateQueueItemProgress(queueItem.id, progressPercent, 'uploading');
    }
    
    // Process variations with attributes
    updateQueueItemProgress(queueItem.id, 60, 'uploading');
    const processedVariations = [];
    
    for (let variation of data.variations) {
        const variationAttributes = [];
        
        for (let attr of variation.attributes) {
            let photoUrl = null;
            if (attr.imageFile) {
                const fileRef = storageRef(storage, `listings/${user.uid}/variations/${Date.now()}_${attr.imageFile.name}`);
                const blob = await fetch(attr.imageFile.dataUrl).then(r => r.blob());
                await uploadBytes(fileRef, blob);
                photoUrl = await getDownloadURL(fileRef);
            }
            
            variationAttributes.push({
                attr_name: attr.attr_name,
                stock: attr.stock,
                piece_count: attr.piece_count,
                price: attr.price,
                photoUrl
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
    
    updateQueueItemProgress(queueItem.id, 80, 'uploading');
    
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
        photoTraceUrl,
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
    
    updateQueueItemProgress(queueItem.id, 100, 'completed');
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
            width: 350px;
            max-height: 400px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.15);
            z-index: 10000;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;
        
        queueContainer.innerHTML = `
            <div style="padding: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <strong>Upload Queue</strong>
                </div>
                <button onclick="toggleQueueUI()" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer;">
                    <i class="fas fa-chevron-down" id="queue-toggle-icon"></i>
                </button>
            </div>
            <div id="queue-items" style="padding: 12px; overflow-y: auto; max-height: 300px;">
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
                ${item.progress > 0 && item.status === 'uploading' ? `
                    <div style="background: #e0e0e0; height: 4px; border-radius: 2px; margin-top: 8px; overflow: hidden;">
                        <div style="background: ${statusColor}; height: 100%; width: ${item.progress}%; transition: width 0.3s;"></div>
                    </div>
                ` : ''}
                ${item.error ? `<small style="color: #f44336; display: block; margin-top: 4px;">${item.error}</small>` : ''}
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
    if (confirm('Remove this upload from queue?')) {
        removeFromQueue(itemId);
    }
};

// ================= AUTO-SAVE DRAFT =================
let draftSaveTimeout;

function saveDraft() {
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
        timestamp: Date.now()
    };
    
    try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftData));
    } catch (e) {
        console.error("Error saving draft:", e);
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
        
        if (confirm('Found a saved draft. Would you like to restore it?')) {
            document.getElementById('category').value = draft.category || '';
            document.getElementById('subcategory').value = draft.subcategory || '';
            document.getElementById('subsubcategory').value = draft.subsubcategory || '';
            document.getElementById('custom-subsubcategory').value = draft.customSubsubcategory || '';
            document.getElementById('item-name').value = draft.itemName || '';
            document.getElementById('brand-name').value = draft.brandName || '';
            document.getElementById('custom-brand').value = draft.customBrand || '';
            document.getElementById('description').value = draft.description || '';
            document.getElementById('item-price').value = draft.itemPrice || '';
            document.getElementById('initial-price').value = draft.initialPrice || '';
            
            return true;
        } else {
            localStorage.removeItem(DRAFT_STORAGE_KEY);
        }
    } catch (e) {
        console.error("Error loading draft:", e);
        localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
    
    return false;
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
        const photoTrace = document.getElementById('photo-trace');
        if (!photoTrace.files[0]) {
            showNotification('Please upload a verification photo (Photo Trace)');
            return false;
        }
    }
    
    if (step === 3 && variations.length === 0) {
        showNotification('Please add at least one product variation');
        return false;
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
    } else {
        subcategoryGroup.style.display = 'none';
        subcategorySelect.disabled = true;
    }
});

document.getElementById('subcategory').addEventListener('change', function() {
    const category = document.getElementById('category').value;
    const subcategory = this.value;
    const subsubcategoryGroup = document.getElementById('subsubcategory-group');
    const subsubcategorySelect = document.getElementById('subsubcategory');
    
    subsubcategorySelect.innerHTML = '<option value="">Select specific type</option>';
    document.getElementById('custom-subsubcategory-group').style.display = 'none';
    
    if (subcategory && categoryHierarchy[category]?.subcategories[subcategory]) {
        subsubcategoryGroup.style.display = 'block';
        subsubcategorySelect.disabled = false;
        
        const types = categoryHierarchy[category].subcategories[subcategory].types;
        types.forEach(type => {
            const option = document.createElement('option');
            option.value = type.toLowerCase().replace(/\s+/g, '-');
            option.textContent = type;
            subsubcategorySelect.appendChild(option);
        });
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

function updateBrandDropdown(category) {
    const brandSelect = document.getElementById('brand-name');
    brandSelect.innerHTML = '<option value="">Select brand</option>';
    
    const brands = brandsByCategory[category] || ["Generic", "Custom/Other"];
    brands.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand;
        option.textContent = brand;
        brandSelect.appendChild(option);
    });
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
        
        if (!types.includes(customType)) {
            types.push(customType);
            await setDoc(metadataRef, { types }, { merge: true });
        }
    } catch (error) {
        console.error("Error saving custom category:", error);
    }
}

// ================= PHOTO TRACE & ADDITIONAL IMAGES =================
document.getElementById('photo-trace').addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('photo-trace-preview');
            preview.src = e.target.result;
            preview.style.display = 'block';
            document.getElementById('photo-trace-label').style.display = 'none';
        };
        reader.readAsDataURL(file);
    }
});

for (let i = 1; i <= 5; i++) {
    document.getElementById(`media-upload-${i}`).addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const label = document.getElementById(`image-upload-label-${i}`);
                label.style.backgroundImage = `url(${e.target.result})`;
                label.querySelector('i').style.display = 'none';
            };
            reader.readAsDataURL(file);
        }
    });
}

window.removeImage = function(index) {
    document.getElementById(`media-upload-${index}`).value = '';
    const label = document.getElementById(`image-upload-label-${index}`);
    label.style.backgroundImage = '';
    label.querySelector('i').style.display = 'flex';
};

// ================= VARIATION MATRIX WITH ATTRIBUTES =================
function createVariationRow() {
    if (document.querySelectorAll('.variation-row').length >= MAX_VARIATIONS) {
        showNotification(`Maximum ${MAX_VARIATIONS} variations allowed`, 'warning');
        return;
    }

    variationCounter++;
    
    const variationRow = document.createElement('div');
    variationRow.className = 'variation-row';
    variationRow.dataset.variationId = variationCounter;
    
    variationRow.innerHTML = `
        <div class="variation-header">
            <div class="variation-title-section">
                <label>Variation Type *</label>
                <input type="text" class="variation-title-input" placeholder="e.g., Size, Color, Weight, Packaging" required>
                <small>What type of variation is this?</small>
            </div>
            <button type="button" class="remove-variation-btn" onclick="removeVariation(${variationCounter})">
                <i class="fas fa-times"></i> Remove
            </button>
        </div>
        
        <div class="attributes-container" data-variation-id="${variationCounter}">
            <div class="attributes-header">
                <h4>Attributes for this Variation</h4>
                <small>Add up to ${MAX_ATTRIBUTES_PER_VARIATION} options (e.g., for Size: S, M, L, XL, XXL)</small>
                <button type="button" class="add-attribute-btn" onclick="addAttribute(${variationCounter})" style="margin-top: 10px;">
                    <i class="fas fa-plus"></i> Add Attribute
                </button>
            </div>
            <div class="attributes-list" data-variation-id="${variationCounter}">
            </div>
        </div>
        
        <div class="wholesale-calculation" data-calc-id="${variationCounter}">
            <p><strong>Auto-Calculation:</strong></p>
            <p class="calc-display">Add attributes to see breakdown</p>
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

function addAttribute(variationId) {
    const attributesList = document.querySelector(`.attributes-list[data-variation-id="${variationId}"]`);
    
    if (!attributesList) {
        console.error(`Attributes list not found for variation ${variationId}`);
        return;
    }
    
    const currentAttributes = attributesList.querySelectorAll('.attribute-item').length;
    
    if (currentAttributes >= MAX_ATTRIBUTES_PER_VARIATION) {
        showNotification(`Maximum ${MAX_ATTRIBUTES_PER_VARIATION} attributes per variation allowed`, 'warning');
        return;
    }
    
    const attributeIndex = currentAttributes + 1;
    
    const attributeDiv = document.createElement('div');
    attributeDiv.className = 'attribute-item';
    attributeDiv.dataset.attributeIndex = attributeIndex;
    attributeDiv.dataset.variationId = variationId;
    
    attributeDiv.innerHTML = `
        <div class="attribute-content">
            <div class="form-group">
                <label>Option Name *</label>
                <input type="text" class="attribute-name" placeholder="e.g., Small, Red, 500g" required>
                <small>The specific value for this attribute</small>
            </div>
            <div class="form-group">
                <label>Stock for this Option *</label>
                <input type="number" class="attribute-stock" placeholder="e.g., 100" required min="1">
                <small>Units available for this option</small>
            </div>
            <div class="form-group">
                <label>Price for this Option (KES) *</label>
                <input type="number" class="attribute-price" placeholder="e.g., 1200" required step="0.01" min="0">
                <small>Price specific to this option</small>
            </div>
            <div class="form-group">
                <label>Pieces per Unit</label>
                <input type="number" class="attribute-pieces" placeholder="e.g., 1" value="1" min="1">
                <small>How many pieces in one unit?</small>
            </div>
            <div class="form-group">
                <label>Image for this Option (Optional)</label>
                <input type="file" class="attribute-image" accept="image/*">
                <img class="attribute-image-preview" style="display:none; width:80px; height:80px; object-fit:cover; border-radius:4px; margin-top:8px;">
                <small>Upload specific image for this option</small>
            </div>
        </div>
        <button type="button" class="remove-attribute-btn" onclick="removeAttribute(${variationId}, ${attributeIndex})">
            <i class="fas fa-trash"></i>
        </button>
    `;
    
    attributesList.appendChild(attributeDiv);
    
    // Auto-focus on the new attribute name field
    setTimeout(() => {
        const nameInput = attributeDiv.querySelector('.attribute-name');
        nameInput.focus();
        nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    
    const imageInput = attributeDiv.querySelector('.attribute-image');
    const imagePreview = attributeDiv.querySelector('.attribute-image-preview');
    
    imageInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                imagePreview.src = e.target.result;
                imagePreview.style.display = 'block';
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
}

window.addAttribute = addAttribute;

window.removeAttribute = function(variationId, attributeIndex) {
    const attributesList = document.querySelector(`.attributes-list[data-variation-id="${variationId}"]`);
    if (attributesList) {
        const attributeItem = attributesList.querySelector(`.attribute-item[data-attribute-index="${attributeIndex}"]`);
        if (attributeItem) {
            attributeItem.remove();
        }
    }
    updateVariationCalculations();
};

window.removeVariation = function(id) {
    const row = document.querySelector(`[data-variation-id="${id}"]`);
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
        
        const attributes = row.querySelectorAll('.attribute-item');
        let totalStock = 0;
        let totalPieces = 0;
        let totalValue = 0;
        
        attributes.forEach(attr => {
            const stock = parseFloat(attr.querySelector('.attribute-stock').value) || 0;
            const pieces = parseFloat(attr.querySelector('.attribute-pieces').value) || 1;
            
            totalStock += stock;
            totalPieces += stock * pieces;
            totalValue += basePrice * stock;
        });
        
        if (totalStock > 0) {
            const pricePerPiece = totalValue / totalPieces;
            
            calcDisplay.innerHTML = `
                <strong>Total Units:</strong> ${totalStock} <br>
                <strong>Total Value:</strong> KES ${totalValue.toFixed(2)} <br>
                <strong>Total Pieces:</strong> ${totalPieces} pieces <br>
                <strong>Price per Piece:</strong> KES ${pricePerPiece.toFixed(2)}
            `;
        }
    });
}

function calculatePricing() {
    const basePrice = parseFloat(document.getElementById('item-price').value) || 0;
    let finalPrice = basePrice;
    let adjustmentRate = 0;
    
    if (finalPrice < 10000) {
        adjustmentRate = 0.05;
        finalPrice += finalPrice * 0.05;
    } else {
        adjustmentRate = 0.025;
        finalPrice += finalPrice * 0.025;
    }
    
    const platformFee = finalPrice - basePrice;
    
    document.getElementById('price-breakdown').innerHTML = `
        <p><strong>Base Price:</strong> KES ${basePrice.toFixed(2)}</p>
        <p><strong>Platform Fee (${(adjustmentRate * 100).toFixed(1)}%):</strong> KES ${platformFee.toFixed(2)}</p>
        <p class="final-price"><strong>Final Price per Unit:</strong> KES ${finalPrice.toFixed(2)}</p>
    `;
    
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
        const title = row.querySelector('.variation-title-input').value || `Variation ${index + 1}`;
        const attributeItems = row.querySelectorAll('.attribute-item');
        
        let variationStockSubtotal = 0;
        let attributesList = '';
        
        attributeItems.forEach(attr => {
            const attrName = attr.querySelector('.attribute-name').value || 'Not specified';
            const stock = parseInt(attr.querySelector('.attribute-stock').value) || 0;
            const pieces = parseInt(attr.querySelector('.attribute-pieces').value) || 1;
            variationStockSubtotal += stock;
            totalStock += stock;
            
            attributesList += `<li>${attrName} - ${stock} units (${pieces} pieces/unit) = ${stock * pieces} total pieces</li>`;
        });
        
        variationsSummary += `<li><strong>${title}</strong><ul style="margin-left: 20px; margin-top: 4px;">${attributesList}</ul></li>`;
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
        
        // Convert photo trace to data URL
        const photoTraceFile = document.getElementById('photo-trace').files[0];
        const photoTraceDataUrl = await fileToDataUrl(photoTraceFile);
        
        // Convert additional images to data URLs
        const additionalImagesData = [];
        for (let i = 1; i <= 5; i++) {
            const file = document.getElementById(`media-upload-${i}`).files[0];
            if (file) {
                const dataUrl = await fileToDataUrl(file);
                additionalImagesData.push({
                    name: file.name,
                    dataUrl: dataUrl
                });
            }
        }
        
        // Process variations with attributes
        const variationRows = document.querySelectorAll('.variation-row');
        const processedVariations = [];
        
        for (let row of variationRows) {
            const variationTitle = row.querySelector('.variation-title-input').value;
            const attributeItems = row.querySelectorAll('.attribute-item');
            const variationAttributes = [];
            
            for (let attrItem of attributeItems) {
                const attrName = attrItem.querySelector('.attribute-name').value;
                const stock = parseInt(attrItem.querySelector('.attribute-stock').value);
                const pieces = parseInt(attrItem.querySelector('.attribute-pieces').value);
                const attributePrice = parseFloat(attrItem.querySelector('.attribute-price').value);
                const imageFile = attrItem.querySelector('.attribute-image').files[0];
                
                let imageData = null;
                if (imageFile) {
                    const dataUrl = await fileToDataUrl(imageFile);
                    imageData = {
                        name: imageFile.name,
                        dataUrl: dataUrl
                    };
                }
                
                variationAttributes.push({
                    attr_name: attrName,
                    stock,
                    piece_count: pieces,
                    price: attributePrice,
                    imageFile: imageData
                });
            }
            
            processedVariations.push({
                title: variationTitle,
                attributes: variationAttributes
            });
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
            photoTraceFile: {
                name: photoTraceFile.name,
                dataUrl: photoTraceDataUrl
            },
            additionalImages: additionalImagesData,
            variations: processedVariations,
            bulkPricing: processedBulkTiers,
            listingId: listingId || null
        };
        
        // Add to queue
        const queueId = addToQueue(listingDataForQueue);
        
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
    if (!confirm("Are you sure you want to delete this listing? This action cannot be undone.")) {
        return;
    }
    
    try {
        document.getElementById('spinner').style.display = 'block';
        await deleteDoc(doc(db, "Listings", listingId));
        showNotification("Listing deleted successfully!");
        await loadUserListings();
    } catch (error) {
        console.error("Error deleting listing:", error);
        showNotification("Error deleting listing: " + error.message);
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
    setupAutoSave();
    initializeQueue();
    
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