
import { GoogleGenAI } from "@google/genai";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { db, auth, isConfigured } from "./firebase-config.js";

// -- VARIÁVEIS GLOBAIS --
// Inicializando em Janeiro de 2026 conforme solicitado
let currentMonth = 1;
let currentYear = 2026;
let currentMonthData: any = null;
let currentUser: any = null;
let isOfflineMode = !isConfigured;
let isBalanceVisible = true;
let unsubscribeSnapshot: any = null;
let unsubscribeProfile: any = null;
let syncStatus: 'offline' | 'syncing' | 'online' = 'offline';

// Atualizado para usar o novo Project ID como base para os dados da família
const FAMILY_ID = 'chaveunica-225e0-default';
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const PAYMENT_SCHEDULE: Record<number, string> = {
    1: '-01-23', 2: '-02-21', 3: '-03-21', 4: '-04-22', 
    5: '-05-23', 6: '-06-23', 7: '-07-23', 8: '-08-22', 
    9: '-09-23', 10: '-10-23', 11: '-11-28', 12: '-12-23'
};

function getEl(id: string) { return document.getElementById(id); }
function formatCurrency(val: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val); }
function getMonthName(month: number) { return ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][month - 1]; }

function getCategoryIcon(cat: string) {
    const icons: any = { 'Salário': '💰', 'Mumbuca': '💳', 'Moradia': '🏠', 'Alimentação': '🛒', 'Transporte': '🚗', 'Saúde': '💊', 'Educação': '📚', 'Lazer': '🎉', 'Dívidas': '💸', 'Investimento': '📈', 'Abastecimento': '⛽', 'Doação': '🎁', 'Renda Extra': '💵' };
    return icons[cat] || '📝';
}

function updateSyncUI(status: 'offline' | 'syncing' | 'online') {
    syncStatus = status;
    const indicator = getEl('syncStatusIndicator');
    if (indicator) indicator.className = `sync-indicator ${status}`;
}

// Função auxiliar para calcular parcela baseada na data alvo
function getInstallmentInfo(startYear: number, startMonth: number, total: number, targetYear: number, targetMonth: number) {
    const diff = (targetYear - startYear) * 12 + (targetMonth - startMonth);
    const current = diff + 1;
    if (current < 1 || current > total) return null;
    return { current, total };
}

