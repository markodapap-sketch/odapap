/**
 * Oda Pap Listing Page - Complete Rewrite
 * Mobile-first with swipe navigation, image compression, all features
 */

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { app } from "./js/firebase.js";
import { categoryHierarchy, brandsByCategory } from './js/categoryData.js';
import { setupGlobalImageErrorHandler, getImageUrl } from './js/imageCache.js';

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Setup global image error handling
setupGlobalImageErrorHandler();

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const state = {
    step: 1,
    maxSteps: 4,
    images: [],
    variants: [],
    bulkTiers: [],
    editingId: null,
    listings: [],
    cropper: null,
    editingImgIdx: null,
    touchStartX: 0,
    touchEndX: 0,
    profileComplete: false,
    uploadQueue: [],
    isUploading: false
};

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
const debounce = (fn, ms = 300) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

const formatPrice = n => `KES ${Number(n).toLocaleString()}`;

function toast(msg, type = 'info', dur = 3500) {
    const box = $('toast-box');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i><span>${msg}</span><button onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>`;
    box.appendChild(el);
    setTimeout(() => el.remove(), dur);
}

function showLoader(text = 'Loading...') {
    $('load-text').textContent = text;
    $('loader').style.display = 'flex';
}

function hideLoader() {
    $('loader').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════
function initTabs() {
    $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
}

window.switchTab = function(id) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    $$('.tab-content').forEach(c => c.classList.toggle('active', c.id === id));
    if (id === 'my-listings') loadListings();
};

// ═══════════════════════════════════════════════════════════
// STEP NAVIGATION - Swipe + Click
// ═══════════════════════════════════════════════════════════
function initSteps() {
    const wrapper = $('form-wrapper');
    
    // Swipe detection
    wrapper.addEventListener('touchstart', e => {
        state.touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    
    wrapper.addEventListener('touchend', e => {
        state.touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });
    
    // Click on step circles
    $$('.step').forEach(s => {
        s.addEventListener('click', () => {
            const target = parseInt(s.dataset.step);
            if (target < state.step) {
                goToStep(target);
            } else if (target === state.step + 1 && validateStep(state.step)) {
                goToStep(target);
            }
        });
    });
    
    // Nav buttons
    $('btn-next').addEventListener('click', nextStep);
    $('btn-back').addEventListener('click', prevStep);
}

function handleSwipe() {
    const diff = state.touchStartX - state.touchEndX;
    if (Math.abs(diff) < 50) return; // Min swipe distance
    
    if (diff > 0) {
        // Swipe left = next
        nextStep();
    } else {
        // Swipe right = prev
        prevStep();
    }
}

function goToStep(n) {
    state.step = n;
    updateStepUI();
    saveDraft();
}

function nextStep() {
    if (state.step >= state.maxSteps) return;
    if (!validateStep(state.step)) return;
    state.step++;
    updateStepUI();
    saveDraft();
}

function prevStep() {
    if (state.step <= 1) return;
    state.step--;
    updateStepUI();
}

function updateStepUI() {
    // Update step indicators
    $$('.step').forEach((s, i) => {
        const n = i + 1;
        s.classList.remove('active', 'done');
        if (n < state.step) s.classList.add('done');
        if (n === state.step) s.classList.add('active');
    });
    
    // Slide form
    const wrapper = $('form-wrapper');
    wrapper.style.transform = `translateX(-${(state.step - 1) * 100}%)`;
    
    // Nav buttons
    $('btn-back').disabled = state.step === 1;
    $('btn-next').style.display = state.step < state.maxSteps ? 'flex' : 'none';
    $('btn-submit').style.display = state.step === state.maxSteps ? 'flex' : 'none';
    
    // Update context pills
    updateContextPills();
    
    // Generate review on last step
    if (state.step === state.maxSteps) {
        generateReview();
    }
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════════
// CONTEXT PILLS (Memory Jogger)
// ═══════════════════════════════════════════════════════════
function updateContextPills() {
    const box = $('context-pills');
    if (state.step === 1) {
        box.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Show first image thumbnail + name
    if (state.images.length > 0) {
        const name = $('product-name').value.trim();
        html += `<div class="ctx-pill"><img src="${state.images[0].dataUrl}" alt=""><span>${name || 'Product'}</span></div>`;
    }
    
    // Show category
    if (state.step > 2) {
        const cat = $('category').selectedOptions[0]?.text;
        if (cat && cat !== 'Select category') {
            html += `<div class="ctx-pill"><i class="fas fa-tag"></i><span>${cat}</span></div>`;
        }
    }
    
    box.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════
function validateStep(step) {
    clearErrors();
    const errors = [];
    
    if (step === 1) {
        const name = $('product-name').value.trim();
        const desc = $('description').value.trim();
        
        if (!name) {
            errors.push({ field: 'product-name', msg: 'Product name is required' });
        }
        if (state.images.length === 0) {
            errors.push({ field: 'upload-area', msg: 'Add at least one photo' });
        }
        if (!desc) {
            errors.push({ field: 'description', msg: 'Description is required' });
        }
    }
    
    if (step === 2) {
        if (!$('category').value) {
            errors.push({ field: 'category', msg: 'Select a category' });
        }
        if ($('sub-field').style.display !== 'none' && !$('subcategory').value) {
            errors.push({ field: 'subcategory', msg: 'Select a subcategory' });
        }
        if (!$('brand').value) {
            errors.push({ field: 'brand', msg: 'Select a brand' });
        }
        if ($('brand').value === 'Other' && !$('custom-brand').value.trim()) {
            errors.push({ field: 'custom-brand', msg: 'Enter brand name' });
        }
    }
    
    if (step === 3) {
        if (state.variants.length === 0) {
            toast('Add at least one variant option', 'warning');
            return false;
        }
        
        for (const v of state.variants) {
            if (!v.type) {
                toast('Select a variant type', 'warning');
                return false;
            }
            if (v.options.length === 0) {
                toast('Add options to your variant', 'warning');
                return false;
            }
            for (const opt of v.options) {
                if (!opt.name || !opt.stock || !opt.price) {
                    toast('Complete all variant options (name, stock, price)', 'warning');
                    return false;
                }
            }
        }
    }
    
    if (errors.length > 0) {
        showErrors(errors);
        toast(errors[0].msg, 'warning');
        return false;
    }
    
    return true;
}

// Comprehensive validation before final upload
function validateAllBeforeUpload() {
    const missing = [];
    
    // Step 1: Product Info
    const name = $('product-name').value.trim();
    const desc = $('description').value.trim();
    
    if (!name) missing.push('Product name');
    if (state.images.length === 0) missing.push('Product photos');
    if (!desc) missing.push('Description');
    
    // Step 2: Category
    if (!$('category').value) missing.push('Category');
    if ($('sub-field').style.display !== 'none' && !$('subcategory').value) missing.push('Subcategory');
    if (!$('brand').value) missing.push('Brand');
    if ($('brand').value === 'Other' && !$('custom-brand').value.trim()) missing.push('Custom brand name');
    
    // Step 3: Variants
    if (state.variants.length === 0) {
        missing.push('Variant options');
    } else {
        for (const v of state.variants) {
            if (!v.type) {
                missing.push('Variant type');
                break;
            }
            if (v.options.length === 0) {
                missing.push('Variant options');
                break;
            }
            for (const opt of v.options) {
                if (!opt.name) { missing.push('Variant option name'); break; }
                if (!opt.stock) { missing.push('Variant stock quantity'); break; }
                if (!opt.price) { missing.push('Variant price'); break; }
            }
        }
    }
    
    if (missing.length > 0) {
        // Find which step has the first issue and go there
        let goToStep = 1;
        if (['Product name', 'Product photos', 'Description'].some(m => missing.includes(m))) {
            goToStep = 1;
        } else if (['Category', 'Subcategory', 'Brand', 'Custom brand name'].some(m => missing.includes(m))) {
            goToStep = 2;
        } else {
            goToStep = 3;
        }
        
        state.step = goToStep;
        updateStepUI();
        
        toast(`Missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}`, 'error', 5000);
        return false;
    }
    
    return true;
}

function showErrors(errors) {
    errors.forEach(e => {
        const field = $(e.field)?.closest('.field') || $(e.field);
        if (field) {
            field.classList.add('error');
        }
    });
}

function clearErrors() {
    $$('.field.error').forEach(f => f.classList.remove('error'));
}

// ═══════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════
function initCategories() {
    const catSel = $('category');
    catSel.innerHTML = '<option value="">Select category</option>';
    
    Object.entries(categoryHierarchy).forEach(([key, val]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = val.label;
        catSel.appendChild(opt);
    });
    
    catSel.addEventListener('change', onCategoryChange);
    $('subcategory').addEventListener('change', onSubcategoryChange);
    $('product-type').addEventListener('change', onTypeChange);
    $('brand').addEventListener('change', onBrandChange);
}

function onCategoryChange() {
    const cat = $('category').value;
    const subSel = $('subcategory');
    const subField = $('sub-field');
    
    subSel.innerHTML = '<option value="">Select subcategory</option>';
    $('type-field').style.display = 'none';
    $('custom-type-field').style.display = 'none';
    
    if (cat && categoryHierarchy[cat]) {
        subField.style.display = 'block';
        
        Object.entries(categoryHierarchy[cat].subcategories).forEach(([key, val]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = val.label;
            subSel.appendChild(opt);
        });
        
        loadBrands(cat);
    } else {
        subField.style.display = 'none';
    }
}

async function onSubcategoryChange() {
    const cat = $('category').value;
    const sub = $('subcategory').value;
    const typeSel = $('product-type');
    const typeField = $('type-field');
    
    typeSel.innerHTML = '<option value="">Select type (optional)</option>';
    $('custom-type-field').style.display = 'none';
    
    if (sub && categoryHierarchy[cat]?.subcategories?.[sub]) {
        const types = categoryHierarchy[cat].subcategories[sub].types || [];
        
        if (types.length > 0) {
            typeField.style.display = 'block';
            
            types.forEach(type => {
                const opt = document.createElement('option');
                opt.value = type.toLowerCase().replace(/\s+/g, '-');
                opt.textContent = type;
                typeSel.appendChild(opt);
            });
            
            // Add custom option
            const customOpt = document.createElement('option');
            customOpt.value = 'custom';
            customOpt.textContent = '+ Add Custom Type';
            typeSel.appendChild(customOpt);
        } else {
            typeField.style.display = 'none';
        }
    } else {
        typeField.style.display = 'none';
    }
}

function onTypeChange() {
    $('custom-type-field').style.display = $('product-type').value === 'custom' ? 'block' : 'none';
}

async function loadBrands(category) {
    const brandSel = $('brand');
    brandSel.innerHTML = '<option value="">Select brand</option>';
    
    const defaultBrands = brandsByCategory[category] || ['Generic'];
    
    // Add Other first
    const otherOpt = document.createElement('option');
    otherOpt.value = 'Other';
    otherOpt.textContent = '+ Add New Brand';
    brandSel.appendChild(otherOpt);
    
    defaultBrands.filter(b => b !== 'Custom/Other').forEach(brand => {
        const opt = document.createElement('option');
        opt.value = brand;
        opt.textContent = brand;
        brandSel.appendChild(opt);
    });
}

function onBrandChange() {
    $('custom-brand-field').style.display = $('brand').value === 'Other' ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════════
// IMAGE UPLOAD (2MB limit, compression, HEIC support)
// ═══════════════════════════════════════════════════════════
function initImageUpload() {
    const area = $('upload-area');
    const input = $('img-input');
    
    area.addEventListener('click', () => input.click());
    input.addEventListener('change', handleFiles);
    
    // Drag & drop
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('active'); });
    area.addEventListener('dragleave', () => area.classList.remove('active'));
    area.addEventListener('drop', e => {
        e.preventDefault();
        area.classList.remove('active');
        handleFiles({ target: { files: e.dataTransfer.files } });
    });
}

async function handleFiles(e) {
    const files = Array.from(e.target.files);
    const maxSize = 2 * 1024 * 1024; // 2MB
    const maxImages = 5;
    
    if (state.images.length >= maxImages) {
        toast('Maximum 5 photos allowed', 'warning');
        return;
    }
    
    for (const file of files) {
        if (state.images.length >= maxImages) break;
        
        // Validate type
        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
        const isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
        
        if (!validTypes.includes(file.type) && !isHeic) {
            toast(`${file.name}: Invalid format. Use JPEG, PNG, WebP, or HEIC.`, 'error');
            continue;
        }
        
        try {
            // Add placeholder
            const tempId = Date.now() + Math.random();
            state.images.push({ id: tempId, loading: true });
            renderImages();
            
            let processedFile = file;
            
            // Convert HEIC
            if (isHeic || file.type.includes('heic')) {
                try {
                    const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
                    processedFile = new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
                } catch (err) {
                    console.warn('HEIC conversion failed:', err);
                    toast('Could not convert HEIC image', 'error');
                    state.images = state.images.filter(img => img.id !== tempId);
                    renderImages();
                    continue;
                }
            }
            
            // Compress if > 2MB
            if (processedFile.size > maxSize) {
                processedFile = await compressImage(processedFile, maxSize);
            }
            
            // Create data URL
            const dataUrl = await readAsDataURL(processedFile);
            
            // Update state
            const idx = state.images.findIndex(img => img.id === tempId);
            if (idx !== -1) {
                state.images[idx] = { id: tempId, file: processedFile, dataUrl, loading: false };
            }
            
            renderImages();
            saveDraft();
            
        } catch (err) {
            console.error('Error processing image:', err);
            toast('Error processing image', 'error');
        }
    }
    
    // Reset input
    e.target.value = '';
}

function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function compressImage(file, maxSize) {
    return new Promise(resolve => {
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        img.onload = () => {
            let { width, height } = img;
            const maxDim = 1200;
            
            if (width > height && width > maxDim) {
                height = (height * maxDim) / width;
                width = maxDim;
            } else if (height > maxDim) {
                width = (width * maxDim) / height;
                height = maxDim;
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            // Try different quality levels
            let quality = 0.8;
            const tryCompress = () => {
                canvas.toBlob(blob => {
                    if (blob && (blob.size <= maxSize || quality <= 0.3)) {
                        resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                    } else {
                        quality -= 0.1;
                        tryCompress();
                    }
                }, 'image/jpeg', quality);
            };
            tryCompress();
        };
        
        img.onerror = () => resolve(file);
        img.src = URL.createObjectURL(file);
    });
}

function renderImages() {
    const grid = $('img-grid');
    
    grid.innerHTML = state.images.map((img, i) => `
        <div class="img-item ${i === 0 ? 'main' : ''} ${img.loading ? 'loading' : ''}" data-idx="${i}">
            ${img.loading ? '' : `
                <img src="${img.dataUrl}" alt="Photo ${i + 1}">
                <div class="img-btns">
                    <button type="button" onclick="editImg(${i})"><i class="fas fa-crop-alt"></i></button>
                    <button type="button" class="del" onclick="removeImg(${i})"><i class="fas fa-trash"></i></button>
                </div>
            `}
        </div>
    `).join('');
    
    // Update upload area visibility
    $('upload-area').style.display = state.images.length >= 5 ? 'none' : '';
}

window.removeImg = function(idx) {
    state.images.splice(idx, 1);
    renderImages();
    saveDraft();
};

window.editImg = function(idx) {
    const img = state.images[idx];
    if (!img || img.loading) return;
    
    state.editingImgIdx = idx;
    $('edit-img').src = img.dataUrl;
    $('editor-modal').classList.add('show');
    
    // Init cropper
    setTimeout(() => {
        if (state.cropper) state.cropper.destroy();
        if (typeof Cropper !== 'undefined') {
            state.cropper = new Cropper($('edit-img'), {
                viewMode: 1,
                autoCropArea: 1,
                responsive: true,
                background: false
            });
        }
    }, 100);
};

window.closeEditor = function() {
    if (state.cropper) {
        state.cropper.destroy();
        state.cropper = null;
    }
    state.editingImgIdx = null;
    $('editor-modal').classList.remove('show');
};

window.rotateImg = function(deg) {
    if (state.cropper) state.cropper.rotate(deg);
};

window.flipImg = function(dir) {
    if (!state.cropper) return;
    const data = state.cropper.getData();
    if (dir === 'h') state.cropper.scaleX(data.scaleX === -1 ? 1 : -1);
    else state.cropper.scaleY(data.scaleY === -1 ? 1 : -1);
};

window.applyEdit = function() {
    if (!state.cropper || state.editingImgIdx === null) return;
    
    const canvas = state.cropper.getCroppedCanvas({ maxWidth: 1200, maxHeight: 1200 });
    if (!canvas) {
        toast('Could not process image', 'error');
        return;
    }
    
    canvas.toBlob(async blob => {
        const dataUrl = await readAsDataURL(blob);
        const file = new File([blob], 'edited.jpg', { type: 'image/jpeg' });
        
        state.images[state.editingImgIdx] = {
            ...state.images[state.editingImgIdx],
            dataUrl,
            file
        };
        
        renderImages();
        closeEditor();
        saveDraft();
        toast('Photo updated', 'success');
    }, 'image/jpeg', 0.9);
};

// ═══════════════════════════════════════════════════════════
// VARIANTS (Default variant shown)
// ═══════════════════════════════════════════════════════════
function initVariants() {
    $('add-variant-btn').addEventListener('click', addVariant);
    
    // Add default variant
    if (state.variants.length === 0) {
        addVariant();
    }
}

function addVariant() {
    if (state.variants.length >= 3) {
        toast('Max 3 variant types', 'warning');
        return;
    }
    
    const id = Date.now();
    state.variants.push({ id, type: '', customType: '', options: [{ id: Date.now(), name: '', stock: '', price: '', retail: '', image: null, imageFile: null }] });
    renderVariants();
}

function renderVariants() {
    const box = $('variants-box');
    
    box.innerHTML = state.variants.map((v, vi) => `
        <div class="variant-card" data-vid="${v.id}">
            <div class="variant-head">
                <select onchange="updateVarType(${v.id}, this.value)">
                    <option value="">Select Type</option>
                    <option value="Size" ${v.type === 'Size' ? 'selected' : ''}>Size</option>
                    <option value="Color" ${v.type === 'Color' ? 'selected' : ''}>Color</option>
                    <option value="Pack" ${v.type === 'Pack' ? 'selected' : ''}>Pack</option>
                    <option value="Material" ${v.type === 'Material' ? 'selected' : ''}>Material</option>
                    <option value="Custom" ${v.type === 'Custom' ? 'selected' : ''}>Custom</option>
                </select>
                ${v.type === 'Custom' ? `<input type="text" placeholder="Type name" value="${v.customType}" onchange="updateVarCustom(${v.id}, this.value)">` : ''}
                ${state.variants.length > 1 ? `<button type="button" class="del-var" onclick="removeVar(${v.id})"><i class="fas fa-trash"></i></button>` : ''}
            </div>
            ${v.options.map((o, oi) => {
                // Calculate price difference
                const price = Number(o.price) || 0;
                const retail = Number(o.retail) || 0;
                let diffText = '-';
                let diffClass = '';
                if (price > 0 && retail > 0) {
                    const diff = retail - price;
                    const percent = Math.round((diff / retail) * 100);
                    diffText = diff >= 0 ? `+KES ${diff.toLocaleString()} (${percent}%)` : `KES ${diff.toLocaleString()}`;
                    diffClass = diff >= 0 ? 'difference-positive' : 'difference-negative';
                }
                return `
                <div class="opt-card" data-oid="${o.id}">
                    <div class="opt-row1">
                        <div class="opt-img-wrap">
                            <button type="button" class="opt-img-btn ${o.image ? 'has-img' : ''}" onclick="triggerOptImgUpload(${v.id}, ${o.id})" title="Photo (optional)">
                                ${o.image ? `<img src="${o.image}" alt=""><button type="button" class="remove-opt-img" onclick="event.stopPropagation(); removeOptImg(${v.id}, ${o.id})"><i class="fas fa-times"></i></button>` : '<i class="fas fa-camera"></i>'}
                            </button>
                            <input type="file" class="opt-img-input" id="opt-img-${v.id}-${o.id}" accept="image/*" onchange="handleOptImgUpload(event, ${v.id}, ${o.id})">
                        </div>
                        <div class="opt-name-field">
                            <input type="text" value="${o.name}" onchange="updateOpt(${v.id}, ${o.id}, 'name', this.value)" placeholder="Option name (e.g. Small, Red)">
                        </div>
                        <div class="opt-pack-field">
                            <input type="text" value="${o.packSize || ''}" onchange="updateOpt(${v.id}, ${o.id}, 'packSize', this.value)" placeholder="pcs/doz" title="Pack size (e.g. pieces, dozen, carton)">
                        </div>
                        ${v.options.length > 1 ? `<button type="button" class="opt-del" onclick="removeOpt(${v.id}, ${o.id})"><i class="fas fa-times"></i></button>` : ''}
                    </div>
                    <div class="opt-row2">
                        <div class="opt-field"><label>Stock</label><input type="number" min="1" value="${o.stock}" onchange="updateOpt(${v.id}, ${o.id}, 'stock', this.value)" placeholder="Qty"></div>
                        <div class="opt-field"><label>Wholesale</label><input type="number" min="1" value="${o.price}" oninput="calcDifference(${v.id}, ${o.id})" onchange="updateOpt(${v.id}, ${o.id}, 'price', this.value)" placeholder="Your price"></div>
                        <div class="opt-field"><label>Retail</label><input type="number" min="0" value="${o.retail || ''}" oninput="calcDifference(${v.id}, ${o.id})" onchange="updateOpt(${v.id}, ${o.id}, 'retail', this.value)" placeholder="Shop price"></div>
                        <div class="opt-field"><label>Difference</label><input type="text" class="difference-display ${diffClass}" value="${diffText}" readonly></div>
                    </div>
                </div>
            `}).join('')}
            <button type="button" class="add-opt" onclick="addOpt(${v.id})"><i class="fas fa-plus"></i> Add Option</button>
        </div>
    `).join('');
}

// Calculate and display price difference in real-time
window.calcDifference = function(vid, oid) {
    const v = state.variants.find(x => x.id === vid);
    if (!v) return;
    const opt = v.options.find(x => x.id === oid);
    if (!opt) return;
    
    const card = document.querySelector(`.opt-card[data-oid="${oid}"]`);
    if (!card) return;
    
    const priceInput = card.querySelector('input[oninput*="calcDifference"][onchange*="price"]');
    const retailInput = card.querySelector('input[oninput*="calcDifference"][onchange*="retail"]');
    const diffInput = card.querySelector('.difference-display');
    
    if (!priceInput || !retailInput || !diffInput) return;
    
    const price = Number(priceInput.value) || 0;
    const retail = Number(retailInput.value) || 0;
    
    if (price > 0 && retail > 0) {
        const diff = retail - price;
        const percent = Math.round((diff / retail) * 100);
        diffInput.value = diff >= 0 ? `+KES ${diff.toLocaleString()} (${percent}%)` : `KES ${diff.toLocaleString()}`;
        diffInput.classList.remove('difference-positive', 'difference-negative');
        diffInput.classList.add(diff >= 0 ? 'difference-positive' : 'difference-negative');
    } else {
        diffInput.value = '-';
        diffInput.classList.remove('difference-positive', 'difference-negative');
    }
};

window.updateVarType = function(vid, type) {
    const v = state.variants.find(x => x.id === vid);
    if (v) { v.type = type; renderVariants(); saveDraft(); }
};

window.updateVarCustom = function(vid, val) {
    const v = state.variants.find(x => x.id === vid);
    if (v) { v.customType = val; saveDraft(); }
};

window.removeVar = function(vid) {
    state.variants = state.variants.filter(x => x.id !== vid);
    if (state.variants.length === 0) addVariant();
    else renderVariants();
    saveDraft();
};

window.addOpt = function(vid) {
    const v = state.variants.find(x => x.id === vid);
    if (!v) return;
    if (v.options.length >= 10) { toast('Max 10 options per variant', 'warning'); return; }
    v.options.push({ id: Date.now(), name: '', stock: '', price: '', retail: '', image: null, imageFile: null });
    renderVariants();
};

// Variant option image upload
window.triggerOptImgUpload = function(vid, oid) {
    const input = document.getElementById(`opt-img-${vid}-${oid}`);
    if (input) input.click();
};

window.handleOptImgUpload = async function(e, vid, oid) {
    const file = e.target.files[0];
    if (!file) return;
    
    const maxSize = 1 * 1024 * 1024; // 1MB for variant images
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    
    if (!validTypes.includes(file.type)) {
        toast('Use JPEG, PNG, or WebP format', 'error');
        return;
    }
    
    try {
        let processedFile = file;
        
        // Compress if needed
        if (file.size > maxSize) {
            processedFile = await compressImage(file, maxSize);
        }
        
        const dataUrl = await readAsDataURL(processedFile);
        
        const v = state.variants.find(x => x.id === vid);
        if (v) {
            const o = v.options.find(x => x.id === oid);
            if (o) {
                o.image = dataUrl;
                o.imageFile = processedFile;
                renderVariants();
                saveDraft();
                toast('Option photo added', 'success', 1500);
            }
        }
    } catch (err) {
        console.error('Variant image error:', err);
        toast('Failed to add photo', 'error');
    }
    
    e.target.value = '';
};

window.removeOptImg = function(vid, oid) {
    const v = state.variants.find(x => x.id === vid);
    if (v) {
        const o = v.options.find(x => x.id === oid);
        if (o) {
            o.image = null;
            o.imageFile = null;
            renderVariants();
            saveDraft();
        }
    }
};

window.updateOpt = function(vid, oid, field, val) {
    const v = state.variants.find(x => x.id === vid);
    if (!v) return;
    const o = v.options.find(x => x.id === oid);
    if (o) {
        o[field] = ['stock', 'price', 'retail'].includes(field) ? Number(val) || '' : val;
        saveDraft();
    }
};

window.removeOpt = function(vid, oid) {
    const v = state.variants.find(x => x.id === vid);
    if (!v) return;
    v.options = v.options.filter(x => x.id !== oid);
    if (v.options.length === 0) v.options.push({ id: Date.now(), name: '', stock: '', price: '', retail: '' });
    renderVariants();
    saveDraft();
};

// ═══════════════════════════════════════════════════════════
// BULK PRICING
// ═══════════════════════════════════════════════════════════
function initBulk() {
    $('add-tier-btn').addEventListener('click', addTier);
}

function addTier() {
    if (state.bulkTiers.length >= 5) { toast('Max 5 tiers', 'warning'); return; }
    state.bulkTiers.push({ id: Date.now(), qty: '', discount: '' });
    renderTiers();
}

function renderTiers() {
    const container = $('bulk-tiers');
    if (!container) return;
    
    container.innerHTML = state.bulkTiers.map((t, idx) => `
        <div class="tier-row" data-tid="${t.id}">
            <div class="tier-input-wrapper">
                <input type="number" 
                       placeholder="${idx === 0 ? 'e.g., 10' : idx === 1 ? 'e.g., 50' : 'e.g., 100'}" 
                       min="2" 
                       value="${t.qty}" 
                       onchange="updateTier(${t.id}, 'qty', this.value)">
                <span class="tier-input-label">+ units</span>
            </div>
            <div class="tier-input-wrapper">
                <input type="number" 
                       placeholder="${idx === 0 ? 'e.g., 5' : idx === 1 ? 'e.g., 10' : 'e.g., 15'}" 
                       min="1" 
                       max="50" 
                       value="${t.discount}" 
                       onchange="updateTier(${t.id}, 'discount', this.value)">
                <span class="tier-input-label">% off</span>
            </div>
            <button type="button" onclick="removeTier(${t.id})" title="Remove tier">
                <i class="fas fa-trash-alt"></i>
            </button>
        </div>
    `).join('');
}

window.updateTier = function(tid, field, val) {
    const t = state.bulkTiers.find(x => x.id === tid);
    if (t) { t[field] = Number(val); saveDraft(); }
};

window.removeTier = function(tid) {
    state.bulkTiers = state.bulkTiers.filter(x => x.id !== tid);
    renderTiers();
    saveDraft();
};

// ═══════════════════════════════════════════════════════════
// REVIEW
// ═══════════════════════════════════════════════════════════
function generateReview() {
    const catText = $('category').selectedOptions[0]?.text || '';
    const subText = $('subcategory').selectedOptions[0]?.text || '';
    const brandVal = $('brand').value === 'Other' ? $('custom-brand').value : $('brand').value;
    
    let totalStock = 0, minPrice = Infinity, maxPrice = 0;
    
    state.variants.forEach(v => {
        v.options.forEach(o => {
            totalStock += Number(o.stock) || 0;
            const p = Number(o.price) || 0;
            if (p > 0) {
                minPrice = Math.min(minPrice, p);
                maxPrice = Math.max(maxPrice, p);
            }
        });
    });
    
    if (minPrice === Infinity) minPrice = 0;
    
    const fee = minPrice < 10000 ? minPrice * 0.05 : minPrice * 0.025;
    const buyerPrice = minPrice + fee;
    
    $('review-box').innerHTML = `
        <div class="review-section">
            <h4>Category</h4>
            <p>${catText}${subText ? ' › ' + subText : ''}</p>
        </div>
        <div class="review-section">
            <h4>Product</h4>
            <p><strong>${$('product-name').value}</strong></p>
            <p>Brand: ${brandVal}</p>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 6px;">
                ${$('description').value.slice(0, 150)}${$('description').value.length > 150 ? '...' : ''}
            </p>
        </div>
        <div class="review-section">
            <h4>Photos</h4>
            <div class="review-imgs">
                ${state.images.map(img => `<img src="${img.dataUrl}" alt="">`).join('')}
            </div>
        </div>
        <div class="review-section">
            <h4>Variants & Pricing</h4>
            ${state.variants.map(v => `
                <div class="review-var">
                    <strong>${v.type === 'Custom' ? v.customType : v.type}</strong>
                    ${v.options.map(o => `
                        <div class="review-opt">
                            ${o.image ? `<img src="${o.image}" style="width:30px;height:30px;border-radius:4px;object-fit:cover;margin-right:8px;">` : ''}
                            <span>${o.name}</span>
                            <span>Stock: ${o.stock} · ${formatPrice(o.price)}${o.retail ? ` <small>(Retail: ${formatPrice(o.retail)})</small>` : ''}</span>
                        </div>
                    `).join('')}
                </div>
            `).join('')}
        </div>
        ${state.bulkTiers.length > 0 ? `
            <div class="review-section">
                <h4>Bulk Discounts</h4>
                ${state.bulkTiers.map(t => `<div class="review-opt"><span>Buy ${t.qty}+</span><span>${t.discount}% off</span></div>`).join('')}
            </div>
        ` : ''}
        <div class="review-summary">
            <h4>Summary</h4>
            <div class="review-row"><span>Total Stock</span><span>${totalStock} units</span></div>
            <div class="review-row"><span>Price Range</span><span>${minPrice === maxPrice ? formatPrice(minPrice) : `${formatPrice(minPrice)} - ${formatPrice(maxPrice)}`}</span></div>
            <div class="review-row"><span>Platform Fee (${minPrice < 10000 ? '5%' : '2.5%'})</span><span>${formatPrice(fee)}</span></div>
            <div class="review-row total"><span>Buyer Pays From</span><span>${formatPrice(buyerPrice)}</span></div>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════
