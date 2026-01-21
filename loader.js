/**
 * Non-blocking Loader with Progress Feedback
 * Provides user feedback every <8 seconds to prevent panic on slow connections
 * Does NOT block user interaction with the page
 */

// Loading messages that cycle every few seconds
const LOADING_MESSAGES = [
  { text: 'Loading products...', icon: 'fa-box' },
  { text: 'Fetching latest deals...', icon: 'fa-tag' },
  { text: 'Almost there...', icon: 'fa-spinner fa-spin' },
  { text: 'Connecting to server...', icon: 'fa-server' },
  { text: 'Still working on it...', icon: 'fa-cog fa-spin' },
  { text: 'Loading images...', icon: 'fa-image' },
  { text: 'Preparing your feed...', icon: 'fa-stream' },
  { text: 'Just a moment...', icon: 'fa-hourglass-half' }
];

// Progress indicator state
let progressInterval = null;
let messageIndex = 0;
let loadStartTime = 0;

/**
 * Create and inject the progress toast element
 */
function createProgressToast() {
  // Remove existing if any
  const existing = document.getElementById('oda-progress-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'oda-progress-toast';
  toast.innerHTML = `
    <div class="progress-toast-content">
      <div class="progress-toast-icon"><i class="fas fa-spinner fa-spin"></i></div>
      <div class="progress-toast-text">Loading...</div>
      <div class="progress-toast-bar"><div class="progress-toast-fill"></div></div>
    </div>
  `;
  document.body.appendChild(toast);

  // Add styles if not already present
  if (!document.getElementById('oda-progress-styles')) {
    const styles = document.createElement('style');
    styles.id = 'oda-progress-styles';
    styles.textContent = `
      #oda-progress-toast {
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%) translateY(100px);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        padding: 12px 20px;
        z-index: 9999;
        opacity: 0;
        transition: transform 0.3s ease, opacity 0.3s ease;
        max-width: 90%;
        width: auto;
        min-width: 200px;
        pointer-events: none;
      }
      #oda-progress-toast.visible {
        transform: translateX(-50%) translateY(0);
        opacity: 1;
      }
      .progress-toast-content {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .progress-toast-icon {
        color: #ff5722;
        font-size: 18px;
        flex-shrink: 0;
      }
      .progress-toast-text {
        font-size: 14px;
        color: #333;
        font-weight: 500;
        flex: 1;
        min-width: 120px;
      }
      .progress-toast-bar {
        width: 100%;
        height: 3px;
        background: #eee;
        border-radius: 3px;
        overflow: hidden;
        margin-top: 8px;
      }
      .progress-toast-fill {
        height: 100%;
        background: linear-gradient(90deg, #ff5722, #ff9800);
        border-radius: 3px;
        width: 0%;
        transition: width 0.3s ease;
        animation: progressPulse 2s ease-in-out infinite;
      }
      @keyframes progressPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }

      /* Skeleton loading styles */
      .skeleton {
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
        background-size: 200% 100%;
        animation: skeletonShimmer 1.5s infinite;
        border-radius: 8px;
      }
      @keyframes skeletonShimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      
      /* Skeleton cards for product grid */
      .skeleton-card {
        background: #fff;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      }
      .skeleton-card .skeleton-image {
        width: 100%;
        aspect-ratio: 1;
        background: linear-gradient(90deg, #f5f5f5 25%, #eee 50%, #f5f5f5 75%);
        background-size: 200% 100%;
        animation: skeletonShimmer 1.5s infinite;
      }
      .skeleton-card .skeleton-content {
        padding: 12px;
      }
      .skeleton-card .skeleton-line {
        height: 14px;
        margin-bottom: 8px;
        border-radius: 4px;
      }
      .skeleton-card .skeleton-line.short {
        width: 60%;
      }
      .skeleton-card .skeleton-line.medium {
        width: 80%;
      }
      .skeleton-card .skeleton-line.full {
        width: 100%;
      }

      /* Image loading placeholder */
      .img-loading {
        position: relative;
        background: #f5f5f5;
        min-height: 100px;
      }
      .img-loading::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(90deg, #f5f5f5 25%, #eee 50%, #f5f5f5 75%);
        background-size: 200% 100%;
        animation: skeletonShimmer 1.5s infinite;
      }
      .img-loading::after {
        content: '\\f03e';
        font-family: 'Font Awesome 5 Free';
        font-weight: 900;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 24px;
        color: #ddd;
        z-index: 1;
      }
      
      /* Featured section skeleton */
      .skeleton-featured {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        padding: 10px 0;
      }
      .skeleton-featured-card {
        flex-shrink: 0;
        width: 160px;
        background: #fff;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      }
      .skeleton-featured-card .skeleton-image {
        height: 120px;
      }
      
      /* Category strip skeleton */
      .skeleton-category-strip {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        padding: 10px 0;
      }
      .skeleton-cat-card {
        flex-shrink: 0;
        width: 80px;
        height: 80px;
        border-radius: 12px;
      }

      /* Carousel skeleton */
      .skeleton-carousel {
        width: 100%;
        aspect-ratio: 2.5;
        border-radius: 12px;
        margin-bottom: 12px;
      }
    `;
    document.head.appendChild(styles);
  }

  return toast;
}

/**
 * Show non-blocking loading progress
 * @param {string} section - Optional section identifier
 */
export function showLoader(section = 'main') {
  const toast = createProgressToast();
  loadStartTime = Date.now();
  messageIndex = 0;

  // Show toast after a brief delay (don't show for very fast loads)
  setTimeout(() => {
    if (progressInterval) {
      toast.classList.add('visible');
    }
  }, 500);

  // Update message every 6 seconds (under 8s requirement)
  progressInterval = setInterval(() => {
    const textEl = toast.querySelector('.progress-toast-text');
    const iconEl = toast.querySelector('.progress-toast-icon i');
    const fillEl = toast.querySelector('.progress-toast-fill');

    if (textEl && iconEl) {
      const msg = LOADING_MESSAGES[messageIndex % LOADING_MESSAGES.length];
      textEl.textContent = msg.text;
      iconEl.className = `fas ${msg.icon}`;
      messageIndex++;

      // Update progress bar (estimate based on time)
      const elapsed = Date.now() - loadStartTime;
      const estimatedProgress = Math.min(90, (elapsed / 10000) * 100); // Max 90% until done
      if (fillEl) {
        fillEl.style.width = `${estimatedProgress}%`;
      }
    }
  }, 6000);

  return toast;
}

/**
 * Hide the loading progress
 */
export function hideLoader() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  const toast = document.getElementById('oda-progress-toast');
  if (toast) {
    // Complete the progress bar
    const fillEl = toast.querySelector('.progress-toast-fill');
    if (fillEl) {
      fillEl.style.width = '100%';
    }

    // Hide after a brief moment
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 200);
  }
}

