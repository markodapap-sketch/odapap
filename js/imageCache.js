/**
 * Image Cache & Fallback Manager
 * Prevents excessive Firestore reads by caching images locally
 * and handling broken/missing images gracefully
 */

const IMAGE_CACHE_KEY = 'oda_image_cache';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const FAILED_IMAGES_KEY = 'oda_failed_images';
const FAILED_RETRY_DURATION = 24 * 60 * 60 * 1000; // 24 hours before retry

// Default placeholder images
const PLACEHOLDERS = {
    product: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"%3E%3Crect fill="%23f5f5f5" width="200" height="200"/%3E%3Cpath fill="%23ddd" d="M100 40c-33.137 0-60 26.863-60 60s26.863 60 60 60 60-26.863 60-60-26.863-60-60-60zm0 10c27.614 0 50 22.386 50 50s-22.386 50-50 50-50-22.386-50-50 22.386-50 50-50z"/%3E%3Cpath fill="%23bbb" d="M85 80h30v10H85zm0 20h30v10H85zm0 20h30v10H85z"/%3E%3C/svg%3E',
    user: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle fill="%23e2e8f0" cx="50" cy="50" r="50"/%3E%3Ccircle fill="%2394a3b8" cx="50" cy="40" r="20"/%3E%3Cellipse fill="%2394a3b8" cx="50" cy="85" rx="35" ry="25"/%3E%3C/svg%3E',
    profile: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle fill="%23e2e8f0" cx="50" cy="50" r="50"/%3E%3Ccircle fill="%2394a3b8" cx="50" cy="40" r="20"/%3E%3Cellipse fill="%2394a3b8" cx="50" cy="85" rx="35" ry="25"/%3E%3C/svg%3E',
    logo: 'images/logo.png'
};

// Memory cache for session
const memoryCache = new Map();

/**
 * Get the best available image URL with caching
 * @param {Object|Array|string} imageSource - Image data (can be object with multiple fields, array, or string)
 * @param {string} type - Type of image: 'product', 'user', 'logo'
 * @returns {string} Best available image URL
 */
export function getImageUrl(imageSource, type = 'product') {
    // Handle null/undefined
    if (!imageSource) {
        return PLACEHOLDERS[type] || PLACEHOLDERS.product;
    }

    // If it's a string URL, validate and return
    if (typeof imageSource === 'string') {
        return validateAndCacheUrl(imageSource, type);
    }

    // If it's an array, get first valid item
    if (Array.isArray(imageSource)) {
        for (const url of imageSource) {
            if (url && typeof url === 'string' && url.trim()) {
                return validateAndCacheUrl(url.trim(), type);
            }
        }
        return PLACEHOLDERS[type] || PLACEHOLDERS.product;
    }

    // If it's an object, try common field names
    const fieldPriority = [
        'photoTraceUrl',
        'imageUrls',
        'imageUrl',
        'images',
        'photoUrl',
        'profilePicUrl',
        'profilePic',
        'avatar',
        'thumbnail',
        'image'
    ];

    for (const field of fieldPriority) {
        const value = imageSource[field];
        if (!value) continue;

        if (typeof value === 'string' && value.trim()) {
            return validateAndCacheUrl(value.trim(), type);
        }

        if (Array.isArray(value) && value.length > 0) {
            for (const url of value) {
                if (url && typeof url === 'string' && url.trim()) {
                    return validateAndCacheUrl(url.trim(), type);
                }
            }
        }
    }

    return PLACEHOLDERS[type] || PLACEHOLDERS.product;
}

/**
 * Validate URL and check cache
 */
function validateAndCacheUrl(url, type) {
    if (!url) return PLACEHOLDERS[type];

    // Check if URL has failed recently
    if (isFailedUrl(url)) {
        return PLACEHOLDERS[type];
    }

    // Check memory cache first (fastest)
    if (memoryCache.has(url)) {
        return memoryCache.get(url);
    }

    // Basic URL validation
    if (!isValidUrl(url)) {
        markUrlFailed(url);
        return PLACEHOLDERS[type];
    }

    // Cache the URL in memory
    memoryCache.set(url, url);
    return url;
}

