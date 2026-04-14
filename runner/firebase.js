const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyD8iK-dkLYeK6HqDRyLELXQyUR3JY57YRs",
  authDomain: "jgujy-23d7b.firebaseapp.com",
  projectId: "jgujy-23d7b",
  storageBucket: "jgujy-23d7b.firebasestorage.app",
  messagingSenderId: "200620171636",
  appId: "1:200620171636:web:052da9512f0c4e1f09cc21",
  measurementId: "G-KT5YFWFBDE"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

module.exports = { app, db };

