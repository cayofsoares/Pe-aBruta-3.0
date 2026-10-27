const API_URL = 'https://pe-abruta-3-0.onrender.com/api';
function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}
// ==========================================
// CÉREBRO DO INBOX: VERSÃO MESTRE (BLINDADA)
// ==========================================

let contatoAtivo = null;
let meusContatos = [];
let lojasDoSistema = []; 
let parceirosPorId = new Map();

let usuarioAtualNome = "VISITANTE";
let tipoConta = "CLIENTE";

function escaparHTML(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, caractere => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[caractere]);
}

function formatarTextoComLinks(textoDaMensagem) {
    const textoSeguro = escaparHTML(textoDaMensagem);
    return textoSeguro.replace(/(https?:\/\/[^\s]+)/g, url =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: var(--primary); text-decoration: underline; word-break: break-all;">${url}</a>`
    );
}

document.addEventListener('click', evento => {
    const linkProduto = evento.target.closest('#chatBox a[target="_blank"]');
    if (!linkProduto) return;

    let urlProduto;
    try {
        urlProduto = new URL(linkProduto.href, window.location.href);
    } catch (erro) {
        return;
    }

    if (urlProduto.origin !== window.location.origin || !/(^|\/)produto\.html$/i.test(urlProduto.pathname)) return;

    const usuarioRaw = sessionStorage.getItem('usuario');
    let usuario = null;
    try {
        usuario = usuarioRaw ? JSON.parse(usuarioRaw) : null;
    } catch (erro) {}

    const token = sessionStorage.getItem('token') || usuario?.token || usuario?.user?.token;
    if (!token || !usuarioRaw) return;

    const bridgeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const bridgeKey = `pb_auth_bridge:${bridgeId}`;
    try {
        localStorage.setItem(bridgeKey, JSON.stringify({
            token,
            usuario: usuarioRaw,
            expiresAt: Date.now() + 60000
        }));
        urlProduto.searchParams.set('pbAuthBridge', bridgeId);
        linkProduto.href = urlProduto.href;
        window.setTimeout(() => localStorage.removeItem(bridgeKey), 60000);
    } catch (erro) {
        // Se o navegador bloquear o armazenamento temporário, preserve a sessão nesta aba.
        evento.preventDefault();
        window.location.href = urlProduto.href;
    }
});

// 1. IDENTIFICAÇÃO A PROVA DE FALHAS (Impede a tela de congelar)
const lojaRaw = sessionStorage.getItem('usuarioLogado') || sessionStorage.getItem('lojaLogada');
const clienteRaw = sessionStorage.getItem('clienteLogado') || sessionStorage.getItem('usuario');

if (lojaRaw) {
    tipoConta = "LOJA";
    try {
        let obj = JSON.parse(lojaRaw);
        usuarioAtualNome = (obj.razaoSocial || obj.nome || obj.name || "").toUpperCase();
    } catch(e) {
        usuarioAtualNome = lojaRaw.toUpperCase();
    }
} else if (clienteRaw) {
    tipoConta = "CLIENTE";
    try {
        let obj = JSON.parse(clienteRaw);
        usuarioAtualNome = (obj.nome || obj.name || "").toUpperCase();
    } catch(e) {
        usuarioAtualNome = clienteRaw.toUpperCase();
    }
}

if (!usuarioAtualNome || usuarioAtualNome.trim() === "") {
    usuarioAtualNome = "USUARIO_DESCONHECIDO";
}

