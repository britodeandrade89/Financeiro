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
let syncStatus: 'offline' | 'syncing' | 'online' = 'offline';

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
    11: '2025-11-28', 
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

function updateSyncUI(status: 'offline' | 'syncing' | 'online') {
    syncStatus = status;
    const indicator = getEl('syncStatusIndicator');
    const text = getEl('sync-status-text');
    
    if (indicator) {
        indicator.className = `sync-indicator ${status}`;
        indicator.title = status === 'online' ? 'Conectado à Nuvem' : (status === 'syncing' ? 'Sincronizando...' : 'Modo Offline');
    }
    
    if (text) {
        text.textContent = status === 'online' ? 'Conectado' : (status === 'syncing' ? 'Sincronizando...' : 'Desconectado');
        text.className = status;
    }
}

// -- GERENCIAMENTO DE DADOS --

function getMonthKey(year: number = currentYear, month: number = currentMonth) {
    return `${year}-${month.toString().padStart(2, '0')}`;
}

function getLocalData(year: number, month: number) {
    const key = `financeData_${year}_${month}`;
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : null;
}

async function createNewMonthData() {
    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth === 0) { prevMonth = 12; prevYear = currentYear - 1; }

    const prevMonthData = getLocalData(prevYear, prevMonth);
    
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
        ],
        updatedAt: Date.now()
    };

    // --- LÓGICA DE SALÁRIO ---
    let refMonth = currentMonth - 1;
    let refYear = currentYear;
    if (refMonth === 0) { refMonth = 12; refYear = currentYear - 1; }

    let salaryDate = '';
    if (refYear === 2025 && PAYMENT_SCHEDULE_2025[refMonth]) {
        salaryDate = PAYMENT_SCHEDULE_2025[refMonth];
    } else {
        salaryDate = `${refYear}-${refMonth.toString().padStart(2, '0')}-23`;
    }

    const monthNameRef = getMonthName(refMonth); 

    newMonthData.incomes.push(
        { id: `inc_sal_m_${Date.now()}`, description: `SALARIO MARCELLY (Ref. ${monthNameRef})`, amount: 3349.92, paid: false, date: salaryDate, category: 'Salário' },
        { id: `inc_sal_a_${Date.now()}`, description: `SALARIO ANDRE (Ref. ${monthNameRef})`, amount: 3349.92, paid: false, date: salaryDate, category: 'Salário' },
        { id: `inc_mum_m_${Date.now()}`, description: 'MUMBUCA MARCELLY', amount: 650.00, paid: false, date: `${currentYear}-${currentMonth.toString().padStart(2,'0')}-15`, category: 'Mumbuca' },
        { id: `inc_mum_a_${Date.now()}`, description: 'MUMBUCA ANDRE', amount: 650.00, paid: false, date: `${currentYear}-${currentMonth.toString().padStart(2,'0')}-15`, category: 'Mumbuca' }
    );

    // --- LÓGICA DE DÉBITO ACUMULADO (ACUMULADO DO MÊS ANTERIOR) ---
    if (prevMonthData && prevMonthData.expenses) {
        prevMonthData.expenses.forEach((oldExp: any) => {
            if (!oldExp.paid) {
                // Se a conta não foi paga, ela vai para o novo mês como débito anterior
                const carryOver = {
                    ...oldExp,
                    id: `debt_${Date.now()}_${Math.random()}`,
                    description: `[DÉBITO ANTERIOR] ${oldExp.description.replace('[DÉBITO ANTERIOR] ', '')}`,
                    paid: false,
                    dueDate: `${currentYear}-${currentMonth.toString().padStart(2, '0')}-01`, // Vence no dia 1 do novo mês
                };
                newMonthData.expenses.push(carryOver);
            }
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
        { description: "CONSERTO DO CARRO E PEÇAS (OUTUBRO) (MARCIA BRITO)", amount: 361.75, category: "Transporte", day: 10, totalInstallments: 4 }
    ];

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

    cyclicalExpenses.forEach(def => {
        newMonthData.expenses.push(createExpense(def.description, def.amount, def.category, def.day, def.initialPaid || false));
    });

    variableExpensesFinite.forEach(def => {
        let startInstallment = 1;
        let isPaid = false;
        if (def.description.includes("MULTAS") || def.description.includes("FACULDADE")) isPaid = true;
        if (def.description.includes("CONSERTO DO CARRO")) startInstallment = 2;
        if (def.description.includes("RENEGOCIAR CARREFOUR")) startInstallment = 2;
        if (def.description === "EMPRÉSTIMO TIA CÉLIA") startInstallment = 5;

        const desc = `${def.description} (${startInstallment}/${def.totalInstallments})`;
        newMonthData.expenses.push(createExpense(desc, def.amount, def.category, def.day, isPaid, { current: startInstallment, total: def.totalInstallments }));
    });

    newMonthData.expenses.push(createExpense("REMÉDIOS DO ANDRÉ (SEPARAR NO SOFISA)", (currentMonth % 2 !== 0) ? 500.00 : 0.00, "Saúde", 5, false));

    currentMonthData = newMonthData;
    await saveData();
}

async function loadData() {
    const key = `financeData_${currentYear}_${currentMonth}`;
    const local = getLocalData(currentYear, currentMonth);
    
    if (local) {
        currentMonthData = local;
        updateUI();
    } else if (isOfflineMode) {
        await createNewMonthData();
    }
}

function setupRealtimeListener() {
    if (!currentUser) return;
    const docRef = doc(db, 'families', FAMILY_ID, 'months', getMonthKey());
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    
    updateSyncUI('syncing');
    
    unsubscribeSnapshot = onSnapshot(docRef, async (docSnap) => {
        if (docSnap.exists()) {
            const cloudData = docSnap.data();
            const local = getLocalData(currentYear, currentMonth);
            
            // Reconciliação: Se o local é mais novo que a nuvem, priorizamos o local e subimos.
            if (local && local.updatedAt > (cloudData.updatedAt || 0)) {
                currentMonthData = local;
                await saveData(); // Sobe o local mais novo
            } else {
                currentMonthData = cloudData;
                const key = `financeData_${currentYear}_${currentMonth}`;
                localStorage.setItem(key, JSON.stringify(currentMonthData));
            }
            updateUI();
            updateSyncUI('online');
        } else {
            // Se não existe na nuvem, usamos o local ou criamos novo
            const local = getLocalData(currentYear, currentMonth);
            if (local) {
                currentMonthData = local;
                await saveData(); // Sobe o local inicial
            } else {
                await createNewMonthData();
            }
            updateSyncUI('online');
        }
    }, (error) => {
        console.error("Erro no listener Firebase:", error);
        updateSyncUI('offline');
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

async function saveData() {
    if (!currentMonthData) return;
    
    currentMonthData.updatedAt = Date.now();
    updateUI();

    // Sempre salva no localStorage como cache de segurança
    const key = `financeData_${currentYear}_${currentMonth}`;
    localStorage.setItem(key, JSON.stringify(currentMonthData));

    if (!isOfflineMode && currentUser) {
        updateSyncUI('syncing'); // ATIVA A SETA GIRANDO
        try {
            const docRef = doc(db, 'families', FAMILY_ID, 'months', getMonthKey());
            await setDoc(docRef, currentMonthData);
            updateSyncUI('online'); // PARA A SETA
        } catch (err) {
            console.error("Erro ao salvar no Firebase:", err);
            updateSyncUI('offline');
        }
    }
}

// -- UPDATE UI --
function updateUI() {
    if (!currentMonthData) return;
    updateDateDisplay();

    const incomes = currentMonthData.incomes || [];
    const expenses = currentMonthData.expenses || [];
    const shoppingItems = currentMonthData.shoppingItems || [];
    const avulsosItems = currentMonthData.avulsosItems || [];

    const avulsosMainItems = avulsosItems.filter((i: any) => i.sourceAccount !== 'acc_mum');
    const mumbucaItems = [...shoppingItems, ...avulsosItems.filter((i: any) => i.sourceAccount === 'acc_mum')];
    
    const salaryIncome = incomes.filter((i: any) => ['Salário', 'Doação', 'Renda Extra'].includes(i.category)).reduce((acc: number, i: any) => acc + i.amount, 0);
    const mumbucaIncome = incomes.filter((i: any) => i.category === 'Mumbuca').reduce((acc: number, i: any) => acc + i.amount, 0);
    
    const paidExpenses = expenses.filter((i: any) => i.paid).reduce((acc: number, i: any) => acc + i.amount, 0) + avulsosMainItems.filter((i: any) => i.paid).reduce((acc: number, i: any) => acc + i.amount, 0);
    const pendingExpenses = expenses.filter((i: any) => !i.paid).reduce((acc: number, i: any) => acc + i.amount, 0) + avulsosMainItems.filter((i: any) => !i.paid).reduce((acc: number, i: any) => acc + i.amount, 0);
    
    const mumbucaPaid = mumbucaItems.filter((i: any) => i.paid).reduce((acc: number, i: any) => acc + i.amount, 0);
    const mumbucaPending = mumbucaItems.filter((i: any) => !i.paid).reduce((acc: number, i: any) => acc + i.amount, 0);

    const updateText = (id: string, text: string) => { const el = getEl(id); if (el) el.textContent = text; };
    const updateBar = (id: string, current: number, total: number) => { const el = getEl(id); if (el) el.style.width = `${total > 0 ? Math.min((current/total)*100, 100) : 0}%`; };

    updateText('salaryTotalDisplay', formatCurrency(salaryIncome));
    updateText('salaryIncome', formatCurrency(incomes.filter((i: any) => ['Salário', 'Doação', 'Renda Extra'].includes(i.category) && i.paid).reduce((a,b)=>a+b.amount,0)));
    updateText('salaryPendingValue', formatCurrency(incomes.filter((i: any) => ['Salário', 'Doação', 'Renda Extra'].includes(i.category) && !i.paid).reduce((a,b)=>a+b.amount,0)));
    updateBar('salaryIncomeProgressBar', incomes.filter((i: any) => ['Salário', 'Doação', 'Renda Extra'].includes(i.category) && i.paid).reduce((a,b)=>a+b.amount,0), salaryIncome);
    
    updateText('expensesTotalDisplay', formatCurrency(paidExpenses + pendingExpenses));
    updateText('fixedVariableExpenses', formatCurrency(paidExpenses));
    updateText('expensesPendingValue', formatCurrency(pendingExpenses));
    updateBar('fixedVariableExpensesProgressBar', paidExpenses, paidExpenses + pendingExpenses);

    const remainder = salaryIncome - (paidExpenses + pendingExpenses);
    updateText('salaryRemainder', formatCurrency(remainder));
    updateBar('salaryRemainderProgressBar', Math.max(0, remainder), salaryIncome);

    updateText('mumbucaTotalDisplay', formatCurrency(mumbucaIncome));
    updateText('mumbucaIncome', formatCurrency(incomes.filter((i: any) => i.category === 'Mumbuca' && i.paid).reduce((a,b)=>a+b.amount,0)));
    updateBar('mumbucaIncomeProgressBar', incomes.filter((i: any) => i.category === 'Mumbuca' && i.paid).reduce((a,b)=>a+b.amount,0), mumbucaIncome);
    
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
    
    // Repasses
    const repassesStats: Record<string, { paid: number, pending: number }> = {};
    expenses.forEach((item: any) => {
        const matches = item.description.match(/\((.*?)\)/g);
        if (matches) {
            matches.forEach((match: string) => {
                const content = match.replace(/[()]/g, '').trim();
                if (/^\d+\s*\/\s*\d+$/.test(content) || content.toLowerCase().startsWith('ref.')) return;
                let nameKey = content.toUpperCase();
                if (nameKey === 'MÁRCIA BRITO') nameKey = 'MARCIA BRITO';
                if (!repassesStats[nameKey]) repassesStats[nameKey] = { paid: 0, pending: 0 };
                if (item.paid) repassesStats[nameKey].paid += item.amount;
                else repassesStats[nameKey].pending += item.amount;
            });
        }
    });

    const repassesContainer = getEl('repassesDynamicContainer');
    if (repassesContainer) {
        repassesContainer.innerHTML = ''; 
        Object.keys(repassesStats).sort().forEach(name => {
             const stats = repassesStats[name];
             const div = document.createElement('div');
             div.className = 'summary-card card-bg-purple'; 
             div.style.flex = "1 1 calc(50% - 0.5rem)"; 
             div.style.minWidth = "150px";
             div.innerHTML = `
                <div class="summary-header"><div class="summary-title">Repasse ${name}</div></div>
                <div class="stats-grid" style="margin-top: 0.5rem; width: 100%;">
                    <div class="stat-box"><span class="stat-label">Já Pago</span><span class="stat-val success">${formatCurrency(stats.paid)}</span></div>
                    <div class="stat-box"><span class="stat-label">Falta</span><span class="stat-val danger">${formatCurrency(stats.pending)}</span></div>
                </div>
                <div style="text-align: center; font-size: 0.7rem; color: var(--text-light); margin-top: 6px;">Total: ${formatCurrency(stats.paid + stats.pending)}</div>
             `;
             repassesContainer.appendChild(div);
        });
    }

    renderBankAccounts();
    renderList(getEl('incomesList'), incomes, 'incomes');
    renderList(getEl('expensesList'), expenses, 'expenses');
    renderList(getEl('comprasMumbucaList'), currentMonthData.shoppingItems, 'shoppingItems');
    renderList(getEl('abastecimentoMumbucaList'), (currentMonthData.avulsosItems || []).filter((i: any) => i.category === 'Abastecimento'), 'avulsosItems');
    renderList(getEl('avulsosList'), (currentMonthData.avulsosItems || []).filter((i: any) => i.category !== 'Abastecimento'), 'avulsosItems');
    renderGoals();
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
        container.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-light); opacity: 0.7;">Nenhum item</div>`;
        return;
    }
    const sorted = [...items].sort((a, b) => (a.dueDate || a.date || '').localeCompare(b.dueDate || b.date || ''));
    sorted.forEach(item => {
        const div = document.createElement('div');
        div.className = `item type-${listType} ${item.paid ? 'paid' : ''}`;
        const dateStr = item.dueDate || item.date || '';
        const [y, m, d] = dateStr.split('-');
        div.innerHTML = `
            <div class="item-left-col"><label class="switch"><input type="checkbox" ${item.paid ? 'checked' : ''}><span class="slider"></span></label></div>
            <div class="item-info-wrapper">
                <div class="item-primary-info">
                    <span class="item-description ${item.paid ? 'paid' : ''}">${item.description}</span>
                    <span class="item-amount">R$ ${item.amount.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                </div>
                <div class="item-secondary-info"><span>📅 ${d}/${m}</span><span>${getCategoryIcon(item.category)} ${item.category}</span></div>
            </div>
        `;
        div.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.switch')) return;
            openEditModal(item, listType);
        });
        const cb = div.querySelector('input[type="checkbox"]');
        cb?.addEventListener('change', (e: any) => {
            item.paid = e.target.checked;
            saveData();
        });
        container.appendChild(div);
    });
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
        div.innerHTML = `<div class="account-name">${acc.name}</div><div class="account-balance">${formatCurrency(acc.balance)}</div>`;
        div.addEventListener('click', () => {
             (getEl('accountId') as HTMLInputElement).value = acc.id;
             (getEl('accountName') as HTMLInputElement).value = acc.name;
             (getEl('accountBalance') as HTMLInputElement).value = acc.balance.toString();
             getEl('accountModal')!.style.display = 'flex';
             getEl('accountModal')!.classList.add('active');
        });
        list.appendChild(div);
    });
    const tel = getEl('accountsTotalValue'); if(tel) tel.textContent = formatCurrency(total);
}

