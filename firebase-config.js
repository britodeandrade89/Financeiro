// @ts-nocheck
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, enableMultiTabIndexedDbPersistence } from "firebase/firestore";

// ▼▼▼ COLE SUAS CHAVES DO FIREBASE AQUI ▼▼▼
const firebaseConfig = {
  apiKey: "AIzaSyCJ9K6sovkNzeO_fuQbSPD9LnIUG0p8Da4",
  authDomain: "financas-bispo-brito.firebaseapp.com",
  projectId: "financas-bispo-brito",
  storageBucket: "financas-bispo-brito.firebasestorage.app",
  messagingSenderId: "159834229207",
  appId: "1:159834229207:web:290d078ad03c2e025be392",
  measurementId: "G-J5VVC29364"
};

let app, auth, db;

const isConfigured = firebaseConfig.apiKey && firebaseConfig.apiKey.startsWith("AIza") && firebaseConfig.projectId && firebaseConfig.projectId !== "your-project-id";

if (isConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    
    // Habilitar persistência offline nativa do Firestore
    enableMultiTabIndexedDbPersistence(db).catch((err) => {
        if (err.code == 'failed-precondition') {
            console.warn("Múltiplas abas abertas, persistência habilitada apenas na primeira.");
        } else if (err.code == 'unimplemented') {
            console.warn("O navegador atual não suporta persistência offline.");
        }
    });
    
    console.log("Firebase conectado com sucesso!");
  } catch (error) {
    console.error("Erro ao inicializar o Firebase.", error);
    auth = null;
    db = null;
  }
} else {
  console.warn("Firebase não está configurado.");
  auth = null;
  db = null;
}

export { db, auth, isConfigured, firebaseConfig };