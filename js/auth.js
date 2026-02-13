import { auth } from './firebase.js';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

const firestore = getFirestore();

// Helper function to get user-friendly error messages
const getErrorMessage = (error) => {
  const errorMessages = {
    'auth/user-not-found': 'No account found with this email. Please sign up first.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/email-already-in-use': 'This email is already registered. Please login instead.',
    'auth/weak-password': 'Password must be at least 6 characters long.',
    'auth/network-request-failed': 'Network error. Please check your internet connection.',
    'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
    'auth/popup-blocked': 'Popup was blocked. Please allow popups or try again.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled. Please try again.',
    'auth/cancelled-popup-request': 'Sign-in was cancelled.',
    'auth/invalid-credential': 'Invalid email or password. Please check and try again.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled.',
    'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.'
  };
  return errorMessages[error.code] || error.message || 'An error occurred. Please try again.';
};

// Function to log in a user
export const loginUser = async (email, password) => {
  try {
    // Validate inputs
    if (!email || !email.trim()) {
      throw { code: 'auth/invalid-email', message: 'Please enter your email address.' };
    }
    if (!password) {
      throw { code: 'auth/wrong-password', message: 'Please enter your password.' };
    }
    
    const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
    console.log("Login successful:", userCredential);
    return userCredential;
  } catch (error) {
    console.error("Login error:", error.code, error.message);
    const friendlyError = new Error(getErrorMessage(error));
    friendlyError.code = error.code;
    throw friendlyError;
  }
};

// Function to sign up a new user with optional survey data
export const signUpUser = async (email, phone, password, surveyData = null, referredBy = null) => {
  try {
    // Validate inputs
    if (!email || !email.trim()) {
      throw { code: 'auth/invalid-email', message: 'Please enter your email address.' };
    }
    if (!phone || !phone.trim()) {
      throw { code: 'custom/missing-phone', message: 'Please enter your phone number.' };
    }
    if (!password || password.length < 6) {
      throw { code: 'auth/weak-password', message: 'Password must be at least 6 characters long.' };
    }
    
    const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const user = userCredential.user;

    // Build user data object — use email prefix as placeholder name
    const emailPrefix = user.email ? user.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() : 'User';
    const userData = {
      email: user.email,
      phone: phone.trim(),
      name: emailPrefix,
      profilePicUrl: "images/profile-placeholder.png",
      createdAt: new Date().toISOString(),
      referralEarnings: 0,
      pendingReferralEarnings: 0
    };
    
    // Add survey data if provided
    if (surveyData) {
      userData.surveyCompleted = true;
      userData.surveyData = surveyData;
    }

    // Handle referral: link to referrer
    if (referredBy) {
      userData.referredBy = referredBy.referrerId;
      userData.referredByCode = referredBy.code;
    }

    // Store additional user information in Firestore
    await setDoc(doc(firestore, "Users", user.uid), userData);

    return user;
  } catch (error) {
    console.error('Error signing up:', error.code, error.message);
    const friendlyError = new Error(getErrorMessage(error));
    friendlyError.code = error.code;
    throw friendlyError;
  }
};

