// Oda Pap PWA Manager
// Handles service worker registration, push notifications, and install prompts

import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, Timestamp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { app } from './firebase.js';

const db = getFirestore(app);
const auth = getAuth(app);

// VAPID Key for Firebase Cloud Messaging (you need to generate this in Firebase Console)
// Go to: Firebase Console > Project Settings > Cloud Messaging > Web Push certificates
const VAPID_KEY = 'YOUR_VAPID_KEY_HERE'; // Replace with your actual VAPID key

let deferredPrompt = null;
let messaging = null;
let currentUser = null;

// ============= Service Worker Registration =============
export async function initPWA() {
  if ('serviceWorker' in navigator) {
    try {
      // Register main service worker
      const swRegistration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });
      console.log('[PWA] Service Worker registered:', swRegistration.scope);

      // Register Firebase messaging service worker
      const firebaseRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/firebase-cloud-messaging-push-scope'
      });
      console.log('[PWA] Firebase Messaging SW registered');

      // Check for updates
      swRegistration.addEventListener('updatefound', () => {
        const newWorker = swRegistration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateNotification();
          }
        });
      });

      // Initialize Firebase Messaging
      await initializeFirebaseMessaging(firebaseRegistration);

      // Listen for auth state changes
      onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (user) {
          // Save FCM token for this user
          saveFCMToken(user.uid);
        }
      });

      return swRegistration;
    } catch (error) {
      console.error('[PWA] Service Worker registration failed:', error);
    }
  }
  return null;
}

// ============= Firebase Cloud Messaging =============
async function initializeFirebaseMessaging(registration) {
  try {
    messaging = getMessaging(app);
    
    // Handle foreground messages
    onMessage(messaging, (payload) => {
      console.log('[FCM] Foreground message received:', payload);
      showForegroundNotification(payload);
    });

    console.log('[FCM] Messaging initialized');
  } catch (error) {
    console.error('[FCM] Initialization failed:', error);
  }
}

// Request notification permission and get FCM token
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.log('[Notification] Not supported');
    return { success: false, reason: 'not-supported' };
  }

  if (Notification.permission === 'granted') {
    const token = await getFCMToken();
    return { success: true, token };
  }

  if (Notification.permission === 'denied') {
    return { success: false, reason: 'denied' };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await getFCMToken();
      return { success: true, token };
    }
    return { success: false, reason: permission };
  } catch (error) {
    console.error('[Notification] Permission request failed:', error);
    return { success: false, reason: 'error', error };
  }
}

async function getFCMToken() {
  if (!messaging) return null;
  
  try {
    const registration = await navigator.serviceWorker.getRegistration('/firebase-cloud-messaging-push-scope');
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });
    console.log('[FCM] Token:', token);
    return token;
  } catch (error) {
    console.error('[FCM] Token retrieval failed:', error);
    return null;
  }
}

// Save FCM token to Firestore for user
async function saveFCMToken(userId) {
  if (!userId) return;
  
  try {
    const token = await getFCMToken();
    if (!token) return;

    // Save token to user's document
    const userTokenRef = doc(db, 'UserTokens', userId);
    await setDoc(userTokenRef, {
      fcmToken: token,
      platform: getPlatformInfo(),
      lastUpdated: Timestamp.now(),
      notificationsEnabled: true
    }, { merge: true });

    // Also save to a tokens collection for admin broadcast
    const tokenRef = doc(db, 'FCMTokens', token);
    await setDoc(tokenRef, {
      userId: userId,
      token: token,
      platform: getPlatformInfo(),
      createdAt: Timestamp.now(),
      active: true
    }, { merge: true });

    console.log('[FCM] Token saved for user:', userId);
  } catch (error) {
    console.error('[FCM] Failed to save token:', error);
  }
}

function getPlatformInfo() {
  const ua = navigator.userAgent;
  let platform = 'web';
  let browser = 'unknown';
  
  if (/android/i.test(ua)) platform = 'android';
  else if (/iPad|iPhone|iPod/.test(ua)) platform = 'ios';
  else if (/Win/.test(ua)) platform = 'windows';
  else if (/Mac/.test(ua)) platform = 'macos';
  else if (/Linux/.test(ua)) platform = 'linux';
  
  if (/chrome/i.test(ua) && !/edge/i.test(ua)) browser = 'chrome';
  else if (/firefox/i.test(ua)) browser = 'firefox';
  else if (/safari/i.test(ua)) browser = 'safari';
  else if (/edge/i.test(ua)) browser = 'edge';
  
  return { platform, browser, userAgent: ua.substring(0, 200) };
}

