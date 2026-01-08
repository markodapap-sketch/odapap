





















































// File: server.js (to be hosted separately, not on Firebase)

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin SDK
const serviceAccount = require('./path-to-your-firebase-admin-sdk.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://your-project-id.firebaseio.com"
});

const MPESA_API_URL = 'https://sandbox.safaricom.co.ke';
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const BUSINESS_SHORT_CODE = process.env.MPESA_BUSINESS_SHORT_CODE;
const PASSKEY = process.env.MPESA_PASSKEY;
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL;

async function getAccessToken() {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    const response = await axios.get(`${MPESA_API_URL}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${auth}` },
    });
    return response.data.access_token;
}

app.post('/api/initiate-mpesa-payment', async (req, res) => {
    try {
        const { phoneNumber, amount, accountNumber } = req.body;
        const accessToken = await getAccessToken();

        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
        const password = Buffer.from(`${BUSINESS_SHORT_CODE}${PASSKEY}${timestamp}`).toString('base64');

        const response = await axios.post(
            `${MPESA_API_URL}/mpesa/stkpush/v1/processrequest`,
            {    
                "BusinessShortCode": "174379",    
                "Password": "MTc0Mzc5YmZiMjc5ZjlhYTliZGJjZjE1OGU5N2RkNzFhNDY3Y2QyZTBjODkzMDU5YjEwZjc4ZTZiNzJhZGExZWQyYzkxOTIwMTYwMjE2MTY1NjI3",    
                "Timestamp":"20160216165627",    
                "TransactionType": "CustomerPayBillOnline",    
                "Amount": "1",    
                "PartyA":"254708374149",    
                "PartyB":"174379",    
                "PhoneNumber":"254708374149",    
                "CallBackURL": "https://mydomain.com/pat",    
                "AccountReference":"Test",    
                "TransactionDesc":"Test"
             }
        );

        // Store transaction details in Firebase Realtime Database
        await admin.database().ref('mpesa_transactions').push({
            checkoutRequestID: response.data.CheckoutRequestID,
            phoneNumber,
            amount,
            accountNumber,
            status: 'pending',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        res.json({
            success: true,
            transactionId: response.data.CheckoutRequestID,
        });
    } catch (error) {
        console.error('Error initiating M-Pesa payment:', error);
        res.status(500).json({ success: false, error: 'Failed to initiate payment' });
    }
});

app.get('/api/check-payment-status', async (req, res) => {
    try {
        const { transactionId } = req.query;
        const snapshot = await admin.database().ref('mpesa_transactions')
            .orderByChild('checkoutRequestID')
            .equalTo(transactionId)
            .once('value');
        
        if (snapshot.exists()) {
            const transaction = Object.values(snapshot.val())[0];
            res.json({ status: transaction.status });
        } else {
            res.status(404).json({ error: 'Transaction not found' });
        }
    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({ error: 'Failed to check payment status' });
    }
});

app.post('/mpesa-callback', async (req, res) => {
    try {
        const { Body } = req.body;
        const { stkCallback } = Body;
        const { CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;

        const snapshot = await admin.database().ref('mpesa_transactions')
            .orderByChild('checkoutRequestID')
            .equalTo(CheckoutRequestID)
            .once('value');

        if (snapshot.exists()) {
            const key = Object.keys(snapshot.val())[0];
            await admin.database().ref(`mpesa_transactions/${key}`).update({
                status: ResultCode === 0 ? 'completed' : 'failed',
                resultDescription: ResultDesc,
                updatedAt: admin.database.ServerValue.TIMESTAMP
            });
        }

        res.json({ result: 'Success' });
    } catch (error) {
        console.error('Error processing M-Pesa callback:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));