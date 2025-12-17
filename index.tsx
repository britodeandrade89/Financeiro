import { GoogleGenAI } from "@google/genai";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { db, auth, isConfigured } from "./firebase-config.js";

// -- VARIÁVEIS GLOBAIS --
let currentMonth = new Date().getMonth() + 1;
let currentYear = new Date().getFullYear();
let currentMonthData: any = null;
let currentUser: any = null;
let isOfflineMode = !isConfigured;
let isBalanceVisible = true;
let unsubscribeSnapshot: any = null;
let unsubscribeProfile: any = null;

// ID COMPARTILHADO DA FAMÍLIA (CHAVE ÚNICA)
const FAMILY_ID = 'gen-lang-client-0669556100';

// INICIALIZAÇÃO DA IA
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Calendário Oficial 2025
const PAYMENT_SCHEDULE_2025: Record<number, string> = {
    1: '2025-01-23', 
    2: '2025-02-21', 
    3: '2025-03-21', 
    4: '2025-04-22', 
    5: '2025-05-23', 
    6: '2025-06-23', 
    7: '2025-07-23', 
    8: '2025-08-22', 
    9: '2025-09-23', 
    10: '2025-10-23', 
    11: '2025-11-28', // Ajustado: Pagamento de Nov cai dia 28 (para uso em Dezembro)
    12: '2025-12-23'
};

// -- FUNÇÕES AUXILIARES --
function getEl(id: string) { return document.getElementById(id); }