// FORM SUBMISSION
// ═══════════════════════════════════════════════════════════
function initForm() {
    $('listing-form').addEventListener('submit', handleSubmit);
    
    // Character counts
    $('product-name').addEventListener('input', e => {
        $('name-count').textContent = e.target.value.length;
    });
    $('description').addEventListener('input', e => {
        $('desc-count').textContent = e.target.value.length;
    });
}

async function handleSubmit(e) {
    e.preventDefault();
    
    // Check if profile is complete
    if (!state.profileComplete) {
        sessionStorage.setItem('profileMessage', 'Please complete your profile before listing products');
        window.location.href = 'profile.html';
        return;
    }
    
    // Comprehensive validation of ALL steps before upload
    if (!validateAllBeforeUpload()) return;
    
    const user = auth.currentUser;
    if (!user) { toast('Please login', 'error'); return; }
    
    // Create upload job with all current form data
    const uploadJob = {
        id: Date.now(),
        productName: $('product-name').value.trim(),
        images: [...state.images],
        variants: JSON.parse(JSON.stringify(state.variants)),
        bulkTiers: [...state.bulkTiers],
        formData: {
            category: $('category').value,
            subcategory: $('subcategory').value,
            productType: $('product-type').value,
            customType: $('custom-type').value,
            brand: $('brand').value,
            customBrand: $('custom-brand').value,
            description: $('description').value.trim()
        },
        editingId: state.editingId,
        status: 'pending',
        progress: 0
    };
    
    // Add to upload queue
    state.uploadQueue.push(uploadJob);
    
    // Show upload notification
    toast(`Uploading "${uploadJob.productName}" in background...`, 'info', 3000);
    
    // Display upload progress UI
    showUploadProgress(uploadJob);
    
    // Reset form immediately to allow new listings
    clearDraft();
    resetForm();
    
    // Start upload if not already uploading
    if (!state.isUploading) {
        processUploadQueue();
    }
}

