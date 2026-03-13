/**
 * app-router.js  —  Oda Pap Single Page Application Router
 *
 * Manages three views: home (index), category, product.
 * Swaps <main> content without a full page reload, preserving the shared
 * header/footer and keeping Firebase Auth + module code warm in memory.
 */

// ─── View HTML templates ─────────────────────────────────────────────────────

const SKELETON_CARDS = `
  <div class="skeleton-card"><div class="skeleton-image skeleton"></div><div class="skeleton-content"><div class="skeleton-line full skeleton"></div><div class="skeleton-line medium skeleton"></div><div class="skeleton-line short skeleton"></div></div></div>
  <div class="skeleton-card"><div class="skeleton-image skeleton"></div><div class="skeleton-content"><div class="skeleton-line full skeleton"></div><div class="skeleton-line medium skeleton"></div><div class="skeleton-line short skeleton"></div></div></div>
  <div class="skeleton-card"><div class="skeleton-image skeleton"></div><div class="skeleton-content"><div class="skeleton-line full skeleton"></div><div class="skeleton-line medium skeleton"></div><div class="skeleton-line short skeleton"></div></div></div>
  <div class="skeleton-card"><div class="skeleton-image skeleton"></div><div class="skeleton-content"><div class="skeleton-line full skeleton"></div><div class="skeleton-line medium skeleton"></div><div class="skeleton-line short skeleton"></div></div></div>`;

