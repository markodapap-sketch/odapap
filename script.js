import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs, addDoc, query, where } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage, ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { app } from "./js/firebase.js";
import { logoutUser, onAuthChange } from "./js/auth.js";
import { initializeImageSliders } from './imageSlider.js';
import { showLoader, hideLoader } from './loader.js';
import { showNotification } from './notifications.js';
import { animateButton, animateIconToCart, updateCartCounter, updateWishlistCounter, updateChatCounter } from './js/utils.js';

// Initialize Firebase services using the app instance
const auth = getAuth(app);
const storage = getStorage(app);
const firestore = getFirestore(app);

// DOM elements
const profilePic = document.getElementById("profile-pic");
const userEmail = document.getElementById("user-email");
const userName = document.getElementById("user-name");
const userPhone = document.getElementById("user-phone");

// Toggle menu dropdown
export function toggleMenu() {
  const dropdown = document.getElementById("dropdown");
  dropdown.style.display =
    dropdown.style.display === "block" ? "none" : "block";
}

// Close dropdown if clicked outside
window.onclick = function (event) {
  if (
    !event.target.matches(".menu-icon") &&
    !event.target.matches(".menu-icon *")
  ) {
    const dropdown = document.getElementById("dropdown");
    if (dropdown.style.display === "block") {
      dropdown.style.display = "none";
    }
  }
};

// Function to display user status and logout button
const displayAuthStatus = (user) => {
  const authStatusDiv = document.getElementById("auth-status");
  authStatusDiv.innerHTML = ""; // Clear the current content

  if (user) {
    const logoutButton = document.createElement("button");
    logoutButton.innerText = "Logout";
    logoutButton.addEventListener("click", async () => {
      await logoutUser();
      window.location.reload(); // Reload the page after logout
    });

    const welcomeMessage = document.createElement("span");
    welcomeMessage.innerText = `Welcome to Oda-Pap, ${user.email}`;

    authStatusDiv.appendChild(welcomeMessage);
    authStatusDiv.appendChild(logoutButton);
  } else {
    authStatusDiv.innerHTML =
      '<a href="login.html">Login</a> | <a href="signup.html">Sign Up</a>';
  }
};

// Listen to authentication state changes
onAuthChange(displayAuthStatus);

// Function to load and display featured listings with gallery dropdown
// DOM elements remain the same...


