// chat.js
import { app } from './js/firebase.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';
import { getFirestore, collection, addDoc, query, where, onSnapshot, serverTimestamp, orderBy, getDoc, doc } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js';
import { showNotification } from './notifications.js';
import { escapeHtml, sanitizeUrl } from './js/sanitize.js';
import authModal from './js/authModal.js';

const auth = getAuth(app);
const firestore = getFirestore(app);
const storage = getStorage(app);

const chatContainer = document.getElementById('chat-container');
const chatInput = document.getElementById('chat-input');
const fileInput = document.getElementById('file-input');
const sendButton = document.getElementById('send-button');
const sendFileButton = document.getElementById('send-file-button');
const reportButton = document.getElementById('report-button');
const reportDropdown = document.getElementById('report-dropdown');

let chatHeaderDisplayed = false; // Track if chat header is already displayed

// Function to send a message without reloading the page
async function sendMessage() {
    const messageText = chatInput.value;
    if (messageText.trim() === '') return;

    const user = auth.currentUser;
    if (!user) {
        showNotification('You must be logged in to send a message.', 'warning');
        return;
    }

    const chatId = getChatId(); // Function to retrieve or generate chat ID
    const buyerId = user.uid; // Assuming the current user is the buyer
    const sellerId = getSellerId(); // Function to retrieve seller ID
    const listingId = getListingId(); // Function to retrieve listing ID

    // Log values for debugging
    console.log('chatId:', chatId);
    console.log('sellerId:', sellerId);
    console.log('listingId:', listingId);

    if (!chatId || !sellerId) {
        alert('Chat ID or Seller ID is missing.');
        return;
    }

    // Show loading spinner
    sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        const userDoc = await getDoc(doc(firestore, "Users", user.uid));
        const userName = userDoc.exists() ? userDoc.data().name : user.displayName || 'Anonymous';

        const messageData = {
            chatId,
            buyerId,
            sellerId,
            senderId: user.uid,
            senderName: userName, // Use the fetched user name
            message: messageText,
            timestamp: serverTimestamp(),
        };

        if (listingId) {
            const listingDoc = await getDoc(doc(firestore, "Listings", listingId));
            if (listingDoc.exists()) {
                const listing = listingDoc.data();
                const imageUrl = listing.imageUrls ? listing.imageUrls[0] : 'images/product-placeholder.png';
                messageData.fileUrl = imageUrl;
                messageData.fileType = 'image/jpeg';
                messageData.listingId = listingId; // Include listing ID in the message data
            }
        }

        await addDoc(collection(firestore, 'Messages'), messageData);

        chatInput.value = ''; // Clear the input field
        document.getElementById('attached-image').style.display = 'none'; // Hide the attached image

        // Hide loading spinner
        sendButton.innerHTML = 'Send';
    } catch (error) {
        console.error("Error sending message:", error);
        showNotification('Failed to send message. Please try again.', 'error');
        sendButton.innerHTML = 'Send';
    }
}

// Function to send a file
async function sendFile(file) {
    const user = auth.currentUser;
    if (!user) {
        showNotification('You must be logged in to send a file.', 'warning');
        return;
    }

    const chatId = getChatId(); // Function to retrieve or generate chat ID
    const buyerId = user.uid; // Assuming the current user is the buyer
    const sellerId = getSellerId(); // Function to retrieve seller ID

    // Show loading spinner
    sendFileButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        const fileRef = ref(storage, `chat_files/${chatId}/${file.name}`);
        await uploadBytes(fileRef, file);
        const fileUrl = await getDownloadURL(fileRef);

        const userDoc = await getDoc(doc(firestore, "Users", user.uid));
        const userName = userDoc.exists() ? userDoc.data().name : user.displayName || 'Anonymous';

        await addDoc(collection(firestore, 'Messages'), {
            chatId,
            buyerId,
            sellerId,
            senderId: user.uid,
            senderName: userName, // Use the fetched user name
            fileUrl,
            fileType: file.type,
            timestamp: serverTimestamp(),
        });

        // Hide loading spinner
        sendFileButton.innerHTML = '<i class="fas fa-paperclip"></i>';
    } catch (error) {
        console.error("Error sending file:", error);
        showNotification('Failed to send file. Please try again.', 'error');
        sendFileButton.innerHTML = '<i class="fas fa-paperclip"></i>';
    }
}

// Function to report an issue
async function reportIssue(issue) {
    const user = auth.currentUser;
    if (!user) {
        showNotification('You must be logged in to report an issue.', 'warning');
        return;
    }

    const chatId = getChatId();
    const buyerId = user.uid;
    const sellerId = getSellerId();

    if (!chatId || !sellerId) {
        showNotification('Chat ID or Seller ID is missing.', 'error');
        return;
    }

    const reportData = {
        chatId,
        buyerId,
        sellerId,
        reporterId: user.uid,
        issue,
        timestamp: serverTimestamp(),
    };

    try {
        console.log("Attempting to report issue:", reportData);
        await addDoc(collection(firestore, 'Reports'), reportData);
        console.log("Issue reported successfully.");
        showNotification('Issue reported successfully.');
    } catch (error) {
        console.error("Error reporting issue:", error); // IMPORTANT: Log the full error object
        console.error("Error code:", error.code);        // Log the error code specifically
        console.error("Error message:", error.message);  // Log the error message specifically
        showNotification('Failed to report issue. Please try again.', 'error');
    }
}