// Function to update user survey data
export const updateUserSurvey = async (userId, surveyData) => {
  try {
    await updateDoc(doc(firestore, "Users", userId), {
      surveyCompleted: true,
      surveyData: surveyData,
      surveyCompletedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error saving survey:', error);
    throw error;
  }
};

// Detect if user is on mobile
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// Function to sign in with Google - with fallback for popup blockers
export const signInWithGoogle = async (referredBy = null) => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account'
  });
  
  try {
    let result;
    
    // Try popup first (works better on desktop)
    if (!isMobileDevice()) {
      try {
        result = await signInWithPopup(auth, provider);
      } catch (popupError) {
        // If popup is blocked or fails, fall back to redirect
        if (popupError.code === 'auth/popup-blocked' || 
            popupError.code === 'auth/popup-closed-by-user' ||
            popupError.code === 'auth/cancelled-popup-request') {
          console.log('Popup failed, using redirect...');
          await signInWithRedirect(auth, provider);
          return null; // Will handle in redirect result
        }
        throw popupError;
      }
    } else {
      // Use redirect for mobile devices (more reliable)
      await signInWithRedirect(auth, provider);
      return null;
    }
    
    if (!result) return null;
    
    const user = result.user;
    
    // Check if user already exists in Firestore
    const userDoc = await getDoc(doc(firestore, "Users", user.uid));
    
    if (!userDoc.exists()) {
      // New user - create minimal profile, they'll complete it later
      const emailPrefix = user.email ? user.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() : 'User';
      const newUserData = {
        email: user.email,
        phone: "",
        name: user.displayName || emailPrefix,
        profilePicUrl: user.photoURL || "images/profile-placeholder.png",
        createdAt: new Date().toISOString(),
        referralEarnings: 0,
        pendingReferralEarnings: 0
      };
      
      // Handle referral for Google sign-up
      if (referredBy) {
        newUserData.referredBy = referredBy.referrerId;
        newUserData.referredByCode = referredBy.code;
      }
      
      await setDoc(doc(firestore, "Users", user.uid), newUserData);
      
      return {
        user: user,
        isNewUser: true
      };
    } else {
      // Existing user
      const userData = userDoc.data();
      return {
        user: user,
        isNewUser: false,
        needsSurvey: !userData.surveyCompleted
      };
    }
  } catch (error) {
    console.error('Error signing in with Google:', error.code, error.message);
    const friendlyError = new Error(getErrorMessage(error));
    friendlyError.code = error.code;
    throw friendlyError;
  }
};

// Handle redirect result (call this on page load)
export const handleGoogleRedirectResult = async () => {
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      const user = result.user;
      const userDoc = await getDoc(doc(firestore, "Users", user.uid));
      
      if (!userDoc.exists()) {
        const emailPrefix = user.email ? user.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() : 'User';
        await setDoc(doc(firestore, "Users", user.uid), {
          email: user.email,
          phone: "",
          name: user.displayName || emailPrefix,
          profilePicUrl: user.photoURL || "images/profile-placeholder.png",
          createdAt: new Date().toISOString()
        });
        
        return { user, isNewUser: true };
      }
      
      const userData = userDoc.data();
      return { user, isNewUser: false, needsSurvey: !userData.surveyCompleted };
    }
    return null;
  } catch (error) {
    console.error('Redirect result error:', error);
    return null;
  }
};

// Check if survey is enabled from settings
export const checkSurveyEnabled = async () => {
  try {
    const settingsDoc = await getDoc(doc(firestore, "Settings", "appSettings"));
    if (settingsDoc.exists()) {
      return settingsDoc.data().surveyEnabled === true;
    }
    return false;
  } catch (error) {
    console.error('Error checking survey settings:', error);
    return false;
  }
};

// Function to log out a user
export const logoutUser = async () => {
  try {
    await signOut(auth);
    console.log('User logged out');
  } catch (error) {
    console.error('Error logging out:', error);
    throw error;
  }
};

// Function to listen to auth state changes
export const onAuthChange = (callback) => {
  onAuthStateChanged(auth, callback);
};

// Function to send password reset email
export const sendPasswordReset = async (email) => {
  try {
    await sendPasswordResetEmail(auth, email);
    console.log('Password reset email sent');
    return true;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw error;
  }
};

// Resolve a referral code to a user ID
export const resolveReferralCode = async (code) => {
  if (!code || code.length < 4) return null;
  try {
    const q = query(collection(firestore, "Users"), where("referralCode", "==", code.toUpperCase()));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const referrerDoc = snap.docs[0];
    return { referrerId: referrerDoc.id, code: code.toUpperCase() };
  } catch (e) {
    console.error('Error resolving referral code:', e);
    return null;
  }
};