// Background upload processor
async function processUploadQueue() {
    if (state.uploadQueue.length === 0) {
        state.isUploading = false;
        return;
    }
    
    state.isUploading = true;
    const job = state.uploadQueue[0];
    const user = auth.currentUser;
    
    if (!user) {
        state.uploadQueue.shift();
        updateUploadProgress(job.id, 'error', 'User not logged in');
        processUploadQueue();
        return;
    }
    
    try {
        updateUploadProgress(job.id, 'uploading', 0);
        
        // Upload images
        const imageUrls = [];
        for (let i = 0; i < job.images.length; i++) {
            const img = job.images[i];
            
            // Skip if already a URL (editing)
            if (img.isExisting && img.dataUrl?.startsWith('http')) {
                imageUrls.push(img.dataUrl);
                continue;
            }
            
            const progress = Math.floor((i / job.images.length) * 40);
            updateUploadProgress(job.id, 'uploading', progress, `Uploading photo ${i + 1}/${job.images.length}`);
            
            const fileRef = storageRef(storage, `listings/${user.uid}/${Date.now()}_${i}.jpg`);
            const blob = await fetch(img.dataUrl).then(r => r.blob());
            await uploadBytes(fileRef, blob);
            imageUrls.push(await getDownloadURL(fileRef));
        }
        
        // Process variants and upload variant images
        updateUploadProgress(job.id, 'uploading', 45, 'Processing variants...');
        const variations = [];
        
        for (const v of job.variants) {
            const attributes = [];
            
            for (const o of v.options) {
                const price = Number(o.price);
                const fee = price < 10000 ? price * 0.05 : price * 0.025;
                
                let imageUrl = null;
                
                // Upload variant option image if exists
                if (o.image && o.imageFile) {
                    const varImgRef = storageRef(storage, `listings/${user.uid}/variants/${Date.now()}_${o.name.replace(/\s+/g, '_')}.jpg`);
                    await uploadBytes(varImgRef, o.imageFile);
                    imageUrl = await getDownloadURL(varImgRef);
                } else if (o.image?.startsWith('http')) {
                    imageUrl = o.image;
                }
                
                attributes.push({
                    attr_name: o.name,
                    stock: Number(o.stock),
                    price: price + fee,
                    originalPrice: price,
                    retailPrice: o.retail ? Number(o.retail) : null,
                    imageUrl: imageUrl
                });
            }
            
            variations.push({
                title: v.type === 'Custom' ? v.customType : v.type,
                attributes
            });
        }
        
        // Calculate totals
        updateUploadProgress(job.id, 'uploading', 80, 'Finalizing...');
        let totalStock = 0, lowestPrice = Infinity;
        variations.forEach(v => {
            v.attributes.forEach(a => {
                totalStock += a.stock;
                lowestPrice = Math.min(lowestPrice, a.price);
            });
        });
        
        const brand = job.formData.brand === 'Other' ? job.formData.customBrand.trim() : job.formData.brand;
        const finalType = job.formData.productType === 'custom' ? job.formData.customType : job.formData.productType;
        
        const data = {
            uploaderId: user.uid,
            category: job.formData.category,
            subcategory: job.formData.subcategory,
            subsubcategory: finalType,
            name: job.productName,
            brand,
            description: job.formData.description,
            imageUrls,
            variations,
            bulkPricing: job.bulkTiers.length > 0 ? job.bulkTiers.map(t => ({ minQuantity: t.qty, discountPercent: t.discount })) : null,
            totalStock,
            price: lowestPrice,
            originalPrice: lowestPrice,
            updatedAt: new Date().toISOString()
        };
        
        updateUploadProgress(job.id, 'uploading', 90, 'Publishing...');
        
        if (job.editingId) {
            await updateDoc(doc(db, "Listings", job.editingId), data);
        } else {
            data.createdAt = new Date().toISOString();
            await addDoc(collection(db, "Listings"), data);
        }
        
        updateUploadProgress(job.id, 'complete', 100, 'Published!');
        
        // Remove from queue
        state.uploadQueue.shift();
        
        // Auto-remove success notification after 5 seconds
        setTimeout(() => removeUploadProgress(job.id), 5000);
        
    } catch (err) {
        console.error('Upload error:', err);
        updateUploadProgress(job.id, 'error', 0, err.message || 'Upload failed');
        state.uploadQueue.shift();
    }
    
    // Process next item in queue
    setTimeout(() => processUploadQueue(), 1000);
}