function formatCurrency(val: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function getCategoryIcon(cat: string) {
    const icons: any = {
        'Salário': '💰', 'Mumbuca': '💳', 'Moradia': '🏠', 'Alimentação': '🛒',
        'Transporte': '🚗', 'Saúde': '💊', 'Educação': '📚', 'Lazer': '🎉',
        'Dívidas': '💸', 'Investimento': '📈', 'Abastecimento': '⛽',
        'Doação': '🎁', 'Renda Extra': '💵'
    };
    return icons[cat] || '📝';
}

function getMonthName(month: number) {
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return months[month - 1] || '';
}

// -- GERENCIAMENTO DE DADOS --

function getMonthKey(year: number = currentYear, month: number = currentMonth) {
    return `${year}-${month.toString().padStart(2, '0')}`;
}

function getMonthDataSync(year: number, month: number) {
    const key = `financeData_${year}_${month}`;
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : null;
}

async function createNewMonthData() {
    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth === 0) { prevMonth = 12; prevYear = currentYear - 1; }

    const prevMonthData = getMonthDataSync(prevYear, prevMonth);
    
    const newMonthData = {
        incomes: [] as any[],
        expenses: [] as any[],
        shoppingItems: [],
        avulsosItems: [],
        goals: prevMonthData?.goals || [
            { id: "goal_1", category: "Moradia", amount: 2200 },
            { id: "goal_2", category: "Saúde", amount: 1200 },
            { id: "goal_3", category: "Transporte", amount: 1000 },
            { id: "goal_4", category: "Dívidas", amount: 1500 },
            { id: "goal_5", category: "Lazer", amount: 600 },
        ],
        savingsGoals: prevMonthData?.savingsGoals || [],
        bankAccounts: prevMonthData?.bankAccounts || [
            { id: 'acc_main', name: 'Conta Principal', balance: 0 },
            { id: 'acc_mum', name: 'Mumbuca', balance: 0 }
        ]
    };

    // ---------------------------------------------------------
    // LÓGICA DE SALÁRIO: REGIME DE CAIXA
    // O salário do mês X (ex: Dezembro) é financiado pelo pagamento
    // recebido no mês X-1 (ex: Novembro).
    // ---------------------------------------------------------
    
    // 1. Determina o Mês de Referência (O mês anterior)
    let refMonth = currentMonth - 1;
    let refYear = currentYear;
    if (refMonth === 0) {
        refMonth = 12;
        refYear = currentYear - 1;
    }

    // 2. Busca a data de pagamento desse Mês de Referência
    // Ex: Se estamos em Dezembro, buscamos a data do mês 11 (28/11)
    let salaryDate = '';
    if (refYear === 2025 && PAYMENT_SCHEDULE_2025[refMonth]) {
        salaryDate = PAYMENT_SCHEDULE_2025[refMonth];
    } else {
        const day = 23; 
        salaryDate = `${refYear}-${refMonth.toString().padStart(2, '0')}-${day}`;
    }

    // 3. Nome do Mês de Referência para a descrição
    const monthNameRef = getMonthName(refMonth); 

    newMonthData.incomes.push(
        { id: `inc_sal_m_${Date.now()}`, description: `SALARIO MARCELLY (Ref. ${monthNameRef})`, amount: 3349.92, paid: false, date: salaryDate, category: 'Salário' },
        { id: `inc_sal_a_${Date.now()}`, description: `SALARIO ANDRE (Ref. ${monthNameRef})`, amount: 3349.92, paid: false, date: salaryDate, category: 'Salário' }
    );
    
    // Mumbuca mantido no mês corrente (dia 15) como auxílio de consumo imediato
    newMonthData.incomes.push(
        { id: `inc_mum_m_${Date.now()}`, description: 'MUMBUCA MARCELLY', amount: 650.00, paid: false, date: `${currentYear}-${currentMonth.toString().padStart(2,'0')}-15`, category: 'Mumbuca' },
        { id: `inc_mum_a_${Date.now()}`, description: 'MUMBUCA ANDRE', amount: 650.00, paid: false, date: `${currentYear}-${currentMonth.toString().padStart(2,'0')}-15`, category: 'Mumbuca' }
    );

    // 13º Salário (Mantido nas datas específicas do calendário)
    // Julho (1ª Parcela paga em Julho para gastar em Julho/Agosto)
    if (currentMonth === 7) {
        // Data baseada em Julho
        let date13_1 = (currentYear === 2025 && PAYMENT_SCHEDULE_2025[7]) ? PAYMENT_SCHEDULE_2025[7] : `${currentYear}-07-23`;
         newMonthData.incomes.push(
            { id: `inc_13_1_m_${Date.now()}`, description: `1ª PARCELA 13º MARCELLY`, amount: 1674.96, paid: false, date: date13_1, category: 'Salário' },
            { id: `inc_13_1_a_${Date.now()}`, description: `1ª PARCELA 13º ANDRE`, amount: 1674.96, paid: false, date: date13_1, category: 'Salário' }
        );
        
        // PERDA EM APOSTAS - 1ª PARCELA
        newMonthData.avulsosItems.push({
            id: `avl_bet_loss_1_${Date.now()}`,
            description: "PERDA EM APOSTAS (13º SALÁRIO)",
            amount: 1674.96,
            category: "Lazer",
            paid: true,
            date: date13_1,
            sourceAccount: 'acc_main'
        });
    }
    // Dezembro (2ª Parcela paga dia 20 de Dezembro)
    if (currentMonth === 12) { 
         const date13_2 = `${currentYear}-12-20`;
         newMonthData.incomes.push(
            { id: `inc_13_2_m_${Date.now()}`, description: `2ª PARCELA 13º MARCELLY`, amount: 1674.96, paid: false, date: date13_2, category: 'Salário' },
            { id: `inc_13_2_a_${Date.now()}`, description: `2ª PARCELA 13º ANDRE`, amount: 1674.96, paid: false, date: date13_2, category: 'Salário' }
        );

        // PERDA EM APOSTAS - 2ª PARCELA
        newMonthData.avulsosItems.push({
            id: `avl_bet_loss_2_${Date.now()}`,
            description: "PERDA EM APOSTAS (13º SALÁRIO)",
            amount: 1674.96,
            category: "Lazer",
            paid: true,
            date: date13_2,
            sourceAccount: 'acc_main'
        });
    }

    const cyclicalExpenses = [
        { description: "ALUGUEL", amount: 1300.00, category: "Moradia", day: 1, initialPaid: true },
        { description: "CONTA DA CLARO", amount: 55.00, category: "Moradia", day: 5 },
        { description: "CONTA DA VIVO - ANDRÉ", amount: 35.00, category: "Moradia", day: 5 },
        { description: "PSICÓLOGA DA MARCELLY", amount: 280.00, category: "Saúde", day: 10 }, 
        { description: "INTERMÉDICA DO ANDRÉ (MARCIA BRITO)", amount: 123.00, category: "Saúde", day: 15 },
        { description: "INTERNET DE CASA", amount: 125.00, category: "Moradia", day: 18, initialPaid: true },
        { description: "CIDADANIA PORTUGUESA (REBECCA BRITO)", amount: 140.00, category: "Dívidas", day: 20, initialPaid: true },
        { description: "APPAI DO ANDRÉ (MARCIA BRITO)", amount: 123.55, category: "Saúde", day: 20 },
        { description: "SEGURO DO CARRO (SEPARAR NO SOFISA)", amount: 143.00, category: "Transporte", day: 20 },
        // MÁRCIA BISPO: Alterado para false para aparecer nos repasses pendentes
        { description: "APPAI DA MARCELLY (MÁRCIA BISPO)", amount: 110.00, category: "Saúde", day: 23, initialPaid: false }, 
        { description: "CONTA DA VIVO - MARCELLY", amount: 66.60, category: "Moradia", day: 23, initialPaid: true },
        { description: "FATURA DO CARTÃO DO ANDRÉ (ITAÚ)", amount: 100.00, category: "Outros", day: 24 },
        { description: "FATURA DO CARTÃO DO ANDRÉ (INTER)", amount: 100.00, category: "Outros", day: 24 }
    ];

    const variableExpensesFinite = [
        { description: "FACULDADE DA MARCELLY (MARCIA BRITO)", amount: 202.68, category: "Educação", day: 12, totalInstallments: 10 },
        { description: "RENEGOCIAR CARREFOUR (MARCIA BRITO)", amount: 312.50, category: "Dívidas", day: 28, totalInstallments: 12 },
        { description: "MULTAS (MARCIA BRITO)", amount: 260.00, category: "Transporte", day: 30, totalInstallments: 4 }, 
        { description: "PASSAGENS AÉREAS (LILI)", amount: 504.87, category: "Lazer", day: 15, totalInstallments: 6 },
        { description: "EMPRÉSTIMO TIA CÉLIA", amount: 100.00, category: "Dívidas", day: 10, totalInstallments: 10 },
        // NOVO ITEM: Conserto do Carro (Outubro)
        { description: "CONSERTO DO CARRO E PEÇAS (OUTUBRO) (MARCIA BRITO)", amount: 361.75, category: "Transporte", day: 10, totalInstallments: 4 }
    ];

    const remediosAmount = (currentMonth % 2 !== 0) ? 500.00 : 0.00;
    
    const createExpense = (desc: string, amount: number, cat: string, day: number, initialPaid: boolean, installments?: any) => ({
        id: `exp_${Date.now()}_${Math.random()}`,
        description: desc,
        amount: amount,
        category: cat,
        type: installments ? "variable" : "fixed",
        isRecurring: !installments,
        paid: initialPaid || false,
        paidDate: initialPaid ? new Date().toISOString().split('T')[0] : null,
        dueDate: `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${(day || 10).toString().padStart(2, '0')}`,
        sourceAccount: 'acc_main',
        installments: installments || null
    });


    if (prevMonthData && prevMonthData.expenses && prevMonthData.expenses.length > 0) {
        prevMonthData.expenses.forEach((prevItem: any) => {
            if (prevItem.description.includes("REMÉDIOS DO ANDRÉ")) return;

            const masterItem = cyclicalExpenses.find(c => prevItem.description.startsWith(c.description));
            if (masterItem) {
                newMonthData.expenses.push(createExpense(masterItem.description, masterItem.amount, masterItem.category, masterItem.day, false));
                return;
            }

            if (prevItem.installments && prevItem.installments.total > 0) {
                const nextInst = prevItem.installments.current + 1;
                if (nextInst <= prevItem.installments.total) {
                    const newItem = { ...prevItem };
                    newItem.id = `exp_${Date.now()}_${Math.random()}`;
                    newItem.paid = false;
                    newItem.paidDate = null;
                    const day = newItem.dueDate ? newItem.dueDate.split('-')[2] : '10';
                    newItem.dueDate = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${day}`;
                    newItem.installments = { current: nextInst, total: prevItem.installments.total };
                    newItem.description = newItem.description.replace(/\(\d+\/\d+\)/, `(${nextInst}/${prevItem.installments.total})`);
                    newMonthData.expenses.push(newItem);
                }
            } 
            else if (prevItem.type === 'fixed' || prevItem.isRecurring) {
                const newItem = { ...prevItem };
                newItem.id = `exp_${Date.now()}_${Math.random()}`;
                newItem.paid = false;
                newItem.paidDate = null;
                const day = newItem.dueDate ? newItem.dueDate.split('-')[2] : '10';
                newItem.dueDate = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${day}`;
                newMonthData.expenses.push(newItem);
            }
        });

    } else {
        cyclicalExpenses.forEach(def => {
            newMonthData.expenses.push(createExpense(def.description, def.amount, def.category, def.day, def.initialPaid || false));
        });

        variableExpensesFinite.forEach(def => {
            let startInstallment = 1;
            let isPaid = false;
            let shouldAdd = true;

            if (def.description === "EMPRÉSTIMO TIA CÉLIA") { 
                startInstallment = 5; 
            }
            if (def.description.includes("MULTAS")) {
                startInstallment = 3;
                isPaid = true;
            }
            if (def.description.includes("FACULDADE")) {
                isPaid = true;
            }

            // Lógica Específica para Conserto do Carro:
            // Ajuste solicitado: Este mês é a parcela 2/4.
            if (def.description.includes("CONSERTO DO CARRO")) {
                startInstallment = 2;
            }

            // Lógica Específica para Renegociar Carrefour:
            // Ajuste: Iniciar na parcela 2 neste mês.
            if (def.description.includes("RENEGOCIAR CARREFOUR")) {
                startInstallment = 2;
            }

            if (shouldAdd) {
                const desc = `${def.description} (${startInstallment}/${def.totalInstallments})`;
                newMonthData.expenses.push(createExpense(desc, def.amount, def.category, def.day, isPaid, { current: startInstallment, total: def.totalInstallments }));
            }
        });
    }

    newMonthData.expenses.push(createExpense(
        "REMÉDIOS DO ANDRÉ (SEPARAR NO SOFISA)", 
        remediosAmount, 
        "Saúde", 
        5, 
        false
    ));

    currentMonthData = newMonthData;
    saveData();
}

async function loadData() {
    const key = `financeData_${currentYear}_${currentMonth}`;
    if (isOfflineMode) {
        const saved = localStorage.getItem(key);
        if (saved) {
            currentMonthData = JSON.parse(saved);
        } else {
            await createNewMonthData();
        }
        updateUI();
    }
}

function setupRealtimeListener() {
    if (!currentUser) return;
    const docRef = doc(db, 'families', FAMILY_ID, 'months', getMonthKey());
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    unsubscribeSnapshot = onSnapshot(docRef, async (docSnap) => {
        if (docSnap.exists()) {
            currentMonthData = docSnap.data();
            updateUI();
        } else {
            await createNewMonthData();
        }
    });

    const profileRef = doc(db, 'families', FAMILY_ID, 'settings', 'profile');
    if (unsubscribeProfile) unsubscribeProfile();
    unsubscribeProfile = onSnapshot(profileRef, (docSnap) => {
        if (docSnap.exists() && docSnap.data().image) {
            const imgEl = getEl('profileImageDisplay') as HTMLImageElement;
            if (imgEl) imgEl.src = docSnap.data().image;
        }
    });
}

function setupProfilePicture() {
    const triggerBtn = getEl('coupleAvatarBtn');
    const fileInput = getEl('profileUploadInput') as HTMLInputElement;

    if (triggerBtn && fileInput) {
        triggerBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    const MAX_SIZE = 300;
                    let width = img.width;
                    let height = img.height;
                    
                    if (width > height) {
                        if (width > MAX_SIZE) {
                            height *= MAX_SIZE / width;
                            width = MAX_SIZE;
                        }
                    } else {
                        if (height > MAX_SIZE) {
                            width *= MAX_SIZE / height;
                            height = MAX_SIZE;
                        }
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, width, height);
                        const base64 = canvas.toDataURL('image/jpeg', 0.8);
                        
                        if (!isOfflineMode && currentUser) {
                             const profileRef = doc(db, 'families', FAMILY_ID, 'settings', 'profile');
                             setDoc(profileRef, { image: base64 }, { merge: true });
                        }
                        
                        const imgEl = getEl('profileImageDisplay') as HTMLImageElement;
                        if(imgEl) imgEl.src = base64;
                    }
                };
                img.src = event.target?.result as string;
            };
            reader.readAsDataURL(file);
        });
    }
}