/**
 * Check if URL is valid
 */
function isValidUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    // Accept data URLs
    if (url.startsWith('data:')) return true;
    
    // Accept relative paths
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('images/')) return true;
    
    // Check for valid URL patterns
    try {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            new URL(url);
            return true;
        }
        // Could be a relative path
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if URL has failed recently
 */
function isFailedUrl(url) {
    try {
        const failed = JSON.parse(localStorage.getItem(FAILED_IMAGES_KEY) || '{}');
        const failedAt = failed[url];
        if (!failedAt) return false;
        
        // Check if retry period has passed
        if (Date.now() - failedAt > FAILED_RETRY_DURATION) {
            delete failed[url];
            localStorage.setItem(FAILED_IMAGES_KEY, JSON.stringify(failed));
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Mark URL as failed
 */
function markUrlFailed(url) {
    try {
        const failed = JSON.parse(localStorage.getItem(FAILED_IMAGES_KEY) || '{}');
        failed[url] = Date.now();
        
        // Limit cache size
        const keys = Object.keys(failed);
        if (keys.length > 500) {
            const toRemove = keys.slice(0, 100);
            toRemove.forEach(k => delete failed[k]);
        }
        
        localStorage.setItem(FAILED_IMAGES_KEY, JSON.stringify(failed));
    } catch {
        // Storage full or unavailable
    }
}

/**
 * Handle image load error - call this from onerror handlers
 * @param {HTMLImageElement} img - The image element
 * @param {string} type - Type: 'product', 'user'
 */
export function handleImageError(img, type = 'product') {
    if (!img) return;
    
    const originalSrc = img.dataset.originalSrc || img.src;
    
    // Prevent infinite loop
    if (img.dataset.errorHandled === 'true') return;
    img.dataset.errorHandled = 'true';
    
    // Mark as failed
    if (originalSrc && !originalSrc.startsWith('data:')) {
        markUrlFailed(originalSrc);
    }
    
    // Set placeholder
    img.src = PLACEHOLDERS[type] || PLACEHOLDERS.product;
    img.classList.add('img-placeholder');
}

/**
 * Initialize lazy loading for images
 * Call this once after DOM is ready
 */
export function initLazyLoading() {
    // Use Intersection Observer for lazy loading
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.dataset.src;
                    if (src) {
                        img.src = src;
                        img.removeAttribute('data-src');
                    }
                    observer.unobserve(img);
                }
            });
        }, {
            rootMargin: '100px'
        });

        document.querySelectorAll('img[data-src]').forEach(img => {
            observer.observe(img);
        });
    } else {
        // Fallback: load all images immediately
        document.querySelectorAll('img[data-src]').forEach(img => {
            img.src = img.dataset.src;
        });
    }
}

/**
 * Global error handler for images
 * Attach to window to catch all image errors
 */
export function setupGlobalImageErrorHandler() {
    // Delegate error handling
    document.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG') {
            // Check data-fallback attribute first
            const fallbackType = e.target.dataset.fallback;
            if (fallbackType) {
                handleImageError(e.target, fallbackType);
                return;
            }
            
            // Fallback to class-based detection
            handleImageError(e.target, 
                e.target.classList.contains('user-img') || 
                e.target.classList.contains('avatar') || 
                e.target.classList.contains('profile-pic') ||
                e.target.closest('.profile') ||
                e.target.closest('.featured-seller')
                    ? 'user' 
                    : 'product'
            );
        }
    }, true);
}

/**
 * Generate optimized image HTML
 * @param {string} src - Image source
 * @param {string} alt - Alt text
 * @param {string} className - CSS class
 * @param {string} type - Image type for fallback
 * @returns {string} HTML string
 */