// Upload progress UI management
function showUploadProgress(job) {
    let container = $('upload-progress-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'upload-progress-container';
        container.className = 'upload-progress-container';
        document.body.appendChild(container);
    }
    
    const progressEl = document.createElement('div');
    progressEl.id = `upload-${job.id}`;
    progressEl.className = 'upload-progress-item';
    progressEl.innerHTML = `
        <div class="upload-info">
            <strong class="upload-name">${job.productName}</strong>
            <span class="upload-status">Queued...</span>
        </div>
        <div class="upload-bar">
            <div class="upload-bar-fill" style="width: 0%"></div>
        </div>
        <button class="upload-cancel" onclick="cancelUpload(${job.id})"><i class="fas fa-times"></i></button>
    `;
    container.appendChild(progressEl);
}

function updateUploadProgress(jobId, status, progress, message) {
    const el = $(`upload-${jobId}`);
    if (!el) return;
    
    const statusEl = el.querySelector('.upload-status');
    const barFill = el.querySelector('.upload-bar-fill');
    
    if (status === 'uploading') {
        statusEl.textContent = message || `${progress}%`;
        barFill.style.width = `${progress}%`;
        el.className = 'upload-progress-item uploading';
    } else if (status === 'complete') {
        statusEl.textContent = 'Published!';
        barFill.style.width = '100%';
        el.className = 'upload-progress-item complete';
    } else if (status === 'error') {
        statusEl.textContent = message || 'Failed';
        el.className = 'upload-progress-item error';
    }
}

