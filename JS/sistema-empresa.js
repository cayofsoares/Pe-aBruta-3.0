// ==========================================
// CONFIGURAÇÕES GERAIS E ESTADO
// ==========================================
const API_URL = (() => {
    const hostname = window.location.hostname;
    // Em teste local, sempre consulta o Node local, mesmo que a sessão tenha
    // guardado uma URL antiga do DevTunnel.
    if (['127.0.0.1', 'localhost'].includes(hostname)) {
        return `http://${hostname}:3000/api`;
    }

    // Em produção, mantém o backend que emitiu o JWT quando ele é permitido.
    const apiBaseUrlSalva = sessionStorage.getItem('apiBaseUrl');
    if (apiBaseUrlSalva) {
        try {
            const apiSalva = new URL(apiBaseUrlSalva);
            const caminhoApiValido = apiSalva.pathname.replace(/\/+$/, '') === '/api';
            const apiLocalValida = apiSalva.protocol === 'http:' &&
                ['localhost', '127.0.0.1'].includes(apiSalva.hostname) && apiSalva.port === '3000';
            const apiRenderValida = apiSalva.origin === 'https://api.pecabruta.com.br';
            if (caminhoApiValido && (apiLocalValida || apiRenderValida)) {
                return `${apiSalva.origin}/api`;
            }
        } catch (erro) {
            console.warn('Endereço de API da sessão inválido; usando o ambiente atual.');
        }
    }

    return 'https://api.pecabruta.com.br/api';
})();

function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}

function apiHeaders(extra = {}) {
    return {
        ...extra
    };
}
let usuarioLoja = null;
let token = null;

// ==========================================
// INICIALIZAÇÃO DO PERFIL DA EMPRESA
// ==========================================
window.onload = function() {
    if (!validarSessaoLocal()) return;
    document.getElementById('headerLojaNome').textContent = (usuarioLoja.nome || "Lojista").toUpperCase();
    adicionarLinkPainelAdmin();
    preencherFormularioPerfil();
};

function adicionarLinkPainelAdmin() {
    const emailAdmin = String(usuarioLoja?.email || '').trim().toLowerCase();
    if (emailAdmin !== 'cayofelipe1506@gmail.com' || usuarioLoja?.isAdmin !== true) return;

    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || document.getElementById('link-painel-admin')) return;

    const link = document.createElement('a');
    link.id = 'link-painel-admin';
    link.href = 'admin-pb-secret.html';
    link.className = 'nav-btn';
    link.innerHTML = '<i class="fas fa-shield-alt" aria-hidden="true"></i> Painel Admin';
    link.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:14px;padding:13px 16px;border:1px solid rgba(255,91,47,.7);border-radius:10px;background:linear-gradient(120deg,rgba(255,91,47,.24),rgba(255,145,0,.12));color:#fff;font-weight:800;text-decoration:none;box-shadow:0 0 18px rgba(255,91,47,.18);';
    sidebar.insertBefore(link, sidebar.querySelector('.btn-logout'));
}

function validarSessaoLocal() {
    const userStr = sessionStorage.getItem('usuario');
    let parsed = {};
    try {
        parsed = userStr ? JSON.parse(userStr) : {};
    } catch (erro) {
        console.warn('Dados locais da sessão inválidos; será necessário entrar novamente.');
    }

    usuarioLoja = parsed.user || parsed;
    token = sessionStorage.getItem('token') || parsed.token || parsed.user?.token || null;
    if (!token) {
        redirecionarParaLogin();
        return false;
    }

    if (usuarioLoja.tipo !== 'loja' && usuarioLoja.tipo !== 'admin' && usuarioLoja.isAdmin !== true) {
        alert("Acesso Negado: Área exclusiva para vendedores.");
        window.location.href = "feed.html";
        return false;
    }
    return true;
}

function redirecionarParaLogin() {
    window.location.href = "login-empresa.html";
}

function logout() {
    sessionStorage.clear();
    redirecionarParaLogin();
}

function iniciarNovoProduto() {
    if (usuarioLoja?.isAdmin !== true && usuarioLoja?.tipo !== 'admin' && !String(usuarioLoja?.chavePix || '').trim()) {
        showToast('⚠️ Obrigatório: Cadastre sua Chave PIX no Perfil da Loja antes de anunciar uma peça.', 'error');
        return;
    }

    window.location.href = 'painel-lojista.html';
}

// ==========================================
// 2. MÓDULO: PERFIL CORPORATIVO (INTEGRADO)
// ==========================================
function preencherFormularioPerfil() {
    document.getElementById('perfNome').value = usuarioLoja.nome || '';
    document.getElementById('perfEmail').value = usuarioLoja.email || '';
    document.getElementById('perfCnpj').value = usuarioLoja.cpf || 'Não informado'; 
    document.getElementById('perfBio').value = usuarioLoja.bio || '';
    document.getElementById('perfLogo').value = usuarioLoja.fotoPerfil || '';
    document.getElementById('perfWhats').value = usuarioLoja.telefone || '';
    const campoChavePix = document.getElementById('perfChavePix');
    campoChavePix.value = usuarioLoja.chavePix || '';
    campoChavePix.required = usuarioLoja.tipo !== 'admin' && usuarioLoja.isAdmin !== true;
}

async function atualizarPerfilAPI(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSalvarPerfil');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESSANDO...';

    const payload = {
        email: usuarioLoja.email, 
        novoNome: document.getElementById('perfNome').value,
        bio: document.getElementById('perfBio').value,
        fotoPerfil: document.getElementById('perfLogo').value,
        chavePix: document.getElementById('perfChavePix').value.trim()
    };

    try {
        const res = await apiFetch(`${API_URL}/loja/atualizar-completo`, {
            method: 'PUT',
            headers: apiHeaders({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }),
            body: JSON.stringify(payload)
        });

        if(res.ok) {
            usuarioLoja.nome = payload.novoNome;
            usuarioLoja.bio = payload.bio;
            usuarioLoja.fotoPerfil = payload.fotoPerfil;
            usuarioLoja.chavePix = payload.chavePix;
            
            sessionStorage.setItem('usuario', JSON.stringify({ token: token, user: usuarioLoja }));
            
            let userLogadoRaw = sessionStorage.getItem('usuarioLogado');
            if (userLogadoRaw) {
                try {
                    let obj = JSON.parse(userLogadoRaw);
                    obj.nome = payload.novoNome;
                    if (obj.name) obj.name = payload.novoNome;
                    obj.chavePix = payload.chavePix;
                    sessionStorage.setItem('usuarioLogado', JSON.stringify(obj));
                } catch(err) {}
            }

            sessionStorage.setItem('usuarioNome', payload.novoNome);
            document.getElementById('headerLojaNome').textContent = payload.novoNome.toUpperCase();
            showToast("Perfil atualizado com sucesso. Faça login novamente se houver falhas.", "success");
        } else {
            const err = await res.json();
            showToast(err.error || "Erro ao atualizar dados", "error");
        }
    } catch (err) {
        showToast("Erro de conexão ao atualizar perfil.", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> SALVAR ALTERAÇÕES';
    }
}

// --- SISTEMA DE TOAST NOTIFICATIONS ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : (type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle');
    
    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.5s ease forwards';
        setTimeout(() => toast.remove(), 500);
    }, 5000); // Aumentado para 5 segundos para o lojista ter tempo de ler a nova venda
}

