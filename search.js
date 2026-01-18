import { app } from "./js/firebase.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { showNotification } from './notifications.js';
import { escapeHtml, sanitizeUrl } from './js/sanitize.js';

const auth = getAuth(app);
const db = getFirestore(app);

document.addEventListener('DOMContentLoaded', async () => {
    // Get product ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        window.location.href = 'index.html';
        return;
    }

    try {
        // Fetch product details
        const productDoc = await getDoc(doc(db, 'Listings', productId));
        if (!productDoc.exists()) {
            window.location.href = 'index.html';
            return;
        }

        const productData = productDoc.data();
        displayProductDetails(productData);
        
        // Fetch seller details
        const sellerDoc = await getDoc(doc(db, 'Users', productData.uploaderId));
        if (sellerDoc.exists()) {
            displaySellerInfo(sellerDoc.data());
        }

        // Fetch related products
        await loadRelatedProducts(productData.category, productId);

    } catch (error) {
        console.error('Error loading product:', error);
    }
});

function displayProductDetails(product) {
    document.getElementById('productName').textContent = product.name;
    document.getElementById('productPrice').textContent = `KES ${product.price}`;
    document.getElementById('productDescription').textContent = product.description;
    document.getElementById('mainImage').src = product.imageUrls[0];

    // Create thumbnails
    const thumbnailContainer = document.getElementById('thumbnailContainer');
    product.imageUrls.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = `thumbnail ${index === 0 ? 'active' : ''}`;
        thumb.innerHTML = `<img src="${url}" alt="Product thumbnail">`;
        thumb.onclick = () => {
            document.getElementById('mainImage').src = url;
            document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
        };
        thumbnailContainer.appendChild(thumb);
    });

    // Set up action buttons
    setupActionButtons(product);
}

function displaySellerInfo(seller) {
    document.getElementById('sellerImage').src = seller.profilePicUrl || 'images/profile-placeholder.png';
    document.getElementById('sellerName').textContent = seller.name || 'Anonymous Seller';
    
    document.getElementById('messageBtn').onclick = () => {
        if (!auth.currentUser) {
            showNotification('Please login to message the seller');
            return;
        }
        window.location.href = `chat.html?sellerId=${seller.uid}`;
    };
}

async function loadRelatedProducts(category, currentProductId) {
    const relatedProductsQuery = query(
        collection(db, 'Listings'),
        where('category', '==', category),
        where('__name__', '!=', currentProductId),
        limit(4)
    );

    const relatedSnapshot = await getDocs(relatedProductsQuery);
    const relatedContainer = document.getElementById('relatedProducts');
    
    relatedSnapshot.forEach(doc => {
        const product = doc.data();
        const productEl = document.createElement('div');
        productEl.className = 'related-product-card';
        
        const safeImageUrl = sanitizeUrl(product.imageUrls?.[0], 'images/product-placeholder.png');
        const safeName = escapeHtml(product.name || 'Product');
        const safeId = encodeURIComponent(doc.id);
        
        productEl.innerHTML = `
            <img src="${safeImageUrl}" alt="${safeName}">
            <h3>${safeName}</h3>
            <p>KES ${(product.price || 0).toLocaleString()}</p>
        `;
        productEl.onclick = () => {
            window.location.href = `product.html?id=${safeId}`;
        };
        relatedContainer.appendChild(productEl);
    });
}

function setupActionButtons(product) {
    document.getElementById('addToCartBtn').onclick = async () => {
        if (!auth.currentUser) {
            showNotification('Please login to add items to cart');
            return;
        }
        // Add to cart logic here
    };

    document.getElementById('buyNowBtn').onclick = () => {
        if (!auth.currentUser) {
            showNotification('Please login to purchase items');
            return;
        }
        window.location.href = `checkout.html?productId=${product.id}`;
    };

    document.getElementById('wishlistBtn').onclick = async () => {
        if (!auth.currentUser) {
            showNotification('Please login to add items to wishlist');
            return;
        }
        // Add to wishlist logic here
    };
}