async function saveData() {
    if (!currentMonthData) return;
    
    if (!currentMonthData.avulsosItems) currentMonthData.avulsosItems = [];
    if (!currentMonthData.shoppingItems) currentMonthData.shoppingItems = [];
    
    updateUI();

    if (isOfflineMode) {
        const key = `financeData_${currentYear}_${currentMonth}`;
        localStorage.setItem(key, JSON.stringify(currentMonthData));
    } else if (currentUser) {
        const docRef = doc(db, 'families', FAMILY_ID, 'months', getMonthKey());
        await setDoc(docRef, currentMonthData);
    }
}

// -- UPDATE UI --
function updateUI() {
    if (!currentMonthData) return;
    updateDateDisplay();

    // 1. Calcular Totais
    const incomes = currentMonthData.incomes || [];
    const expenses = currentMonthData.expenses || [];
    
    // Itens Mumbuca (Shopping + Avulsos que são da conta Mumbuca)
    const mumbucaItems = [
        ...(currentMonthData.shoppingItems || []),
        ...(currentMonthData.avulsosItems || []).filter((i: any) => i.sourceAccount === 'acc_mum')
    ];

    // Itens Avulsos da Conta Principal (Ex: Perda de Apostas, Abastecimentos pagos em dinheiro/débito)
    // Estes devem ser somados às despesas gerais para reduzir o balanço.
    const avulsosMainItems = (currentMonthData.avulsosItems || []).filter((i: any) => i.sourceAccount !== 'acc_mum');
    
    const salaryIncome = incomes.filter((i: any) => i.category === 'Salário' || i.category === 'Doação' || i.category === 'Renda Extra').reduce((acc: number, i: any) => acc + i.amount, 0);
    const mumbucaIncome = incomes.filter((i: any) => i.category === 'Mumbuca').reduce((acc: number, i: any) => acc + i.amount, 0);
    
    // Despesas Pagas = Despesas Fixas/Var Pagas + Avulsos da Conta Principal Pagos
    const paidExpenses = expenses.filter((i: any) => i.paid).reduce((acc: number, i: any) => acc + i.amount, 0)
                         + avulsosMainItems.filter((i: any) => i.paid).reduce((acc: number, i: any) => acc + i.amount, 0);
    
    // Despesas Pendentes = Despesas Fixas/Var Pendentes + Avulsos da Conta Principal Pendentes
    const pendingExpenses = expenses.filter((i: any) => !i.paid).reduce((acc: number, i: any) => acc + i.amount, 0)
                            + avulsosMainItems.filter((i: any) => !i.paid).reduce((acc: number, i: any) => acc + i.amount, 0);
    
    const mumbucaPaid = mumbucaItems.filter((i: any) => i.paid).reduce((acc: number, i: any) => acc + i.amount, 0);
    const mumbucaPending = mumbucaItems.filter((i: any) => !i.paid).reduce((acc: number, i: any) => acc + i.amount, 0);

    // Lógica Atualizada para Repasses (Mostrar Pago e Pendente)
    const repassesStats: Record<string, { paid: number, pending: number }> = {};
    
    // Iterar sobre TODAS as despesas (pagas e pendentes)
    expenses.forEach((item: any) => {
        const matches = item.description.match(/\((.*?)\)/g);
        if (matches) {
            matches.forEach((match: string) => {
                const content = match.replace(/[()]/g, '').trim();
                // Ignorar referências de parcelas (ex: 1/12) e Ref. mês
                if (/^\d+\s*\/\s*\d+$/.test(content)) return;
                if (content.toLowerCase().startsWith('ref.')) return;
                
                let nameKey = content.toUpperCase();
                
                // CORREÇÃO: Normalizar MÁRCIA para MARCIA para agrupar corretamente
                if (nameKey === 'MÁRCIA BRITO') nameKey = 'MARCIA BRITO';
                
                if (!repassesStats[nameKey]) {
                    repassesStats[nameKey] = { paid: 0, pending: 0 };
                }

                if (item.paid) {
                    repassesStats[nameKey].paid += item.amount;
                } else {
                    repassesStats[nameKey].pending += item.amount;
                }
            });
        }
    });

    const repassesContainer = getEl('repassesDynamicContainer');
    if (repassesContainer) {
        repassesContainer.innerHTML = ''; 
        const names = Object.keys(repassesStats).sort();
        names.forEach(name => {
             const stats = repassesStats[name];
             const total = stats.paid + stats.pending;
             
             const div = document.createElement('div');
             div.className = 'summary-card card-bg-purple'; 
             div.style.flex = "1 1 calc(50% - 0.5rem)"; 
             div.style.minWidth = "150px"; // Slightly wider for new layout

             div.innerHTML = `
                <div class="summary-header"><div class="summary-title">Repasse ${name}</div></div>
                
                <div class="stats-grid" style="margin-top: 0.5rem; width: 100%;">
                    <div class="stat-box">
                        <span class="stat-label">Já Pago</span>
                        <span class="stat-val success">${formatCurrency(stats.paid)}</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-label">Falta</span>
                        <span class="stat-val danger">${formatCurrency(stats.pending)}</span>
                    </div>
                </div>
                
                <div style="text-align: center; font-size: 0.7rem; color: var(--text-light); margin-top: 6px; font-weight: 500;">
                    Total: ${formatCurrency(total)}
                </div>
             `;
             repassesContainer.appendChild(div);
        });
    }

    const updateText = (id: string, text: string) => { const el = getEl(id); if (el) el.textContent = text; };
    const updateBar = (id: string, current: number, total: number) => { 
        const el = getEl(id); 
        if (el) el.style.width = `${total > 0 ? Math.min((current/total)*100, 100) : 0}%`; 
    };

    updateText('salaryTotalDisplay', formatCurrency(salaryIncome));
    updateText('salaryIncome', formatCurrency(incomes.filter((i: any) => (i.category === 'Salário' || i.category === 'Doação' || i.category === 'Renda Extra') && i.paid).reduce((a:number, b:any)=>a+b.amount,0)));
    updateText('salaryPendingValue', formatCurrency(incomes.filter((i: any) => (i.category === 'Salário' || i.category === 'Doação' || i.category === 'Renda Extra') && !i.paid).reduce((a:number, b:any)=>a+b.amount,0)));
    updateBar('salaryIncomeProgressBar', incomes.filter((i: any) => (i.category === 'Salário' || i.category === 'Doação' || i.category === 'Renda Extra') && i.paid).reduce((a:number, b:any)=>a+b.amount,0), salaryIncome);
    
    updateText('expensesTotalDisplay', formatCurrency(paidExpenses + pendingExpenses));
    updateText('fixedVariableExpenses', formatCurrency(paidExpenses));
    updateText('expensesPendingValue', formatCurrency(pendingExpenses));
    updateBar('fixedVariableExpensesProgressBar', paidExpenses, paidExpenses + pendingExpenses);

    const remainder = salaryIncome - (paidExpenses + pendingExpenses);
    updateText('salaryRemainder', formatCurrency(remainder));
    updateBar('salaryRemainderProgressBar', Math.max(0, remainder), salaryIncome);

    updateText('mumbucaTotalDisplay', formatCurrency(mumbucaIncome));
    updateText('mumbucaIncome', formatCurrency(incomes.filter((i: any) => i.category === 'Mumbuca' && i.paid).reduce((a:number, b:any)=>a+b.amount,0)));
    updateBar('mumbucaIncomeProgressBar', incomes.filter((i: any) => i.category === 'Mumbuca' && i.paid).reduce((a:number, b:any)=>a+b.amount,0), mumbucaIncome);
    
    updateText('mumbucaExpensesTotalDisplay', formatCurrency(mumbucaPaid + mumbucaPending));
    updateText('mumbucaExpenses', formatCurrency(mumbucaPaid));
    updateText('mumbucaExpensesPendingValue', formatCurrency(mumbucaPending));
    updateBar('mumbucaExpensesProgressBar', mumbucaPaid, mumbucaPaid + mumbucaPending);

    updateText('generalTotalIncome', formatCurrency(salaryIncome + mumbucaIncome));
    updateText('generalTotalExpenses', formatCurrency(paidExpenses + pendingExpenses + mumbucaPaid + mumbucaPending));

    const totalBalance = (currentMonthData.bankAccounts || []).reduce((acc: number, b: any) => acc + b.balance, 0);
    const headerBalance = getEl('headerBalanceValue');
    if (headerBalance) headerBalance.textContent = isBalanceVisible ? formatCurrency(totalBalance) : '••••••';
    
    const mumAcc = (currentMonthData.bankAccounts || []).find((a: any) => a.name === 'Mumbuca');
    updateText('mumbucaBalance', formatCurrency(mumAcc ? mumAcc.balance : 0));
    
    renderBankAccounts();
    renderList(getEl('incomesList'), incomes, 'incomes');
    renderList(getEl('expensesList'), expenses, 'expenses');
    renderList(getEl('comprasMumbucaList'), currentMonthData.shoppingItems, 'shoppingItems');
    renderList(getEl('abastecimentoMumbucaList'), (currentMonthData.avulsosItems || []).filter((i: any) => i.category === 'Abastecimento'), 'avulsosItems');
    renderList(getEl('avulsosList'), (currentMonthData.avulsosItems || []).filter((i: any) => i.category !== 'Abastecimento'), 'avulsosItems');
    renderGoals();
    renderSavingsGoals();
}