function removeUploadProgress(jobId) {
    const el = $(`upload-${jobId}`);
    if (el) el.remove();
    
    const container = $('upload-progress-container');
    if (container && container.children.length === 0) {
        container.remove();
    }
}

window.cancelUpload = function(jobId) {
    const idx = state.uploadQueue.findIndex(j => j.id === jobId);
    if (idx !== -1) {
        state.uploadQueue.splice(idx, 1);
        removeUploadProgress(jobId);
        toast('Upload cancelled', 'info');
    }
};

function resetForm() {
    $('listing-form').reset();
    state.step = 1;
    state.images = [];
    state.variants = [];
    state.bulkTiers = [];
    state.editingId = null;
    
    $('sub-field').style.display = 'none';
    $('type-field').style.display = 'none';
    $('custom-type-field').style.display = 'none';
    $('custom-brand-field').style.display = 'none';
    
    updateStepUI();
    addVariant();
    renderImages();
    renderTiers();
}

// ═══════════════════════════════════════════════════════════
// MY LISTINGS
// ═══════════════════════════════════════════════════════════
async function loadListings() {
    const user = auth.currentUser;
    if (!user) return;
    
    const grid = $('listings-grid');
    grid.innerHTML = '<div style="grid-column: span 2; text-align: center; padding: 40px; color: var(--text-muted);"><div class="spin" style="margin: 0 auto 16px;"></div>Loading...</div>';
    
    try {
        const q = query(collection(db, "Listings"), where("uploaderId", "==", user.uid));
        const snap = await getDocs(q);
        
        state.listings = [];
        snap.forEach(d => state.listings.push({ id: d.id, ...d.data() }));
        
        $('total-listings').textContent = state.listings.length;
        
        if (state.listings.length === 0) {
            grid.innerHTML = '';
            $('empty-list').style.display = 'block';
        } else {
            $('empty-list').style.display = 'none';
            renderListings();
        }
        
    } catch (err) {
        console.error('Load error:', err);
        toast('Failed to load listings', 'error');
        grid.innerHTML = '<p style="text-align: center; color: var(--error);">Failed to load</p>';
    }
}