function getHomeHTML() {
  return `
    <!-- Compact Hero + Quick Links -->
    <section class="hero-compact" id="heroCarousel">
      <div class="hero-mini-carousel" id="carouselTrack"></div>
      <div class="carousel-dots" id="carouselDots"></div>
    </section>

    <!-- Auth Status -->
    <div id="auth-status" class="auth-bar"></div>

    <!-- How It Works -->
    <section id="howItWorks" style="display:none;padding:16px;margin:0 12px 8px;background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border-radius:12px;border:1px solid #bae6fd;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;font-size:15px;color:#0c4a6e;"><i class="fas fa-lightbulb" style="color:#f59e0b;"></i> How Oda Pap Works</h3>
        <button onclick="this.closest('section').style.display='none'" style="background:none;border:none;color:#94a3b8;font-size:16px;cursor:pointer;" aria-label="Close"><i class="fas fa-times"></i></button>
      </div>
      <p style="font-size:12px;color:#475569;margin:0 0 12px;line-height:1.5;">Buy quality products at <strong>wholesale prices</strong> — delivered to your door in Mombasa.</p>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;text-align:center;">
        <div style="font-size:11px;color:#334155;background:#fff;border-radius:10px;padding:10px 6px;"><div style="width:36px;height:36px;background:#dbeafe;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;"><i class="fas fa-search" style="color:#2563eb;font-size:14px;"></i></div><strong>Browse &amp; Compare</strong><br><span style="color:#64748b;">Find products from verified sellers</span></div>
        <div style="font-size:11px;color:#334155;background:#fff;border-radius:10px;padding:10px 6px;"><div style="width:36px;height:36px;background:#dbeafe;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;"><i class="fas fa-tags" style="color:#2563eb;font-size:14px;"></i></div><strong>Wholesale Prices</strong><br><span style="color:#64748b;">Pay less than shop retail prices</span></div>
        <div style="font-size:11px;color:#334155;background:#fff;border-radius:10px;padding:10px 6px;"><div style="width:36px;height:36px;background:#dbeafe;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;"><i class="fas fa-mobile-alt" style="color:#2563eb;font-size:14px;"></i></div><strong>Pay via M-Pesa</strong><br><span style="color:#64748b;">Safe M-Pesa, wallet or COD</span></div>
        <div style="font-size:11px;color:#334155;background:#fff;border-radius:10px;padding:10px 6px;"><div style="width:36px;height:36px;background:#dbeafe;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;"><i class="fas fa-truck" style="color:#2563eb;font-size:14px;"></i></div><strong>Fast Delivery</strong><br><span style="color:#64748b;">Delivered across Mombasa</span></div>
      </div>
      <div style="margin-top:12px;padding:10px;background:#f0fdf4;border-radius:8px;font-size:11px;color:#166534;line-height:1.6;">
        <i class="fas fa-check-circle" style="color:#16a34a;"></i> <strong>Free delivery</strong> on orders over KES 3,000<br>
        <i class="fas fa-check-circle" style="color:#16a34a;"></i> <strong>Verified sellers</strong> — quality guaranteed<br>
        <i class="fas fa-check-circle" style="color:#16a34a;"></i> <strong>Buyer protection</strong> — secure payments &amp; easy returns
      </div>
      <div style="text-align:center;margin-top:12px;">
        <a href="signup.html" style="display:inline-block;background:#2563eb;color:#fff;padding:8px 24px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">Sign Up Free <i class="fas fa-arrow-right" style="margin-left:4px;"></i></a>
        <p style="font-size:11px;color:#94a3b8;margin:6px 0 0;">Already have an account? <a href="login.html" style="color:#2563eb;">Log in</a></p>
      </div>
    </section>

    <!-- Prime Categories Pills -->
    <section class="prime-pills">
      <a href="#" class="prime-pill general" data-spa-cat="generalShop"><i class="fas fa-store"></i> General</a>
      <a href="#" class="prime-pill featured" data-spa-cat="featured"><i class="fas fa-star"></i> Featured</a>
      <a href="#" class="prime-pill bestseller" data-spa-cat="bestseller"><i class="fas fa-fire"></i> Hot</a>
      <a href="#" class="prime-pill offers" data-spa-cat="offers"><i class="fas fa-percent"></i> Deals</a>
    </section>

    <!-- Featured: General Shop -->
    <section class="featured-section" id="featuredSection">
      <div class="featured-header">
        <div class="featured-title">
          <i class="fas fa-star"></i>
          <h2>General Shop</h2>
          <span class="featured-badge">Curated</span>
        </div>
        <a href="#" class="see-all" data-spa-cat="generalShop">See All <i class="fas fa-chevron-right"></i></a>
      </div>
      <div class="featured-scroll" id="featuredItems"></div>
    </section>

    <!-- Delivery Countdown Banner -->
    <div id="deliveryCountdownBanner" style="margin:0 0 6px;padding:8px 12px;background:linear-gradient(135deg,#ff5722,#e64a19);border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <div style="display:flex;align-items:center;gap:7px;min-width:0;">
        <i class="fas fa-truck" style="color:#fff;font-size:14px;flex-shrink:0;"></i>
        <span id="countdownMessage" style="color:#fff;font-size:12px;font-weight:600;line-height:1.3;">Loading...</span>
      </div>
      <div style="background:rgba(0,0,0,0.25);border-radius:7px;padding:4px 9px;text-align:center;flex-shrink:0;">
        <span id="countdownTime" style="color:#fff;font-size:13px;font-weight:700;letter-spacing:0.5px;">--:--:--</span>
      </div>
    </div>

    <!-- Categories Strip -->
    <section class="cat-section" style="margin-bottom:6px;">
      <div class="cat-strip" id="categoryStrip"></div>
    </section>

    <!-- Products Grid -->
    <section class="gallery">
      <div class="filter-bar" style="padding:6px 10px;margin-bottom:8px;">
        <select id="sortSelect" class="sort-select">
          <option value="for-you">✨ For You</option>
          <option value="profit">Best Margin</option>
          <option value="popular">Most Popular</option>
          <option value="price-low">Price: Low to High</option>
          <option value="price-high">Price: High to Low</option>
          <option value="newest">Newest</option>
        </select>
      </div>
      <div class="listings-container" id="listings-container">${SKELETON_CARDS}</div>
    </section>`;
}