function updateDateDisplay() {
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const monthDisplay = getEl('monthDisplay');
    if (monthDisplay) monthDisplay.textContent = `${months[currentMonth - 1]} ${currentYear}`;
    
    const dateDisplay = getEl('currentDateDisplay');
    if (dateDisplay) {
        const now = new Date();
        const str = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
        dateDisplay.textContent = str.charAt(0).toUpperCase() + str.slice(1);
    }
}

function renderList(container: HTMLElement | null, items: any[], listType: string) {
    if (!container) return;
    container.innerHTML = '';
    
    if (!items || items.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-light); opacity: 0.7;">Nenhum item lançado</div>`;
        return;
    }

    if (listType === 'expenses') {
        const fixedItems = items.filter(i => i.type === 'fixed' || (!i.installments && i.type !== 'variable'));
        const variableItems = items.filter(i => i.type === 'variable' || i.installments);

        fixedItems.sort((a, b) => a.description.localeCompare(b.description));
        variableItems.sort((a, b) => a.description.localeCompare(b.description));

        if (fixedItems.length > 0) {
            const header = document.createElement('div');
            header.className = 'list-section-title fixed';
            header.textContent = 'Dívidas Fixas';
            container.appendChild(header);
            fixedItems.forEach(item => container.appendChild(createItemCard(item, 'expenses', 'expense-fixed')));
        }

        if (variableItems.length > 0) {
            const header = document.createElement('div');
            header.className = 'list-section-title variable';
            header.textContent = 'Dívidas Variáveis';
            container.appendChild(header);
            variableItems.forEach(item => container.appendChild(createItemCard(item, 'expenses', 'expense-variable')));
        }
        return;
    }

    const sorted = [...items].sort((a, b) => {
        if (listType === 'incomes') {
            const isSalA = (a.category || '').includes('Salário');
            const isSalB = (b.category || '').includes('Salário');
            if (isSalA && !isSalB) return -1;
            if (!isSalA && isSalB) return 1;
        }
        const dateA = a.dueDate || a.date || '2099-12-31';
        const dateB = b.dueDate || b.date || '2099-12-31';
        return dateA.localeCompare(dateB);
    });

    sorted.forEach(item => {
        container.appendChild(createItemCard(item, listType, listType === 'incomes' ? 'income' : 'standard'));
    });
}