// Share functionality
async function shareProduct(listingId, productName, productDescription, imageUrl) {
  try {
    const shareUrl = `${window.location.origin}/public/product.html?id=${listingId}`;
    if (navigator.share) {
      await navigator.share({
        title: productName,
        text: productDescription,
        url: shareUrl
      });
    } else {
      // Fallback for browsers that don't support Web Share API

      const shareModal = document.createElement('div');
      shareModal.className = 'share-modal';
      shareModal.innerHTML = `
        <div class="share-modal-content">
          <h3>Share via:</h3>
          <div class="share-buttons">
            <a href="https://wa.me/?text=${encodeURIComponent(`Check out ${productName}: ${shareUrl}`)}" target="_blank">
              <i class="fab fa-whatsapp"></i> WhatsApp
            </a>
            <a href="https://telegram.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(productName)}" target="_blank">
              <i class="fab fa-telegram"></i> Telegram
            </a>
            <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(`Check out ${productName}`)}&url=${encodeURIComponent(shareUrl)}" target="_blank">
              <i class="fab fa-twitter"></i> Twitter
            </a>
            <button onclick="copyToClipboard('${shareUrl}')">
              <i class="fas fa-copy"></i> Copy Link
            </button>
          </div>
          <button onclick="this.parentElement.parentElement.remove()" class="close-modal">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
      document.body.appendChild(shareModal);
    }
  } catch (error) {
    console.error('Error sharing:', error);
  }
}

// Copy to clipboard function
window.copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    showNotification('Link copied to clipboard!');
  } catch (err) {
    console.error('Failed to copy:', err);
  }
};

// Function to redirect to user profile page
window.goToUserProfile = function(userId) {
  window.location.href = `user.html?userId=${userId}`;
};

const loadFeaturedListings = async () => {
  showLoader();
  try {
    const listingsSnapshot = await getDocs(collection(firestore, "Listings"));
    const listingsContainer = document.getElementById("listings-container");
    listingsContainer.innerHTML = "";

    for (const listingDoc of listingsSnapshot.docs) {
      const listing = listingDoc.data();
      const uploaderId = listing.uploaderId || listing.userId;
      let userData = {};

      if (uploaderId) {
        try {
          const userDoc = await getDoc(doc(firestore, "Users", uploaderId));
          if (userDoc.exists()) {
            userData = userDoc.data();
          }
        } catch (error) {
          console.error(`Error fetching user data:`, error);
        }
      }

      // Ensure userData is defined before accessing its properties
      const displayName = userData?.name || userData?.username || "Unknown User";
      const imageUrls = listing.imageUrls || [];
      const firstImageUrl = imageUrls.length > 0 ? imageUrls[0] : "images/product-placeholder.png";
      const sellerId = listing.uploaderId || listing.userId;

      const listingElement = document.createElement("div");
      listingElement.className = "listing-item";
      listingElement.innerHTML = `
        <div class="product-item">
          <div class="profile">
            <img src="${userData.profilePicUrl || "images/profile-placeholder.png"}" alt="${displayName}" onclick="goToUserProfile('${uploaderId}')">
            <div>
              <p><strong>${displayName}</strong></p>
              <p>${listing.name}</p>
            </div>
            <div class="product-actions">
              <div>
                <i class="fas fa-comments" onclick="goToChat('${sellerId}', '${listingDoc.id}')"></i>
                <small> Message </small>
              </div>
              <div>
                <i class="fas fa-share" onclick="shareProduct('${listingDoc.id}', '${listing.name}', '${listing.description}', '${firstImageUrl}')"></i>
                <small> Share </small>
              </div>
            </div>
          </div>
          <div class="product-image-container" onclick="goToProduct('${listingDoc.id}')">
            <div class="image-slider">
              ${imageUrls.map(url => `
                <img src="${url}" alt="Product Image" class="product-image">
              `).join('')}
              <div class="product-tags">
                ${listing.subcategory ? `<span class="product-condition">${listing.subcategory}</span>` : ''}
                ${listing.brand ? `<span class="product-age">${listing.brand} </span>` : ''}
              </div>
            </div>
          </div>
          <p class="product-price">
            <strong>KES ${listing.price}</strong>
            <span class="initial-price">${listing.initialPrice ? `<s>KES ${listing.initialPrice}</s>` : ''}</span>
          </p>
          <p class="product-description">${listing.description ? listing.description : ''}</p>
          
          <div class="product-actions">
            <div>
              <i class="fas fa-cart-plus add-to-cart-btn" data-listing-id="${listingDoc.id}"></i>
              <p>Cart</p>
            </div>
            <div>
              <i class="fas fa-bolt buy-now-btn" data-listing-id="${listingDoc.id}"></i>
              <p>Buy Now</p>
            </div>
            <div>
              <i class="fas fa-heart wishlist-btn" data-listing-id="${listingDoc.id}"></i>
              <p>Wishlist</p>
            </div>
          </div>
        </div>
      `;

      listingsContainer.appendChild(listingElement);
    }
    
    // Initialize image sliders after content is loaded
    initializeImageSliders();

    // Add event listeners for cart, wishlist, and buy now buttons
    document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.addToCart(btn.dataset.listingId);
      });
    });
    document.querySelectorAll('.wishlist-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.addToWishlist(btn.dataset.listingId);
      });
    });
    document.querySelectorAll('.buy-now-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.buyNow(btn.dataset.listingId);
      });
    });

    hideLoader();

  } catch (error) {
    console.error("Error loading featured listings:", error);
    showNotification("Failed to load listings. Please try again later.", "error");
    hideLoader();
  }
};

// Share product function available globally
window.shareProduct = shareProduct;

/*// Function to toggle dropdown gallery
window.toggleDropdown = function (listingId) {
  const dropdown = document.getElementById(`dropdown-${listingId}`);
  dropdown.style.display =
    dropdown.style.display === "block" ? "none" : "block";
};

// Function to change images in the gallery
window.changeImage = function (direction, listingId) {
  const galleryImage = document.getElementById(`galleryImage-${listingId}`);
  const imageUrls = JSON.parse(galleryImage.dataset.imageUrls);
  let currentIndex = imageUrls.indexOf(galleryImage.src);

  currentIndex = (currentIndex + direction + imageUrls.length) % imageUrls.length;
  galleryImage.src = imageUrls[currentIndex];
};*/
// Add this function to handle product navigation
window.goToProduct = function(productId) {
  window.location.href = `product.html?id=${productId}`;
};

// --- CATEGORY STRIP RENDERING FOR INDEX PAGE ---
document.addEventListener("DOMContentLoaded", () => {
  // Render swipeable category strip if #categoryStrip exists
  const categoryStrip = document.getElementById('categoryStrip');
  if (categoryStrip) {
    const categories = [
      { key: "student-centre", icon: "fa-graduation-cap", label: "Student Centre" },
      { key: "electronics", icon: "fa-tv", label: "Electronics" },
      { key: "kitchenware", icon: "fa-blender", label: "Kitchenware" },
      { key: "furniture", icon: "fa-couch", label: "Furniture" },
      { key: "fashion", icon: "fa-tshirt", label: "Fashion" },
      { key: "beauty", icon: "fa-heart", label: "Beauty" },
      { key: "rentals", icon: "fa-building", label: "Rentals" },
      { key: "service-men", icon: "fa-tools", label: "Service Men" },
      { key: "foodstuffs", icon: "fa-carrot", label: "Foodstuffs" },
      { key: "phones", icon: "fa-mobile-alt", label: "Phones" },
      { key: "accessories", icon: "fa-headphones", label: "Accessories" },
      { key: "pharmaceutical", icon: "fa-pills", label: "Pharmaceutical" },
      { key: "kids", icon: "fa-hat-wizard", label: "Kids" }
    ];
    categoryStrip.innerHTML = "";
    categories.forEach(cat => {
      const card = document.createElement("div");
      card.className = "category-card";
      card.innerHTML = `
        <i class="fas ${cat.icon}"></i>
        <span style="color: #ff5722;">${cat.label}</span>
      `;
      card.onclick = () => window.location.href = `category.html?category=${cat.key}`;
      categoryStrip.appendChild(card);
    });
  }

  // Scroll buttons for category strip
  window.scrollCategories = function(dir) {
    const strip = document.getElementById('categoryStrip');
    if (strip) {
      const card = strip.querySelector('.category-card');
      const scrollAmount = card ? card.offsetWidth + 14 : 120;
      strip.scrollBy({ left: dir * scrollAmount * 2.5, behavior: 'smooth' });
    }
  };
});

// --- BUY NOW & ADD TO CART MODAL LOGIC FOR INDEX PAGE ---
window.buyNow = async function (listingId) {
  const user = auth.currentUser;
  if (user) {
    const listingRef = doc(firestore, `Listings/${listingId}`);
    const snapshot = await getDoc(listingRef);
    const listing = snapshot.data();

    try {
      // Always show the quantity modal (with or without variations)
      showQuantityModalWithVariations(listingId, listing, false);
    } catch (error) {
      showNotification("Failed to proceed to checkout. Please try again.");
    }
  } else {
    showNotification("Please log in to buy items.", "warning");
  }
};

window.addToCart = async function (listingId) {
  const user = auth.currentUser;
  if (user) {
    const listingRef = doc(firestore, `Listings/${listingId}`);
    const snapshot = await getDoc(listingRef);
    const listing = snapshot.data();

    try {
      if (listing.variations && listing.variations.length > 0) {
        // Show modal if variations exist
        showQuantityModalWithVariations(listingId, listing, true);
      } else {
        // Add directly if no variations
        await addDoc(collection(firestore, `users/${user.uid}/cart`), {
          userId: user.uid,
          listingId: listingId,
          quantity: 1,
          ...listing,
          addedAt: new Date().toISOString()
        });
        showNotification("Item added to cart!");
        const addToCartBtn = document.querySelector(`[onclick="addToCart('${listingId}')"]`);
        if (addToCartBtn) {
          animateButton(addToCartBtn, 'sounds/pop-39222.mp3');
          animateIconToCart(addToCartBtn, 'cart-icon');
        }
        await updateCartCounter(firestore, user.uid);
      }
    } catch (error) {
      showNotification("Failed to add item to cart. Please try again.");
    }
  } else {
    showNotification("Please log in to add items to the cart.", "warning");
  }
};

// --- MODAL LOGIC (same as category.js) ---
function showQuantityModalWithVariations(listingId, listing, isAddToCart = false) {
  let selectedVariation = null;
  let price = listing.price;
  let maxStock = listing.totalStock || 10;

  let variationsHTML = '';
  if (listing.variations && listing.variations.length > 0) {
    variationsHTML = '<div class="modal-variations"><h4>Available Variations:</h4><div class="variations-grid">';
    listing.variations.forEach((variation, idx) => {
      variationsHTML += `
        <div class="variation-mini-card" data-variation-index="${idx}">
          ${variation.photoUrl ? `<img src="${variation.photoUrl}" alt="${variation.title}">` : '<i class="fas fa-box"></i>'}
          <p><strong>${variation.title}</strong></p>
          <p class="variation-attr">${variation.attr_name}</p>
          <p class="variation-stock">${variation.stock} units</p>
        </div>
      `;
    });
    variationsHTML += '</div></div>';
    selectedVariation = listing.variations[0];
    price = selectedVariation.price || listing.price;
    maxStock = selectedVariation.stock || 10;
  }

  const modal = document.createElement('div');
  modal.className = 'quantity-modal';
  modal.innerHTML = `
    <div class="quantity-modal-content">
      <h3>Select Quantity</h3>
      <p>Available stock: <span id="modalStock">${maxStock}</span> units</p>
      ${variationsHTML}
      <div class="quantity-selector">
        <button class="qty-btn minus">-</button>
        <input type="number" id="buyNowQuantity" value="1" min="1" max="${maxStock}">
        <button class="qty-btn plus">+</button>
      </div>
      <div class="quantity-total">
        <p>Total: <span id="quantityTotal">KES ${price.toLocaleString()}</span></p>
      </div>
      <div class="quantity-actions">
        <button class="cancel-btn">Cancel</button>
        <button class="confirm-btn">${isAddToCart ? 'Add to Cart' : 'Proceed to Checkout'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const quantityInput = modal.querySelector('#buyNowQuantity');
  const totalEl = modal.querySelector('#quantityTotal');
  const minusBtn = modal.querySelector('.minus');
  const plusBtn = modal.querySelector('.plus');
  const cancelBtn = modal.querySelector('.cancel-btn');
  const confirmBtn = modal.querySelector('.confirm-btn');
  const stockEl = modal.querySelector('#modalStock');

  // Select first variation by default if present
  if (listing.variations && listing.variations.length > 0) {
    const cards = modal.querySelectorAll('.variation-mini-card');
    if (cards.length > 0) {
      cards[0].classList.add('selected');
    }
    cards.forEach((card, idx) => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedVariation = listing.variations[idx];
        price = selectedVariation.price || listing.price;
        maxStock = selectedVariation.stock || 10;
        quantityInput.max = maxStock;
        stockEl.textContent = maxStock;
        updateTotal();
      });
    });
  }

  const updateTotal = () => {
    const qty = parseInt(quantityInput.value) || 1;
    totalEl.textContent = `KES ${(price * qty).toLocaleString()}`;
  };

  minusBtn.addEventListener('click', () => {
    if (parseInt(quantityInput.value) > 1) {
      quantityInput.value = parseInt(quantityInput.value) - 1;
      updateTotal();
    }
  });

  plusBtn.addEventListener('click', () => {
    if (parseInt(quantityInput.value) < maxStock) {
      quantityInput.value = parseInt(quantityInput.value) + 1;
      updateTotal();
    }
  });

  quantityInput.addEventListener('input', updateTotal);

  cancelBtn.addEventListener('click', () => {
    modal.remove();
  });

  confirmBtn.addEventListener('click', async () => {
    const quantity = parseInt(quantityInput.value);
    if (isAddToCart) {
      const user = auth.currentUser;
      if (user) {
        try {
          await addDoc(collection(firestore, `users/${user.uid}/cart`), {
            userId: user.uid,
            listingId: listingId,
            quantity: quantity,
            selectedVariation: selectedVariation,
            ...listing,
            addedAt: new Date().toISOString()
          });
          showNotification("Item added to cart!");
          const addToCartBtn = document.querySelector(`[onclick="addToCart('${listingId}')"]`);
          if (addToCartBtn) {
            animateButton(addToCartBtn, 'sounds/pop-39222.mp3');
            animateIconToCart(addToCartBtn, 'cart-icon');
          }
          await updateCartCounter(firestore, user.uid);
        } catch (error) {
          showNotification("Failed to add item to cart. Please try again.");
        }
      }
    } else {
      // Buy Now: pass selected variation and quantity to checkout
      proceedToBuyNowCheckout(quantity, listing, listingId, selectedVariation);
    }
    modal.remove();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Helper to set cookie
function setCookie(name, value, days = 1) {
  const expires = new Date();
  expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};expires=${expires.toUTCString()};path=/`;
}

// Buy Now quantity modal and proceed function
window.showQuantityModal = function(listingId, listing, selectedVariation = null) {
  const maxStock = selectedVariation ? selectedVariation.stock : (listing.totalStock || 10);

  const modal = document.createElement('div');
  modal.className = 'quantity-modal';
  modal.innerHTML = `
    <div class="quantity-modal-content">
      <h3>Select Quantity</h3>
      <p>Available stock: ${maxStock} units</p>
      <div class="quantity-selector">
        <button class="qty-btn minus">-</button>
        <input type="number" id="buyNowQuantity" value="1" min="1" max="${maxStock}">
        <button class="qty-btn plus">+</button>
      </div>
      <div class="quantity-total">
        <p>Total: <span id="quantityTotal">KES ${listing.price.toLocaleString()}</span></p>
      </div>
      <div class="quantity-actions">
        <button class="cancel-btn">Cancel</button>
        <button class="confirm-btn">Proceed to Checkout</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const quantityInput = modal.querySelector('#buyNowQuantity');
  const totalEl = modal.querySelector('#quantityTotal');
  const minusBtn = modal.querySelector('.minus');
  const plusBtn = modal.querySelector('.plus');
  const cancelBtn = modal.querySelector('.cancel-btn');
  const confirmBtn = modal.querySelector('.confirm-btn');

  const updateTotal = () => {
    const qty = parseInt(quantityInput.value) || 1;
    const total = listing.price * qty;
    totalEl.textContent = `KES ${total.toLocaleString()}`;
  };

  minusBtn.addEventListener('click', () => {
    if (parseInt(quantityInput.value) > 1) {
      quantityInput.value = parseInt(quantityInput.value) - 1;
      updateTotal();
    }
  });

  plusBtn.addEventListener('click', () => {
    if (parseInt(quantityInput.value) < maxStock) {
      quantityInput.value = parseInt(quantityInput.value) + 1;
      updateTotal();
    }
  });

  quantityInput.addEventListener('input', updateTotal);

  cancelBtn.addEventListener('click', () => {
    modal.remove();
  });

  confirmBtn.addEventListener('click', () => {
    const quantity = parseInt(quantityInput.value);
    proceedToBuyNowCheckout(quantity, listing, listingId, selectedVariation);
    modal.remove();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
};

// Add this function for Buy Now checkout
function proceedToBuyNowCheckout(quantity, listing, listingId, selectedVariation = null) {
  try {
    const buyNowData = {
      listingId: listingId,
      name: listing.name,
      price: listing.price,
      quantity: quantity,
      selectedVariation: selectedVariation,
      photoTraceUrl: listing.photoTraceUrl,
      imageUrls: listing.imageUrls,
      brand: listing.brand,
      category: listing.category
    };
    setCookie('buyNowItem', buyNowData, 1);
    showNotification("Proceeding to checkout!");
    // Optionally animate the Buy Now button if you have a reference
    // animateButton(document.querySelector(`[onclick="buyNow('${listingId}')"]`));
    setTimeout(() => {
      window.location.href = "checkout.html?source=buynow";
    }, 500);
  } catch (error) {
    console.error("Error proceeding to checkout:", error);
    showNotification("Failed to proceed to checkout. Please try again.");
  }
}

// Function to display chat history item
async function displayChat(chatData) {
  const chatItem = document.createElement("li");
  chatItem.classList.add("notification-item");

  // Get profile picture of the seller/buyer
  let profilePicUrl = "images/profile-placeholder.png";
  if (chatData.profilePic) {
    profilePicUrl = chatData.profilePic;
  }

  chatItem.innerHTML = `
    <div class="chat-item">
      <div class="profile-picture">
        <img src="${profilePicUrl}" alt="Profile Picture" class="profile-img" onclick="goToUserProfile('${chatData.sellerId}')">
      </div>
      <!-- ...existing code... -->
    </div>
  `;
  // ...existing code...
}

async function handleAddToCart(listingId) {
    const auth = getAuth(app);
    const db = getFirestore(app);
    if (!auth.currentUser) {
        showNotification("Please login to add items to cart", "warning");
        return;
    }
    const listingRef = doc(db, `Listings/${listingId}`);
    const snapshot = await getDoc(listingRef);
    const listing = snapshot.data();

    try {
        await addDoc(collection(db, `users/${auth.currentUser.uid}/cart`), {
            userId: auth.currentUser.uid,
            listingId: listingId,
            ...listing,
        });
        showNotification("Item added to cart!");
        animateButton(document.querySelector(`[data-listing-id="${listingId}"] .add-to-cart-btn`), 'sounds/pop-39222.mp3');
        animateIconToCart(document.querySelector(`[data-listing-id="${listingId}"] .add-to-cart-btn`), 'cart-icon');
        await updateCartCounter(db, auth.currentUser.uid);
    } catch (error) {
        console.error("Error adding item to cart:", error);
        showNotification("Failed to add item to cart. Please try again.");
    }
}

async function handleBuyNow(listingId) {
    const auth = getAuth(app);
    const db = getFirestore(app);
    if (!auth.currentUser) {
        showNotification("Please login to purchase items", "warning");
        return;
    }
    const listingRef = doc(db, `Listings/${listingId}`);
    const snapshot = await getDoc(listingRef);
    const listing = snapshot.data();

    try {
        await addDoc(collection(db, `users/${auth.currentUser.uid}/checkout`), {
            userId: auth.currentUser.uid,
            listingId: listingId,
            ...listing
        });
        showNotification("Proceed to checkout!");
        animateButton(document.querySelector(`[data-listing-id="${listingId}"] .buy-now-btn`));
        window.location.href = "checkout.html?source=checkout"; // Assuming you have a checkout page
    } catch (error) {
        console.error("Error proceeding to checkout:", error);
        showNotification("Failed to proceed to checkout. Please try again.");
    }
}

async function handleWishlist(listingId) {
    const auth = getAuth(app);
    const db = getFirestore(app);
    if (!auth.currentUser) {
        showNotification("Please login to add items to wishlist", "warning");
        return;
    }
    const listingRef = doc(db, `Listings/${listingId}`);
    const snapshot = await getDoc(listingRef);
    const listing = snapshot.data();

    try {
        await addDoc(collection(db, `users/${auth.currentUser.uid}/wishlist`), {
            userId: auth.currentUser.uid,
            listingId: listingId,
            ...listing,
        });
        showNotification("Item added to wishlist!");
        animateButton(document.querySelector(`[data-listing-id="${listingId}"] .wishlist-btn`), 'sounds/pop-268648.mp3');
        animateIconToCart(document.querySelector(`[data-listing-id="${listingId}"] .wishlist-btn`), 'wishlist-icon');
        await updateWishlistCounter(db, auth.currentUser.uid);
    } catch (error) {
        console.error("Error adding item to wishlist:", error);
        showNotification("Failed to add item to wishlist. Please try again.");
    }
}

