/**
 * Sanitization and Validation Utilities for Oda Pap
 * Prevents XSS, validates inputs, and ensures data integrity
 */

/**
 * Escapes HTML special characters to prevent XSS
 * @param {string} str - The string to sanitize
 * @returns {string} - HTML-escaped string
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const text = String(str);
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };
    return text.replace(/[&<>"'`=/]/g, char => map[char]);
}

/**
 * Sanitizes a URL to prevent javascript: and data: injection
 * @param {string} url - The URL to sanitize
 * @param {string} fallback - Fallback URL if invalid
 * @returns {string} - Safe URL
 */
export function sanitizeUrl(url, fallback = 'images/placeholder.png') {
    if (!url || typeof url !== 'string') return fallback;
    
    const trimmedUrl = url.trim().toLowerCase();
    
    // Block dangerous protocols
    if (trimmedUrl.startsWith('javascript:') || 
        trimmedUrl.startsWith('vbscript:') ||
        trimmedUrl.startsWith('data:text/html')) {
        return fallback;
    }
    
    // Allow relative URLs, http, https, and safe data URLs (images only)
    if (trimmedUrl.startsWith('/') || 
        trimmedUrl.startsWith('http://') || 
        trimmedUrl.startsWith('https://') ||
        trimmedUrl.startsWith('data:image/')) {
        return url;
    }
    
    // For relative paths without leading slash
    if (!trimmedUrl.includes(':')) {
        return url;
    }
    
    return fallback;
}

/**
 * Validates and sanitizes a price value
 * @param {any} value - The value to validate
 * @param {number} min - Minimum allowed value (default 0)
 * @param {number} max - Maximum allowed value (default 10,000,000)
 * @returns {number|null} - Valid price or null if invalid
 */
export function validatePrice(value, min = 0, max = 10000000) {
    const num = parseFloat(value);
    if (isNaN(num) || !isFinite(num)) return null;
    if (num < min || num > max) return null;
    return Math.round(num * 100) / 100; // Round to 2 decimal places
}

/**
 * Validates and sanitizes a quantity/stock value
 * @param {any} value - The value to validate
 * @param {number} min - Minimum allowed (default 0)
 * @param {number} max - Maximum allowed (default 1,000,000)
 * @returns {number|null} - Valid integer or null if invalid
 */
export function validateQuantity(value, min = 0, max = 1000000) {
    const num = parseInt(value, 10);
    if (isNaN(num) || !isFinite(num)) return null;
    if (num < min || num > max) return null;
    return num;
}

/**
 * Validates a phone number (Kenyan format)
 * @param {string} phone - The phone number to validate
 * @returns {string|null} - Normalized phone or null if invalid
 */
export function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') return null;
    
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    
    // Check Kenyan formats
    if (digits.length === 9 && digits.startsWith('7')) {
        return '254' + digits;
    }
    if (digits.length === 10 && digits.startsWith('07')) {
        return '254' + digits.substring(1);
    }
    if (digits.length === 12 && digits.startsWith('254')) {
        return digits;
    }
    if (digits.length === 13 && digits.startsWith('2547')) {
        return digits.substring(1);
    }
    
    return null;
}

/**
 * Validates an email address
 * @param {string} email - The email to validate
 * @returns {string|null} - Normalized email or null if invalid
 */
export function validateEmail(email) {
    if (!email || typeof email !== 'string') return null;
    const trimmed = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(trimmed) ? trimmed : null;
}

/**
 * Sanitizes a text input (name, description, etc.)
 * @param {string} text - The text to sanitize
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} - Sanitized text
 */
export function sanitizeText(text, maxLength = 1000) {
    if (!text || typeof text !== 'string') return '';
    return text.trim().substring(0, maxLength);
}

/**
 * Validates listing data before Firestore write
 * @param {Object} listing - The listing data
 * @returns {Object} - { valid: boolean, errors: string[], data: Object }
 */
export function validateListing(listing) {
    const errors = [];
    const sanitized = {};
    
    // Required fields
    if (!listing.name || sanitizeText(listing.name, 200).length < 2) {
        errors.push('Product name must be at least 2 characters');
    } else {
        sanitized.name = sanitizeText(listing.name, 200);
    }
    
    if (!listing.category) {
        errors.push('Category is required');
    } else {
        sanitized.category = sanitizeText(listing.category, 100);
    }
    
    if (!listing.description || sanitizeText(listing.description, 5000).length < 10) {
        errors.push('Description must be at least 10 characters');
    } else {
        sanitized.description = sanitizeText(listing.description, 5000);
    }
    
    // Price validation
    const price = validatePrice(listing.price);
    if (price === null || price <= 0) {
        errors.push('Valid price is required (greater than 0)');
    } else {
        sanitized.price = price;
    }
    
    // Stock validation
    const stock = validateQuantity(listing.totalStock);
    if (stock === null) {
        errors.push('Valid stock quantity is required');
    } else {
        sanitized.totalStock = stock;
    }
    
    // Optional fields
    if (listing.brand) {
        sanitized.brand = sanitizeText(listing.brand, 100);
    }
    
    if (listing.subcategory) {
        sanitized.subcategory = sanitizeText(listing.subcategory, 100);
    }
    
    // Copy safe fields
    if (listing.uploaderId) sanitized.uploaderId = listing.uploaderId;
    if (listing.imageUrls) sanitized.imageUrls = listing.imageUrls;
    if (listing.variations) sanitized.variations = listing.variations;
    if (listing.minOrderQuantity) {
        sanitized.minOrderQuantity = validateQuantity(listing.minOrderQuantity, 1) || 1;
    }
    
    return {
        valid: errors.length === 0,
        errors,
        data: sanitized
    };
}

/**
 * Validates order data before creation
 * @param {Object} order - The order data
 * @returns {Object} - { valid: boolean, errors: string[], data: Object }
 */
export function validateOrder(order) {
    const errors = [];
    
    if (!order.userId) {
        errors.push('User ID is required');
    }
    
    if (!order.items || !Array.isArray(order.items) || order.items.length === 0) {
        errors.push('Order must have at least one item');
    }
    
    if (!order.deliveryAddress || sanitizeText(order.deliveryAddress).length < 5) {
        errors.push('Valid delivery address is required');
    }
    
    const total = validatePrice(order.totalAmount);
    if (total === null || total <= 0) {
        errors.push('Valid order total is required');
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Creates a safe HTML string for product display
 * All values are escaped
 */
export function createProductCardHtml(product) {
    const name = escapeHtml(product.name);
    const brand = escapeHtml(product.brand || '');
    const price = validatePrice(product.price) || 0;
    const imageUrl = sanitizeUrl(product.photoTraceUrl || product.imageUrls?.[0]);
    const id = escapeHtml(product.id);
    
    return `
        <div class="product-card" data-id="${id}">
            <img src="${imageUrl}" alt="${name}" loading="lazy" onerror="this.src='images/placeholder.png'">
            <div class="product-info">
                <h3>${name}</h3>
                ${brand ? `<p class="brand">${brand}</p>` : ''}
                <p class="price">KES ${price.toLocaleString()}</p>
            </div>
        </div>
    `;
}

export default {
    escapeHtml,
    sanitizeUrl,
    validatePrice,
    validateQuantity,
    validatePhone,
    validateEmail,
    sanitizeText,
    validateListing,
    validateOrder,
    createProductCardHtml
};