window.onload = async function() {
    if (tipoConta === "LOJA") {
        document.querySelector('.search-box').style.display = 'none'; 
    } else {
        await carregarParceirosDaAPI();
    }
    await carregarHistoricoDeContatos();

    const urlParams = new URLSearchParams(window.location.search);
    const idLojistaDaUrl = urlParams.get('lojista');
    const lojaDaUrl = (idLojistaDaUrl && parceirosPorId.get(idLojistaDaUrl.toLowerCase())) || urlParams.get('loja');
    const nomeProdutoDaUrl = urlParams.get('produto') || urlParams.get('ref');
    const pedidoIdDaUrl = urlParams.get('pedidoId');
    const mensagemInicial = urlParams.has('msg')
        ? (urlParams.get('msg') || '')
        : (pedidoIdDaUrl
            ? (nomeProdutoDaUrl
                ? `Olá! Gostaria de falar sobre o pedido #${pedidoIdDaUrl} referente ao produto ${nomeProdutoDaUrl}.`
                : `Olá! Gostaria de falar sobre o pedido #${pedidoIdDaUrl}.`)
            : (nomeProdutoDaUrl ? `Olá! Tenho interesse no produto: ${nomeProdutoDaUrl}` : ''));
    if (lojaDaUrl) {
        await abrirChat(lojaDaUrl);
    }
    if (urlParams.has('msg') || nomeProdutoDaUrl || pedidoIdDaUrl) {
        const campoMensagem = document.getElementById('inputMensagem');
        campoMensagem.value = mensagemInicial || '';
        campoMensagem.focus();
    }
};

// ==========================================
// INTEGRAÇÃO COM O BANCO DE DADOS (API)
// ==========================================

async function carregarParceirosDaAPI() {
    try {
        const response = await apiFetch(`${API_URL}/parceiros`);
        if (response.ok) {
            const data = await response.json();
            parceirosPorId.clear();
            lojasDoSistema = (data.lojas || [])
                .map(l => {
                    const nome = l.nome || l.razaoSocial || "";
                    const id = String(l._id || l.id || '').trim();
                    if (id && nome) parceirosPorId.set(id.toLowerCase(), nome);
                    return nome.toUpperCase();
                })
                .filter(nome => nome !== "" && nome !== usuarioAtualNome);
        }
    } catch (erro) { console.error("Erro ao carregar lojas."); }
}

async function carregarHistoricoDeContatos() {
    try {
        const url = `${API_URL}/lista-contatos/${encodeURIComponent(usuarioAtualNome)}`;
        const response = await apiFetch(url);
        if (response.ok) {
            meusContatos = await response.json();
        }
    } catch (e) { console.error("Erro ao puxar contatos:", e); }
    renderizarListaLateral(meusContatos);
}

async function abrirChat(nomeContato) {
    contatoAtivo = nomeContato;
    
    if (tipoConta === "CLIENTE") document.getElementById('inputBusca').value = "";
    
    if (!meusContatos.includes(contatoAtivo)) {
        meusContatos.push(contatoAtivo);
    }
    renderizarListaLateral(meusContatos); 

    document.getElementById('estadoVazio').style.display = 'none';
    document.getElementById('chatHeader').style.display = 'flex';
    document.getElementById('chatBox').style.display = 'flex';
    document.getElementById('areaDigitacao').style.display = 'flex';

    document.getElementById('chatNomeLoja').innerText = nomeContato;
    document.getElementById('chatAvatar').innerText = nomeContato.charAt(0);

    const chatBox = document.getElementById('chatBox');
    chatBox.innerHTML = '<p style="text-align:center; color:#555; font-size: 12px; margin-top: 20px;">Carregando conversa...</p>';

    try {
        const url = `${API_URL}/mensagens/${encodeURIComponent(usuarioAtualNome)}/${encodeURIComponent(nomeContato)}`;
        const response = await apiFetch(url);
        if (response.ok) {
            const mensagensDB = await response.json();
            renderizarBaloes(mensagensDB);
        } else {
            chatBox.innerHTML = '<p style="text-align:center; color:#ff4d00; font-size: 12px;">Erro interno do servidor.</p>';
        }
    } catch (erro) {
        chatBox.innerHTML = '<p style="text-align:center; color:#ff4d00; font-size: 12px;">Erro ao carregar mensagens.</p>';
    }
}