function getCategoryHTML() {
  return `
    <!-- Breadcrumb -->
    <nav id="breadcrumb-nav" class="breadcrumb-nav" role="navigation"></nav>

    <div class="category-header">
      <i id="category-icon" class="category-icon"></i>
      <h1 id="category-title">Category</h1>
      <p id="category-description" class="category-description"></p>
    </div>

    <!-- Filter & Sort Controls -->
    <div class="filter-bar">
      <button id="filterToggleBtn" class="filter-toggle-btn">
        <i class="fas fa-filter"></i> Filter
      </button>
      <select id="sortSelect" class="sort-select">
        <option value="profit">Best Margin</option>
        <option value="popular">Most Popular</option>
        <option value="price-low">Price: Low to High</option>
        <option value="price-high">Price: High to Low</option>
        <option value="newest">Newest</option>
      </select>
    </div>

    <!-- Subcategory & Brand Cards -->
    <div id="subcategory-cards" class="filter-cards-grid"></div>
    <div id="brand-cards" class="filter-cards-grid"></div>

    <!-- Filter Form -->
    <form id="filterForm" class="filter-form">
      <h3>Filter Options</h3>
      <div class="filter-group">
        <label>Price Range:</label>
        <select id="priceRange">
          <option value="">All Prices</option>
          <option value="0-1000">0 - 1,000</option>
          <option value="1000-5000">1,000 - 5,000</option>
          <option value="5000-10000">5,000 - 10,000</option>
          <option value="10000-50000">10,000 - 50,000</option>
          <option value="50000+">50,000+</option>
        </select>
      </div>
      <button type="submit" class="btn-apply-filter">Apply Filters</button>
    </form>

    <!-- Listings Grid -->
    <section class="gallery">
      <div id="listings-container" class="listings-container">${SKELETON_CARDS}</div>
    </section>`;
}

