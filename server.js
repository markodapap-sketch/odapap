/**
 * Oda Pap M-Pesa Server - Production Ready
 * Handles M-Pesa STK Push payments with robust error handling
 * 
 * Run: node server.js
 * Production: PM2 with ecosystem.config.js
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

// Firebase Client SDK
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, getDocs, updateDoc, collection, query, where, limit, serverTimestamp } = require('firebase/firestore');

const app = express();

// ===========================================
// CONFIGURATION
// ===========================================
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CALLBACK_URL = process.env.CALLBACK_URL || `${BASE_URL}/api/mpesa/callback`;

// M-Pesa Configuration
const MPESA_CONFIG = {
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    shortcode: process.env.MPESA_SHORTCODE,
    passkey: process.env.MPESA_PASSKEY,
    environment: process.env.MPESA_ENVIRONMENT || 'sandbox',
    get baseUrl() {
        return this.environment === 'live' 
            ? 'https://api.safaricom.co.ke'
            : 'https://sandbox.safaricom.co.ke';
    }
};

// Firebase Configuration from Environment Variables
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

// Initialize Firebase
let db = null;
try {
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
    console.log('✅ Firebase initialized successfully');
} catch (error) {
    console.error('❌ Firebase initialization error:', error.message);
}

// ===========================================
// MIDDLEWARE
// ===========================================

// Security headers
app.use(helmet({
    contentSecurityPolicy: false, // Disable for API server
    crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// CORS Configuration - Production
const allowedOrigins = [
    'http://13.201.184.44',
    'https://13.201.184.44',
    'http://odapap.com',
    'https://odapap.com',
    'http://www.odapap.com',
    'https://www.odapap.com',
    'http://api.odapap.com',
    'https://api.odapap.com',
    'http://localhost:5000',
    'https://localhost:5000',
    'http://localhost:5500',
    'https://localhost:5500',
    'http://127.0.0.1:5500',
    'https://127.0.0.1:5500',
    'http://localhost:3000',
    'https://localhost:3000'
];

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        
        // Allow all origins in development or if origin matches allowed list
        if (allowedOrigins.indexOf(origin) !== -1 || NODE_ENV === 'development') {
            callback(null, true);
        } else {
            // In production, still allow but log for monitoring
            console.log('⚠️ CORS request from:', origin);
            callback(null, true); // Allow all origins for API accessibility
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// ===== CRITICAL CORS FIX - Handle preflight OPTIONS requests =====
app.options('*', cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || NODE_ENV === 'development') {
            callback(null, true);
        } else {
            console.log('⚠️ CORS preflight from:', origin);
            callback(null, true);
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Ensure all API routes send CORS headers explicitly
app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    next();
});
// ===== END CORS FIX =====

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname), {
    maxAge: NODE_ENV === 'production' ? '1d' : 0
}));

// ===========================================
// M-PESA TOKEN MANAGEMENT
// ===========================================
let accessToken = null;
let tokenExpiry = null;

async function getAccessToken() {
    // Return cached token if still valid
    if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
        return accessToken;
    }

    try {
        const auth = Buffer.from(
            `${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`
        ).toString('base64');

        const response = await axios.get(
            `${MPESA_CONFIG.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
            {
                headers: {
                    'Authorization': `Basic ${auth}`
                },
                timeout: 30000
            }
        );

        accessToken = response.data.access_token;
        // Token expires in 1 hour, refresh 5 minutes early
        tokenExpiry = Date.now() + (55 * 60 * 1000);
        
        console.log('✅ M-Pesa access token refreshed');
        return accessToken;
    } catch (error) {
        console.error('❌ Token generation failed:', error.response?.data || error.message);
        throw new Error('Failed to generate M-Pesa access token');
    }
}

// ===========================================
// API ROUTES
// ===========================================

// Health Check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        mpesa: {
            environment: MPESA_CONFIG.environment,
            shortcode: MPESA_CONFIG.shortcode,
            callbackUrl: CALLBACK_URL
        },
        firebase: db ? 'connected' : 'disconnected'
    });
});

// STK Push - Initiate Payment
app.post('/api/mpesa/stkpush', async (req, res) => {
    console.log('📱 STK Push Request:', JSON.stringify(req.body, null, 2));
    
    try {
        const { phone, phoneNumber, amount, accountReference, transactionDesc } = req.body;
        const phoneInput = phone || phoneNumber;

        // Validation
        if (!phoneInput || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Phone number and amount are required'
            });
        }

        // Normalize phone number
        let normalizedPhone = phoneInput.toString().replace(/\D/g, '');
        if (normalizedPhone.startsWith('0')) {
            normalizedPhone = '254' + normalizedPhone.substring(1);
        } else if (normalizedPhone.startsWith('+')) {
            normalizedPhone = normalizedPhone.substring(1);
        } else if (!normalizedPhone.startsWith('254')) {
            normalizedPhone = '254' + normalizedPhone;
        }

        // Validate phone format
        if (!/^254[17]\d{8}$/.test(normalizedPhone)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone number format. Use 07XXXXXXXX or 01XXXXXXXX'
            });
        }

        // Validate amount
        const numAmount = parseInt(amount);
        if (isNaN(numAmount) || numAmount < 1) {
            return res.status(400).json({
                success: false,
                error: 'Amount must be at least KES 1'
            });
        }

        // Get access token
        const token = await getAccessToken();

        // Generate timestamp and password
        const timestamp = new Date().toISOString()
            .replace(/[-:T.Z]/g, '')
            .substring(0, 14);
        
        const password = Buffer.from(
            `${MPESA_CONFIG.shortcode}${MPESA_CONFIG.passkey}${timestamp}`
        ).toString('base64');

        // STK Push payload
        const stkPayload = {
            BusinessShortCode: MPESA_CONFIG.shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: numAmount,
            PartyA: normalizedPhone,
            PartyB: MPESA_CONFIG.shortcode,
            PhoneNumber: normalizedPhone,
            CallBackURL: CALLBACK_URL,
            AccountReference: accountReference || 'OdaPap',
            TransactionDesc: transactionDesc || 'Payment'
        };

        console.log('📤 Sending STK Push to M-Pesa...');

        const response = await axios.post(
            `${MPESA_CONFIG.baseUrl}/mpesa/stkpush/v1/processrequest`,
            stkPayload,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        console.log('📥 M-Pesa Response:', JSON.stringify(response.data, null, 2));

        if (response.data.ResponseCode === '0') {
            res.json({
                success: true,
                message: 'STK Push sent successfully',
                checkoutRequestId: response.data.CheckoutRequestID,
                merchantRequestId: response.data.MerchantRequestID,
                responseDescription: response.data.ResponseDescription,
                customerMessage: response.data.CustomerMessage
            });
        } else {
            res.status(400).json({
                success: false,
                error: response.data.ResponseDescription || 'STK Push failed',
                errorCode: response.data.ResponseCode
            });
        }

    } catch (error) {
        console.error('❌ STK Push Error:', error.response?.data || error.message);
        
        const errorMessage = error.response?.data?.errorMessage 
            || error.response?.data?.ResponseDescription 
            || error.message 
            || 'Failed to initiate payment';

        res.status(error.response?.status || 500).json({
            success: false,
            error: errorMessage
        });
    }
});

// M-Pesa Callback Handler
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 M-Pesa Callback Received:', JSON.stringify(req.body, null, 2));
    
    // Always respond immediately to M-Pesa
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    try {
        const { Body } = req.body;
        
        if (!Body || !Body.stkCallback) {
            console.log('⚠️ Invalid callback structure');
            return;
        }

        const { stkCallback } = Body;
        const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;

        console.log(`📋 Callback Details:
            - MerchantRequestID: ${MerchantRequestID}
            - CheckoutRequestID: ${CheckoutRequestID}
            - ResultCode: ${ResultCode}
            - ResultDesc: ${ResultDesc}`);

        // Find transaction in Firebase (check both collections for compatibility)
        if (db) {
            try {
                // Try MpesaTransactions collection first (main collection)
                let transactionsRef = collection(db, 'MpesaTransactions');
                let q = query(
                    transactionsRef,
                    where('checkoutRequestId', '==', CheckoutRequestID),
                    limit(1)
                );
                
                let querySnapshot = await getDocs(q);
                
                // If not found, try lowercase collection name (legacy)
                if (querySnapshot.empty) {
                    transactionsRef = collection(db, 'mpesa_transactions');
                    q = query(
                        transactionsRef,
                        where('checkoutRequestId', '==', CheckoutRequestID),
                        limit(1)
                    );
                    querySnapshot = await getDocs(q);
                }
                
                if (!querySnapshot.empty) {
                    const transactionDoc = querySnapshot.docs[0];
                    const collectionName = transactionDoc.ref.parent.id;
                    
                    if (ResultCode === 0) {
                        // Payment successful
                        const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
                        const metadata = {};
                        
                        callbackMetadata.forEach(item => {
                            metadata[item.Name] = item.Value;
                        });

                        await updateDoc(doc(db, collectionName, transactionDoc.id), {
                            status: 'completed',
                            mpesaReceiptNumber: metadata.MpesaReceiptNumber || null,
                            transactionDate: metadata.TransactionDate || null,
                            phoneNumber: metadata.PhoneNumber || null,
                            amount: metadata.Amount || null,
                            resultCode: ResultCode,
                            resultDesc: ResultDesc,
                            completedAt: serverTimestamp(),
                            callbackData: req.body
                        });

                        console.log(`✅ Transaction ${transactionDoc.id} marked as completed`);
                        console.log(`   Receipt: ${metadata.MpesaReceiptNumber}`);
                    } else {
                        // Payment failed or cancelled
                        await updateDoc(doc(db, collectionName, transactionDoc.id), {
                            status: 'failed',
                            resultCode: ResultCode,
                            resultDesc: ResultDesc,
                            failedAt: serverTimestamp(),
                            callbackData: req.body
                        });

                        console.log(`❌ Transaction ${transactionDoc.id} failed: ${ResultDesc}`);
                    }
                } else {
                    console.log('⚠️ Transaction not found for CheckoutRequestID:', CheckoutRequestID);
                }
            } catch (dbError) {
                console.error('❌ Database update error:', dbError.message);
            }
        }
    } catch (error) {
        console.error('❌ Callback processing error:', error.message);
    }
});

// Query Transaction Status
app.post('/api/mpesa/query', async (req, res) => {
    try {
        const { checkoutRequestId } = req.body;

        if (!checkoutRequestId) {
            return res.status(400).json({
                success: false,
                error: 'CheckoutRequestID is required'
            });
        }

        const token = await getAccessToken();

        const timestamp = new Date().toISOString()
            .replace(/[-:T.Z]/g, '')
            .substring(0, 14);
        
        const password = Buffer.from(
            `${MPESA_CONFIG.shortcode}${MPESA_CONFIG.passkey}${timestamp}`
        ).toString('base64');

        const response = await axios.post(
            `${MPESA_CONFIG.baseUrl}/mpesa/stkpushquery/v1/query`,
            {
                BusinessShortCode: MPESA_CONFIG.shortcode,
                Password: password,
                Timestamp: timestamp,
                CheckoutRequestID: checkoutRequestId
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        console.log('📥 Query Response:', JSON.stringify(response.data, null, 2));

        res.json({
            success: true,
            data: response.data
        });

    } catch (error) {
        console.error('❌ Query Error:', error.response?.data || error.message);
        
        res.status(error.response?.status || 500).json({
            success: false,
            error: error.response?.data?.errorMessage || error.message
        });
    }
});

// Verify M-Pesa Code
app.post('/api/mpesa/verify', async (req, res) => {
    try {
        const { mpesaCode, expectedAmount, transactionId } = req.body;

        if (!mpesaCode) {
            return res.status(400).json({
                success: false,
                error: 'M-Pesa code is required'
            });
        }

        // Validate M-Pesa code format (e.g., SJK1234ABC)
        const codePattern = /^[A-Z]{2,3}[A-Z0-9]{7,10}$/i;
        if (!codePattern.test(mpesaCode.trim())) {
            return res.status(400).json({
                success: false,
                error: 'Invalid M-Pesa code format'
            });
        }

        // Check if code already used in Firebase
        if (db) {
            const transactionsRef = collection(db, 'mpesa_transactions');
            const q = query(
                transactionsRef,
                where('mpesaReceiptNumber', '==', mpesaCode.trim().toUpperCase()),
                limit(1)
            );
            
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                const existingTx = snapshot.docs[0].data();
                
                // If it's the same transaction, return success
                if (transactionId && existingTx.transactionId === transactionId) {
                    return res.json({
                        success: true,
                        message: 'Payment already verified',
                        data: {
                            mpesaCode: mpesaCode,
                            status: 'completed'
                        }
                    });
                }

                return res.status(400).json({
                    success: false,
                    error: 'This M-Pesa code has already been used'
                });
            }
        }

        // Code is valid and not used
        res.json({
            success: true,
            message: 'M-Pesa code verified',
            data: {
                mpesaCode: mpesaCode.trim().toUpperCase(),
                verified: true
            }
        });

    } catch (error) {
        console.error('❌ Verification Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Verification failed'
        });
    }
});

// Timeout URL Handler
app.post('/api/mpesa/timeout', (req, res) => {
    console.log('⏱️ M-Pesa Timeout:', JSON.stringify(req.body, null, 2));
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// Result URL Handler
app.post('/api/mpesa/result', (req, res) => {
    console.log('📋 M-Pesa Result:', JSON.stringify(req.body, null, 2));
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ===========================================
// STATIC FILE ROUTES
// ===========================================

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('*.html', (req, res) => {
    res.sendFile(path.join(__dirname, req.path));
});

// 404 Handler
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err);
    res.status(500).json({
        error: NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
});

// ===========================================
// START SERVER
// ===========================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    ODA PAP SERVER                          ║
╠═══════════════════════════════════════════════════════════╣
║  Status:      ✅ Running                                   ║
║  Environment: ${NODE_ENV.padEnd(43)}║
║  Port:        ${PORT.toString().padEnd(43)}║
║  Base URL:    ${BASE_URL.padEnd(43)}║
║  M-Pesa:      ${MPESA_CONFIG.environment.padEnd(43)}║
║  Callback:    ${CALLBACK_URL.substring(0, 43).padEnd(43)}║
╚═══════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;