function renderListings() {
    const grid = $('listings-grid');
    const search = $('search-list').value.toLowerCase();
    
    const filtered = state.listings.filter(l =>
        l.name.toLowerCase().includes(search) ||
        l.brand?.toLowerCase().includes(search)
    );
    
    grid.innerHTML = filtered.map(l => {
        const stockClass = l.totalStock === 0 ? 'out' : l.totalStock < 10 ? 'low' : '';
        const stockText = l.totalStock === 0 ? 'Out' : `${l.totalStock}`;
        const imgCount = l.imageUrls?.length || 0;
        
        return `
            <div class="listing-card">
                <div class="img"><img src="${l.imageUrls?.[0] || 'https://placehold.co/200x150/e2e8f0/64748b?text=No+Image'}" alt=""><span class="stock-badge ${stockClass}">${stockText}</span></div>
                <div class="body">
                    <h3>${l.name}</h3>
                    <div class="meta"><span>${l.brand || '-'}</span><span class="price">${formatPrice(l.originalPrice || l.price)}</span></div>
                    <div class="actions">
                        <button class="edit-btn" onclick="editListing('${l.id}')"><i class="fas fa-edit"></i> Edit</button>
                        <button class="img-btn" onclick="openImageManager('${l.id}')" title="Manage images"><i class="fas fa-images"></i> ${imgCount}</button>
                        <button class="del-btn" onclick="deleteListing('${l.id}')"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

window.editListing = function(id) {
    const l = state.listings.find(x => x.id === id);
    if (!l) return;
    
    state.editingId = id;
    
    // Set category
    $('category').value = l.category;
    onCategoryChange();
    
    setTimeout(() => {
        $('subcategory').value = l.subcategory;
        onSubcategoryChange();
        
        setTimeout(() => {
            if (l.subsubcategory) $('product-type').value = l.subsubcategory;
            $('brand').value = l.brand;
            $('product-name').value = l.name;
            $('description').value = l.description;
            $('name-count').textContent = l.name.length;
            $('desc-count').textContent = l.description.length;
            
            // Load images from URLs
            if (l.imageUrls?.length > 0) {
                state.images = l.imageUrls.map((url, i) => ({
                    id: Date.now() + i,
                    dataUrl: url,
                    isExisting: true,
                    loading: false
                }));
                renderImages();
            }
            
            // Load variants
            if (l.variations) {
                state.variants = l.variations.map((v, i) => ({
                    id: Date.now() + i,
                    type: v.title,
                    customType: '',
                    options: v.attributes.map((a, j) => ({
                        id: Date.now() + i * 100 + j,
                        name: a.attr_name,
                        stock: a.stock,
                        price: a.originalPrice || a.price,
                        retail: a.retailPrice || '',
                        image: a.imageUrl || null,
                        imageFile: null
                    }))
                }));
                renderVariants();
            }
            
            // Load bulk
            if (l.bulkPricing) {
                state.bulkTiers = l.bulkPricing.map((t, i) => ({
                    id: Date.now() + i,
                    qty: t.minQuantity,
                    discount: t.discountPercent
                }));
                renderTiers();
            }
            
            switchTab('new-listing');
            toast('Editing listing', 'info');
            
        }, 150);
    }, 150);
};

window.deleteListing = function(id) {
    const l = state.listings.find(x => x.id === id);
    
    $('confirm-title').textContent = 'Delete Listing?';
    $('confirm-msg').textContent = `"${l?.name || 'This listing'}" will be permanently removed.`;
    $('confirm-modal').classList.add('show');
    
    $('confirm-yes').onclick = async () => {
        hideConfirm();
        showLoader('Deleting...');
        
        try {
            await deleteDoc(doc(db, "Listings", id));
            state.listings = state.listings.filter(x => x.id !== id);
            renderListings();
            $('total-listings').textContent = state.listings.length;
            toast('Listing deleted', 'success');
        } catch (err) {
            console.error('Delete error:', err);
            toast('Failed to delete', 'error');
        } finally {
            hideLoader();
        }
    };
};

window.hideConfirm = function() {
    $('confirm-modal').classList.remove('show');
};

// Search + View toggle
$('search-list')?.addEventListener('input', debounce(() => {
    const view = document.querySelector('.view-btns button.active')?.dataset.view;
    if (view === 'table') {
        renderTableView();
    } else {
        renderListings();
    }
}, 300));

$$('.view-btns button').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.view-btns button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const view = btn.dataset.view;
        
        if (view === 'table') {
            $('listings-grid').style.display = 'none';
            $('listings-table').style.display = 'block';
            renderTableView();
        } else {
            $('listings-grid').style.display = '';
            $('listings-table').style.display = 'none';
            $('listings-grid').classList.toggle('list-view', view === 'list');
            renderListings();
        }
    });
});

// ═══════════════════════════════════════════════════════════
// EXCEL TABLE VIEW
// ═══════════════════════════════════════════════════════════
const pendingChanges = new Map();

function renderTableView() {
    const tbody = $('excel-body');
    const search = $('search-list').value.toLowerCase();
    
    const filtered = state.listings.filter(l =>
        l.name.toLowerCase().includes(search) ||
        l.brand?.toLowerCase().includes(search)
    );
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-muted);">No listings found</td></tr>';
        return;
    }
    
    tbody.innerHTML = filtered.map(l => {
        const modified = pendingChanges.has(l.id) ? 'modified' : '';
        const lowestPrice = getLowestPrice(l);
        const totalStock = getTotalStock(l);
        const imgCount = l.imageUrls?.length || 0;
        const extraImgs = imgCount > 1 ? imgCount - 1 : 0;
        
        return `
            <tr data-id="${l.id}" class="${modified}">
                <td>
                    <div class="table-img-group">
                        <img src="${l.imageUrls?.[0] || 'https://placehold.co/50x50/e2e8f0/64748b?text=N/A'}" class="table-img" alt="" onclick="openImageManager('${l.id}')">
                        ${extraImgs > 0 ? `<span class="table-img-more">+${extraImgs}</span>` : ''}
                        <button class="table-img-btn" onclick="openImageManager('${l.id}')" title="Manage images"><i class="fas fa-edit"></i></button>
                    </div>
                </td>
                <td class="table-cell">
                    <div class="table-cell-content" data-field="name" data-id="${l.id}" onclick="startCellEdit(this)">${escapeHtml(l.name)}</div>
                </td>
                <td class="table-cell">
                    <div class="table-cell-content" data-field="description" data-id="${l.id}" onclick="startCellEdit(this)">${escapeHtml(truncate(l.description, 60))}</div>
                </td>
                <td class="table-cell var-cell">
                    ${renderVariationsCell(l)}
                </td>
                <td class="table-cell">
                    <div class="table-cell-content" data-field="price" data-id="${l.id}" onclick="startCellEdit(this)">${formatPrice(lowestPrice)}</div>
                </td>
                <td class="table-cell">
                    <div class="table-cell-content" data-field="stock" data-id="${l.id}" onclick="startCellEdit(this)">${totalStock}</div>
                </td>
                <td class="table-actions">
                    <button class="btn-full-edit" onclick="editListing('${l.id}')" title="Full Edit"><i class="fas fa-expand"></i></button>
                    <button class="btn-var-edit" onclick="openVariationEditor('${l.id}')" title="Edit Variations"><i class="fas fa-layer-group"></i></button>
                    <button class="btn-del" onclick="deleteListing('${l.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}

// Render variations cell with editable inline options
function renderVariationsCell(l) {
    if (!l.variations || l.variations.length === 0) {
        return `<div class="var-empty" onclick="openVariationEditor('${l.id}')"><i class="fas fa-plus"></i> Add Variants</div>`;
    }
    
    const items = [];
    l.variations.forEach(v => {
        items.push(`<div class="var-type-label">${escapeHtml(v.title)}</div>`);
        v.attributes?.forEach(a => {
            items.push(`
                <div class="var-row" data-id="${l.id}" data-var="${escapeHtml(v.title)}" data-attr="${escapeHtml(a.attr_name)}">
                    <span class="var-name">${escapeHtml(a.attr_name)}</span>
                    <input type="number" class="var-price-input" value="${a.originalPrice || a.price || 0}" data-field="varPrice" onchange="updateVariantField(this)" placeholder="Price" title="Price">
                    <input type="number" class="var-stock-input" value="${a.stock || 0}" data-field="varStock" onchange="updateVariantField(this)" placeholder="Qty" title="Stock">
                    <button class="var-del-btn" onclick="deleteVariantOption('${l.id}', '${escapeHtml(v.title)}', '${escapeHtml(a.attr_name)}')" title="Remove"><i class="fas fa-times"></i></button>
                </div>
            `);
        });
    });
    
    return `
        <div class="var-cell-content">
            ${items.join('')}
            <button class="var-add-btn" onclick="openVariationEditor('${l.id}')" title="Add/Edit Variations"><i class="fas fa-plus"></i> Add</button>
        </div>
    `;
}

function renderVariantsMini(l) {
    if (!l.variations || l.variations.length === 0) return '';
    
    const items = [];
    l.variations.forEach(v => {
        v.attributes?.forEach(a => {
            items.push(`<div class="variant-mini-row" data-id="${l.id}" data-var="${v.title}" data-attr="${a.attr_name}">
                <span>${a.attr_name}</span>
                <input type="number" value="${a.originalPrice || a.price}" data-field="varPrice" onchange="updateVariantField(this)" placeholder="Price">
            </div>`);
        });
    });
    
    return items.length > 1 ? `<div class="variant-mini">${items.slice(0, 3).join('')}${items.length > 3 ? `<div style="font-size:0.7rem;color:var(--text-muted);">+${items.length - 3} more</div>` : ''}</div>` : '';
}

function renderStockMini(l) {
    if (!l.variations || l.variations.length === 0) return '';
    
    const items = [];
    l.variations.forEach(v => {
        v.attributes?.forEach(a => {
            items.push(`<div class="variant-mini-row" data-id="${l.id}" data-var="${v.title}" data-attr="${a.attr_name}">
                <span>${a.attr_name}</span>
                <input type="number" value="${a.stock}" data-field="varStock" onchange="updateVariantField(this)" placeholder="Qty">
            </div>`);
        });
    });
    
    return items.length > 1 ? `<div class="variant-mini">${items.slice(0, 3).join('')}${items.length > 3 ? `<div style="font-size:0.7rem;color:var(--text-muted);">+${items.length - 3} more</div>` : ''}</div>` : '';
}

function getLowestPrice(l) {
    if (!l.variations?.length) return l.originalPrice || l.price || 0;
    let min = Infinity;
    l.variations.forEach(v => v.attributes?.forEach(a => {
        const p = a.originalPrice || a.price || 0;
        if (p > 0 && p < min) min = p;
    }));
    return min === Infinity ? 0 : min;
}

function getTotalStock(l) {
    if (!l.variations?.length) return l.totalStock || 0;
    let total = 0;
    l.variations.forEach(v => v.attributes?.forEach(a => { total += a.stock || 0; }));
    return total;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
}

window.startCellEdit = function(el) {
    if (el.classList.contains('editing')) return;
    
    const field = el.dataset.field;
    const id = el.dataset.id;
    const listing = state.listings.find(l => l.id === id);
    if (!listing) return;
    
    el.classList.add('editing');
    
    let value = '';
    if (field === 'name') value = listing.name;
    else if (field === 'description') value = listing.description;
    else if (field === 'price') value = getLowestPrice(listing);
    else if (field === 'stock') value = getTotalStock(listing);
    
    if (field === 'description') {
        el.innerHTML = `<textarea data-field="${field}" onblur="endCellEdit(this, '${id}')" onkeydown="handleCellKey(event, this, '${id}')">${escapeHtml(value)}</textarea>`;
    } else {
        const type = (field === 'price' || field === 'stock') ? 'number' : 'text';
        el.innerHTML = `<input type="${type}" value="${escapeHtml(String(value))}" data-field="${field}" onblur="endCellEdit(this, '${id}')" onkeydown="handleCellKey(event, this, '${id}')">`;
    }
    
    const input = el.querySelector('input, textarea');
    input.focus();
    input.select();
};

window.handleCellKey = function(e, input, id) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        input.blur();
    } else if (e.key === 'Escape') {
        const cell = input.closest('.table-cell-content');
        cell.classList.remove('editing');
        renderTableView();
    }
};

window.endCellEdit = async function(input, id) {
    const field = input.dataset.field;
    const newValue = input.value.trim();
    const cell = input.closest('.table-cell-content');
    const listing = state.listings.find(l => l.id === id);
    
    if (!listing) return;
    
    let changed = false;
    const updates = {};
    
    if (field === 'name' && newValue !== listing.name) {
        updates.name = newValue;
        changed = true;
    } else if (field === 'description' && newValue !== listing.description) {
        updates.description = newValue;
        changed = true;
    } else if (field === 'price' && listing.variations?.length <= 1) {
        // For single variant, update directly
        const numVal = parseFloat(newValue) || 0;
        if (numVal !== getLowestPrice(listing)) {
            if (listing.variations?.[0]?.attributes?.[0]) {
                listing.variations[0].attributes[0].originalPrice = numVal;
                const fee = numVal < 10000 ? numVal * 0.05 : numVal * 0.025;
                listing.variations[0].attributes[0].price = numVal + fee;
            }
            updates.variations = listing.variations;
            updates.price = numVal;
            updates.originalPrice = numVal;
            changed = true;
        }
    } else if (field === 'stock' && listing.variations?.length <= 1) {
        const numVal = parseInt(newValue) || 0;
        if (numVal !== getTotalStock(listing)) {
            if (listing.variations?.[0]?.attributes?.[0]) {
                listing.variations[0].attributes[0].stock = numVal;
            }
            updates.variations = listing.variations;
            updates.totalStock = numVal;
            changed = true;
        }
    }
    
    if (changed) {
        await saveQuickEdit(id, updates);
    }
    
    cell.classList.remove('editing');
    renderTableView();
};

window.updateVariantField = async function(input) {
    const row = input.closest('.var-row, .variant-mini-row');
    const id = row.dataset.id;
    const varTitle = row.dataset.var;
    const attrName = row.dataset.attr;
    const field = input.dataset.field;
    const value = parseFloat(input.value) || 0;
    
    const listing = state.listings.find(l => l.id === id);
    if (!listing?.variations) return;
    
    let changed = false;
    
    listing.variations.forEach(v => {
        if (v.title === varTitle) {
            v.attributes?.forEach(a => {
                if (a.attr_name === attrName) {
                    if (field === 'varPrice') {
                        if (a.originalPrice !== value) {
                            a.originalPrice = value;
                            const fee = value < 10000 ? value * 0.05 : value * 0.025;
                            a.price = value + fee;
                            changed = true;
                        }
                    } else if (field === 'varStock') {
                        if (a.stock !== value) {
                            a.stock = value;
                            changed = true;
                        }
                    }
                }
            });
        }
    });
    
    if (changed) {
        const totalStock = getTotalStock(listing);
        const lowestPrice = getLowestPrice(listing);
        
        await saveQuickEdit(id, {
            variations: listing.variations,
            totalStock,
            price: lowestPrice,
            originalPrice: lowestPrice
        });
        
        toast('Variation updated', 'success');
    }
};

// Delete a single variant option
window.deleteVariantOption = async function(listingId, varTitle, attrName) {
    const listing = state.listings.find(l => l.id === listingId);
    if (!listing?.variations) return;
    
    // Find and remove the attribute
    listing.variations.forEach(v => {
        if (v.title === varTitle) {
            v.attributes = v.attributes?.filter(a => a.attr_name !== attrName) || [];
        }
    });
    
    // Remove empty variation types
    listing.variations = listing.variations.filter(v => v.attributes && v.attributes.length > 0);
    
    const totalStock = getTotalStock(listing);
    const lowestPrice = getLowestPrice(listing);
    
    await saveQuickEdit(listingId, {
        variations: listing.variations,
        totalStock,
        price: lowestPrice,
        originalPrice: lowestPrice
    });
    
    renderTableView();
    toast('Variant removed', 'success');
};

// ═══════════════════════════════════════════════════════════
// VARIATION EDITOR MODAL
// ═══════════════════════════════════════════════════════════
let varEditorListingId = null;
let varEditorData = [];

window.openVariationEditor = function(listingId) {
    const listing = state.listings.find(l => l.id === listingId);
    if (!listing) return;
    
    varEditorListingId = listingId;
    varEditorData = JSON.parse(JSON.stringify(listing.variations || []));
    
    renderVariationEditor();
    $('var-editor-modal').style.display = 'flex';
};

window.closeVariationEditor = function() {
    $('var-editor-modal').style.display = 'none';
    varEditorListingId = null;
    varEditorData = [];
};

function renderVariationEditor() {
    const container = $('var-editor-content');
    
    container.innerHTML = `
        <div class="var-editor-types">
            ${varEditorData.map((v, vi) => `
                <div class="var-editor-type" data-index="${vi}">
                    <div class="var-type-header">
                        <input type="text" class="var-type-name" value="${escapeHtml(v.title)}" placeholder="Variation type (e.g., Size, Color)" onchange="updateVarTypeName(${vi}, this.value)">
                        <button class="btn-del-type" onclick="deleteVarType(${vi})" title="Remove type"><i class="fas fa-trash"></i></button>
                    </div>
                    <div class="var-options-list">
                        ${(v.attributes || []).map((a, ai) => `
                            <div class="var-option-row">
                                <input type="text" value="${escapeHtml(a.attr_name)}" placeholder="Option name" onchange="updateVarOption(${vi}, ${ai}, 'name', this.value)">
                                <input type="number" value="${a.originalPrice || a.price || 0}" placeholder="Price" onchange="updateVarOption(${vi}, ${ai}, 'price', this.value)">
                                <input type="number" value="${a.stock || 0}" placeholder="Stock" onchange="updateVarOption(${vi}, ${ai}, 'stock', this.value)">
                                <input type="number" value="${a.retailPrice || ''}" placeholder="Retail (opt)" onchange="updateVarOption(${vi}, ${ai}, 'retail', this.value)">
                                <button onclick="deleteVarOption(${vi}, ${ai})"><i class="fas fa-times"></i></button>
                            </div>
                        `).join('')}
                        <button class="btn-add-option" onclick="addVarOption(${vi})"><i class="fas fa-plus"></i> Add Option</button>
                    </div>
                </div>
            `).join('')}
        </div>
        <button class="btn-add-type" onclick="addVarType()"><i class="fas fa-layer-group"></i> Add Variation Type</button>
    `;
}

window.addVarType = function() {
    varEditorData.push({ title: '', attributes: [{ attr_name: '', stock: 0, price: 0, originalPrice: 0 }] });
    renderVariationEditor();
};

window.deleteVarType = function(vi) {
    varEditorData.splice(vi, 1);
    renderVariationEditor();
};

window.updateVarTypeName = function(vi, value) {
    varEditorData[vi].title = value;
};

window.addVarOption = function(vi) {
    varEditorData[vi].attributes = varEditorData[vi].attributes || [];
    varEditorData[vi].attributes.push({ attr_name: '', stock: 0, price: 0, originalPrice: 0 });
    renderVariationEditor();
};

window.deleteVarOption = function(vi, ai) {
    varEditorData[vi].attributes.splice(ai, 1);
    renderVariationEditor();
};

window.updateVarOption = function(vi, ai, field, value) {
    const attr = varEditorData[vi].attributes[ai];
    if (field === 'name') attr.attr_name = value;
    else if (field === 'price') {
        const price = parseFloat(value) || 0;
        attr.originalPrice = price;
        const fee = price < 10000 ? price * 0.05 : price * 0.025;
        attr.price = price + fee;
    }
    else if (field === 'stock') attr.stock = parseInt(value) || 0;
    else if (field === 'retail') attr.retailPrice = parseFloat(value) || null;
};

window.saveVariationEditor = async function() {
    if (!varEditorListingId) return;
    
    // Filter out empty variations
    const cleanData = varEditorData
        .filter(v => v.title && v.attributes?.length > 0)
        .map(v => ({
            ...v,
            attributes: v.attributes.filter(a => a.attr_name)
        }))
        .filter(v => v.attributes.length > 0);
    
    const listing = state.listings.find(l => l.id === varEditorListingId);
    if (listing) {
        listing.variations = cleanData;
        
        const totalStock = getTotalStock(listing);
        const lowestPrice = getLowestPrice(listing);
        
        await saveQuickEdit(varEditorListingId, {
            variations: cleanData,
            totalStock,
            price: lowestPrice,
            originalPrice: lowestPrice
        });
    }
    
    closeVariationEditor();
    renderTableView();
    toast('Variations saved', 'success');
};

// ═══════════════════════════════════════════════════════════
// IMAGE MANAGER (for My Listings)
// ═══════════════════════════════════════════════════════════
const imageManagerState = {
    listingId: null,
    images: [], // { url, isExisting, file, dataUrl }
    toDelete: []
};

window.openImageManager = function(listingId) {
    const listing = state.listings.find(l => l.id === listingId);
    if (!listing) return;
    
    imageManagerState.listingId = listingId;
    imageManagerState.images = (listing.imageUrls || []).map((url, i) => ({
        id: Date.now() + i,
        url,
        isExisting: true
    }));
    imageManagerState.toDelete = [];
    
    renderImageManagerGrid();
    $('image-manager-modal').classList.add('show');
};

window.closeImageManager = function() {
    $('image-manager-modal').classList.remove('show');
    imageManagerState.listingId = null;
    imageManagerState.images = [];
    imageManagerState.toDelete = [];
};

function renderImageManagerGrid() {
    const grid = $('manage-images-grid');
    
    grid.innerHTML = imageManagerState.images.map((img, i) => `
        <div class="manage-img-item ${i === 0 ? 'main' : ''} ${img.loading ? 'loading' : ''}" data-idx="${i}">
            ${img.loading ? '' : `
                <img src="${img.dataUrl || img.url}" alt="Photo ${i + 1}">
                ${imageManagerState.images.length > 1 ? `<button type="button" class="manage-img-remove" onclick="removeManagerImage(${i})"><i class="fas fa-times"></i></button>` : ''}
            `}
        </div>
    `).join('');
    
    // Show/hide add button based on count
    const addArea = $('add-more-images');
    addArea.style.display = imageManagerState.images.length >= 5 ? 'none' : '';
}

window.removeManagerImage = function(idx) {
    const img = imageManagerState.images[idx];
    
    // Enforce minimum 1 image
    if (imageManagerState.images.length <= 1) {
        toast('Must have at least 1 image', 'warning');
        return;
    }
    
    // If existing image, mark for deletion
    if (img.isExisting && img.url) {
        imageManagerState.toDelete.push(img.url);
    }
    
    imageManagerState.images.splice(idx, 1);
    renderImageManagerGrid();
};

window.saveListingImages = async function() {
    if (!imageManagerState.listingId) return;
    
    // Enforce minimum 1 image
    if (imageManagerState.images.length === 0) {
        toast('Must have at least 1 image', 'error');
        return;
    }
    
    const user = auth.currentUser;
    if (!user) {
        toast('Please login', 'error');
        return;
    }
    
    const saveBtn = $('save-images-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
    try {
        const finalUrls = [];
        
        // Process images
        for (const img of imageManagerState.images) {
            if (img.isExisting && img.url) {
                // Keep existing URL
                finalUrls.push(img.url);
            } else if (img.file) {
                // Upload new image
                const fileRef = storageRef(storage, `listings/${user.uid}/${Date.now()}_${finalUrls.length}.jpg`);
                await uploadBytes(fileRef, img.file);
                const url = await getDownloadURL(fileRef);
                finalUrls.push(url);
            }
        }
        
        // Delete removed images from storage
        for (const url of imageManagerState.toDelete) {
            try {
                // Extract path from URL and delete
                const urlObj = new URL(url);
                const pathMatch = urlObj.pathname.match(/\/o\/(.+?)\?/);
                if (pathMatch) {
                    const path = decodeURIComponent(pathMatch[1]);
                    const delRef = storageRef(storage, path);
                    await deleteObject(delRef).catch(() => {}); // Ignore errors
                }
            } catch (e) {
                console.warn('Could not delete old image:', e);
            }
        }
        
        // Update Firestore
        await updateDoc(doc(db, "Listings", imageManagerState.listingId), {
            imageUrls: finalUrls,
            updatedAt: new Date().toISOString()
        });
        
        // Update local state
        const listing = state.listings.find(l => l.id === imageManagerState.listingId);
        if (listing) {
            listing.imageUrls = finalUrls;
        }
        
        toast('Images saved!', 'success');
        closeImageManager();
        
        // Refresh view
        const view = document.querySelector('.view-btns button.active')?.dataset.view;
        if (view === 'table') {
            renderTableView();
        } else {
            renderListings();
        }
        
    } catch (err) {
        console.error('Save images error:', err);
        toast('Failed to save images', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Images';
    }
};

async function saveQuickEdit(id, updates) {
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (row) row.classList.add('saving');
    
    try {
        updates.updatedAt = new Date().toISOString();
        await updateDoc(doc(db, "Listings", id), updates);
        
        // Update local state
        const idx = state.listings.findIndex(l => l.id === id);
        if (idx !== -1) {
            state.listings[idx] = { ...state.listings[idx], ...updates };
        }
        
        toast('Saved', 'success', 1500);
    } catch (err) {
        console.error('Quick edit save error:', err);
        toast('Failed to save', 'error');
    } finally {
        if (row) row.classList.remove('saving');
    }
}

// ═══════════════════════════════════════════════════════════
// DRAFTS
// ═══════════════════════════════════════════════════════════
const DRAFT_KEY = 'oda_listing_draft';

const saveDraft = debounce(() => {
    const draft = {
        category: $('category').value,
        subcategory: $('subcategory').value,
        productType: $('product-type').value,
        customType: $('custom-type').value,
        brand: $('brand').value,
        customBrand: $('custom-brand').value,
        productName: $('product-name').value,
        description: $('description').value,
        variants: state.variants,
        bulkTiers: state.bulkTiers,
        step: state.step,
        ts: Date.now()
    };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
}, 1500);

function loadDraft() {
    try {
        const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
        if (!draft) return;
        
        // Expire after 7 days
        if (Date.now() - draft.ts > 7 * 24 * 60 * 60 * 1000) {
            localStorage.removeItem(DRAFT_KEY);
            return;
        }
        
        const hrs = Math.floor((Date.now() - draft.ts) / (1000 * 60 * 60));
        $('draft-msg').textContent = hrs < 1 ? 'From just now' : hrs < 24 ? `From ${hrs}h ago` : `From ${Math.floor(hrs / 24)}d ago`;
        $('draft-modal').classList.add('show');
        
        $('draft-yes').onclick = () => {
            restoreDraft(draft);
            $('draft-modal').classList.remove('show');
        };
        
        $('draft-no').onclick = () => {
            clearDraft();
            $('draft-modal').classList.remove('show');
            addVariant();
        };
        
    } catch (e) {}
}

function restoreDraft(draft) {
    if (draft.category) {
        $('category').value = draft.category;
        onCategoryChange();
    }
    
    setTimeout(() => {
        if (draft.subcategory) {
            $('subcategory').value = draft.subcategory;
            onSubcategoryChange();
        }
        
        setTimeout(() => {
            if (draft.productType) $('product-type').value = draft.productType;
            if (draft.customType) $('custom-type').value = draft.customType;
            if (draft.brand) { $('brand').value = draft.brand; onBrandChange(); }
            if (draft.customBrand) $('custom-brand').value = draft.customBrand;
            if (draft.productName) { $('product-name').value = draft.productName; $('name-count').textContent = draft.productName.length; }
            if (draft.description) { $('description').value = draft.description; $('desc-count').textContent = draft.description.length; }
            
            if (draft.variants?.length > 0) {
                state.variants = draft.variants;
                renderVariants();
            } else {
                addVariant();
            }
            
            if (draft.bulkTiers?.length > 0) {
                state.bulkTiers = draft.bulkTiers;
                renderTiers();
            }
            
            // Images cannot be restored from draft - always start at step 1
            // and prompt user to re-upload photos
            state.step = 1;
            state.images = [];
            renderImages();
            updateStepUI();
            
            toast('Draft restored! Please re-upload your photos to continue.', 'warning', 5000);
        }, 150);
    }, 150);
}

function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
}

// ═══════════════════════════════════════════════════════════
// AUTH & PROFILE
// ═══════════════════════════════════════════════════════════
function initAuth() {
    onAuthStateChanged(auth, async user => {
        if (user) {
            await loadProfile(user);
            loadDraft();
        } else {
            window.location.href = 'login.html';
        }
    });
}

async function loadProfile(user) {
    try {
        const snap = await getDoc(doc(db, "Users", user.uid));
        
        if (snap.exists()) {
            const d = snap.data();
            
            $('seller-name').textContent = d.name || user.displayName || 'Seller';
            
            // Handle both flat and nested location structures
            const locationStr = d.county || (typeof d.location === 'string' ? d.location : d.location?.county) || 'Location not set';
            $('seller-location').querySelector('span').textContent = locationStr;
            
            // Use profilePicUrl as per profile.html convention
            if (d.profilePicUrl || user.photoURL) {
                $('profile-pic').src = d.profilePicUrl || user.photoURL;
            }
            
            // Check profile completion - name, location/county, and phone required
            const complete = d.name && (d.county || d.location) && d.phone;
            state.profileComplete = complete;
            
            // Redirect to profile if incomplete
            if (!complete) {
                // Store message in session for profile page
                sessionStorage.setItem('profileMessage', 'Please complete your profile before listing products');
                window.location.href = 'profile.html';
                return;
            }
            
            // Hide warning if complete
            const warningEl = $('profile-warning');
            warningEl.style.display = 'none';
        }
    } catch (e) {
        console.error('Profile load error:', e);
    }
}

// ═══════════════════════════════════════════════════════════
// NETWORK STATUS
// ═══════════════════════════════════════════════════════════
window.addEventListener('online', () => toast('Back online', 'success'));
window.addEventListener('offline', () => toast('You are offline', 'warning'));

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initTabs();
    initSteps();
    initCategories();
    initImageUpload();
    initVariants();
    initBulk();
    initForm();
    initImageManager();
    updateStepUI();
});