function getProductHTML() {
  return `
    <!-- Error Message -->
    <div id="errorMessage" class="error-message"></div>

    <!-- Product Container -->
    <div class="product-container" id="productContent">
      <!-- Left Column: Image Gallery -->
      <div class="product-gallery">
        <div class="main-image-container">
          <button class="nav-btn prev" id="prevBtn"><i class="fas fa-chevron-left"></i></button>
          <img id="mainImage" src="" alt="Product Image" fetchpriority="high">
          <button class="nav-btn next" id="nextBtn"><i class="fas fa-chevron-right"></i></button>
          <div class="image-counter">
            <span id="currentImageIndex">1</span>/<span id="totalImages">5</span>
          </div>
        </div>
        <div class="thumbnail-container" id="thumbnailContainer"></div>
      </div>

      <!-- Right Column: Product Details -->
      <div class="product-details">
        <div class="product-header">
          <div class="product-title">
            <h1 id="productName"></h1>
            <span class="product-meta-date"><i class="fas fa-calendar"></i> <span id="productDate"></span></span>
          </div>
        </div>

        <!-- Price Section -->
        <div class="price-section">
          <div class="current-price">
            <span class="price-label"><i class="fas fa-tags"></i> Your Price (Wholesale)</span>
            <span id="productPrice" class="amount"></span>
            <span class="price-per-item" id="pricePerItem"></span>
          </div>
          <div class="initial-price" id="initialPriceContainer">
            <span class="was-label">Est. Retail (Approx.)</span>
            <span id="initialPrice" class="amount strikethrough"></span>
            <span id="retailPerPiece" class="retail-per-piece"></span>
            <span id="discountBadge" class="discount-badge"></span>
          </div>
          <div id="pricingExplainer" style="display:none;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;margin-top:8px;font-size:11px;color:#92400e;line-height:1.5;">
            <i class="fas fa-info-circle" style="color:#f59e0b;"></i>
            <strong>Why two prices?</strong> "Your Price" is the wholesale rate you pay. "Est. Retail" is the approximate market price — the difference is your potential savings or resale margin.
          </div>
        </div>

        <!-- Quick Actions -->
        <div class="quick-actions">
          <button id="buyNowBtn" class="primary-btn"><i class="fas fa-bolt"></i> Buy Now</button>
          <button id="addToCartBtn" class="secondary-btn"><i class="fas fa-cart-plus"></i> Add to Cart</button>
          <button id="wishlistBtn" class="icon-btn"><i class="fas fa-heart"></i></button>
          <button id="compareBtn" class="icon-btn" title="Add to compare list"><i class="fas fa-columns"></i></button>
          <button id="copyLinkBtn" class="icon-btn"><i class="fas fa-share"></i></button>
        </div>

        <!-- Variations -->
        <div id="variationsContainer" class="variations-section">
          <h3><i class="fas fa-palette"></i> Variations</h3>
          <div id="variationsList" class="variations-list"></div>
        </div>

        <!-- Product Info -->
        <div class="product-info-compact">
          <a href="#" id="productCategoryLink" class="info-tag"><i class="fas fa-tag"></i> <span id="productCategory"></span></a>
          <a href="#" id="productSubcategoryLink" class="info-tag"><i class="fas fa-layer-group"></i> <span id="productSubcategory"></span></a>
          <span class="info-tag"><i class="fas fa-copyright"></i> <span id="productBrand"></span></span>
          <span class="info-tag" id="stockInfoTag"><i class="fas fa-boxes"></i> <span id="productTotalStock"></span> in stock</span>
          <span class="info-tag" id="minOrderTag" style="display:none;"><i class="fas fa-shopping-basket"></i> Min order: <span id="productMinOrder"></span> units</span>
          <span class="info-tag" id="variationCountTag" style="display:none;"><i class="fas fa-palette"></i> <span id="productVariationCount"></span> options available</span>
          <span class="info-tag"><i class="fas fa-map-marker-alt"></i> <span id="productLocation"></span></span>
        </div>

        <!-- Bulk Pricing -->
        <div id="bulkPricingContainer" class="bulk-pricing-section">
          <h3><i class="fas fa-tags"></i> Bulk Discounts</h3>
          <div id="bulkPricingList" class="bulk-pricing-list"></div>
        </div>

        <!-- Description -->
        <div class="description-section">
          <h3><i class="fas fa-align-left"></i> Description</h3>
          <p id="productDescription"></p>
        </div>

        <!-- Seller -->
        <div class="seller-section">
          <div class="seller-info">
            <img id="sellerImage" src="images/default-profile.png" alt="Seller">
            <div class="seller-details">
              <h4 id="sellerName"></h4>
              <span class="seller-badge" id="sellerVerifiedBadge" style="display:none;">
                <svg class="verified-tick" viewBox="0 0 22 22" aria-label="Verified account" role="img"><g><path fill="#1d9bf0" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></g></svg>
                Verified Seller
              </span>
            </div>
            <button id="messageSellerBtn" class="message-btn"><i class="fas fa-comment"></i> Chat</button>
          </div>
        </div>

        <!-- Trust Guarantees -->
        <div class="trust-guarantees" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-top:12px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#166534;"><i class="fas fa-truck" style="font-size:16px;color:#16a34a;"></i><div><strong>Fast Delivery</strong><br><span style="color:#4b5563;font-size:11px;">Within Mombasa</span></div></div>
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#166534;"><i class="fas fa-shield-alt" style="font-size:16px;color:#16a34a;"></i><div><strong>Buyer Protection</strong><br><span style="color:#4b5563;font-size:11px;">Secure payments</span></div></div>
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#166534;"><i class="fas fa-undo" style="font-size:16px;color:#16a34a;"></i><div><strong>Easy Returns</strong><br><span style="color:#4b5563;font-size:11px;">Contact seller</span></div></div>
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#166534;"><i class="fas fa-tags" style="font-size:16px;color:#16a34a;"></i><div><strong>Wholesale Price</strong><br><span style="color:#4b5563;font-size:11px;">Buy more, save more</span></div></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Customer Reviews -->
    <section class="reviews-section" id="reviewsSection" style="display:none;">
      <div class="reviews-header">
        <h2><i class="fas fa-star"></i> Customer Reviews</h2>
        <div class="reviews-summary" id="reviewsSummary">
          <div class="rating-big">
            <span class="rating-number" id="avgRating">0</span>
            <div class="rating-stars" id="avgStars"></div>
            <span class="total-reviews" id="totalReviews">0 reviews</span>
          </div>
          <div class="rating-bars" id="ratingBars"></div>
        </div>
      </div>
      <div class="reviews-list" id="reviewsList"></div>
      <div class="reviews-empty" id="reviewsEmpty" style="display:none;">
        <i class="fas fa-comment-slash"></i>
        <p>No reviews yet. Be the first to buy and review!</p>
      </div>
    </section>

    <!-- Similar Products -->
    <section class="similar-products">
      <h2><i class="fas fa-boxes"></i> Similar Products</h2>
      <p class="section-subtitle">Recommended based on product match</p>
      <div id="similarProductsContainer" class="products-grid"></div>
    </section>`;
}

