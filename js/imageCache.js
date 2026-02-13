/**
 * Image Utilities (No Caching)
 * Simple image URL validation, lazy loading, and error handling.
 * All localStorage/memory caching removed for reliability.
 */

const PLACEHOLDERS = {
    product: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"%3E%3Crect fill="%23f5f5f5" width="200" height="200"/%3E%3Cpath fill="%23ddd" d="M100 40c-33.137 0-60 26.863-60 60s26.863 60 60 60 60-26.863 60-60-26.863-60-60-60zm0 10c27.614 0 50 22.386 50 50s-22.386 50-50 50-50-22.386-50-50 22.386-50 50-50z"/%3E%3C/svg%3E',
    user: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle fill="%23e2e8f0" cx="50" cy="50" r="50"/%3E%3Ccircle fill="%2394a3b8" cx="50" cy="40" r="20"/%3E%3Cellipse fill="%2394a3b8" cx="50" cy="85" rx="35" ry="25"/%3E%3C/svg%3E',
    profile: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle fill="%23e2e8f0" cx="50" cy="50" r="50"/%3E%3Ccircle fill="%2394a3b8" cx="50" cy="40" r="20"/%3E%3Cellipse fill="%2394a3b8" cx="50" cy="85" rx="35" ry="25"/%3E%3C/svg%3E',
    logo: 'images/logo.png'
};

export function getImageUrl(imageSource, type = 'product') {
    if (!imageSource) return PLACEHOLDERS[type] || PLACEHOLDERS.product;
    if (typeof imageSource === 'string') return imageSource.trim() || PLACEHOLDERS[type] || PLACEHOLDERS.product;
    if (Array.isArray(imageSource)) {
        for (const url of imageSource) {
            if (url && typeof url === 'string' && url.trim()) return url.trim();
        }
        return PLACEHOLDERS[type] || PLACEHOLDERS.product;
    }
    const fields = ['imageUrl','imageURL','photoUrl','photoURL','image','photo','url','src','thumbnail','thumbUrl','profilePic','profilePicUrl','avatar','imageUrls','images'];
    for (const field of fields) {
        const v = imageSource[field];
        if (!v) continue;
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') return v[0].trim();
    }
    return PLACEHOLDERS[type] || PLACEHOLDERS.product;
}

export function initLazyLoading() {
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
                    observer.unobserve(img);
                }
            });
        }, { rootMargin: '100px' });
        document.querySelectorAll('img[data-src]').forEach(img => observer.observe(img));
    } else {
        document.querySelectorAll('img[data-src]').forEach(img => { img.src = img.dataset.src; });
    }
}

export function setupGlobalImageErrorHandler() {
    document.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG') {
            const type = e.target.dataset.fallback || (
                e.target.classList.contains('user-img') || e.target.classList.contains('avatar') ||
                e.target.classList.contains('profile-pic') || e.target.closest('.profile') || e.target.closest('.featured-seller')
                    ? 'user' : 'product'
            );
            e.target.onerror = null;
            e.target.src = PLACEHOLDERS[type] || PLACEHOLDERS.product;
            e.target.classList.add('img-placeholder');
        }
    }, true);
}

export function handleImageError(img, type = 'product') {
    if (!img || img.dataset.errorHandled === 'true') return;
    img.dataset.errorHandled = 'true';
    img.src = PLACEHOLDERS[type] || PLACEHOLDERS.product;
    img.classList.add('img-placeholder');
}

export function imageHtml(src, alt = '', className = '', type = 'product') {
    const validSrc = getImageUrl(src, type);
    const placeholder = PLACEHOLDERS[type] || PLACEHOLDERS.product;
    const safeAlt = (alt || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    return `<img src="${validSrc}" alt="${safeAlt}" class="${className}" loading="lazy" onerror="this.onerror=null;this.src='${placeholder}';this.classList.add('img-placeholder');">`;
}

export function clearImageCache() {
    try { localStorage.removeItem('oda_image_cache'); localStorage.removeItem('oda_failed_images'); } catch {}
}
export function preloadImages(urls) { if (Array.isArray(urls)) urls.forEach(u => { const i = new Image(); i.src = u; }); }
export function getConnectionQuality() {
    if (!navigator.onLine) return 'offline';
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c) { if (c.effectiveType === '4g') return 'fast'; if (c.effectiveType === '3g') return 'medium'; return 'slow'; }
    return 'unknown';
}
export function initConnectionAwareLoading() {}
export function loadImageWithRetry(img, src, options = {}) {
    const { maxRetries = 2, timeout = 15000, fallbackType = 'product' } = options;
    let retries = 0;
    const attempt = () => {
        const tmp = new Image();
        const timer = setTimeout(() => { tmp.onload = tmp.onerror = null; if (retries < maxRetries) { retries++; attempt(); } else { img.src = PLACEHOLDERS[fallbackType] || PLACEHOLDERS.product; } }, timeout);
        tmp.onload = () => { clearTimeout(timer); img.src = src; };
        tmp.onerror = () => { clearTimeout(timer); if (retries < maxRetries) { retries++; setTimeout(attempt, 1000 * retries); } else { img.src = PLACEHOLDERS[fallbackType] || PLACEHOLDERS.product; } };
        tmp.src = src;
    };
    attempt();
}

if (typeof window !== 'undefined') { setupGlobalImageErrorHandler(); }

export { PLACEHOLDERS };