function createItemCard(item: any, listType: string, customClass: string) {
    const div = document.createElement('div');
    div.className = `item type-${listType === 'incomes' ? 'income' : 'expense'} ${customClass} ${item.paid ? 'paid' : ''}`;
    
    const dateStr = item.dueDate || item.date || '';
    const [y, m, d] = dateStr.split('-');
    
    const footerInfo = `
        <div class="item-meta">
            <span style="font-weight:600; margin-right: 8px;">📅 ${d}/${m}</span>
            <span>${getCategoryIcon(item.category)} ${item.category}</span>
            ${item.installments ? `<span class="installment-badge">${item.installments.current}/${item.installments.total}</span>` : ''}
        </div>
    `;

    div.innerHTML = `
        <div class="item-left-col">
                <label class="switch">
                <input type="checkbox" ${item.paid ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
        </div>
        <div class="item-info-wrapper">
            <div class="item-primary-info">
                    <span class="item-description ${item.paid ? 'paid' : ''}">${item.description}</span>
                    <span class="item-amount ${listType === 'incomes' ? 'income-amount' : 'expense-amount'}">R$ ${item.amount.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
            </div>
            <div class="item-secondary-info">
                    ${footerInfo}
            </div>
        </div>
    `;

    // Click no item abre edição - ATUALIZADO
    div.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.switch')) return;
        openEditModal(item, listType);
    });

    const checkbox = div.querySelector('input[type="checkbox"]');
    checkbox?.addEventListener('change', (e: any) => {
        item.paid = e.target.checked;
        if (item.paid) item.paidDate = new Date().toISOString().split('T')[0];
        else item.paidDate = null;
        saveData(); 
    });

    return div;
}

