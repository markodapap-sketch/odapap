// Firebase Messaging Service Worker
// This handles background push notifications from Firebase Cloud Messaging

importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Initialize Firebase in the service worker
firebase.initializeApp({
  apiKey: "AIzaSyBc-ujBFH8ysXZ7xaPaNdvD_i4-ivthnnU",
  authDomain: "oda-pap-d44c2.firebaseapp.com",
  projectId: "oda-pap-d44c2",
  storageBucket: "oda-pap-d44c2.firebasestorage.app",
  messagingSenderId: "516981877774",
  appId: "1:516981877774:web:1d5532749958218dbae05f"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[Firebase SW] Background message received:', payload);

  const notificationTitle = payload.notification?.title || payload.data?.title || 'Oda Pap';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || 'You have a new notification',
    icon: payload.notification?.icon || '/favicon_io/android-chrome-192x192.png',
    badge: '/favicon_io/favicon-32x32.png',
    tag: payload.data?.tag || 'odapap-fcm-' + Date.now(),
    data: {
      url: payload.data?.url || '/notification.html',
      ...payload.data
    },
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    requireInteraction: payload.data?.requireInteraction === 'true'
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[Firebase SW] Notification clicked:', event);
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const urlToOpen = event.notification.data?.url || '/index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(urlToOpen);
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});