/**
 * Update loader message manually
 * @param {string} message - Message to display
 * @param {string} icon - FontAwesome icon class (without fa-)
 */
export function updateLoaderMessage(message, icon = 'spinner fa-spin') {
  const toast = document.getElementById('oda-progress-toast');
  if (toast) {
    const textEl = toast.querySelector('.progress-toast-text');
    const iconEl = toast.querySelector('.progress-toast-icon i');
    if (textEl) textEl.textContent = message;
    if (iconEl) iconEl.className = `fas fa-${icon}`;
  }
}

/**
 * Set progress percentage
 * @param {number} percent - 0-100
 */
export function setProgress(percent) {
  const toast = document.getElementById('oda-progress-toast');
  if (toast) {
    const fillEl = toast.querySelector('.progress-toast-fill');
    if (fillEl) {
      fillEl.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
  }
}

/**
 * Generate skeleton placeholder HTML for product grid
 * @param {number} count - Number of skeleton cards
 */
export function getSkeletonCards(count = 6) {
  return Array(count).fill(0).map(() => `
    <div class="skeleton-card">
      <div class="skeleton-image skeleton"></div>
      <div class="skeleton-content">
        <div class="skeleton-line full skeleton"></div>
        <div class="skeleton-line medium skeleton"></div>
        <div class="skeleton-line short skeleton"></div>
      </div>
    </div>
  `).join('');
}

/**
 * Generate skeleton for featured section
 * @param {number} count - Number of cards
 */
export function getFeaturedSkeleton(count = 4) {
  return `<div class="skeleton-featured">
    ${Array(count).fill(0).map(() => `
      <div class="skeleton-featured-card">
        <div class="skeleton-image skeleton"></div>
        <div class="skeleton-content">
          <div class="skeleton-line medium skeleton"></div>
          <div class="skeleton-line short skeleton"></div>
        </div>
      </div>
    `).join('')}
  </div>`;
}

/**
 * Generate skeleton for category strip
 * @param {number} count - Number of category cards
 */
export function getCategorySkeleton(count = 6) {
  return `<div class="skeleton-category-strip">
    ${Array(count).fill(0).map(() => `
      <div class="skeleton-cat-card skeleton"></div>
    `).join('')}
  </div>`;
}

/**
 * Generate skeleton for carousel
 */
export function getCarouselSkeleton() {
  return `<div class="skeleton-carousel skeleton"></div>`;
}

/**
 * Show skeleton loaders in containers
 */
export function showSkeletons() {
  // Products container
  const productsContainer = document.getElementById('listings-container');
  if (productsContainer && !productsContainer.dataset.loaded) {
    productsContainer.innerHTML = getSkeletonCards(8);
  }

  // Featured items
  const featuredContainer = document.getElementById('featuredItems');
  if (featuredContainer && !featuredContainer.dataset.loaded) {
    featuredContainer.innerHTML = getFeaturedSkeleton(4);
  }

  // Category strip
  const categoryStrip = document.getElementById('categoryStrip');
  if (categoryStrip && !categoryStrip.dataset.loaded) {
    categoryStrip.innerHTML = getCategorySkeleton(6);
  }

  // Hero carousel
  const carouselTrack = document.getElementById('carouselTrack');
  if (carouselTrack && !carouselTrack.dataset.loaded) {
    carouselTrack.innerHTML = getCarouselSkeleton();
  }
}

/**
 * Enhanced image loading with placeholder
 * @param {HTMLImageElement} img - Image element
 * @param {string} src - Image source URL
 * @param {string} fallbackType - Type of fallback ('product', 'profile', 'logo')
 */
export function loadImageWithPlaceholder(img, src, fallbackType = 'product') {
  // Add loading class
  const container = img.parentElement;
  if (container) {
    container.classList.add('img-loading');
  }

  // Create temporary image to preload
  const tempImg = new Image();
  
  tempImg.onload = () => {
    img.src = src;
    if (container) {
      container.classList.remove('img-loading');
    }
  };

  tempImg.onerror = () => {
    // Use data-fallback attribute or default
    const fallback = img.dataset.fallback || fallbackType;
    img.src = getFallbackImage(fallback);
    if (container) {
      container.classList.remove('img-loading');
    }
  };

  // Start loading
  tempImg.src = src;
}

/**
 * Get fallback image URL
 */
function getFallbackImage(type) {
  const fallbacks = {
    product: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"%3E%3Crect fill="%23f5f5f5" width="200" height="200"/%3E%3Cpath fill="%23ddd" d="M100 40c-33.137 0-60 26.863-60 60s26.863 60 60 60 60-26.863 60-60-26.863-60-60-60zm0 10c27.614 0 50 22.386 50 50s-22.386 50-50 50-50-22.386-50-50 22.386-50 50-50z"/%3E%3Cpath fill="%23bbb" d="M85 80h30v10H85zm0 20h30v10H85zm0 20h30v10H85z"/%3E%3C/svg%3E',
    profile: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle fill="%23e2e8f0" cx="50" cy="50" r="50"/%3E%3Ccircle fill="%2394a3b8" cx="50" cy="40" r="20"/%3E%3Cellipse fill="%2394a3b8" cx="50" cy="85" rx="35" ry="25"/%3E%3C/svg%3E',
    logo: 'images/logo.png'
  };
  return fallbacks[type] || fallbacks.product;
}

/**
 * Initialize progressive image loading for all images with data-src
 */
export function initProgressiveImages() {
  const images = document.querySelectorAll('img[data-src]');
  
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          loadImageWithPlaceholder(img, img.dataset.src, img.dataset.fallback);
          observer.unobserve(img);
        }
      });
    }, {
      rootMargin: '50px 0px',
      threshold: 0.01
    });

    images.forEach(img => observer.observe(img));
  } else {
    // Fallback for older browsers
    images.forEach(img => {
      loadImageWithPlaceholder(img, img.dataset.src, img.dataset.fallback);
    });
  }
}

// Auto-initialize on DOM ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Show skeletons immediately
    showSkeletons();
  });
}