async function createNewMonthData() {
    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth === 0) { prevMonth = 12; prevYear = currentYear - 1; }

    const prevMonthData = getLocalData(prevYear, prevMonth);
    
    const newMonthData: any = {
        incomes: [],
        expenses: [],
        shoppingItems: [],
        avulsosItems: [],
        goals: prevMonthData?.goals || [
            { id: "goal_1", category: "Moradia", amount: 2200 },
            { id: "goal_2", category: "Saúde", amount: 1200 },
            { id: "goal_3", category: "Transporte", amount: 1000 },
        ],
        bankAccounts: prevMonthData?.bankAccounts || [
            { id: 'acc_main', name: 'Conta Principal', balance: 0 },
            { id: 'acc_mum', name: 'Mumbuca', balance: 0 }
        ],
        updatedAt: Date.now()
    };

    const refMonthName = getMonthName(prevMonth);
    const salaryDay = PAYMENT_SCHEDULE[prevMonth] || `-${prevMonth.toString().padStart(2,'0')}-23`;
    const salaryDate = `${prevYear}${salaryDay}`;

    newMonthData.incomes.push(
        { id: `inc_m_${Date.now()}`, description: `SALARIO MARCELLY (Ref. ${refMonthName})`, amount: 3349.92, paid: (currentYear === 2026 && currentMonth === 1), date: salaryDate, category: 'Salário' },
        { id: `inc_a_${Date.now()}`, description: `SALARIO ANDRE (Ref. ${refMonthName})`, amount: 3349.92, paid: (currentYear === 2026 && currentMonth === 1), date: salaryDate, category: 'Salário' },
        { id: `inc_mum_m_${Date.now()}`, description: 'MUMBUCA MARCELLY', amount: 650.00, paid: false, date: `${currentYear}-${currentMonth.toString().padStart(2,'0')}-15`, category: 'Mumbuca' },
        { id: `inc_mum_a_${Date.now()}`, description: 'MUMBUCA ANDRE', amount: 650.00, paid: false, date: `${currentYear}-${currentMonth.toString().padStart(2,'0')}-15`, category: 'Mumbuca' }
    );

    // Débitos acumulados do mês anterior
    if (prevMonthData && prevMonthData.expenses) {
        prevMonthData.expenses.forEach((oldExp: any) => {
            if (!oldExp.paid) {
                newMonthData.expenses.push({
                    ...oldExp,
                    id: `debt_${Date.now()}_${Math.random()}`,
                    description: `[DÉBITO ANTERIOR] ${oldExp.description.replace('[DÉBITO ANTERIOR] ', '')}`,
                    paid: false,
                    dueDate: `${currentYear}-${currentMonth.toString().padStart(2,'0')}-01`
                });
            }
        });
    }

    // Despesas Fixas e Variáveis (Lógica Dinâmica)
    const cyclicalConfig = [
        { description: "ALUGUEL", amount: 1300.00, category: "Moradia", day: 1, janPaid: true },
        { description: "INTERNET DE CASA", amount: 125.00, category: "Moradia", day: 18, janPaid: false },
        { description: "CONTA DA CLARO - ANDRÉ", amount: 55.00, category: "Moradia", day: 5, janPaid: false },
        { description: "CONTA DA VIVO - ANDRÉ", amount: 35.00, category: "Moradia", day: 5, janPaid: false },
        { description: "PSICÓLOGA DA MARCELLY (Ref. Consultas de Dezembro)", amount: 280.00, category: "Saúde", day: 10, janPaid: true }, 
        { description: "INTERMÉDICA DO ANDRÉ (MARCIA BRITO)", amount: 129.50, category: "Saúde", day: 15, janPaid: false },
        { description: "APPAI DO ANDRÉ (MARCIA BRITO)", amount: 129.50, category: "Saúde", day: 20, janPaid: false },
        { description: "APPAI DA MARCELLY (MÁRCIA BISPO)", amount: 110.00, category: "Saúde", day: 23, janPaid: true },
        { description: "SEGURO DO CARRO", amount: 143.00, category: "Transporte", day: 20, janPaid: false },
        { description: "CONTA DA VIVO - MARCELLY", amount: 66.60, category: "Moradia", day: 23, janPaid: false },
        { description: "FATURA DO CARTÃO DO ANDRÉ (ITAÚ)", amount: 100.00, category: "Outros", day: 24, janPaid: true },
        { description: "FATURA DO CARTÃO DO ANDRÉ (INTER)", amount: 100.00, category: "Outros", day: 24, janPaid: true },
        { description: "REMÉDIOS DO ANDRÉ", amount: 500.00, category: "Saúde", day: 5, janPaid: true },
        { description: "CIDADANIA PORTUGUESA (REBECCA BRITO)", amount: 140.00, category: "Dívidas", day: 20, janPaid: true }
    ];

    cyclicalConfig.forEach(c => {
        newMonthData.expenses.push({
            id: `exp_${Date.now()}_${Math.random()}`,
            description: c.description,
            amount: c.amount,
            category: c.category,
            paid: (currentYear === 2026 && currentMonth === 1) ? c.janPaid : false,
            dueDate: `${currentYear}-${currentMonth.toString().padStart(2,'0')}-${c.day.toString().padStart(2,'0')}`
        });
    });

    // Parcelados com lógica retroativa
    const finiteConfig = [
        { desc: "GUARDA ROUPAS", amount: 914.48, cat: "Moradia", day: 10, total: 5, sY: 2026, sM: 1, janPaid: true },
        { desc: "CONSERTO DO CARRO E PEÇAS (OUTUBRO) (MARCIA BRITO)", amount: 361.75, cat: "Transporte", day: 10, total: 4, sY: 2025, sM: 11, janPaid: true },
        { desc: "FACULDADE DA MARCELLY (MARCIA BRITO)", amount: 202.68, cat: "Educação", day: 12, total: 10, sY: 2025, sM: 12, janPaid: true },
        { desc: "PASSAGENS AÉREAS (LILI)", amount: 504.87, cat: "Lazer", day: 15, total: 8, sY: 2025, sM: 12, janPaid: true },
        { desc: "RENEGOCIAR CARREFOUR (MARCIA BRITO)", amount: 312.50, cat: "Dívidas", day: 28, total: 16, sY: 2025, sM: 11, janPaid: false },
        { desc: "MULTAS (MARCIA BRITO)", amount: 260.00, cat: "Transporte", day: 30, total: 4, sY: 2025, sM: 10, janPaid: false },
        { desc: "EMPRÉSTIMO TIA CÉLIA", amount: 100.00, cat: "Dívidas", day: 10, total: 10, sY: 2025, sM: 6, janPaid: false }
    ];

    finiteConfig.forEach(f => {
        const inst = getInstallmentInfo(f.sY, f.sM, f.total, currentYear, currentMonth);
        if (inst) {
            newMonthData.expenses.push({
                id: `fin_${Date.now()}_${Math.random()}`,
                description: `${f.desc} (${inst.current}/${inst.total})`,
                amount: f.amount,
                category: f.cat,
                paid: (currentYear === 2026 && currentMonth === 1) ? f.janPaid : false,
                dueDate: `${currentYear}-${currentMonth.toString().padStart(2,'0')}-${f.day.toString().padStart(2,'0')}`,
                installments: inst
            });
        }
    });

    currentMonthData = newMonthData;
    await saveData();
}

