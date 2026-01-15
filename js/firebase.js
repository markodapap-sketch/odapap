 // Import the functions you need from the SDKs you need
import { getAuth } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries
//  import dotenv from './dotenv'; 

 // dotenv.config();
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyBc-ujBFH8ysXZ7xaPaNdvD_i4-ivthnnU",
    authDomain: "oda-pap-d44c2.firebaseapp.com",
    databaseURL: "https://oda-pap-d44c2-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "oda-pap-d44c2",
    storageBucket: "oda-pap-d44c2.firebasestorage.app",
    messagingSenderId: "516981877774",
    appId: "1:516981877774:web:1d5532749958218dbae05f",
    measurementId: "G-KRSVFTQZK4"
  };

  // Initialize Firebase
 
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
export const firestore = getFirestore(app);
export const db = getFirestore(app);
export const storage = getStorage(app);