// ─── CSS class toggles per view ───────────────────────────────────────────────

const VIEW_BODY_CLASSES = {
  home:     ['spa-view-home'],
  category: ['spa-view-category'],
  product:  ['product-page', 'spa-view-product'],
};

// ─── Router ───────────────────────────────────────────────────────────────────

class Router {
  constructor() {
    this.main = document.querySelector('main');
    this.currentView = null;

    // Module references (imported once, reused on re-navigate)
    this._mods = {};

    // Intercept browser back/forward
    window.addEventListener('popstate', (e) => {
      const state = e.state || {};
      this._render(state.view || 'home', state.params || {}, false);
    });

    // Expose globally so JS modules can call router.navigate()
    window.__router = this;
  }

  // ── Public navigate method ────────────────────────────────────────────────

  navigate(view, params = {}) {
    const url = this._buildUrl(view, params);
    history.pushState({ view, params }, '', url);
    this._render(view, params, true);
  }

  // ── URL builder ───────────────────────────────────────────────────────────

  _buildUrl(view, params) {
    if (view === 'home')     return '/';
    if (view === 'category') {
      const q = new URLSearchParams();
      if (params.category) q.set('category', params.category);
      if (params.prime)    q.set('prime', params.prime);
      return '/category?' + q.toString();
    }
    if (view === 'product') {
      return '/product?id=' + encodeURIComponent(params.id || '');
    }
    return '/';
  }

  // ── Main render ───────────────────────────────────────────────────────────

  async _render(view, params, scrollTop = true) {
    if (scrollTop) window.scrollTo(0, 0);

    // Update <title>
    const titles = { home: 'Oda Pap - Wholesale Marketplace Mombasa', category: 'Category - Oda Pap', product: 'Product - Oda Pap' };
    document.title = titles[view] || 'Oda Pap';

    // Swap body classes
    Object.values(VIEW_BODY_CLASSES).flat().forEach(c => document.body.classList.remove(c));
    (VIEW_BODY_CLASSES[view] || []).forEach(c => document.body.classList.add(c));

    // Swap main content
    const htmlMap = { home: getHomeHTML, category: getCategoryHTML, product: getProductHTML };
    this.main.innerHTML = (htmlMap[view] || getHomeHTML)();

    this.currentView = view;

    // Patch URL params so existing JS reads them correctly via window.location.search
    // We use history state — the URL is already set, so URLSearchParams will work natively.

    // Load and init the page module
    await this._initModule(view, params);

    // Bind SPA-aware links within the new content
    this._bindLinks();
  }

  // ── Module loader ─────────────────────────────────────────────────────────

  async _initModule(view, params) {
    try {
      if (view === 'home') {
        if (!this._mods.home) {
          this._mods.home = await import('./index-spa.js');
        }
        await this._mods.home.initPage();
      } else if (view === 'category') {
        if (!this._mods.category) {
          this._mods.category = await import('./category-spa.js');
        }
        await this._mods.category.initPage();
      } else if (view === 'product') {
        if (!this._mods.product) {
          this._mods.product = await import('./product-spa.js');
        }
        this._mods.product.initPage();
      }
    } catch (err) {
      console.error('[Router] Module init error:', err);
    }
  }

  // ── Link binder ───────────────────────────────────────────────────────────

  _bindLinks() {
    // Prime category pills on home view
    this.main.querySelectorAll('[data-spa-cat]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate('category', { prime: el.dataset.spaCat });
      });
    });
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export function initRouter() {
  const router = new Router();

  // Parse initial URL to decide first view
  const path = window.location.pathname;
  const params = Object.fromEntries(new URLSearchParams(window.location.search));

  let view = 'home';
  if (path.includes('category') || params.category || params.prime) {
    view = 'category';
  } else if (path.includes('product') || params.id) {
    view = 'product';
  }

  // Replace history state for initial load
  history.replaceState({ view, params }, '', window.location.href);
  router._render(view, params, false);

  return router;
}