// Show notification in foreground
function showForegroundNotification(payload) {
  const { notification, data } = payload;
  
  // Create in-app notification
  const notifContainer = document.getElementById('pwa-notification-container');
  if (!notifContainer) {
    createNotificationContainer();
  }
  
  const notif = document.createElement('div');
  notif.className = 'pwa-foreground-notification';
  notif.innerHTML = `
    <div class="pwa-notif-content">
      <img src="${notification?.icon || '/favicon_io/android-chrome-192x192.png'}" alt="icon" class="pwa-notif-icon">
      <div class="pwa-notif-text">
        <strong>${escapeHtml(notification?.title || 'Oda Pap')}</strong>
        <p>${escapeHtml(notification?.body || '')}</p>
      </div>
      <button class="pwa-notif-close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;
  
  notif.addEventListener('click', (e) => {
    if (!e.target.classList.contains('pwa-notif-close')) {
      const url = data?.url || '/notification.html';
      window.location.href = url;
    }
  });
  
  document.getElementById('pwa-notification-container').appendChild(notif);
  
  // Auto remove after 5 seconds
  setTimeout(() => notif.remove(), 5000);
  
  // Also show browser notification if tab is not focused
  if (document.hidden && Notification.permission === 'granted') {
    new Notification(notification?.title || 'Oda Pap', {
      body: notification?.body,
      icon: notification?.icon || '/favicon_io/android-chrome-192x192.png',
      tag: data?.tag || 'odapap-foreground'
    });
  }
}

function createNotificationContainer() {
  const container = document.createElement('div');
  container.id = 'pwa-notification-container';
  document.body.appendChild(container);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}

// ============= Install Prompt =============
export function initInstallPrompt() {
  // Capture the install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Install prompt captured');
    showInstallButton();
  });

  // Handle successful installation
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed');
    deferredPrompt = null;
    hideInstallButton();
    showInstallSuccess();
  });

  // Check if already installed
  if (window.matchMedia('(display-mode: standalone)').matches) {
    console.log('[PWA] Running in standalone mode');
  }
}

function showInstallButton() {
  // Create install banner if it doesn't exist
  let banner = document.getElementById('pwa-install-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML = `
      <div class="pwa-install-content">
        <img src="/favicon_io/android-chrome-192x192.png" alt="Oda Pap" class="pwa-install-icon">
        <div class="pwa-install-text">
          <strong>Install Oda Pap</strong>
          <span>Add to home screen for quick access</span>
        </div>
        <button id="pwa-install-btn" class="pwa-install-button">Install</button>
        <button id="pwa-install-dismiss" class="pwa-install-dismiss">×</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn').addEventListener('click', promptInstall);
    document.getElementById('pwa-install-dismiss').addEventListener('click', () => {
      banner.classList.remove('show');
      // Don't show again for 7 days
      localStorage.setItem('pwa-install-dismissed', Date.now());
    });
  }

  // Check if user dismissed recently
  const dismissed = localStorage.getItem('pwa-install-dismissed');
  if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) {
    return;
  }

  // Show banner after a delay
  setTimeout(() => banner.classList.add('show'), 3000);
}

function hideInstallButton() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.classList.remove('show');
}

export async function promptInstall() {
  if (!deferredPrompt) {
    console.log('[PWA] No install prompt available');
    return false;
  }

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log('[PWA] Install prompt outcome:', outcome);
  deferredPrompt = null;
  
  return outcome === 'accepted';
}