function renderBankAccounts() {
    const list = getEl('bankAccountsList');
    if (!list || !currentMonthData) return;
    list.innerHTML = '';
    
    let total = 0;
    (currentMonthData.bankAccounts || []).forEach((acc: any) => {
        total += acc.balance;
        const div = document.createElement('div');
        div.className = 'account-item';
        div.innerHTML = `
            <div class="account-name">${acc.name}</div>
            <div class="account-balance">${formatCurrency(acc.balance)}</div>
        `;
        div.addEventListener('click', () => {
             const idInput = getEl('accountId') as HTMLInputElement;
             const nameInput = getEl('accountName') as HTMLInputElement;
             const balInput = getEl('accountBalance') as HTMLInputElement;
             if(idInput) idInput.value = acc.id;
             if(nameInput) nameInput.value = acc.name;
             if(balInput) balInput.value = acc.balance.toString();
             const modal = getEl('accountModal');
             if(modal) modal.style.display = 'flex';
        });
        list.appendChild(div);
    });
    const totalEl = getEl('accountsTotalValue');
    if(totalEl) totalEl.textContent = formatCurrency(total);
}

function renderGoals() {
    const list = getEl('goalsList');
    if (!list || !currentMonthData) return;
    list.innerHTML = '';
    
    (currentMonthData.goals || []).forEach((goal: any) => {
        let spent = 0;
        const allExpenses = [
            ...(currentMonthData.expenses || []),
            ...(currentMonthData.shoppingItems || []),
            ...(currentMonthData.avulsosItems || [])
        ];
        
        spent = allExpenses
            .filter((i: any) => (i.category || '').toLowerCase() === (goal.category || '').toLowerCase())
            .reduce((sum: number, i: any) => sum + i.amount, 0);

        const pct = Math.min((spent / goal.amount) * 100, 100);
        let colorClass = 'safe';
        if (pct > 80) colorClass = 'warning';
        if (pct >= 100) colorClass = 'danger';

        const div = document.createElement('div');
        div.className = 'goal-card';
        div.innerHTML = `
            <div class="goal-card-header">
                <span class="goal-card-title">${goal.category}</span>
                <span class="goal-card-auto-info">Meta: ${formatCurrency(goal.amount)}</span>
            </div>
            <div class="goal-progress-bar">
                <div class="goal-progress-bar-inner ${colorClass}" style="width: ${pct}%"></div>
            </div>
            <div class="goal-remaining ${pct >= 100 ? 'over' : 'safe'}">
                ${pct >= 100 ? 'Excedido: ' : 'Restante: '} ${formatCurrency(Math.abs(goal.amount - spent))}
            </div>
        `;
        div.addEventListener('click', () => {
            const idInput = getEl('goalId') as HTMLInputElement;
            const catInput = getEl('goalCategory') as HTMLSelectElement;
            const amtInput = getEl('goalAmount') as HTMLInputElement;
            idInput.value = goal.id;
            if(catInput.options.length === 0) {
                 ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer', 'Educação'].forEach(c => {
                    catInput.innerHTML += `<option value="${c}">${c}</option>`;
                 });
            }
            catInput.value = goal.category;
            amtInput.value = goal.amount.toString();
            const modal = getEl('goalModal');
            if(modal) modal.style.display = 'flex';
        });
        list.appendChild(div);
    });
}

function renderSavingsGoals() {
    const list = getEl('savingsGoalsList');
    if (!list || !currentMonthData) return;
    list.innerHTML = '';
    
    (currentMonthData.savingsGoals || []).forEach((goal: any) => {
        const pct = Math.min((goal.current / goal.target) * 100, 100);
        const div = document.createElement('div');
        div.className = 'goal-card';
        div.innerHTML = `
             <div class="goal-card-header">
                <span class="goal-card-title">${goal.description}</span>
                <span class="goal-card-auto-info">${formatCurrency(goal.current)} / ${formatCurrency(goal.target)}</span>
            </div>
            <div class="goal-progress-bar">
                <div class="goal-progress-bar-inner safe" style="width: ${pct}%"></div>
            </div>
        `;
        div.addEventListener('click', () => {
             const idInput = getEl('savingsGoalId') as HTMLInputElement;
             const descInput = getEl('savingsGoalDescription') as HTMLInputElement;
             const currInput = getEl('savingsGoalCurrent') as HTMLInputElement;
             const tgtInput = getEl('savingsGoalTarget') as HTMLInputElement;
             idInput.value = goal.id;
             descInput.value = goal.description;
             currInput.value = goal.current.toString();
             tgtInput.value = goal.target.toString();
             const modal = getEl('savingsGoalModal');
             if(modal) modal.style.display = 'flex';
        });
        list.appendChild(div);
    });
}