// Initialize Image Manager event listeners
function initImageManager() {
    const manageImgInput = $('manage-img-input');
    if (manageImgInput) {
        manageImgInput.addEventListener('change', async function(e) {
            const files = Array.from(e.target.files);
            const maxSize = 2 * 1024 * 1024;
            
            for (const file of files) {
                if (imageManagerState.images.length >= 5) {
                    toast('Maximum 5 photos allowed', 'warning');
                    break;
                }
                
                const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
                if (!validTypes.includes(file.type)) {
                    toast(`${file.name}: Invalid format`, 'error');
                    continue;
                }
                
                try {
                    const tempId = Date.now() + Math.random();
                    imageManagerState.images.push({ id: tempId, loading: true });
                    renderImageManagerGrid();
                    
                    let processedFile = file;
                    if (file.size > maxSize) {
                        processedFile = await compressImage(file, maxSize);
                    }
                    
                    const dataUrl = await readAsDataURL(processedFile);
                    
                    const idx = imageManagerState.images.findIndex(img => img.id === tempId);
                    if (idx !== -1) {
                        imageManagerState.images[idx] = {
                            id: tempId,
                            file: processedFile,
                            dataUrl,
                            isExisting: false,
                            loading: false
                        };
                    }
                    
                    renderImageManagerGrid();
                } catch (err) {
                    console.error('Error processing image:', err);
                    toast('Error processing image', 'error');
                }
            }
            
            e.target.value = '';
        });
    }
}

export { toast as showNotification };