function showInstallSuccess() {
  const toast = document.createElement('div');
  toast.className = 'pwa-install-toast';
  toast.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <span>Oda Pap installed successfully!</span>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============= Update Notification =============
function showUpdateNotification() {
  const toast = document.createElement('div');
  toast.className = 'pwa-update-toast';
  toast.innerHTML = `
    <span>A new version is available!</span>
    <button onclick="window.location.reload()">Update</button>
    <button onclick="this.parentElement.remove()">Later</button>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 100);
}

// ============= Check Online Status =============
export function initOnlineStatus() {
  function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    document.body.classList.toggle('offline', !isOnline);
    
    if (!isOnline) {
      showOfflineIndicator();
    } else {
      hideOfflineIndicator();
    }
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
}

function showOfflineIndicator() {
  let indicator = document.getElementById('offline-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'offline-indicator';
    indicator.innerHTML = '<i class="fas fa-wifi-slash"></i> You are offline';
    document.body.appendChild(indicator);
  }
  indicator.classList.add('show');
}

function hideOfflineIndicator() {
  const indicator = document.getElementById('offline-indicator');
  if (indicator) indicator.classList.remove('show');
}

// ============= Initialize Everything =============
export async function initializePWA() {
  console.log('[PWA] Initializing...');
  
  // Register service workers
  await initPWA();
  
  // Setup install prompt
  initInstallPrompt();
  
  // Setup online status monitoring
  initOnlineStatus();
  
  // Add PWA styles
  addPWAStyles();
  
  console.log('[PWA] Initialization complete');
}

function addPWAStyles() {
  if (document.getElementById('pwa-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'pwa-styles';
  style.textContent = `
    /* PWA Install Banner */
    #pwa-install-banner {
      position: fixed;
      bottom: -100px;
      left: 0;
      right: 0;
      background: white;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
      z-index: 99999;
      transition: bottom 0.3s ease;
      padding: 0;
    }
    #pwa-install-banner.show { bottom: 0; }
    .pwa-install-content {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      max-width: 600px;
      margin: 0 auto;
      gap: 12px;
    }
    .pwa-install-icon {
      width: 48px;
      height: 48px;
      border-radius: 10px;
    }
    .pwa-install-text {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .pwa-install-text strong { font-size: 14px; color: #333; }
    .pwa-install-text span { font-size: 12px; color: #666; }
    .pwa-install-button {
      background: #ff5722;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 20px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .pwa-install-button:hover { background: #e64a19; }
    .pwa-install-dismiss {
      background: none;
      border: none;
      font-size: 24px;
      color: #999;
      cursor: pointer;
      padding: 0 8px;
    }

    /* PWA Toast Notifications */
    .pwa-install-toast, .pwa-update-toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: #333;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 99999;
      opacity: 0;
      transition: all 0.3s ease;
    }
    .pwa-install-toast.show, .pwa-update-toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
    .pwa-install-toast i { color: #4caf50; }
    .pwa-update-toast button {
      background: #ff5722;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      margin-left: 8px;
    }
    .pwa-update-toast button:last-child {
      background: transparent;
      color: #ccc;
    }

    /* Foreground Notification */
    #pwa-notification-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99998;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 350px;
    }
    .pwa-foreground-notification {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      overflow: hidden;
      animation: slideIn 0.3s ease;
      cursor: pointer;
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .pwa-notif-content {
      display: flex;
      align-items: center;
      padding: 12px;
      gap: 12px;
    }
    .pwa-notif-icon {
      width: 40px;
      height: 40px;
      border-radius: 8px;
    }
    .pwa-notif-text {
      flex: 1;
    }
    .pwa-notif-text strong { display: block; font-size: 14px; color: #333; }
    .pwa-notif-text p { margin: 4px 0 0; font-size: 12px; color: #666; }
    .pwa-notif-close {
      background: none;
      border: none;
      font-size: 20px;
      color: #999;
      cursor: pointer;
      padding: 0 4px;
    }

    /* Offline Indicator */
    #offline-indicator {
      position: fixed;
      top: -50px;
      left: 0;
      right: 0;
      background: #f44336;
      color: white;
      text-align: center;
      padding: 10px;
      font-size: 14px;
      z-index: 100000;
      transition: top 0.3s ease;
    }
    #offline-indicator.show { top: 0; }
    #offline-indicator i { margin-right: 8px; }

    /* Offline body state */
    body.offline {
      /* Subtle grayscale effect when offline */
    }
  `;
  document.head.appendChild(style);
}

// Export for external use
export { deferredPrompt, messaging };
