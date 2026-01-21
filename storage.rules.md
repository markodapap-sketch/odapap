rules_version = '2';

// Craft rules for Firebase Storage
service firebase.storage {
  match /b/{bucket}/o {
    
    // Helper: Check if user is an admin via Firestore
    function isAdmin() {
      return request.auth != null && 
             firestore.exists(/databases/(default)/documents/Admins/$(request.auth.uid));
    }

    // Helper: Check if user is the master admin by email
    function isMasterAdmin() {
      return request.auth != null && 
             request.auth.token.email == 'admin@odapap.com';
    }
    
    // Helper: Validate image file (max 5MB, only images)
    function isValidImage() {
      return request.resource.size < 5 * 1024 * 1024 && // Max 5MB
             request.resource.contentType.matches('image/.*');
    }

    // Listings Images: Everyone can view, only owners/admins can upload/delete
    match /listings/{userId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null && 
                   (request.auth.uid == userId || isAdmin()) &&
                   (request.resource == null || isValidImage()); // Allow delete or valid image upload
    }

    // Profile Pictures (profile-pics path): Everyone can view, only the owner/admin can upload/delete
    match /profile-pics/{userId} {
      allow read: if true;
      allow write: if request.auth != null && 
                   (request.auth.uid == userId || isAdmin()) &&
                   (request.resource == null || isValidImage());
    }

    // Profile Pictures (profiles path - legacy): Everyone can view, only the owner/admin can upload/delete
    match /profiles/{userId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null && 
                   (request.auth.uid == userId || isAdmin()) &&
                   (request.resource == null || isValidImage());
    }

    // Hero Slides: Everyone can view, only admins can manage
    match /heroslides/{allPaths=**} {
      allow read: if true;
      allow write: if isAdmin() && (request.resource == null || isValidImage());
    }

    // Reviews: Everyone can view, authenticated users can upload their own review photos
    match /reviews/{userId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null && 
                   request.auth.uid == userId &&
                   (request.resource == null || isValidImage());
    }

    // Dispatch Photos: Sellers can upload dispatch proof photos
    match /dispatch/{userId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null && 
                   request.auth.uid == userId &&
                   (request.resource == null || isValidImage());
    }
    
    // Default rule: Deny all other access
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