async function enviarMensagem() {
    if (!contatoAtivo) return;
    
    const input = document.getElementById('inputMensagem');
    const texto = input.value.trim();

    if (texto !== "") {
        const chatBox = document.getElementById('chatBox');
        const avisoVazio = chatBox.querySelector('div[style*="Inicie a conversa"]');
        if (avisoVazio) avisoVazio.remove();

        const balao = document.createElement('div');
        balao.className = `mensagem enviada`;
        balao.innerHTML = `<p style="margin: 0;">${formatarTextoComLinks(texto)}</p><span class="hora">Enviando...</span>`;
        chatBox.appendChild(balao);
        chatBox.scrollTop = chatBox.scrollHeight;
        
        input.value = ""; 

        if (!meusContatos.includes(contatoAtivo)) {
            meusContatos.push(contatoAtivo);
            renderizarListaLateral(meusContatos);
        }

        try {
            const response = await apiFetch(`${API_URL}/mensagens`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ remetente: usuarioAtualNome, destinatario: contatoAtivo, texto: texto })
            });

            if (response.ok) {
                balao.querySelector('.hora').innerText = "Agora"; 
                carregarHistoricoDeContatos(); 
            } else {
                balao.querySelector('.hora').innerText = "Erro ao enviar";
                balao.querySelector('.hora').style.color = "#ff4d00";
            }
        } catch (erro) {
            balao.querySelector('.hora').innerText = "Sem conexão";
            balao.querySelector('.hora').style.color = "#ff4d00";
        }
    }
}

// ==========================================
// FUNÇÕES VISUAIS DA TELA
// ==========================================

function filtrarParceiros() {
    if (tipoConta === "LOJA") return;

    const termo = document.getElementById('inputBusca').value.toUpperCase().trim();
    if (termo === "") {
        renderizarListaLateral(meusContatos);
        return;
    }

    const resultados = lojasDoSistema.filter(loja => loja.includes(termo));
    renderizarListaLateral(resultados, true);
}

function renderizarListaLateral(lista, isPesquisa = false) {
    const painel = document.getElementById('listaParceiros');
    painel.innerHTML = '';

    if (lista.length === 0) {
        const txt = isPesquisa ? "Nenhuma loja encontrada." : "Nenhuma conversa ativa.";
        painel.innerHTML = `<p style="text-align:center; color:#555; margin-top: 20px; font-size:12px;">${txt}</p>`;
        return;
    }

    lista.forEach(nomeContato => {
        const item = document.createElement('div');
        item.className = `store-item ${contatoAtivo === nomeContato ? 'ativo' : ''}`;
        
        item.onclick = () => {
            if (isPesquisa) document.getElementById('inputBusca').value = ""; 
            abrirChat(nomeContato);
        };

        const subtexto = isPesquisa ? "Nova Negociação" : "Toque para abrir";
        item.innerHTML = `
            <div class="store-avatar">${nomeContato.charAt(0)}</div>
            <div class="store-info">
                <h4>${nomeContato}</h4>
                <p style="color: #00cc66;">${subtexto}</p>
            </div>
        `;
        painel.appendChild(item);
    });
}

function renderizarBaloes(mensagens) {
    const chatBox = document.getElementById('chatBox');
    chatBox.innerHTML = ''; 
    
    // AVISO DE 24 HORAS RESTAURADO
    const avisoSistema = document.createElement('div');
    avisoSistema.style.textAlign = 'center';
    avisoSistema.style.color = '#888';
    avisoSistema.style.fontSize = '11px';
    avisoSistema.style.margin = '15px 0 25px 0';
    avisoSistema.style.fontStyle = 'italic';
    avisoSistema.innerHTML = '<i class="fas fa-clock"></i> As mensagens desta conversa serão apagadas automaticamente após 24 horas.';
    chatBox.appendChild(avisoSistema);
    
    if (mensagens.length === 0) {
        chatBox.innerHTML += `<div style="text-align:center; color:#555; margin-top:20px; font-size: 13px;">Inicie a conversa com <b>${contatoAtivo}</b>.</div>`;
        return;
    }

    mensagens.forEach(msg => {
        const tipo = (msg.remetente === usuarioAtualNome) ? 'enviada' : 'recebida';
        const data = new Date(msg.dataEnvio);
        const horaFormatada = data.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        const balao = document.createElement('div');
        balao.className = `mensagem ${tipo}`;
        balao.innerHTML = `
            <p style="margin: 0;">${formatarTextoComLinks(msg.texto)}</p>
            <span class="hora">${horaFormatada}</span>
        `;
        chatBox.appendChild(balao);
    });
    chatBox.scrollTop = chatBox.scrollHeight;
}

function verificarEnter(event) {
    if (event.key === 'Enter') enviarMensagem();
}