reportButton.addEventListener('click', () => {
    reportDropdown.classList.toggle('show');
});

reportDropdown.addEventListener('change', (event) => {
    const issue = event.target.value;
    if (issue) {
        reportIssue(issue);
        reportDropdown.classList.remove('show');
    }
});

sendButton.addEventListener('click', sendMessage);

chatInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault(); // Prevent form submission
        sendMessage();
    }
});

sendFileButton.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        sendFile(file);
    }
});

// Function to load chat messages
function loadChatMessages(chatId) {
    const messagesQuery = query(
        collection(firestore, 'Messages'),
        where('chatId', '==', chatId)
    );

    onSnapshot(messagesQuery, async (snapshot) => {
        chatContainer.innerHTML = ''; // Clear existing messages
        const messages = [];
        snapshot.forEach((doc) => {
            messages.push(doc.data());
        });

        // Sort messages by timestamp locally
        messages.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

        // Display messages in order
        messages.forEach((messageData) => {
            displayMessage(messageData);
        });

        chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll to the bottom
    });
}

// Function to display chat header
function displayChatHeader(userData) {
    if (chatHeaderDisplayed) return; // Ensure only one chat header is displayed

    const chatHeader = document.createElement('div');
    chatHeader.className = 'chat-header';
    
    const safeProfilePicUrl = sanitizeUrl(userData.profilePicUrl, 'images/profile-placeholder.png');
    const safeName = escapeHtml(userData.name || 'User');
    const safeUserId = encodeURIComponent(userData.userId || '');
    
    chatHeader.innerHTML = `
        <img src="${safeProfilePicUrl}" alt="Profile Picture" class="profile-picture" onclick="window.location.href='user.html?userId=${safeUserId}'" style="cursor: pointer;">
        <span class="profile-name">${safeName}</span>
    `;
    chatContainer.parentNode.insertBefore(chatHeader, chatContainer);
    chatHeaderDisplayed = true;
}

// Function to display a message
async function displayMessage(messageData) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    const isSender = messageData.senderId === auth.currentUser.uid;
    const bubbleClass = isSender ? 'sender' : 'receiver';
    
    // Fetch sender's name if not available in messageData
    let senderName = messageData.senderName;
    if (!senderName) {
        const senderDoc = await getDoc(doc(firestore, "Users", messageData.senderId));
        senderName = senderDoc.exists() ? senderDoc.data().name : "Unknown User";
    }
    
    // Sanitize all user content
    const safeSenderName = escapeHtml(isSender ? 'You' : senderName);
    const safeMessage = escapeHtml(messageData.message || '');
    const safeFileUrl = sanitizeUrl(messageData.fileUrl, '');
    const safeListingId = encodeURIComponent(messageData.listingId || '');
    const timestamp = messageData.timestamp?.seconds ? new Date(messageData.timestamp.seconds * 1000).toLocaleTimeString() : '';

    if (messageData.fileUrl && safeFileUrl) {
        const fileType = messageData.fileType?.startsWith('image/') ? 'img' : 'video';
        messageElement.innerHTML = `
            <div class="message-bubble ${bubbleClass}">
                <div class="sender-name">${safeSenderName}</div>
                <${fileType} src="${safeFileUrl}" controls onclick="window.location.href='product.html?id=${safeListingId}'" style="cursor: pointer; max-width: 200px; max-height: 200px;"></${fileType}>
                <p>${safeMessage}</p>
                <span class="timestamp">${timestamp}</span>
            </div>
        `;
    } else {
        messageElement.innerHTML = `
            <div class="message-bubble ${bubbleClass}">
                <div class="sender-name">${safeSenderName}</div>
                <p>${safeMessage}</p>
                <span class="timestamp">${timestamp}</span>
            </div>
        `;
    }
    chatContainer.appendChild(messageElement);
}

// Function to get or create chat ID
function getChatId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('sellerId') || 'defaultChatId';
}

// Function to get seller ID
function getSellerId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('sellerId');
}

// Function to get listing ID
function getListingId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('listingId');
}

// Initialize chat loading
auth.onAuthStateChanged(async (user) => {
    if (user) {
        const chatId = getChatId();
        loadChatMessages(chatId);

        // Check if there's an image to attach to the message input
        const listingId = getListingId();
        if (listingId) {
            const listingDoc = await getDoc(doc(firestore, "Listings", listingId));
            if (listingDoc.exists()) {
                const listing = listingDoc.data();
                const imageUrl = listing.imageUrls ? listing.imageUrls[0] : 'images/product-placeholder.png';
                const attachedImage = document.getElementById('attached-image');
                attachedImage.src = imageUrl;
                attachedImage.style.display = 'block';
            }
        }

        // Fetch and display chat header
        const otherUserId = getSellerId() === user.uid ? getBuyerId() : getSellerId();
        const otherUserDoc = await getDoc(doc(firestore, "Users", otherUserId));
        if (otherUserDoc.exists()) {
            const otherUserData = otherUserDoc.data();
            otherUserData.userId = otherUserId; // Include userId in the data
            displayChatHeader(otherUserData);
        }
    } else {
        // Show login modal with cancel option
        authModal.show({
            title: 'Login to Chat',
            message: 'Sign in to message sellers and negotiate deals',
            icon: 'fa-comments',
            feature: 'chat with sellers',
            allowCancel: true,
            cancelRedirect: 'index.html'
        });
    }
});
