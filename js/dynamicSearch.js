/**
 * Dynamic Search Component - Oda Pap
 * Provides real-time search suggestions as you type
 */

import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { app } from "./firebase.js";
import { escapeHtml, sanitizeUrl } from './sanitize.js';

const db = getFirestore(app);

// Cache for search data
let searchCache = {
  listings: [],
  lastFetch: 0,
  CACHE_DURATION: 5 * 60 * 1000 // 5 minutes
};

// Popular searches for empty state
const popularSearches = [
  'phones', 'electronics', 'fashion', 'beauty', 'kitchenware',
  'laptop', 'headphones', 'shoes', 'bags', 'watches'
];

// Category icons mapping
const categoryIcons = {
  'fashion': 'tshirt', 'electronics': 'tv', 'phones': 'mobile-alt',
  'beauty': 'heart', 'kitchenware': 'blender', 'furniture': 'couch',
  'accessories': 'headphones', 'foodstuffs': 'carrot', 'pharmaceutical': 'pills',
  'kids': 'baby', 'rentals': 'building', 'default': 'search'
};

/**
 * Initialize dynamic search on an input element
 * @param {string} inputId - The ID of the search input
 * @param {Object} options - Configuration options
 */
export function initDynamicSearch(inputId, options = {}) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const config = {
    maxSuggestions: options.maxSuggestions || 8,
    minChars: options.minChars || 1,
    debounceMs: options.debounceMs || 150,
    showCategories: options.showCategories !== false,
    showRecent: options.showRecent !== false,
    onSelect: options.onSelect || null,
    resultsContainer: options.resultsContainer || null
  };

  // Create suggestions container
  let suggestionsContainer = config.resultsContainer 
    ? document.getElementById(config.resultsContainer)
    : createSuggestionsContainer(input);

  let debounceTimer = null;
  let selectedIndex = -1;

  // Input event for real-time suggestions
  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();

    if (query.length < config.minChars) {
      showPopularSearches(suggestionsContainer, config);
      return;
    }

    debounceTimer = setTimeout(() => {
      performSearch(query, suggestionsContainer, config);
    }, config.debounceMs);
  });

  // Focus event - show popular searches
  input.addEventListener('focus', () => {
    const query = input.value.trim();
    if (query.length < config.minChars) {
      showPopularSearches(suggestionsContainer, config);
    } else {
      performSearch(query, suggestionsContainer, config);
    }
    suggestionsContainer.classList.add('active');
    // On mobile, prevent body scroll when suggestions are open
    if (window.innerWidth <= 768) {
      document.body.style.overflow = 'hidden';
    }
  });

  // Blur event - hide suggestions after delay (to allow clicks)
  input.addEventListener('blur', () => {
    setTimeout(() => {
      suggestionsContainer.classList.remove('active');
      document.body.style.overflow = '';
    }, 250);
  });

  // On mobile, tap the ::before "back" area to close
  suggestionsContainer.addEventListener('click', (e) => {
    if (e.target === suggestionsContainer && window.innerWidth <= 768) {
      suggestionsContainer.classList.remove('active');
      document.body.style.overflow = '';
      input.blur();
    }
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    const items = suggestionsContainer.querySelectorAll('.search-suggestion-item');
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
      updateSelection(items, selectedIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
      updateSelection(items, selectedIndex);
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && items[selectedIndex]) {
        e.preventDefault();
        items[selectedIndex].click();
      } else {
        // Submit search
        const query = input.value.trim();
        if (query) {
          saveRecentSearch(query);
          window.location.href = `search-results.html?q=${encodeURIComponent(query)}`;
        }
      }
    } else if (e.key === 'Escape') {
      suggestionsContainer.classList.remove('active');
      document.body.style.overflow = '';
      input.blur();
    }
  });

  // Form submit handler
  const form = input.closest('form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const query = input.value.trim();
      if (query) {
        saveRecentSearch(query);
        window.location.href = `search-results.html?q=${encodeURIComponent(query)}`;
      }
    });
  }

  return suggestionsContainer;
}

