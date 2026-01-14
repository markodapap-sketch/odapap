import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, doc, updateDoc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { app } from "./js/firebase.js";
import { showNotification } from './notifications.js';
import { counties } from './js/locationData.js';
import { setupGlobalImageErrorHandler, getImageUrl } from './js/imageCache.js';

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Setup global image error handling
setupGlobalImageErrorHandler();

const EDIT_LOCK_DURATION = 24 * 60 * 60 * 1000;
const LOCKED_FIELDS = ['name', 'phone'];

const elements = {
  profilePic: document.getElementById('profile-pic'),
  profilePicInput: document.getElementById('profile-pic-input'),
  changePicButton: document.getElementById('change-pic-button'),
  editNameButton: document.getElementById('edit-name-button'),
  editNameContainer: document.getElementById('edit-name-container'),
  newNameInput: document.getElementById('new-name-input'),
  saveNameButton: document.getElementById('save-name-button'),
  cancelNameButton: document.getElementById('cancel-name-button'),
  editPhoneButton: document.getElementById('edit-phone-button'),
  editPhoneContainer: document.getElementById('edit-phone-container'),
  newPhoneInput: document.getElementById('new-phone-input'),
  savePhoneButton: document.getElementById('save-phone-button'),
  cancelPhoneButton: document.getElementById('cancel-phone-button'),
  regionSelect: document.getElementById('region-select'),
  countySelect: document.getElementById('county-select'),
  constituencySelect: document.getElementById('constituency-select'),
  wardSelect: document.getElementById('ward-select'),
  specificDetails: document.getElementById('specific-details'),
  saveLocationButton: document.getElementById('save-location-button'),
  userEmail: document.getElementById('user-email'),
  userName: document.getElementById('user-name'),
  userPhone: document.getElementById('user-phone'),
  userRegion: document.getElementById('user-region'),
  userCounty: document.getElementById('user-county'),
  userWard: document.getElementById('user-ward'),
  userSpecificLocation: document.getElementById('user-specific-location'),
  userConstituency: document.getElementById('user-constituency'),
  accountBalance: document.getElementById('account-balance'),
  toggleBalance: document.getElementById('toggle-balance'),
  profileNotification: document.getElementById('profile-notification'),
  editLocationButton: document.getElementById('edit-location-button'),
  locationSelection: document.getElementById('location-selection')
};

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userDocRef = doc(db, "Users", user.uid);
    const userDoc = await getDoc(userDocRef);
    if (!userDoc.exists()) {
      await setDoc(userDocRef, {
        email: user.email,
        name: user.displayName || "",
        phone: "",
        profilePicUrl: "images/profile-placeholder.png"
      });
    }
    const userData = userDoc.data();
    elements.profilePic.src = userData.profilePicUrl || "images/profile-placeholder.png";
    elements.userEmail.textContent = userData.email || user.email;
    elements.userName.textContent = userData.name || "Not Set";
    elements.userPhone.textContent = userData.phone || "Not Set";
    updateLocationDisplay(userData);
    if (!userData.name || !userData.phone) {
      elements.profileNotification.style.display = 'flex';
    }
    LOCKED_FIELDS.forEach(updateEditButtonState);
  } else {
    window.location.href = 'login.html';
  }
});

// Location logic
elements.regionSelect?.addEventListener('change', populateCounties);
elements.countySelect?.addEventListener('change', populateConstituencies);
elements.constituencySelect?.addEventListener('change', populateWards);

function populateCounties() {
  const region = elements.regionSelect.value;
  elements.countySelect.innerHTML = '<option value="" disabled selected>Select County</option>';
  elements.constituencySelect.innerHTML = '<option value="" disabled selected>Select Constituency</option>';
  elements.wardSelect.innerHTML = '<option value="" disabled selected>Select Ward</option>';
  const regionData = counties[region];
  if (regionData) {
    Object.keys(regionData).forEach(county => {
      const opt = new Option(county, county);
      elements.countySelect.add(opt);
    });
    elements.countySelect.disabled = false;
  }
}

function populateConstituencies() {
  const region = elements.regionSelect.value;
  const county = elements.countySelect.value;
  elements.constituencySelect.innerHTML = '<option value="" disabled selected>Select Constituency</option>';
  elements.wardSelect.innerHTML = '<option value="" disabled selected>Select Ward</option>';
  const countyData = counties[region]?.[county];
  if (countyData) {
    Object.keys(countyData).forEach(constituency => {
      elements.constituencySelect.add(new Option(constituency, constituency));
    });
    elements.constituencySelect.disabled = false;
  }
}