function getLocalData(y: number, m: number) {
    const saved = localStorage.getItem(`financeData_${y}_${m}`);
    return saved ? JSON.parse(saved) : null;
}

async function loadData() {
    const local = getLocalData(currentYear, currentMonth);
    if (local) {
        currentMonthData = local;
        updateUI();
    } else {
        await createNewMonthData();
    }
}

async function saveData() {
    if (!currentMonthData) return;
    currentMonthData.updatedAt = Date.now();
    localStorage.setItem(`financeData_${currentYear}_${currentMonth}`, JSON.stringify(currentMonthData));
    updateUI();

    if (!isOfflineMode && currentUser) {
        updateSyncUI('syncing');
        try {
            const docRef = doc(db, 'families', FAMILY_ID, 'months', `${currentYear}-${currentMonth.toString().padStart(2,'0')}`);
            await setDoc(docRef, currentMonthData);
            updateSyncUI('online');
        } catch (e) {
            console.error(e);
            updateSyncUI('offline');
        }
    }
}

function setupRealtimeListener() {
    if (!currentUser) return;
    const docRef = doc(db, 'families', FAMILY_ID, 'months', `${currentYear}-${currentMonth.toString().padStart(2,'0')}`);
    onSnapshot(docRef, (snap) => {
        if (snap.exists()) {
            const cloud = snap.data();
            const local = getLocalData(currentYear, currentMonth);
            if (!local || cloud.updatedAt > local.updatedAt) {
                currentMonthData = cloud;
                localStorage.setItem(`financeData_${currentYear}_${currentMonth}`, JSON.stringify(cloud));
                updateUI();
            }
        }
    });
}

