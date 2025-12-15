// @ts-nocheck
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ====================================================================================
// GUIA RÁPIDO DE CONFIGURAÇÃO DO FIREBASE
// ====================================================================================
// Para que a sincronização na nuvem funcione, você precisa criar seu próprio
// projeto no Firebase (é gratuito) e colar suas chaves de configuração aqui.
//
// PASSO 1: CRIE O PROJETO
//   - Acesse: https://console.firebase.google.com/
//   - Clique em "Criar um projeto" e siga as instruções.
//
// PASSO 2: PEGUE SUAS CHAVES DA WEB
//   - Dentro do seu projeto, vá em "Configurações do projeto" (ícone de ⚙️).
//   - Role para baixo até "Seus apps" e clique no ícone da Web (</>).
//   - Dê um apelido e registre o app. O Firebase vai te mostrar o objeto "firebaseConfig".
//   - Copie os valores desse objeto e cole nos campos correspondentes abaixo.
//
// PASSO 3: ATIVE OS SERVIÇOS
//   - No menu à esquerda, vá em "Build" > "Firestore Database" > "Criar banco de dados" (inicie em modo de produção).
//   - No menu à esquerda, vá em "Build" > "Authentication" > "Sign-in method" > Ative a opção "Anônimo".
//
// PRONTO! Seu app estará conectado à nuvem.
// ====================================================================================


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
// ▲▲▲ COLE SUAS CHAVES DO FIREBASE AQUI ▲▲▲


// --- Não altere o código abaixo ---
let app, auth, db;

// Verifica se a configuração foi preenchida.
const isConfigured = firebaseConfig.apiKey && firebaseConfig.apiKey.startsWith("AIza") && firebaseConfig.projectId && firebaseConfig.projectId !== "your-project-id";

if (isConfigured) {
  try {
    // Inicializa o Firebase
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    console.log("Firebase conectado com sucesso!");
  } catch (error) {
    console.error("Erro ao inicializar o Firebase. Verifique sua configuração.", error);
    auth = null;
    db = null;
  }
} else {
  console.warn("Firebase não está configurado. O aplicativo será executado em modo local. Atualize o firebase-config.js para habilitar a sincronização na nuvem.");
  auth = null;
  db = null;
}

// Exporta as variáveis para serem usadas em outros arquivos
export { db, auth, isConfigured, firebaseConfig };