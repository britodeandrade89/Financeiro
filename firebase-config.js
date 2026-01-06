
// @ts-nocheck
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, enableMultiTabIndexedDbPersistence } from "firebase/firestore";

// Configuração atualizada com as novas chaves do projeto 'chaveunica-225e0'
const firebaseConfig = {
  apiKey: "AIzaSyD_C_yn_RyBSopY7Tb9aqLW8akkXJR94Vg",
  authDomain: "chaveunica-225e0.firebaseapp.com",
  projectId: "chaveunica-225e0",
  storageBucket: "chaveunica-225e0.firebasestorage.app",
  messagingSenderId: "324211037832",
  appId: "1:324211037832:web:362a46e6446ea37b85b13d",
  measurementId: "G-MRBDJC3QXZ"
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
    
    console.log("Firebase conectado com sucesso ao projeto: " + firebaseConfig.projectId);
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
