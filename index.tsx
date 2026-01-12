import { GoogleGenAI } from "@google/genai";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
// Fix: Import auth functions from config to avoid module resolution errors in some environments
import { db, auth, isConfigured, onAuthStateChanged, signInAnonymously } from "./firebase-config.js";

// -- VARIÁVEIS GLOBAIS --
let currentMonth = 1;
let currentYear = 2026;
let currentMonthData: any = null;
let currentUser: any = null;
let isOfflineMode = !isConfigured;
let isBalanceVisible = true;
let syncStatus: 'offline' | 'syncing' | 'online' = 'offline';

const FAMILY_ID = 'gen-lang-client-0669556100';
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

// Lógica de cálculo de parcelas retroativas e futuras
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

    // CONTAS FIXAS E VARIÁVEIS (Configuração Jan 2026)
    const cyclicalConfig = [
        { description: "ALUGUEL", amount: 1300.00, category: "Moradia", day: 1, janPaid: true },
        { description: "REMÉDIOS DO ANDRÉ", amount: 500.00, category: "Saúde", day: 5, janPaid: true },
        { description: "PSICÓLOGA DA MARCELLY (Ref. Consultas de Dezembro)", amount: 280.00, category: "Saúde", day: 10, janPaid: true }, 
        { description: "APPAI DA MARCELLY (MÁRCIA BISPO)", amount: 110.00, category: "Saúde", day: 23, janPaid: true },
        { description: "FATURA DO CARTÃO DO ANDRÉ (ITAÚ)", amount: 150.00, category: "Outros", day: 24, janPaid: true },
        { description: "FATURA DO CARTÃO DO ANDRÉ (INTER)", amount: 150.00, category: "Outros", day: 24, janPaid: true },
        { description: "INTERNET DA CASA", amount: 125.00, category: "Moradia", day: 18, janPaid: false },
        { description: "INTERMÉDICA DO ANDRÉ (MARCIA BRITO)", amount: 123.00, category: "Saúde", day: 15, janPaid: false },
        { description: "CONTA DA CLARO - ANDRÉ", amount: 55.00, category: "Moradia", day: 5, janPaid: false },
        { description: "CONTA DA VIVO - ANDRÉ", amount: 35.00, category: "Moradia", day: 5, janPaid: false },
        { description: "APPAI DO ANDRÉ (MARCIA BRITO)", amount: 129.50, category: "Saúde", day: 20, janPaid: false },
        { description: "SEGURO DO CARRO", amount: 143.00, category: "Transporte", day: 20, janPaid: false },
        { description: "CONTA DA VIVO - MARCELLY", amount: 66.60, category: "Moradia", day: 23, janPaid: false }
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

    // CONTAS PARCELADAS (Cálculo Retroativo Automático)
    const finiteConfig = [
        { desc: "GUARDA ROUPAS", totalAmount: 914.48, cat: "Moradia", day: 10, installments: 5, sY: 2026, sM: 1, janPaid: true },
        { desc: "CELULAR DA MARCELLY (MÁRCIA BISPO)", totalAmount: 4628.88, cat: "Outros", day: 10, installments: 12, sY: 2026, sM: 1, janPaid: true },
        { desc: "CONSERTO DO CARRO E PEÇAS (OUTUBRO) (MARCIA BRITO)", totalAmount: 1447.00, cat: "Transporte", day: 10, installments: 4, sY: 2025, sM: 11, janPaid: true },
        { desc: "FACULDADE DA MARCELLY (MARCIA BRITO)", totalAmount: 2026.80, cat: "Educação", day: 12, installments: 10, sY: 2025, sM: 11, janPaid: true },
        { desc: "PASSAGENS AÉREAS (LILI)", totalAmount: 4038.96, cat: "Lazer", day: 15, installments: 8, sY: 2025, sM: 12, janPaid: true },
        { desc: "PASSAGEM AÉREA (MARCIA BRITO)", totalAmount: 1560.00, cat: "Lazer", day: 15, installments: 5, sY: 2026, sM: 2, janPaid: false },
        { desc: "RENEGOCIAR CARREFOUR (MARCIA BRITO)", totalAmount: 5000.00, cat: "Dívidas", day: 28, installments: 16, sY: 2025, sM: 11, janPaid: false },
        { desc: "MULTAS (MARCIA BRITO)", totalAmount: 1040.00, cat: "Transporte", day: 30, installments: 4, sY: 2025, sM: 10, janPaid: false },
        { desc: "EMPRÉSTIMO TIA CÉLIA", totalAmount: 1000.00, cat: "Dívidas", day: 10, installments: 10, sY: 2025, sM: 4, janPaid: false }
    ];

    finiteConfig.forEach(f => {
        const inst = getInstallmentInfo(f.sY, f.sM, f.installments, currentYear, currentMonth);
        if (inst) {
            const installmentAmount = f.totalAmount / f.installments;
            newMonthData.expenses.push({
                id: `fin_${Date.now()}_${Math.random()}`,
                description: `${f.desc} (${inst.current}/${inst.total})`,
                amount: parseFloat(installmentAmount.toFixed(2)),
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
    const expTotal = exp.reduce((a:any,b:any)=>a+b.amount,0);
    const expPaid = exp.filter((i:any)=>i.paid).reduce((a:any,b:any)=>a+b.amount,0);

    const updateText = (id:string, val:string) => { const el = getEl(id); if(el) el.textContent = val; };
    updateText('salaryTotalDisplay', formatCurrency(salTotal));
    updateText('salaryIncome', formatCurrency(salPaid));
    updateText('salaryPendingValue', formatCurrency(salTotal - salPaid));
    getEl('salaryIncomeProgressBar')!.style.width = `${salTotal > 0 ? (salPaid/salTotal)*100 : 0}%`;

    updateText('expensesTotalDisplay', formatCurrency(expTotal));
    updateText('fixedVariableExpenses', formatCurrency(expPaid));
    updateText('expensesPendingValue', formatCurrency(expTotal - expPaid));
    getEl('fixedVariableExpensesProgressBar')!.style.width = `${expTotal > 0 ? (expPaid/expTotal)*100 : 0}%`;

    updateText('headerBalanceValue', isBalanceVisible ? formatCurrency(salPaid - expPaid) : '••••••');

    // LÓGICA DE REPASSES (DINÂMICA)
    const repStats: any = {};
    exp.forEach((item: any) => {
        const matches = item.description.match(/\((.*?)\)/g);
        if (matches) {
            matches.forEach((m: string) => {
                let name = m.replace(/[()]/g, '').trim().toUpperCase();
                // Ignorar se for indicação de parcela ou referência de mês
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
            div.className = 'summary-card card-bg-blue-balance'; // Estilo azulado para repasses
            div.style.marginBottom = '0.75rem';
            div.innerHTML = `
                <div class="summary-header"><div class="summary-title">REPASSE ${name}</div></div>
                <div class="stats-grid" style="margin-top: 8px">
                    <div class="stat-box"><span class="stat-label">PAGO</span><span class="stat-val success">${formatCurrency(s.paid)}</span></div>
                    <div class="stat-box"><span class="stat-label">A PAGAR</span><span class="stat-val danger">${formatCurrency(s.pending)}</span></div>
                </div>
            `;
            repContainer.appendChild(div);
        });
    }

    renderList(getEl('incomesList'), inc, 'incomes');
    renderList(getEl('expensesList'), exp, 'expenses');
    renderList(getEl('comprasMumbucaList'), currentMonthData.shoppingItems || [], 'shoppingItems');
    renderList(getEl('abastecimentoMumbucaList'), avl.filter((i:any)=>i.category==='Abastecimento'), 'avulsosItems');
    renderList(getEl('avulsosList'), avl.filter((i:any)=>i.category!=='Abastecimento'), 'avulsosItems');
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
                <div class="item-primary-info"><span class="item-description ${item.paid?'paid':''}">${item.description}</span><span class="item-amount">${formatCurrency(item.amount)}</span></div>
                <div class="item-secondary-info"><span>📅 ${item.dueDate?.split('-')[2]||item.date?.split('-')[2]||'--'}</span><span>${getCategoryIcon(item.category)} ${item.category}</span></div>
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

// --- LÓGICA DE IA FINANCEIRA AVANÇADA ---

function getFinancialProjections() {
    if (!currentMonthData) return {};
    
    const fixedIncome = currentMonthData.incomes
        .filter((i:any) => i.category === 'Salário' && i.description.includes('SALARIO'))
        .reduce((sum:any, i:any) => sum + i.amount, 0);

    const recurringExpenses = currentMonthData.expenses
        .filter((i:any) => !i.installments)
        .reduce((sum:any, i:any) => sum + i.amount, 0);

    const projections = [];
    const months = ['Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto'];
    
    for (let i = 1; i <= 7; i++) {
        let projectedMonthNum = currentMonth + i;
        let projectedYear = currentYear;
        if (projectedMonthNum > 12) {
            projectedMonthNum -= 12;
            projectedYear++;
        }

        let committedInstallments = 0;
        const details: string[] = [];
        
        currentMonthData.expenses.forEach((exp: any) => {
            if (exp.installments) {
                const remaining = exp.installments.total - exp.installments.current;
                if (remaining >= i) {
                    committedInstallments += exp.amount;
                    details.push(`${exp.description} (${exp.amount})`);
                }
            }
        });

        const totalCommitted = recurringExpenses + committedInstallments;
        const margin = fixedIncome - totalCommitted;

        projections.push({
            month: months[i-1],
            year: projectedYear,
            fixedIncome,
            recurringExpenses,
            committedInstallments,
            totalCommitted,
            margin,
            details
        });
    }

    return {
        currentMonth: currentMonthData,
        projections
    };
}

async function handleAIChat(e: Event) {
    e.preventDefault();
    const input = getEl('aiChatInput') as HTMLInputElement;
    const userMsg = input.value;
    if (!userMsg) return;

    const chatArea = getEl('aiAnalysis');
    chatArea!.innerHTML += `<div class="chat-message user-message"><div class="message-bubble">${userMsg}</div></div>`;
    input.value = '';
    chatArea!.scrollTop = chatArea!.scrollHeight;

    const loaderId = `loader-${Date.now()}`;
    chatArea!.innerHTML += `<div id="${loaderId}" class="chat-message ai-message"><div class="message-bubble">Analisando finanças...</div></div>`;

    try {
        const financialContext = getFinancialProjections();
        
        const systemInstruction = `
            Você é um consultor financeiro pessoal sênior, especialista em finanças domésticas.
            Seu objetivo é analisar os dados financeiros fornecidos e responder às dúvidas do usuário com precisão matemática e conselhos práticos.
            
            Regras:
            1. Analise a 'margin' (Margem Livre) de cada mês projetado.
            2. Se a margem for negativa, alerte imediatamente.
            3. Ao sugerir compras parceladas, verifique se o valor da parcela cabe na margem de TODOS os meses afetados.
            4. Seja direto, use listas e negrito para valores importantes.
            5. Não invente dados, use apenas o contexto fornecido.
        `;

        const prompt = `
            DADOS FINANCEIROS DO USUÁRIO:
            
            MÊS ATUAL (${getMonthName(currentMonth)}/${currentYear}):
            Despesas: ${JSON.stringify(currentMonthData.expenses.map((e:any) => ({d: e.description, v: e.amount, p: e.paid})))}
            
            PROJEÇÃO DE FLUXO DE CAIXA (PRÓXIMOS 7 MESES):
            ${JSON.stringify(financialContext.projections)}

            PERGUNTA DO USUÁRIO:
            "${userMsg}"
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
            }
        });

        const aiText = response.text || "Desculpe, não consegui analisar os dados no momento.";
        
        getEl(loaderId)!.remove();
        const formattedText = aiText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
        
        chatArea!.innerHTML += `<div class="chat-message ai-message"><div class="message-bubble">${formattedText}</div></div>`;
        chatArea!.scrollTop = chatArea!.scrollHeight;

    } catch (err: any) {
        if (getEl(loaderId)) getEl(loaderId)!.remove();
        const errorMsg = err.message || "Erro desconhecido";
        chatArea!.innerHTML += `<div class="chat-message ai-message"><div class="message-bubble error">Erro na IA: ${errorMsg}. Tente novamente.</div></div>`;
        console.error("AI Error:", err);
    }
}

function setupEventListeners() {
    getEl('toggleBalanceBtn')!.onclick = () => { isBalanceVisible = !isBalanceVisible; updateUI(); };
    getEl('menuBtn')!.onclick = () => { getEl('sidebar')!.classList.add('active'); getEl('sidebarOverlay')!.classList.add('active'); };
    getEl('sidebarOverlay')!.onclick = () => { getEl('sidebar')!.classList.remove('active'); getEl('sidebarOverlay')!.classList.remove('active'); };
    
    getEl('open-ai-btn-header')!.onclick = () => {
        getEl('aiModal')!.classList.add('active');
        getEl('aiModal')!.style.display = 'flex';
        if(getEl('aiAnalysis')!.innerHTML === '') {
             getEl('aiAnalysis')!.innerHTML = `<div class="chat-message ai-message"><div class="message-bubble">Olá! Analisei suas finanças até Agosto. <strong>Posso calcular se aquela viagem cabe no bolso.</strong> O que deseja saber?</div></div>`;
        }
    };
    getEl('aiChatForm')!.onsubmit = handleAIChat;

    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', (e:any) => {
        document.querySelectorAll('.tab-btn, .app-view').forEach(x => x.classList.remove('active'));
        (b as HTMLElement).classList.add('active');
        getEl(`view-${(b as HTMLElement).dataset.view}`)!.classList.add('active');
    }));

    document.querySelectorAll('.segmented-btn').forEach(btn => btn.addEventListener('click', (e:any) => {
        const b = btn as HTMLElement;
        const parent = b.parentElement;
        parent!.querySelectorAll('.segmented-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const viewContainer = parent!.closest('.app-view');
        viewContainer!.querySelectorAll('.list-view').forEach((l:any) => l.style.display = 'none');
        getEl(`list-${b.dataset.list}`)!.style.display = 'block';
    }));

    const prevBtn = document.querySelector('.prev-month') as HTMLElement;
    const nextBtn = document.querySelector('.next-month') as HTMLElement;

    if (prevBtn) prevBtn.onclick = () => { 
        currentMonth--; if(currentMonth===0){currentMonth=12;currentYear--;} loadData(); 
    };
    if (nextBtn) nextBtn.onclick = () => { 
        currentMonth++; if(currentMonth===13){currentMonth=1;currentYear++;} loadData(); 
    };

    getEl('addForm')!.onsubmit = async (e:any) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const newItem = { id: `item_${Date.now()}`, description: fd.get('description'), amount: parseFloat(fd.get('amount').toString().replace(',','.')), category: 'Outros', paid: false, dueDate: `${currentYear}-${currentMonth.toString().padStart(2,'0')}-10` };
        currentMonthData.expenses.push(newItem);
        await saveData();
        getEl('addModal')!.style.display = 'none';
    };

    document.querySelectorAll('.close-modal-btn').forEach(b => (b as HTMLElement).onclick = () => {
        document.querySelectorAll('.modal').forEach(m => { (m as HTMLElement).style.display = 'none'; m.classList.remove('active'); });
    });
}

async function init() {
    setupEventListeners();
    await loadData();
    if (isConfigured && auth) {
        onAuthStateChanged(auth, (user: any) => {
            if (user) { 
                currentUser = user; 
                isOfflineMode = false; 
                setupRealtimeListener(); 
                updateSyncUI('online');
            }
            else { 
                signInAnonymously(auth).catch((e: any) => {
                    console.error("Erro Auth (Modo Offline Ativado):", e.message);
                    isOfflineMode = true;
                    updateSyncUI('offline');
                }); 
            }
        });
    } else {
        isOfflineMode = true;
        updateSyncUI('offline');
    }
}

init();