function updateUI() {
    if (!currentMonthData) return;
    updateDateDisplay();

    const inc = currentMonthData.incomes || [];
    const exp = currentMonthData.expenses || [];
    const avl = currentMonthData.avulsosItems || [];

    const salTotal = inc.filter((i:any) => ['Salário','Doação','Renda Extra'].includes(i.category)).reduce((a:any,b:any)=>a+b.amount,0);
    const salPaid = inc.filter((i:any) => ['Salário','Doação','Renda Extra'].includes(i.category) && i.paid).reduce((a:any,b:any)=>a+b.amount,0);
    const expTotal = exp.reduce((a:any,b:any)=>a+b.amount,0) + avl.filter((i:any)=>i.sourceAccount !== 'acc_mum').reduce((a:any,b:any)=>a+b.amount,0);
    const expPaid = exp.filter((i:any)=>i.paid).reduce((a:any,b:any)=>a+b.amount,0) + avl.filter((i:any)=>i.sourceAccount !== 'acc_mum' && i.paid).reduce((a:any,b:any)=>a+b.amount,0);

    const updateText = (id:string, val:string) => { const el = getEl(id); if(el) el.textContent = val; };
    updateText('salaryTotalDisplay', formatCurrency(salTotal));
    updateText('salaryIncome', formatCurrency(salPaid));
    updateText('salaryPendingValue', formatCurrency(salTotal - salPaid));
    getEl('salaryIncomeProgressBar')!.style.width = `${salTotal > 0 ? (salPaid/salTotal)*100 : 0}%`;

    updateText('expensesTotalDisplay', formatCurrency(expTotal));
    updateText('fixedVariableExpenses', formatCurrency(expPaid));
    updateText('expensesPendingValue', formatCurrency(expTotal - expPaid));
    getEl('fixedVariableExpensesProgressBar')!.style.width = `${expTotal > 0 ? (expPaid/expTotal)*100 : 0}%`;

    updateText('salaryRemainder', formatCurrency(salTotal - expTotal));
    updateText('headerBalanceValue', isBalanceVisible ? formatCurrency(salPaid - expPaid) : '••••••');

    const repStats: any = {};
    exp.forEach((item: any) => {
        const matches = item.description.match(/\((.*?)\)/g);
        if (matches) {
            matches.forEach((m: string) => {
                let name = m.replace(/[()]/g, '').trim().toUpperCase();
                if (name === 'MÁRCIA BRITO') name = 'MARCIA BRITO';
                if (name.includes('/') || name.startsWith('REF.')) return;
                if (!repStats[name]) repStats[name] = { paid: 0, pending: 0 };
                if (item.paid) repStats[name].paid += item.amount;
                else repStats[name].pending += item.amount;
            });
        }
    });

    const repContainer = getEl('repassesDynamicContainer');
    if (repContainer) {
        repContainer.innerHTML = '';
        Object.keys(repStats).forEach(name => {
            const s = repStats[name];
            const div = document.createElement('div');
            div.className = 'summary-card card-bg-purple';
            div.innerHTML = `
                <div class="summary-header"><div class="summary-title">REPASSE ${name}</div></div>
                <div class="stats-grid" style="margin-top: 8px">
                    <div class="stat-box"><span class="stat-label">PAGO</span><span class="stat-val success">${formatCurrency(s.paid)}</span></div>
                    <div class="stat-box"><span class="stat-label">FALTA</span><span class="stat-val danger">${formatCurrency(s.pending)}</span></div>
                </div>
            `;
            repContainer.appendChild(div);
        });
    }

    renderList(getEl('incomesList'), inc, 'incomes');
    renderList(getEl('expensesList'), exp, 'expenses');
}

function renderList(container: HTMLElement | null, items: any[], type: string) {
    if (!container) return;
    container.innerHTML = '';
    items.sort((a,b) => (a.dueDate||'').localeCompare(b.dueDate||'')).forEach(item => {
        const div = document.createElement('div');
        div.className = `item ${item.paid ? 'paid' : ''}`;
        div.innerHTML = `
            <div class="item-left-col"><label class="switch"><input type="checkbox" ${item.paid?'checked':''}><span class="slider"></span></label></div>
            <div class="item-info-wrapper">
                <div class="item-primary-info"><span class="item-description">${item.description}</span><span class="item-amount">${formatCurrency(item.amount)}</span></div>
                <div class="item-secondary-info"><span>📅 ${item.dueDate?.split('-')[2]||'--'}</span><span>${getCategoryIcon(item.category)} ${item.category}</span></div>
            </div>
        `;
        div.querySelector('input')!.onchange = (e: any) => { item.paid = e.target.checked; saveData(); };
        div.onclick = (e:any) => { if(!e.target.closest('.switch')) openEditModal(item, type); };
        container.appendChild(div);
    });
}