function renderGoals() {
    const list = getEl('goalsList');
    if (!list || !currentMonthData) return;
    list.innerHTML = '';
    (currentMonthData.goals || []).forEach((goal: any) => {
        const spent = [...(currentMonthData.expenses||[]), ...(currentMonthData.shoppingItems||[]), ...(currentMonthData.avulsosItems||[])]
            .filter((i: any) => (i.category || '').toLowerCase() === (goal.category || '').toLowerCase())
            .reduce((sum, i) => sum + i.amount, 0);
        const pct = Math.min((spent / goal.amount) * 100, 100);
        const div = document.createElement('div');
        div.className = 'goal-card';
        div.innerHTML = `
            <div class="goal-card-header"><span class="goal-card-title">${goal.category}</span><span class="goal-card-auto-info">Meta: ${formatCurrency(goal.amount)}</span></div>
            <div class="goal-progress-bar"><div class="goal-progress-bar-inner ${pct > 90 ? 'danger' : 'safe'}" style="width: ${pct}%"></div></div>
            <div class="goal-remaining">Gasto: ${formatCurrency(spent)}</div>
        `;
        list.appendChild(div);
    });
}

function setupEventListeners() {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
        btn.classList.add('active');
        getEl(`view-${(btn as HTMLElement).dataset.view}`)?.classList.add('active');
    }));

    document.querySelectorAll('.segmented-btn').forEach(btn => btn.addEventListener('click', () => {
        const parent = btn.closest('.segmented-control');
        parent!.querySelectorAll('.segmented-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const container = parent!.parentElement;
        container!.querySelectorAll('.list-view').forEach((l: any) => l.style.display = 'none');
        getEl(`list-${(btn as HTMLElement).dataset.list}`)!.style.display = 'block';
    }));

    getEl('menuBtn')?.addEventListener('click', () => { getEl('sidebar')?.classList.add('active'); getEl('sidebarOverlay')?.classList.add('active'); });
    getEl('closeSidebarBtn')?.addEventListener('click', () => { getEl('sidebar')?.classList.remove('active'); getEl('sidebarOverlay')?.classList.remove('active'); });
    getEl('sidebarOverlay')?.addEventListener('click', () => { getEl('sidebar')?.classList.remove('active'); getEl('sidebarOverlay')?.classList.remove('active'); });
    
    document.querySelectorAll('.close-modal-btn').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach((m: any) => { m.style.display = 'none'; m.classList.remove('active'); });
    }));

    getEl('sync-btn')?.addEventListener('click', async () => {
        if (currentUser) {
            updateSyncUI('syncing');
            await saveData();
        }
    });

    getEl('toggleBalanceBtn')?.addEventListener('click', () => { isBalanceVisible = !isBalanceVisible; updateUI(); });

    getEl('add-income-btn')?.addEventListener('click', () => { getEl('addModal')!.style.display = 'flex'; getEl('addModal')!.classList.add('active'); });
    getEl('add-expense-btn')?.addEventListener('click', () => { getEl('addModal')!.style.display = 'flex'; getEl('addModal')!.classList.add('active'); });

    getEl('addForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target as HTMLFormElement);
        const newItem = {
            id: `item_${Date.now()}`,
            description: fd.get('description'),
            amount: parseFloat((fd.get('amount') as string).replace(',', '.')),
            category: fd.get('category'),
            sourceAccount: fd.get('sourceAccount'),
            paid: false,
            date: new Date().toISOString().split('T')[0]
        };
        const activeTab = document.querySelector('.segmented-btn.active') as HTMLElement;
        const listKey = activeTab.dataset.list === 'incomes' ? 'incomes' : (activeTab.dataset.list === 'expenses' ? 'expenses' : 'avulsosItems');
        (currentMonthData as any)[listKey].push(newItem);
        await saveData();
        getEl('addModal')!.style.display = 'none';
        (e.target as HTMLFormElement).reset();
    });

    getEl('open-ai-btn-header')?.addEventListener('click', () => { getEl('aiModal')!.style.display = 'flex'; getEl('aiModal')!.classList.add('active'); });

    document.querySelector('.prev-month')?.addEventListener('click', () => { currentMonth--; if(currentMonth === 0) { currentMonth = 12; currentYear--; } loadData(); });
    document.querySelector('.next-month')?.addEventListener('click', () => { currentMonth++; if(currentMonth === 13) { currentMonth = 1; currentYear++; } loadData(); });
}

function openEditModal(item: any, listType: string) {
    (getEl('editItemId') as HTMLInputElement).value = item.id;
    (getEl('editItemType') as HTMLInputElement).value = listType;
    (getEl('editDescription') as HTMLInputElement).value = item.description;
    (getEl('editAmount') as HTMLInputElement).value = item.amount.toString();
    getEl('editModal')!.style.display = 'flex';
    getEl('editModal')!.classList.add('active');
}

async function init() {
    setupEventListeners();
    updateDateDisplay();
    
    if (isConfigured && auth) {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                isOfflineMode = false;
                setupRealtimeListener();
            } else {
                signInAnonymously(auth).catch(() => {
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