function setupEventListeners() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.app-view');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            const viewId = (btn as HTMLElement).dataset.view;
            getEl(`view-${viewId}`)?.classList.add('active');
        });
    });

    const segmentedBtns = document.querySelectorAll('.segmented-btn');
    segmentedBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.id && btn.id.includes('import')) return;
            const parent = btn.closest('.segmented-control');
            if (!parent) return;
            parent.querySelectorAll('.segmented-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const listId = (btn as HTMLElement).dataset.list;
            const container = parent.parentElement;
            if (container) {
                container.querySelectorAll('.list-view').forEach((l: HTMLElement) => l.style.display = 'none');
                const targetList = getEl(`list-${listId}`);
                if (targetList) targetList.style.display = 'block';
            }
        });
    });

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach((m: HTMLElement) => m.style.display = 'none');
        });
    });

    // Header Actions
    getEl('import-btn-header')?.addEventListener('click', () => {
           const modal = getEl('importModal');
           if(modal) modal.style.display = 'flex';
    });
       
    getEl('open-ai-btn-header')?.addEventListener('click', () => {
        const modal = getEl('aiModal');
        if(modal) modal.style.display = 'flex';
        const chatContainer = getEl('aiAnalysis');
        if(chatContainer && chatContainer.children.length === 0) {
            addChatMessage("Olá! Sou sua IA financeira. Analisei seus dados deste mês. Como posso ajudar? Posso sugerir cortes de gastos ou analisar se você conseguirá pagar as contas futuras.", 'ai');
        }
    });

    getEl('aiChatForm')?.addEventListener('submit', handleAIChatSubmit);

    const openAdd = () => {
        const modal = getEl('addModal');
        if(modal) modal.style.display = 'flex';
        const accSelect = getEl('sourceAccount');
        if(accSelect && currentMonthData) {
            accSelect.innerHTML = '';
            (currentMonthData.bankAccounts || []).forEach((acc: any) => {
                accSelect.innerHTML += `<option value="${acc.id}">${acc.name}</option>`;
            });
        }
        const catSelect = getEl('category');
        if (catSelect && catSelect.children.length <= 1) {
            ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Dívidas', 'Mumbuca', 'Abastecimento', 'Doação', 'Renda Extra', 'Outros'].forEach(c => {
                const opt = document.createElement('option'); opt.value = c; opt.textContent = c; catSelect.appendChild(opt);
            });
        }
    };

    getEl('add-income-btn')?.addEventListener('click', openAdd);
    getEl('add-expense-btn')?.addEventListener('click', openAdd);
    getEl('add-compras-mumbuca-btn')?.addEventListener('click', openAdd);
    getEl('add-abastecimento-mumbuca-btn')?.addEventListener('click', openAdd);
    getEl('add-avulso-btn')?.addEventListener('click', openAdd);
    
    getEl('add-goal-btn')?.addEventListener('click', () => {
        const form = getEl('goalForm') as HTMLFormElement;
        form.reset();
        (getEl('goalId') as HTMLInputElement).value = '';
        const catSelect = getEl('goalCategory');
        if(catSelect) {
            catSelect.innerHTML = '';
             ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Dívidas'].forEach(c => {
                catSelect.innerHTML += `<option value="${c}">${c}</option>`;
             });
        }
        const modal = getEl('goalModal');
        if(modal) modal.style.display = 'flex';
    });

    getEl('addForm')?.addEventListener('submit', handleAddSubmit);
    getEl('editForm')?.addEventListener('submit', handleEditSubmit);
    getEl('deleteItemBtn')?.addEventListener('click', handleDeleteItem);
    
    getEl('goalForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target as HTMLFormElement);
        const id = fd.get('goalId') as string;
        const newItem = {
            id: id || `goal_${Date.now()}`,
            category: fd.get('category'),
            amount: parseFloat((fd.get('goalAmount') as string).replace(',', '.'))
        };
        
        if (id) {
            const idx = currentMonthData.goals.findIndex((g:any) => g.id === id);
            if (idx > -1) currentMonthData.goals[idx] = newItem;
        } else {
            currentMonthData.goals.push(newItem);
        }
        saveData();
        const modal = getEl('goalModal');
        if(modal) modal.style.display = 'none';
    });

    getEl('menuBtn')?.addEventListener('click', () => {
        getEl('sidebar')?.classList.add('active');
        getEl('sidebarOverlay')?.classList.add('active');
    });
    getEl('closeSidebarBtn')?.addEventListener('click', () => {
        getEl('sidebar')?.classList.remove('active');
        getEl('sidebarOverlay')?.classList.remove('active');
    });
    getEl('sidebarOverlay')?.addEventListener('click', () => {
        getEl('sidebar')?.classList.remove('active');
        getEl('sidebarOverlay')?.classList.remove('active');
    });

    const toggleBalanceBtn = getEl('toggleBalanceBtn');
    if (toggleBalanceBtn) {
        toggleBalanceBtn.addEventListener('click', () => {
            isBalanceVisible = !isBalanceVisible;
            updateUI();
        });
    }

    document.querySelector('.prev-month')?.addEventListener('click', () => {
        currentMonth--;
        if(currentMonth === 0) { currentMonth = 12; currentYear--; }
        loadData();
    });
    document.querySelector('.next-month')?.addEventListener('click', () => {
        currentMonth++;
        if(currentMonth === 13) { currentMonth = 1; currentYear++; }
        loadData();
    });
}

// AI CHAT FUNCTIONS
async function handleAIChatSubmit(e: Event) {
    e.preventDefault();
    const input = getEl('aiChatInput') as HTMLInputElement;
    const message = input.value.trim();
    if (!message) return;
    
    addChatMessage(message, 'user');
    input.value = '';
    
    const loadingId = addChatMessage("Analisando...", 'ai', true);
    
    try {
        const incomes = currentMonthData.incomes || [];
        const expenses = currentMonthData.expenses || [];
        
        const contextData = {
            month: `${currentMonth}/${currentYear}`,
            totals: {
                incomes: getEl('salaryTotalDisplay')?.textContent,
                expenses: getEl('expensesTotalDisplay')?.textContent,
                balance: getEl('salaryRemainder')?.textContent
            },
            expenses_list: expenses.map((e:any) => `${e.description}: R$ ${e.amount} (${e.paid ? 'Pago' : 'Pendente'})`),
        };
        
        const prompt = `
            Atue como um especialista financeiro pessoal.
            Dados do mês: ${JSON.stringify(contextData)}
            
            Pergunta do usuário: "${message}"
            
            Responda de forma curta, direta e amigável em Português.
        `;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt
        });
        
        const text = response.text;
        
        const loadingEl = document.getElementById(loadingId);
        if(loadingEl) loadingEl.remove();
        
        addChatMessage(text, 'ai');
        
    } catch (err) {
            const loadingEl = document.getElementById(loadingId);
            if(loadingEl) loadingEl.remove();
            addChatMessage("Erro ao conectar com a IA. Verifique sua chave API ou conexão.", 'ai');
            console.error(err);
    }
}

function addChatMessage(text: string, sender: 'user' | 'ai', isLoading = false) {
    const container = getEl('aiAnalysis');
    if (!container) return '';
    
    const id = `msg-${Date.now()}`;
    const div = document.createElement('div');
    div.className = `chat-message ${sender}-message`;
    div.id = id;
    
    div.innerHTML = `
        <div class="message-bubble">
            ${isLoading ? '<div class="loading-dots"><span></span><span></span><span></span></div>' : text.replace(/\n/g, '<br>')}
        </div>
    `;
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
}

