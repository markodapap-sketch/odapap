// /js/offlineManager.js - Offline Support & Caching Manager
// Provides offline consistency and reduces Firebase reads

const DB_NAME = 'OdaPapCache';
const DB_VERSION = 1;

// Store names
const STORES = {
  LISTINGS: 'listings',
  USER_DATA: 'userData',
  CART: 'cart',
  WISHLIST: 'wishlist',
  MESSAGES: 'messages',
  SETTINGS: 'settings'
};

// Cache durations (ms)
const CACHE_DURATIONS = {
  LISTINGS: 5 * 60 * 1000,      // 5 minutes
  USER_DATA: 10 * 60 * 1000,    // 10 minutes
  CART: 2 * 60 * 1000,          // 2 minutes
  WISHLIST: 5 * 60 * 1000,      // 5 minutes
  MESSAGES: 1 * 60 * 1000,      // 1 minute
  SETTINGS: 60 * 60 * 1000      // 1 hour
};

let db = null;

// ===== DATABASE INITIALIZATION =====
async function initDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Create object stores
      Object.values(STORES).forEach(storeName => {
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: 'id' });
        }
      });
    };
  });
}

// ===== GENERIC CACHE OPERATIONS =====
async function setCache(storeName, key, data) {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      
      const record = {
        id: key,
        data: data,
        timestamp: Date.now()
      };

      const request = store.put(record);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn('Cache write error:', e);
    return false;
  }
}

async function getCache(storeName, key, maxAge) {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result;
        if (record) {
          const age = Date.now() - record.timestamp;
          if (age < maxAge) {
            resolve({ data: record.data, fresh: true });
          } else {
            resolve({ data: record.data, fresh: false });
          }
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn('Cache read error:', e);
    return null;
  }
}

async function deleteCache(storeName, key) {
  try {
    const database = await initDB();
    return new Promise((resolve) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      store.delete(key);
      resolve(true);
    });
  } catch (e) {
    return false;
  }
}

async function clearStore(storeName) {
  try {
    const database = await initDB();
    return new Promise((resolve) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      store.clear();
      resolve(true);
    });
  } catch (e) {
    return false;
  }
}

// ===== LISTINGS CACHE =====
export async function getCachedListings() {
  return await getCache(STORES.LISTINGS, 'all', CACHE_DURATIONS.LISTINGS);
}

export async function setCachedListings(listings) {
  return await setCache(STORES.LISTINGS, 'all', listings);
}

export async function getCachedListing(listingId) {
  return await getCache(STORES.LISTINGS, listingId, CACHE_DURATIONS.LISTINGS);
}

export async function setCachedListing(listingId, listing) {
  return await setCache(STORES.LISTINGS, listingId, listing);
}

// ===== USER DATA CACHE =====
export async function getCachedUserData(userId) {
  return await getCache(STORES.USER_DATA, userId, CACHE_DURATIONS.USER_DATA);
}

export async function setCachedUserData(userId, userData) {
  return await setCache(STORES.USER_DATA, userId, userData);
}

export async function clearUserDataCache() {
  return await clearStore(STORES.USER_DATA);
}

// ===== CART CACHE =====
export async function getCachedCart(userId) {
  return await getCache(STORES.CART, userId, CACHE_DURATIONS.CART);
}

export async function setCachedCart(userId, cart) {
  return await setCache(STORES.CART, userId, cart);
}

// ===== WISHLIST CACHE =====
export async function getCachedWishlist(userId) {
  return await getCache(STORES.WISHLIST, userId, CACHE_DURATIONS.WISHLIST);
}

export async function setCachedWishlist(userId, wishlist) {
  return await setCache(STORES.WISHLIST, userId, wishlist);
}

// ===== MESSAGES CACHE =====
export async function getCachedMessages(chatId) {
  return await getCache(STORES.MESSAGES, chatId, CACHE_DURATIONS.MESSAGES);
}

export async function setCachedMessages(chatId, messages) {
  return await setCache(STORES.MESSAGES, chatId, messages);
}