export function imageHtml(src, alt = '', className = '', type = 'product') {
    const validSrc = getImageUrl(src, type);
    const placeholder = PLACEHOLDERS[type] || PLACEHOLDERS.product;
    
    return `<img 
        src="${validSrc}" 
        alt="${escapeHtml(alt)}" 
        class="${className}" 
        loading="lazy"
        data-original-src="${escapeHtml(validSrc)}"
        onerror="this.onerror=null;this.src='${placeholder}';this.classList.add('img-placeholder');"
    >`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Clear image caches (useful for debugging)
 */
export function clearImageCache() {
    memoryCache.clear();
    localStorage.removeItem(FAILED_IMAGES_KEY);
    localStorage.removeItem(IMAGE_CACHE_KEY);
}

/**
 * Preload critical images
 * @param {string[]} urls - Array of image URLs
 */
export function preloadImages(urls) {
    urls.forEach(url => {
        const img = new Image();
        img.src = url;
    });
}

/**
 * Enhanced image loading with retry for slow connections
 * @param {HTMLImageElement} img - Image element
 * @param {string} src - Source URL
 * @param {Object} options - Options
 */
export function loadImageWithRetry(img, src, options = {}) {
    const { maxRetries = 2, timeout = 15000, fallbackType = 'product' } = options;
    let retries = 0;
    
    // Add loading state
    img.classList.add('img-loading');
    img.dataset.loading = 'true';
    
    const attemptLoad = () => {
        const tempImg = new Image();
        let timeoutId = null;
        
        const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            tempImg.onload = null;
            tempImg.onerror = null;
        };
        
        // Timeout handler for slow connections
        timeoutId = setTimeout(() => {
            cleanup();
            if (retries < maxRetries) {
                retries++;
                console.log(`[ImageLoader] Retry ${retries}/${maxRetries} for:`, src.substring(0, 50));
                attemptLoad();
            } else {
                // All retries failed - use placeholder
                img.src = PLACEHOLDERS[fallbackType] || PLACEHOLDERS.product;
                img.classList.remove('img-loading');
                img.classList.add('img-failed');
                delete img.dataset.loading;
                markUrlFailed(src);
            }
        }, timeout);
        
        tempImg.onload = () => {
            cleanup();
            img.src = src;
            img.classList.remove('img-loading');
            img.classList.add('img-loaded');
            delete img.dataset.loading;
        };
        
        tempImg.onerror = () => {
            cleanup();
            if (retries < maxRetries) {
                retries++;
                setTimeout(attemptLoad, 1000 * retries); // Exponential backoff
            } else {
                img.src = PLACEHOLDERS[fallbackType] || PLACEHOLDERS.product;
                img.classList.remove('img-loading');
                img.classList.add('img-failed');
                delete img.dataset.loading;
                markUrlFailed(src);
            }
        };
        
        tempImg.src = src;
    };
    
    attemptLoad();
}

/**
 * Check network connection quality
 * @returns {string} 'fast', 'slow', or 'offline'
 */
export function getConnectionQuality() {
    if (!navigator.onLine) return 'offline';
    
    // Use Network Information API if available
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection) {
        const effectiveType = connection.effectiveType;
        if (effectiveType === '4g') return 'fast';
        if (effectiveType === '3g') return 'medium';
        return 'slow';
    }
    
    return 'unknown';
}

/**
 * Initialize connection-aware image loading
 */
export function initConnectionAwareLoading() {
    const quality = getConnectionQuality();
    
    // Adjust loading strategy based on connection
    if (quality === 'slow' || quality === 'offline') {
        // Reduce image quality or use smaller versions
        document.body.classList.add('slow-connection');
        console.log('[ImageLoader] Slow connection detected, optimizing image loading');
    }
    
    // Listen for connection changes
    if (navigator.connection) {
        navigator.connection.addEventListener('change', () => {
            const newQuality = getConnectionQuality();
            if (newQuality === 'slow' || newQuality === 'offline') {
                document.body.classList.add('slow-connection');
            } else {
                document.body.classList.remove('slow-connection');
            }
        });
    }
}

// Auto-setup global handler on import
if (typeof window !== 'undefined') {
    setupGlobalImageErrorHandler();
    initConnectionAwareLoading();
}

// Export placeholders for direct use
export { PLACEHOLDERS };