function handleAddSubmit(e: Event) {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const description = fd.get('description') as string;
    const formType = fd.get('type') as string;
    const currentInst = parseInt(fd.get('currentInstallment') as string);
    const totalInst = parseInt(fd.get('totalInstallments') as string);
    const hasInstallments = !isNaN(currentInst) && !isNaN(totalInst) && totalInst > 0;
    
    let finalDescription = description;
    let installmentsObj = null;

    if (hasInstallments) {
        installmentsObj = { current: currentInst, total: totalInst };
        finalDescription = `${description} (${currentInst}/${totalInst})`;
    }

    const newItem = {
        id: `item_${Date.now()}`,
        description: finalDescription,
        amount: parseFloat((fd.get('amount') as string).replace(',', '.')),
        category: fd.get('category') as string,
        sourceAccount: fd.get('sourceAccount') as string,
        dueDate: (fd.get('transactionDate') as string) || new Date().toISOString().split('T')[0],
        paid: false,
        paidDate: null,
        type: hasInstallments ? 'variable' : formType, 
        installments: installmentsObj
    };

    const activeBtn = document.querySelector('.segmented-btn.active');
    const activeListId = activeBtn ? (activeBtn as HTMLElement).dataset.list : 'expenses';
    
    let targetArray = 'expenses';
    if (activeListId === 'incomes') targetArray = 'incomes';
    else if (activeListId === 'compras-mumbuca') targetArray = 'shoppingItems';
    else if (activeListId === 'abastecimento-mumbuca' || activeListId === 'avulsos') targetArray = 'avulsosItems';
    
    if (newItem.category === 'Salário' || newItem.category === 'Mumbuca' || newItem.category === 'Doação' || newItem.category === 'Renda Extra') targetArray = 'incomes';
    if (newItem.category === 'Abastecimento') targetArray = 'avulsosItems';

    if (targetArray === 'expenses') {
         const exists = (currentMonthData.expenses || []).some((item: any) => 
            item.description.toLowerCase().trim() === newItem.description.toLowerCase().trim()
         );
         
         if (exists) {
             alert("Esta despesa já foi lançada neste mês.");
             return;
         }
    }

    (currentMonthData as any)[targetArray].push(newItem);
    saveData();
    const modal = getEl('addModal');
    if(modal) modal.style.display = 'none';
    (e.target as HTMLFormElement).reset();
}

function handleEditSubmit(e: Event) {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const id = fd.get('itemId') as string;
    const type = fd.get('itemType') as string;
    
    const list = (currentMonthData as any)[type];
    if (list) {
        const item = list.find((i: any) => i.id === id);
        if (item) {
            item.description = fd.get('description');
            item.amount = parseFloat((fd.get('amount') as string).replace(',', '.'));
            item.category = fd.get('category');
            item.sourceAccount = fd.get('sourceAccount');
            item.dueDate = fd.get('dueDate');

            const currentInst = parseInt(fd.get('currentInstallment') as string);
            const totalInst = parseInt(fd.get('totalInstallments') as string);

            if (!isNaN(currentInst) && !isNaN(totalInst) && item.installments) {
                item.installments = { current: currentInst, total: totalInst };
                
                if (item.description.match(/\(\d+\/\d+\)/)) {
                    item.description = item.description.replace(/\(\d+\/\d+\)/, `(${currentInst}/${totalInst})`);
                } else {
                    item.description = `${item.description} (${currentInst}/${totalInst})`;
                }
            }

            saveData();
        }
    }
    const modal = getEl('editModal');
    if(modal) modal.style.display = 'none';
}

function handleDeleteItem() {
    const id = (getEl('editItemId') as HTMLInputElement).value;
    const type = (getEl('editItemType') as HTMLInputElement).value;
    
    if ((currentMonthData as any)[type]) {
        (currentMonthData as any)[type] = (currentMonthData as any)[type].filter((i: any) => i.id !== id);
        saveData();
    }
    const modal = getEl('editModal');
    if(modal) modal.style.display = 'none';
}

// FIX: Dynamic fetch of elements inside function to prevent null pointers
function openEditModal(item: any, listType: string) {
    const idInput = getEl('editItemId') as HTMLInputElement;
    const typeInput = getEl('editItemType') as HTMLInputElement;
    const descInput = getEl('editDescription') as HTMLInputElement;
    const amtInput = getEl('editAmount') as HTMLInputElement;
    const dateInput = getEl('editDueDate') as HTMLInputElement;
    const catSelect = getEl('editCategory') as HTMLSelectElement;
    const accSelect = getEl('editSourceAccount') as HTMLSelectElement;
    
    const instGroup = getEl('editInstallmentsGroup');
    const currInput = getEl('editCurrentInstallment') as HTMLInputElement;
    const totInput = getEl('editTotalInstallments') as HTMLInputElement;

    // Safety check - if any input is missing, abort (prevents crash)
    if (!idInput || !descInput || !amtInput) return;

    idInput.value = item.id;
    typeInput.value = listType;
    descInput.value = item.description;
    amtInput.value = item.amount.toString();
    dateInput.value = item.dueDate || item.date;
    
    if (item.installments) {
        if(instGroup) instGroup.style.display = 'block';
        if(currInput) currInput.value = item.installments.current;
        if(totInput) totInput.value = item.installments.total;
    } else {
        if(instGroup) instGroup.style.display = 'none';
    }

    if(catSelect) {
        catSelect.innerHTML = '';
        ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Dívidas', 'Mumbuca', 'Abastecimento', 'Doação', 'Renda Extra', 'Outros'].forEach(c => {
             catSelect.innerHTML += `<option value="${c}" ${item.category === c ? 'selected' : ''}>${c}</option>`;
        });
    }
    
    if(accSelect) {
        accSelect.innerHTML = '';
        (currentMonthData.bankAccounts || []).forEach((acc: any) => {
            accSelect.innerHTML += `<option value="${acc.id}" ${item.sourceAccount === acc.id ? 'selected' : ''}>${acc.name}</option>`;
        });
    }

    const modal = getEl('editModal');
    if(modal) modal.style.display = 'flex';
}

async function init() {
    setupEventListeners();
    setupProfilePicture(); 
    updateDateDisplay();
    
    if (isConfigured && auth) {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                isOfflineMode = false;
                setupRealtimeListener();
            } else {
                signInAnonymously(auth).catch((err) => {
                    console.warn("Auth falhou, modo offline ativado", err);
                    isOfflineMode = true;
                    loadData();
                });
            }
        });
    } else {
        isOfflineMode = true;
        loadData();
    }
}

init();