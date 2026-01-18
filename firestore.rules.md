rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper function to check if user is an admin
    function isAdmin() {
      return request.auth != null && 
             exists(/databases/$(database)/documents/Admins/$(request.auth.uid));
    }
    
    // Helper function to check if user is master admin
    function isMasterAdmin() {
      return request.auth != null && 
             request.auth.token.email == 'admin@odapap.com';
    }
    
    // Admins collection - Only master admin can manage other admins
    match /Admins/{adminId} {
      allow read: if request.auth != null && 
                    (request.auth.uid == adminId || isMasterAdmin() || isAdmin());
      allow create: if isMasterAdmin();
      allow update, delete: if isMasterAdmin() && request.auth.uid != adminId;
      // Allow self-creation for master admin
      allow create: if request.auth != null && 
                      request.auth.token.email == 'admin@odapap.com' && 
                      request.auth.uid == adminId;
    }
    
    // Listings collection - Public read, authenticated write, admin can manage all
    match /Listings/{listingId} {
      allow read: if true;
      allow create, update: if request.auth != null;
      allow delete: if request.auth != null && 
                      (resource.data.uploaderId == request.auth.uid || isAdmin());
    }
    
    // CategoryMetadata collection - for custom categories added by users
    match /CategoryMetadata/{metadataId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    // BrandMetadata collection - for custom brands added by users
    match /BrandMetadata/{brandId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    // Users collection (for personal profile data)
    match /Users/{userId} {
      allow read: if true;
      // Allow creation during signup and updates by owner/admin
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update, delete: if request.auth != null && 
                              (request.auth.uid == userId || isAdmin());
    }
    
    // 'users' collection (for app-related data including followers)
    match /users/{userId} {
      // Users can access their own data, admins can access all
      allow read: if request.auth != null && 
                    (request.auth.uid == userId || isAdmin());
      allow write: if request.auth != null && 
                     (request.auth.uid == userId || isAdmin());
      
      // Nested collections within 'users' (cart, wishlist, etc.)
      match /{collection=**} {
        allow read, write: if request.auth != null && 
                             (request.auth.uid == userId || isAdmin());
      }
      
      // Followers subcollection
      match /followers/{followerId} {
        allow read: if true;
        allow create: if request.auth != null && request.auth.uid == followerId;
        allow delete: if request.auth != null && 
                        (request.auth.uid == followerId || isAdmin());
      }
    }
    
    // Orders collection - Users can read their own, admins can read/write all
    match /Orders/{orderId} {
      allow read: if request.auth != null && 
                    (resource.data.userId == request.auth.uid || 
                     resource.data.buyerId == request.auth.uid || 
                     resource.data.sellerId == request.auth.uid || 
                     isAdmin());
      allow create: if request.auth != null;
      allow update: if request.auth != null && 
                      (resource.data.userId == request.auth.uid ||
                       resource.data.buyerId == request.auth.uid || 
                       resource.data.sellerId == request.auth.uid || 
                       isAdmin());
      allow delete: if isAdmin();
    }
    
    // Chats collection
    match /Chats/{chatId} {
      allow read, write: if request.auth != null;
    }
    
    // Messages collection - Users can access messages they sent or received
    match /Messages/{messageId} {
      // Allow read if user is sender or recipient
      allow read: if request.auth != null && 
                    (resource.data.senderId == request.auth.uid || 
                     resource.data.recipientId == request.auth.uid);
      // Allow create if user is the sender
      allow create: if request.auth != null && 
                      request.resource.data.senderId == request.auth.uid;
      // Allow update for marking messages as read
      allow update: if request.auth != null && 
                      (resource.data.senderId == request.auth.uid || 
                       resource.data.recipientId == request.auth.uid);
      allow delete: if request.auth != null && 
                      resource.data.senderId == request.auth.uid;
    }
    
    // Reports collection - Users can create, admins can manage
    match /Reports/{reportId} {
      allow read: if request.auth != null && 
                    (resource.data.reporterId == request.auth.uid || isAdmin());
      allow create: if request.auth != null;
      allow update, delete: if isAdmin();
    }
    
    // Analytics collection - Only admins can access
    match /Analytics/{docId} {
      allow read, write: if isAdmin();
    }
    
    // Settings collection - Public read for app settings, admin write
    match /Settings/{settingId} {
      allow read: if true;
      allow write: if isAdmin();
    }
    
    // HeroSlides collection - Public read for homepage carousel, admin write
    match /HeroSlides/{slideId} {
      allow read: if true;
      allow create, update, delete: if isAdmin();
    }
    
    // Transactions collection - Admins can read all, users can read their own
    match /Transactions/{transactionId} {
      allow read: if request.auth != null && 
                    (resource.data.userId == request.auth.uid || isAdmin());
      allow create: if request.auth != null;
      allow update, delete: if isAdmin();
    }
    
    // PaymentVerifications collection - Admins can manage
    match /PaymentVerifications/{verificationId} {
      allow read: if request.auth != null && 
                    (resource.data.userId == request.auth.uid || isAdmin());
      allow create: if request.auth != null;
      allow update, delete: if isAdmin();
    }
    
    // PendingPaymentVerifications collection - For manual M-Pesa verification queue
    match /PendingPaymentVerifications/{verificationId} {
      allow read: if request.auth != null && 
                    (resource.data.userId == request.auth.uid || isAdmin());
      allow create: if request.auth != null;
      allow update, delete: if isAdmin();
    }
    
    // MpesaTransactions collection - M-Pesa payment tracking
    match /MpesaTransactions/{transactionId} {
      // Allow read for:
      // 1. Authenticated users for their own transactions
      // 2. Admins can read all
      // 3. Unauthenticated server for callback processing (query by checkoutRequestId)
      allow read: if (request.auth != null && 
                      (resource.data.userId == request.auth.uid || isAdmin()))
                  || request.auth == null;
      
      // Users can create their own transactions
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      
      // Allow updates from:
      // 1. Authenticated users for their own transactions
      // 2. Backend server (unauthenticated) for M-Pesa callback updates
      allow update: if (request.auth != null && 
                        (resource.data.userId == request.auth.uid || isAdmin()))
                    || request.auth == null;
      
      // Only admins can delete
      allow delete: if isAdmin();
    }
    
    // Disputes collection - For order disputes and claims
    match /Disputes/{disputeId} {
      allow read: if request.auth != null && 
                    (resource.data.userId == request.auth.uid || 
                     resource.data.sellerId == request.auth.uid || 
                     isAdmin());
      allow create: if request.auth != null;
      allow update: if isAdmin();
      allow delete: if isAdmin();
    }
    
    // RefundRequests collection - For refund processing
    match /RefundRequests/{refundId} {
      allow read: if request.auth != null && 
                    (resource.data.userId == request.auth.uid || isAdmin());
      allow create: if request.auth != null;
      allow update: if isAdmin();
      allow delete: if isAdmin();
    }
    
    // Reviews collection - Public read, authenticated write
    match /Reviews/{reviewId} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && 
                              (resource.data.userId == request.auth.uid || isAdmin());
    }
    
    // FCMTokens collection - For push notification subscribers
    match /FCMTokens/{tokenId} {
      // Users can manage their own tokens, admins can read all
      allow read: if request.auth != null && 
                    (resource.data.userId == request.auth.uid || isAdmin());
      allow create, update: if request.auth != null && 
                              request.resource.data.userId == request.auth.uid;
      allow delete: if request.auth != null && 
                      (resource.data.userId == request.auth.uid || isAdmin());
    }
    
    // SentNotifications collection - Admin notification history
    match /SentNotifications/{notifId} {
      allow read: if isAdmin();
      allow create: if isAdmin();
      allow update, delete: if isAdmin();
    }
  }
}