function populateWards() {
  const region = elements.regionSelect.value;
  const county = elements.countySelect.value;
  const constituency = elements.constituencySelect.value;
  elements.wardSelect.innerHTML = '<option value="" disabled selected>Select Ward</option>';
  const wardData = counties[region]?.[county]?.[constituency];
  if (wardData) {
    wardData.forEach(ward => elements.wardSelect.add(new Option(ward, ward)));
    elements.wardSelect.disabled = false;
  }
}

elements.saveLocationButton?.addEventListener('click', async () => {
  const data = {
    region: elements.regionSelect.value,
    county: elements.countySelect.value,
    constituency: elements.constituencySelect.value,
    ward: elements.wardSelect.value,
    specificLocation: elements.specificDetails.value
  };
  try {
    await updateDoc(doc(db, "Users", auth.currentUser.uid), data);
    updateLocationDisplay(data);
    elements.locationSelection.style.display = 'none';
    showNotification("Location updated!");
  } catch (e) { showNotification("Error updating location", "error"); }
});

function updateLocationDisplay(data) {
  if (!data) return;
  elements.userRegion.textContent = data.region || "Not Set";
  elements.userCounty.textContent = data.county || "Not Set";
  elements.userConstituency.textContent = data.constituency || "Not Set";
  elements.userWard.textContent = data.ward || "Not Set";
  elements.userSpecificLocation.textContent = data.specificLocation || "Not Set";
}

// Edit logic
elements.changePicButton?.addEventListener('click', () => elements.profilePicInput.click());
elements.profilePicInput?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const ref = storageRef(storage, `profile-pics/${auth.currentUser.uid}`);
  await uploadBytes(ref, file);
  const url = await getDownloadURL(ref);
  await updateDoc(doc(db, "Users", auth.currentUser.uid), { profilePicUrl: url });
  elements.profilePic.src = url;
  showNotification("Picture updated!");
});

elements.editNameButton?.addEventListener('click', () => {
  if (isFieldLocked('name')) return showNotification(`Locked for ${getRemainingLockTime('name')}`, 'warning');
  elements.editNameContainer.style.display = 'block';
  elements.newNameInput.value = elements.userName.textContent;
});

elements.saveNameButton?.addEventListener('click', async () => {
  const val = elements.newNameInput.value.trim();
  if (val) {
    await updateDoc(doc(db, "Users", auth.currentUser.uid), { name: val });
    elements.userName.textContent = val;
    lockField('name');
    elements.editNameContainer.style.display = 'none';
    showNotification("Name updated!");
  }
});

elements.editPhoneButton?.addEventListener('click', () => {
  if (isFieldLocked('phone')) return showNotification(`Locked for ${getRemainingLockTime('phone')}`, 'warning');
  elements.editPhoneContainer.style.display = 'block';
  elements.newPhoneInput.value = elements.userPhone.textContent;
});

elements.savePhoneButton?.addEventListener('click', async () => {
  const val = elements.newPhoneInput.value.trim();
  if (val) {
    await updateDoc(doc(db, "Users", auth.currentUser.uid), { phone: val });
    elements.userPhone.textContent = val;
    lockField('phone');
    elements.editPhoneContainer.style.display = 'none';
    showNotification("Phone updated!");
  }
});

// Helpers
function isFieldLocked(f) {
  const d = localStorage.getItem(`editLock_${f}`);
  return d && (Date.now() - JSON.parse(d).timestamp < EDIT_LOCK_DURATION);
}
function getRemainingLockTime(f) {
  const d = localStorage.getItem(`editLock_${f}`);
  if (!d) return null;
  const rem = EDIT_LOCK_DURATION - (Date.now() - JSON.parse(d).timestamp);
  return `${Math.floor(rem/3600000)}h ${Math.floor((rem%3600000)/60000)}m`;
}
function lockField(f) {
  localStorage.setItem(`editLock_${f}`, JSON.stringify({ timestamp: Date.now() }));
  updateEditButtonState(f);
}
function updateEditButtonState(f) {
  const btn = document.getElementById(`edit-${f}-button`);
  if (!btn) return;
  if (isFieldLocked(f)) {
    btn.disabled = true;
    btn.textContent = `Locked (${getRemainingLockTime(f)})`;
    btn.style.opacity = '0.5';
  } else {
    btn.disabled = false;
    btn.textContent = `Edit ${f.charAt(0).toUpperCase() + f.slice(1)}`;
    btn.style.opacity = '1';
  }
}

window.showEditLocation = () => elements.locationSelection.style.display = 'block';
window.hideEditName = () => elements.editNameContainer.style.display = 'none';
window.hideEditPhone = () => elements.editPhoneContainer.style.display = 'none';