function updateDateDisplay() {
    getEl('monthDisplay')!.textContent = `${getMonthName(currentMonth)} ${currentYear}`;
}

function openEditModal(item: any, type: string) {
    (getEl('editItemId') as HTMLInputElement).value = item.id;
    (getEl('editItemType') as HTMLInputElement).value = type;
    (getEl('editDescription') as HTMLInputElement).value = item.description;
    (getEl('editAmount') as HTMLInputElement).value = item.amount.toString();
    getEl('editModal')!.style.display = 'flex';
    getEl('editModal')!.classList.add('active');
}

function setupEventListeners() {
    getEl('toggleBalanceBtn')!.onclick = () => { isBalanceVisible = !isBalanceVisible; updateUI(); };
    getEl('menuBtn')!.onclick = () => { getEl('sidebar')!.classList.add('active'); getEl('sidebarOverlay')!.classList.add('active'); };
    getEl('sidebarOverlay')!.onclick = () => { getEl('sidebar')!.classList.remove('active'); getEl('sidebarOverlay')!.classList.remove('active'); };
    
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', (e:any) => {
        document.querySelectorAll('.tab-btn, .app-view').forEach(x => x.classList.remove('active'));
        (b as HTMLElement).classList.add('active');
        getEl(`view-${(b as HTMLElement).dataset.view}`)!.classList.add('active');
    }));

    getEl('addForm')!.onsubmit = async (e:any) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const newItem = { id: `item_${Date.now()}`, description: fd.get('description'), amount: parseFloat(fd.get('amount').toString().replace(',','.')), category: 'Outros', paid: false, dueDate: `${currentYear}-${currentMonth.toString().padStart(2,'0')}-10` };
        currentMonthData.expenses.push(newItem);
        await saveData();
        getEl('addModal')!.style.display = 'none';
    };

    getEl('editForm')!.onsubmit = async (e:any) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const id = fd.get('itemId');
        const list = currentMonthData.expenses.concat(currentMonthData.incomes);
        const item = list.find((x:any)=>x.id===id);
        if(item) {
            item.description = fd.get('description');
            item.amount = parseFloat(fd.get('amount').toString().replace(',','.'));
            await saveData();
        }
        getEl('editModal')!.style.display = 'none';
    };

    document.querySelectorAll('.close-modal-btn').forEach(b => (b as HTMLElement).onclick = () => {
        document.querySelectorAll('.modal').forEach(m => { (m as HTMLElement).style.display = 'none'; m.classList.remove('active'); });
    });

    (document.querySelector('.prev-month') as HTMLElement).onclick = () => { currentMonth--; if(currentMonth===0){currentMonth=12;currentYear--;} loadData(); };
    (document.querySelector('.next-month') as HTMLElement).onclick = () => { currentMonth++; if(currentMonth===13){currentMonth=1;currentYear++;} loadData(); };
}

async function init() {
    setupEventListeners();
    await loadData();
    if (isConfigured) {
        onAuthStateChanged(auth, (user) => {
            if (user) { currentUser = user; isOfflineMode = false; setupRealtimeListener(); }
            else { 
                // Tenta entrar anonimamente para sincronizar. 
                // Lembre-se de ativar "Anonymous Login" no console do Firebase!
                signInAnonymously(auth).catch(err => {
                    console.error("Erro ao autenticar anonimamente:", err);
                    isOfflineMode = true;
                });
            }
        });
    }
}

init();
