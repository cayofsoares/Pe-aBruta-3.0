const API_URL = 'https://pe-abruta-3-0.onrender.com/api';
function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}
 // ==========================================
        // 1. UTILITÁRIOS E TOASTS
        // ==========================================
        function showToast(message, type = 'success') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerText = message;
            container.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 5000);
        }

        // Relógio em tempo real
        setInterval(() => {
            const now = new Date();
            document.getElementById('realTimeClock').innerText = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        }, 1000);

        // ==========================================
        // 2. CONTROLE DE SESSÃO E LOGIN NO BACKEND REAL
        // ==========================================
        function checkSession() { 
            const token = sessionStorage.getItem('token');
            const userStr = sessionStorage.getItem('usuario');
            if (token && userStr) {
                const user = JSON.parse(userStr);
                // Verifica se é administrador
                if (user.isAdmin === true) {
                    document.getElementById('loggedAdminName').innerText = user.nome.toUpperCase();
                    document.getElementById('loginView').classList.add('hidden');
                    document.getElementById('dashboardView').classList.remove('hidden');
                    carregarEstatisticasBackend(token);
                } else {
                    realizarLogout(); // Expulsa não admins
                }
            }
        }

        document.getElementById('adminLoginForm').onsubmit = async function(e) {

            e.preventDefault();

            const btn = document.getElementById('btnLogin');
            const email = document.getElementById('admEmail').value.trim();
            const senha = document.getElementById('admPass').value.trim();

            btn.disabled = true;
            btn.innerText = "VERIFICANDO CREDENCIAIS...";

            try {

                // Autenticação Real e Segura no Backend via JWT
                const response = await apiFetch(`${API_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, senha }) // Mandando adminccd e a senha para o servidor
                });

                const result = await response.json();

                if (response.ok && result.user?.isAdmin === true) {

                    // O servidor enviou o crachá VIP (Token)! Salvando no navegador:
                    sessionStorage.setItem('token', result.token);
                    sessionStorage.setItem('usuario', JSON.stringify(result.user));
                    
                    showToast('Autenticado com sucesso. Bem-vindo à Central.', 'success');
                    setTimeout(function() {location.reload(); }, 1000);

                } else {
                    if(response.ok) {
                        showToast('Acesso negado: Você não possui privilégios de Administrador.', 'error');
                    } else {
                        showToast(result.error || 'Credenciais inválidas.', 'error');
                    }
                }
            } catch (err) {
                showToast('Erro crítico de comunicação com o servidor principal.', 'error');
            } finally {
                btn.disabled = false;
                btn.innerText = "AUTENTICAR ACESSO";
            }
        };

        function realizarLogout() {
            sessionStorage.removeItem('token');
            sessionStorage.removeItem('usuario');

            setTimeout(function() {location.reload(); }, 1000);

        }

        // ==========================================
        // 3. COMUNICAÇÃO COM API DE ADMINISTRAÇÃO
        // ==========================================
        function parseDataParaTimestamp(dataStr) {
            if (!dataStr) return 0;
            try {
                const parts = dataStr.split(', ');
                if (parts.length !== 2) return 0;
                const [dia, mes, ano] = parts[0].split('/');
                const [hora, min, seg] = parts[1].split(':');
                return new Date(ano, mes - 1, dia, hora, min, seg).getTime();
            } catch (e) { return 0; }
        }

        async function carregarEstatisticasBackend(token) {
            try {
                
                let tokenBruto = token || ''; 

                // 1. Remove o prefixo "token: " caso ele tenha sido salvo junto
                if (tokenBruto.startsWith('token: ')) {
                    tokenBruto = tokenBruto.replace('token: ', '');
                }

                // 2. Remove as aspas extras das extremidades
                const tokenLimpo = tokenBruto.replace(/^["']|["']$/g, '');

                const response = await apiFetch(`${API_URL}/admin/dados`, {
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${tokenLimpo}` 
                    }
                });

                if(response.ok) {

                    const data = await response.json();
                    const usuarios = data.todosUsuarios || [];
                    const solicitacoes = data.empresas || [];
 
                    // Cálculos Precisos Baseados no Banco Real
                    const totalUsers = usuarios.length;
                    const lojasAtivas = usuarios.filter(u => u.tipo === 'loja').length;
                    const pendentes = solicitacoes.filter(s => s.status === 'pendente').length;
                    const aprovadas = solicitacoes.filter(s => s.status === 'aprovada').length;
                    const recusadas = solicitacoes.filter(s => s.status === 'recusada').length;

                    // Atualizando DOM
                    document.getElementById('stTotalUsers').innerText = totalUsers;
                    document.getElementById('stTotalLojas').innerText = lojasAtivas;
                    document.getElementById('stTotalPendentes').innerText = pendentes;
                    document.getElementById('stTotalAprovadas').innerText = aprovadas;
                    document.getElementById('stTotalRecusadas').innerText = recusadas;
                    const totalProdutos = Number(data.totalProdutos);
                    document.getElementById('stTotalProdutos').innerText = Number.isFinite(totalProdutos)
                        ? totalProdutos.toLocaleString('pt-BR')
                        : '—';

                    // Renderizar Feed de Atividades Recentes
                    renderizarAtividades(solicitacoes);

                } else {
                    showToast('Sessão expirada ou acesso revogado.', 'error');
                    realizarLogout();
                }
            } catch (err) {
                showToast('Falha na extração de dados do servidor.', 'error');
                document.getElementById('stTotalUsers').innerHTML = '<span style="font-size:14px; color:#ff0033;">ERRO</span>';
                document.getElementById('stTotalProdutos').innerText = 'ERRO';
            }
        }

        function renderizarAtividades(solicitacoes) {

            const feed = document.getElementById('activityList');
            
            // Ordenar da mais nova para a mais velha e pegar as 5 primeiras
            const recentes = [...solicitacoes].sort((a, b) => parseDataParaTimestamp(b.data) - parseDataParaTimestamp(a.data)).slice(0, 5);

            if (recentes.length === 0) {
                feed.innerHTML = '<li style="color: #555; font-size: 12px; text-align: center; padding: 20px 0;">Nenhuma atividade recente registrada.</li>';
                return;
            }

            feed.innerHTML = '';
            recentes.forEach(s => {
                let msg = '';
                if(s.status === 'pendente') msg = `Nova solicitação de parceria recebida de <strong>${s.loja.toUpperCase()}</strong>.`;
                else if(s.status === 'aprovada') msg = `O acesso da empresa <strong>${s.loja.toUpperCase()}</strong> foi Aprovado e Liberado.`;
                else msg = `A solicitação da empresa <strong>${s.loja.toUpperCase()}</strong> foi Recusada e Bloqueada.`;

                feed.innerHTML += `
                    <li class="activity-item">
                        <span class="time">${s.data.split(',')[0]}</span>
                        <span class="desc">${msg}</span>
                    </li>
                `;
            });
        }

        // INIT
        document.addEventListener('DOMContentLoaded', () => {
            checkSession();
        });
       