function createSuggestionsContainer(input) {
  const container = document.createElement('div');
  container.className = 'search-suggestions';
  container.id = `${input.id}-suggestions`;
  
  // Position container relative to input
  const wrapper = input.parentElement;
  if (wrapper) {
    wrapper.style.position = 'relative';
    wrapper.appendChild(container);
  } else {
    input.parentNode.insertBefore(container, input.nextSibling);
  }
  
  return container;
}

async function performSearch(query, container, config) {
  const listings = await getCachedListings();
  const queryLower = query.toLowerCase();
  const searchTerms = queryLower.split(/\s+/).filter(t => t.length > 0);
  
  // Score and rank results
  const results = [];
  const categories = new Set();
  const brands = new Set();
  
  listings.forEach(listing => {
    const name = (listing.name || '').toLowerCase();
    const brand = (listing.brand || '').toLowerCase();
    const category = (listing.category || '').toLowerCase();
    const description = (listing.description || '').toLowerCase();
    
    let score = 0;
    let matchedField = '';
    
    searchTerms.forEach(term => {
      // Name matches (highest weight)
      if (name.includes(term)) {
        score += 10;
        if (name.startsWith(term)) score += 5;
        matchedField = 'name';
      }
      // Brand matches
      if (brand.includes(term)) {
        score += 5;
        brands.add(listing.brand);
      }
      // Category matches
      if (category.includes(term)) {
        score += 3;
        categories.add(listing.category);
      }
      // Description matches
      if (description.includes(term)) {
        score += 1;
      }
    });
    
    if (score > 0) {
      results.push({
        ...listing,
        score,
        matchedField,
        image: listing.photoTraceUrl || listing.imageUrls?.[0] || 'images/product-placeholder.png'
      });
    }
  });
  
  // Sort by score
  results.sort((a, b) => b.score - a.score);
  
  // Build suggestions HTML
  let html = '';
  
  // Recent searches section
  if (config.showRecent) {
    const recent = getRecentSearches().filter(r => r.toLowerCase().includes(queryLower)).slice(0, 3);
    if (recent.length > 0) {
      html += `<div class="search-section">
        <div class="search-section-title"><i class="fas fa-history"></i> Recent</div>
        ${recent.map(r => `
          <div class="search-suggestion-item recent" onclick="window.location.href='search-results.html?q=${encodeURIComponent(r)}'">
            <i class="fas fa-history"></i>
            <span>${highlightMatch(r, queryLower)}</span>
          </div>
        `).join('')}
      </div>`;
    }
  }
  
  // Category suggestions
  if (config.showCategories && categories.size > 0) {
    html += `<div class="search-section">
      <div class="search-section-title"><i class="fas fa-folder"></i> Categories</div>
      ${[...categories].slice(0, 3).map(cat => `
        <div class="search-suggestion-item category" onclick="window.location.href='category.html?category=${cat}'">
          <i class="fas fa-${categoryIcons[cat] || categoryIcons.default}"></i>
          <span>${highlightMatch(cat, queryLower)}</span>
          <span class="suggestion-type">in ${cat}</span>
        </div>
      `).join('')}
    </div>`;
  }
  
  // Product suggestions
  if (results.length > 0) {
    html += `<div class="search-section">
      <div class="search-section-title"><i class="fas fa-box"></i> Products</div>
      ${results.slice(0, config.maxSuggestions).map(item => {
        const safeId = encodeURIComponent(item.id || '');
        const safeImage = sanitizeUrl(item.image, 'images/product-placeholder.png');
        const safeBrand = escapeHtml(item.brand || '');
        return `
        <div class="search-suggestion-item product" onclick="window.location.href='product.html?id=${safeId}'">
          <img src="${safeImage}" alt="" class="suggestion-image" onerror="this.src='images/product-placeholder.png'">
          <div class="suggestion-info">
            <span class="suggestion-name">${highlightMatch(item.name || '', queryLower)}</span>
            <span class="suggestion-price">KES ${(item.price || 0).toLocaleString()}</span>
          </div>
          ${safeBrand ? `<span class="suggestion-brand">${safeBrand}</span>` : ''}
        </div>
      `}).join('')}
    </div>`;
  }
  
  // View all results
  if (results.length > 0) {
    html += `
      <div class="search-view-all" onclick="window.location.href='search-results.html?q=${encodeURIComponent(query)}'">
        <i class="fas fa-search"></i> View all results for "${query}" <span class="result-count">(${results.length})</span>
      </div>
    `;
  } else {
    html += `
      <div class="search-no-results">
        <i class="fas fa-search"></i>
        <p>No results for "${query}"</p>
        <small>Try different keywords</small>
      </div>
    `;
  }
  
  container.innerHTML = html;
  container.classList.add('active');
}