// ===== OFFLINE STATUS MANAGEMENT =====
let isOnline = navigator.onLine;
let offlineCallbacks = [];
let onlineCallbacks = [];

export function onOffline(callback) {
  offlineCallbacks.push(callback);
}

export function onOnline(callback) {
  onlineCallbacks.push(callback);
}

export function isNetworkOnline() {
  return isOnline;
}

// Monitor network status
window.addEventListener('online', () => {
  isOnline = true;
  hideOfflineIndicator();
  onlineCallbacks.forEach(cb => cb());
});

window.addEventListener('offline', () => {
  isOnline = false;
  showOfflineIndicator();
  offlineCallbacks.forEach(cb => cb());
});

// ===== OFFLINE INDICATOR UI =====
function createOfflineIndicator() {
  if (document.getElementById('offlineIndicator')) return;
  
  const indicator = document.createElement('div');
  indicator.id = 'offlineIndicator';
  indicator.className = 'offline-indicator';
  indicator.innerHTML = '<i class="fas fa-wifi-slash"></i> You are offline. Some features may be limited.';
  document.body.insertBefore(indicator, document.body.firstChild);
}

function showOfflineIndicator() {
  createOfflineIndicator();
  const indicator = document.getElementById('offlineIndicator');
  if (indicator) {
    indicator.classList.add('show');
    // Adjust body padding
    document.body.style.paddingTop = indicator.offsetHeight + 'px';
  }
}

function hideOfflineIndicator() {
  const indicator = document.getElementById('offlineIndicator');
  if (indicator) {
    indicator.classList.remove('show');
    document.body.style.paddingTop = '';
  }
}

// ===== SMART FETCH WITH CACHE =====
export async function smartFetch(cacheKey, storeName, fetchFn, cacheDuration) {
  // Try cache first
  const cached = await getCache(storeName, cacheKey, cacheDuration);
  
  if (cached && cached.fresh) {
    // Return fresh cached data
    return { data: cached.data, fromCache: true, fresh: true };
  }

  // If offline, return stale cache if available
  if (!isOnline) {
    if (cached) {
      return { data: cached.data, fromCache: true, fresh: false };
    }
    throw new Error('No network and no cached data');
  }

  // Try to fetch fresh data
  try {
    const freshData = await fetchFn();
    await setCache(storeName, cacheKey, freshData);
    return { data: freshData, fromCache: false, fresh: true };
  } catch (error) {
    // On error, return stale cache if available
    if (cached) {
      return { data: cached.data, fromCache: true, fresh: false };
    }
    throw error;
  }
}

// ===== PENDING WRITES QUEUE =====
const PENDING_WRITES_KEY = 'oda_pending_writes';

function getPendingWrites() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_WRITES_KEY)) || [];
  } catch {
    return [];
  }
}

function savePendingWrites(writes) {
  localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(writes));
}

export function queueWrite(operation) {
  const writes = getPendingWrites();
  writes.push({
    ...operation,
    queuedAt: Date.now()
  });
  savePendingWrites(writes);
}

export async function processPendingWrites(processFunction) {
  if (!isOnline) return;

  const writes = getPendingWrites();
  if (writes.length === 0) return;

  const remaining = [];

  for (const write of writes) {
    try {
      await processFunction(write);
    } catch (e) {
      console.warn('Failed to process pending write:', e);
      remaining.push(write);
    }
  }

  savePendingWrites(remaining);
}

// ===== CLEAR ALL CACHE =====
export async function clearAllCache() {
  try {
    const database = await initDB();
    Object.values(STORES).forEach(storeName => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).clear();
    });
    return true;
  } catch (e) {
    return false;
  }
}

// ===== INITIALIZE =====
export async function initOfflineManager() {
  await initDB();
  
  // Check initial online status
  if (!navigator.onLine) {
    showOfflineIndicator();
  }
  
  // Process any pending writes
  if (isOnline) {
    // Will be called by individual modules with their process functions
  }
}

// Auto-initialize
initOfflineManager();