function showPopularSearches(container, config) {
  const recent = config.showRecent ? getRecentSearches().slice(0, 5) : [];
  
  let html = '';
  
  if (recent.length > 0) {
    html += `<div class="search-section">
      <div class="search-section-title"><i class="fas fa-history"></i> Recent Searches</div>
      ${recent.map(r => `
        <div class="search-suggestion-item recent" onclick="window.location.href='search-results.html?q=${encodeURIComponent(r)}'">
          <i class="fas fa-history"></i>
          <span>${r}</span>
          <button class="remove-recent" onclick="event.stopPropagation(); removeRecentSearch('${r}'); this.closest('.search-suggestion-item').remove();">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `).join('')}
    </div>`;
  }
  
  html += `<div class="search-section">
    <div class="search-section-title"><i class="fas fa-fire"></i> Popular Searches</div>
    <div class="popular-tags">
      ${popularSearches.slice(0, 8).map(s => `
        <span class="popular-tag" onclick="window.location.href='search-results.html?q=${encodeURIComponent(s)}'">${s}</span>
      `).join('')}
    </div>
  </div>`;
  
  container.innerHTML = html;
}

async function getCachedListings() {
  const now = Date.now();
  
  // Check if cache is valid
  if (searchCache.listings.length > 0 && (now - searchCache.lastFetch) < searchCache.CACHE_DURATION) {
    return searchCache.listings;
  }
  
  // Check localStorage cache
  try {
    const cached = localStorage.getItem('oda_listings_cache');
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (data && (now - timestamp) < searchCache.CACHE_DURATION) {
        searchCache.listings = data;
        searchCache.lastFetch = timestamp;
        return data;
      }
    }
  } catch (e) {}
  
  // Fetch from Firestore
  try {
    const snapshot = await getDocs(collection(db, 'Listings'));
    const listings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    searchCache.listings = listings;
    searchCache.lastFetch = now;
    
    // Save to localStorage
    try {
      localStorage.setItem('oda_listings_cache', JSON.stringify({ data: listings, timestamp: now }));
    } catch (e) {}
    
    return listings;
  } catch (error) {
    console.error('Error fetching listings:', error);
    return searchCache.listings; // Return stale cache on error
  }
}

function highlightMatch(text, query) {
  if (!text || !query) return escapeHtml(text || '');
  // First escape the text to prevent XSS
  const safeText = escapeHtml(text);
  const safeQuery = escapeHtml(query);
  // Then highlight matches
  const regex = new RegExp(`(${safeQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return safeText.replace(regex, '<mark>$1</mark>');
}

function updateSelection(items, index) {
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === index);
  });
}

// Recent searches management
function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem('oda_recent_searches')) || [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query) {
  const recent = getRecentSearches().filter(r => r.toLowerCase() !== query.toLowerCase());
  recent.unshift(query);
  localStorage.setItem('oda_recent_searches', JSON.stringify(recent.slice(0, 10)));
}

window.removeRecentSearch = function(query) {
  const recent = getRecentSearches().filter(r => r !== query);
  localStorage.setItem('oda_recent_searches', JSON.stringify(recent));
};

// Export for global access
window.initDynamicSearch = initDynamicSearch;
