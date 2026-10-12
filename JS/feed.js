const API_URL = window.location.hostname.includes('127.0.0.1') || window.location.hostname.includes('localhost') ? 'http://localhost:3000/api' : 'https://64xd3fbf-3000.brs.devtunnels.ms/api';
function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
        'bypass-tunnel-reminder': 'true',
        'ngrok-skip-browser-warning': '69420'
    };
    return fetch(url, { ...options, headers });
}
// Nova variável global para segurar os dados vindos da API
let produtosDoBanco = [];

const selectCategoria = document.getElementById('filterCategory');
const selectOrdem = document.getElementById('filterOrder');

// 1. GATILHO UNIVERSAL: Uma única função acionada ao mudar qualquer select
function atualizarFiltros() {
    const categoria = selectCategoria.value;
    const ordem = selectOrdem.value;
    const busca = document.getElementById('searchInput').value; 
    
    carregarProdutos(categoria, ordem, busca);
}

// "Escuta" os campos (Basta estes dois!)
selectCategoria.addEventListener('change', atualizarFiltros);
selectOrdem.addEventListener('change', atualizarFiltros);

// Garante que a função vai rodar automaticamente assim que a página abrir
document.addEventListener('DOMContentLoaded', () => {
    carregarCategoriasNoSelect();
    atualizarFiltros();
});

// Função para buscar e preencher as categorias
async function carregarCategoriasNoSelect() {
    const selectCategoria = document.getElementById('filterCategory');
    try {
        const response = await apiFetch(`${API_URL}/categorias`);
        const data = await response.json();
        if (response.ok && data.success) {
            selectCategoria.innerHTML = '<option value="" selected>Todos...</option>';
            data.categorias.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.nome;
                option.textContent = cat.nome;
                selectCategoria.appendChild(option);
            });
            // 🔴 LIMPEZA FEITA: Removemos gatilhos repetidos que ficavam aqui e causavam conflito.
        } 
        else {
            selectCategoria.innerHTML = '<option value="" disabled>Erro ao carregar categorias</option>';
        }
    } 
    catch (erro) {
        console.error('Falha ao buscar categorias:', erro);
        selectCategoria.innerHTML = '<option value="" disabled>Servidor indisponível</option>';
    }
}

function atualizarContadorCarrinho() {
    const carrinho = JSON.parse(sessionStorage.getItem('carrinho')) || [];
    const contador = document.getElementById('cartCounter');
    if (carrinho.length > 0) {
        contador.innerText = carrinho.length;
        contador.style.display = 'flex';
    } else {
        contador.style.display = 'none';
    }
}

function logout() {
    sessionStorage.removeItem('usuarioLogado');
    sessionStorage.removeItem('tipoUsuario');
    sessionStorage.removeItem('token');
    window.location.reload();
}

function irParaPerfilLoja(nomeLoja) {
    sessionStorage.setItem('loja_ativa_perfil', nomeLoja);
    window.location.href = `perfil-loja.html?nome=${encodeURIComponent(nomeLoja)}`;
}

function parsePreco(precoStr) {
    if (!precoStr) return 0;
    return parseFloat(precoStr.toString().replace("R$", "").replace(/\./g, "").replace(",", ".").trim());
}

async function carregarParceiros() {
    const container = document.getElementById('listaParceirosDestaque');
    try {
        const response = await apiFetch(`${API_URL}/parceiros`, {
            method: 'GET'
        });

        if(response.ok) {
            const data = await response.json();
            const lojas = data.lojas || [];
            
            if(lojas.length === 0) {
                container.style.display = 'none';
                return;
            }
            
            container.innerHTML = lojas.map(loja => {
                const inicial = loja.nome.charAt(0).toUpperCase();
                return `
                    <div class="partner-item" onclick="irParaPerfilLoja('${loja.nome}')">
                        <div class="partner-circle">
                            ${loja.fotoPerfil 
                                ? `<img src="${loja.fotoPerfil}" alt="${loja.nome}">` 
                                : `<span class="partner-initial">${inicial}</span>`
                            }
                        </div>
                        <span class="partner-name">${loja.nome}</span>
                    </div>
                `;
            }).join('');
        } else {
            container.style.display = 'none';
        }
    } catch (err) {
        console.error("Erro de conexão ao carregar parceiros:", err);
        container.style.display = 'none';
    }
}

function carregarProdutos(categoria = '', ordem = '', busca = '') {
    buscarProdutosDoServidor(categoria, ordem, busca);
}

async function buscarProdutosDoServidor(categoria = '', ordem = '', busca = '') {
    document.getElementById('feed-list').innerHTML = '<h3 class="looding">Carregando produtos...</h3>';
    try {
        const params = new URLSearchParams();
        
        // Se escolheu categoria, anexa na URL
        if (categoria && categoria !== 'Todos...') {
            params.append('categoria', categoria);
        }
        // Anexa ordem
        if (ordem) params.append('ordem', ordem);
        
        // Se digitou algo na busca, anexa na URL
        if (busca && busca.trim() !== '') {
            params.append('busca', busca);
        }
        
        const url = `${API_URL}/produtos/feed?${params.toString()}`;
        const response = await apiFetch(url);
        const data = await response.json();
          
        if (response.ok && data.success) {
            produtosDoBanco = data.pecas || []; 
            renderizarFeed(); 
        } else {
            console.error("A API retornou um erro. Status:", response.status);
            produtosDoBanco = [];
            renderizarFeed(); 
        }

    } catch (erro) {
        console.error("Servidor offline ou erro de conexão:", erro);
        produtosDoBanco = [];
        renderizarFeed(); 
    }
}

function renderizarFeed() {
    const termo = document.getElementById('searchInput').value.toLowerCase();
    const ordem = document.getElementById('filterOrder').value;
    const container = document.getElementById('feed-list');
    
    const titulo = document.getElementById('tituloVitrine');
    const parceiros = document.getElementById('listaParceirosDestaque');
    
    // Esconde o banner de parceiros caso haja uma pesquisa
    if (termo.trim() !== "") {
        titulo.style.display = 'none';
        parceiros.style.display = 'none';
    } else {
        titulo.style.display = 'block';
        parceiros.style.display = 'flex';
    }

    // 🔴 LIMPEZA FEITA: Como o Backend já envia as peças perfeitamente filtradas, 
    // nós não precisamos filtrar no JavaScript. Apenas aplicamos a ordem de preço!
    let filtradas = [...produtosDoBanco];

    if (ordem === "menor") {
        filtradas.sort((a, b) => parsePreco(a.preco) - parsePreco(b.preco));
    } else if (ordem === "maior") {
        filtradas.sort((a, b) => parsePreco(b.preco) - parsePreco(a.preco));
    }

    if (filtradas.length === 0) {
        container.innerHTML = `
            <div class="no-results">
                <h2>NENHUMA PEÇA ENCONTRADA</h2>
                <p>Não encontramos resultados para "${termo.toUpperCase()}". Verifique a ortografia ou tente termos mais genéricos.</p>
            </div>
        `;
    } 
    else {                       
        container.innerHTML = filtradas.map((peca, index) => {

            const imgUrl = (peca.imagens && peca.imagens.length > 0) ? peca.imagens[0] : (peca.midia);
            const lojaNome = peca.loja || peca.nomeLoja || 'Peça Bruta';

            let valorBruto = peca.preco && peca.preco.$numberDecimal ? peca.preco.$numberDecimal : peca.preco;
            let precoNumerico = parseFloat(valorBruto);
            let precoFormatado = isNaN(precoNumerico) ? "0,00" : precoNumerico.toFixed(2).replace('.', ',');

            return `
            <article class="post" onclick="window.location.href='produto.html?id=${peca._id}'">
                <div class="post-media"><img src="${imgUrl}"></div>
                <div class="post-body">
                    <h2 style="font-size: 13px; font-weight:600; color:#eee;">${peca.titulo.toUpperCase()}</h2>
                    <div class="price-text">R$ ${precoFormatado}</div>
                    <div class="store-name store-link" onclick="event.stopPropagation(); irParaPerfilLoja('${lojaNome}')">
                        ${lojaNome}
                    </div>
                </div>
            </article>`;
        }).join('');
    }
}

function logout() {
    sessionStorage.removeItem('usuario');
    sessionStorage.removeItem('usuarioLogado');
    sessionStorage.removeItem('clienteLogado');
    sessionStorage.removeItem('cliente');
    sessionStorage.removeItem('usuarioNome');
    sessionStorage.removeItem('nomeCliente');
    sessionStorage.removeItem('tipoUsuario');
    window.location.reload();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay'); 

    if (sidebar) {
        sidebar.classList.toggle('active');
    }

    if (overlay) {
        overlay.classList.toggle('active');
    }
}

window.onload = () => {
    carregarProdutos();
    carregarParceiros();
    atualizarContadorCarrinho();

    let userRaw = sessionStorage.getItem('usuario') || 
                  sessionStorage.getItem('usuarioLogado') || 
                  sessionStorage.getItem('clienteLogado') || 
                  sessionStorage.getItem('cliente');          

    let nomeAvulso = sessionStorage.getItem('usuarioNome') || 
                     sessionStorage.getItem('nomeCliente');
    let user;

    try { 
        user = JSON.parse(userRaw); 
    } 
    catch(e) { 
        user = userRaw; 
    }

    const tipoUser = sessionStorage.getItem('tipoUsuario') || 'cliente'; 
    const authSection = document.getElementById('auth-section');
    const sidebarUser = document.getElementById('nomeUsuarioSidebar');
    const areaPJ = document.getElementById('areaExclusivaPJ');
    const linkSairSide = document.getElementById('linkSairSidebar');
    
    // Captura o botão novo
    const btnLojistaPedidos = document.getElementById('btnLojistaPedidos');

    if (user || nomeAvulso) {
        let nomeExibicao = "USUÁRIO";
        
        if (user && typeof user === 'object') {
            nomeExibicao = user.nome || user.name || "USUÁRIO";
        } else if (nomeAvulso) {
            nomeExibicao = nomeAvulso;
        } else if (typeof user === 'string' && user.trim() !== "") {
            nomeExibicao = user;
        }

        if (sidebarUser) sidebarUser.innerText = nomeExibicao.toUpperCase();
        if (linkSairSide) linkSairSide.style.display = 'block';

        // VERIFICA SE É LOJA
        if (tipoUser === 'loja' || tipoUser === 'admin') {
            if (areaPJ) areaPJ.style.display = 'block';
            if (authSection) {
                authSection.innerHTML = `
                    <a href="javascript:void(0)" onclick="window.location.href='sistema-empresa.html'" class="user-link-header">
                        ${nomeExibicao.toUpperCase()}
                    </a>
                    <button onclick="logout()" class="btn-logout-header">Sair</button>
                `;
            }

            
            // A MÁGICA ACONTECE AQUI: Mostra o botão de requisições!
            if (btnLojistaPedidos) {
                btnLojistaPedidos.style.display = 'block';
            }

        } else {
            // SE FOR CLIENTE
            if (authSection) {
                authSection.innerHTML = `
                    <span style="color: #ff4d00; font-family: 'Orbitron'; font-weight: bold; font-size: 12px; margin-right: 10px; cursor: pointer;" onclick="window.location.href='perfil-cliente.html'">
                        ${nomeExibicao.toUpperCase()}
                    </span>
                    <button onclick="logout()" class="btn-logout-header">Sair</button>
                `;
            }
        }
    }

    // Nova variável global para segurar os dados vindos da API
let produtosDoBanco = [];

const selectCategoria = document.getElementById('filterCategory');
const selectOrdem = document.getElementById('filterOrder');

// 1. GATILHO UNIVERSAL: Uma única função acionada ao mudar qualquer select
function atualizarFiltros() {
    const categoria = selectCategoria.value;
    const ordem = selectOrdem.value;
    const busca = document.getElementById('searchInput').value; 
    
    carregarProdutos(categoria, ordem, busca);
}

// "Escuta" os campos (Basta estes dois!)
selectCategoria.addEventListener('change', atualizarFiltros);
selectOrdem.addEventListener('change', atualizarFiltros);

// Garante que a função vai rodar automaticamente assim que a página abrir
document.addEventListener('DOMContentLoaded', () => {
    carregarCategoriasNoSelect();
    atualizarFiltros();
});

// Função para buscar e preencher as categorias
async function carregarCategoriasNoSelect() {
    const selectCategoria = document.getElementById('filterCategory');
    try {
        const response = await apiFetch(`${API_URL}/categorias`);
        const data = await response.json();
        if (response.ok && data.success) {
            selectCategoria.innerHTML = '<option value="" selected>Todos...</option>';
            data.categorias.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.nome;
                option.textContent = cat.nome;
                selectCategoria.appendChild(option);
            });
            // 🔴 LIMPEZA FEITA: Removemos gatilhos repetidos que ficavam aqui e causavam conflito.
        } 
        else {
            selectCategoria.innerHTML = '<option value="" disabled>Erro ao carregar categorias</option>';
        }
    } 
    catch (erro) {
        console.error('Falha ao buscar categorias:', erro);
        selectCategoria.innerHTML = '<option value="" disabled>Servidor indisponível</option>';
    }
}

function atualizarContadorCarrinho() {
    const carrinho = JSON.parse(sessionStorage.getItem('carrinho')) || [];
    const contador = document.getElementById('cartCounter');
    if (carrinho.length > 0) {
        contador.innerText = carrinho.length;
        contador.style.display = 'flex';
    } else {
        contador.style.display = 'none';
    }
}

function logout() {
    sessionStorage.removeItem('usuarioLogado');
    sessionStorage.removeItem('tipoUsuario');
    sessionStorage.removeItem('token');
    window.location.reload();
}

function irParaPerfilLoja(nomeLoja) {
    sessionStorage.setItem('loja_ativa_perfil', nomeLoja);
    window.location.href = `perfil-loja.html?nome=${encodeURIComponent(nomeLoja)}`;
}

function parsePreco(precoStr) {
    if (!precoStr) return 0;
    return parseFloat(precoStr.toString().replace("R$", "").replace(/\./g, "").replace(",", ".").trim());
}

async function carregarParceiros() {
    const container = document.getElementById('listaParceirosDestaque');
    try {
        const response = await apiFetch(`${API_URL}/parceiros`, {
            method: 'GET'
        });

        if(response.ok) {
            const data = await response.json();
            const lojas = data.lojas || [];
            
            if(lojas.length === 0) {
                container.style.display = 'none';
                return;
            }
            
            container.innerHTML = lojas.map(loja => {
                const inicial = loja.nome.charAt(0).toUpperCase();
                return `
                    <div class="partner-item" onclick="irParaPerfilLoja('${loja.nome}')">
                        <div class="partner-circle">
                            ${loja.fotoPerfil 
                                ? `<img src="${loja.fotoPerfil}" alt="${loja.nome}">` 
                                : `<span class="partner-initial">${inicial}</span>`
                            }
                        </div>
                        <span class="partner-name">${loja.nome}</span>
                    </div>
                `;
            }).join('');
        } else {
            container.style.display = 'none';
        }
    } catch (err) {
        console.error("Erro de conexão ao carregar parceiros:", err);
        container.style.display = 'none';
    }
}

function carregarProdutos(categoria = '', ordem = '', busca = '') {
    buscarProdutosDoServidor(categoria, ordem, busca);
}

async function buscarProdutosDoServidor(categoria = '', ordem = '', busca = '') {
    document.getElementById('feed-list').innerHTML = '<h3 class="looding">Carregando produtos...</h3>';
    try {
        const params = new URLSearchParams();
        
        // Se escolheu categoria, anexa na URL
        if (categoria && categoria !== 'Todos...') {
            params.append('categoria', categoria);
        }
        // Anexa ordem
        if (ordem) params.append('ordem', ordem);
        
        // Se digitou algo na busca, anexa na URL
        if (busca && busca.trim() !== '') {
            params.append('busca', busca);
        }
        
        const url = `${API_URL}/produtos/feed?${params.toString()}`;
        const response = await apiFetch(url);
        const data = await response.json();
          
        if (response.ok && data.success) {
            produtosDoBanco = data.pecas || []; 
            renderizarFeed(); 
        } else {
            console.error("A API retornou um erro. Status:", response.status);
            produtosDoBanco = [];
            renderizarFeed(); 
        }

    } catch (erro) {
        console.error("Servidor offline ou erro de conexão:", erro);
        produtosDoBanco = [];
        renderizarFeed(); 
    }
}

function renderizarFeed() {
    const termo = document.getElementById('searchInput').value.toLowerCase();
    const ordem = document.getElementById('filterOrder').value;
    const container = document.getElementById('feed-list');
    
    const titulo = document.getElementById('tituloVitrine');
    const parceiros = document.getElementById('listaParceirosDestaque');
    
    // Esconde o banner de parceiros caso haja uma pesquisa
    if (termo.trim() !== "") {
        titulo.style.display = 'none';
        parceiros.style.display = 'none';
    } else {
        titulo.style.display = 'block';
        parceiros.style.display = 'flex';
    }

    // 🔴 LIMPEZA FEITA: Como o Backend já envia as peças perfeitamente filtradas, 
    // nós não precisamos filtrar no JavaScript. Apenas aplicamos a ordem de preço!
    let filtradas = [...produtosDoBanco];

    if (ordem === "menor") {
        filtradas.sort((a, b) => parsePreco(a.preco) - parsePreco(b.preco));
    } else if (ordem === "maior") {
        filtradas.sort((a, b) => parsePreco(b.preco) - parsePreco(a.preco));
    }

    if (filtradas.length === 0) {
        container.innerHTML = `
            <div class="no-results">
                <h2>NENHUMA PEÇA ENCONTRADA</h2>
                <p>Não encontramos resultados para "${termo.toUpperCase()}". Verifique a ortografia ou tente termos mais genéricos.</p>
            </div>
        `;
    } 
    else {                       
        container.innerHTML = filtradas.map((peca, index) => {

            const imgUrl = (peca.imagens && peca.imagens.length > 0) ? peca.imagens[0] : (peca.midia);
            const lojaNome = peca.loja || peca.nomeLoja || 'Peça Bruta';

            let valorBruto = peca.preco && peca.preco.$numberDecimal ? peca.preco.$numberDecimal : peca.preco;
            let precoNumerico = parseFloat(valorBruto);
            let precoFormatado = isNaN(precoNumerico) ? "0,00" : precoNumerico.toFixed(2).replace('.', ',');

            return `
            <article class="post" onclick="window.location.href='produto.html?id=${peca._id}'">
                <div class="post-media"><img src="${imgUrl}"></div>
                <div class="post-body">
                    <h2 style="font-size: 13px; font-weight:600; color:#eee;">${peca.titulo.toUpperCase()}</h2>
                    <div class="price-text">R$ ${precoFormatado}</div>
                    <div class="store-name store-link" onclick="event.stopPropagation(); irParaPerfilLoja('${lojaNome}')">
                        ${lojaNome}
                    </div>
                </div>
            </article>`;
        }).join('');
    }
}

function logout() {
    sessionStorage.removeItem('usuario');
    sessionStorage.removeItem('usuarioLogado');
    sessionStorage.removeItem('clienteLogado');
    sessionStorage.removeItem('cliente');
    sessionStorage.removeItem('usuarioNome');
    sessionStorage.removeItem('nomeCliente');
    sessionStorage.removeItem('tipoUsuario');
    window.location.reload();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay'); 

    if (sidebar) {
        sidebar.classList.toggle('active');
    }

    if (overlay) {
        overlay.classList.toggle('active');
    }
}

window.onload = () => {
    carregarProdutos();
    carregarParceiros();
    atualizarContadorCarrinho();

    let userRaw = sessionStorage.getItem('usuario') || 
                  sessionStorage.getItem('usuarioLogado') || 
                  sessionStorage.getItem('clienteLogado') || 
                  sessionStorage.getItem('cliente');          

    let nomeAvulso = sessionStorage.getItem('usuarioNome') || 
                     sessionStorage.getItem('nomeCliente');
    let user;

    try { 
        user = JSON.parse(userRaw); 
    } 
    catch(e) { 
        user = userRaw; 
    }

    const tipoUser = sessionStorage.getItem('tipoUsuario') || 'cliente'; 
    const authSection = document.getElementById('auth-section');
    const sidebarUser = document.getElementById('nomeUsuarioSidebar');
    const areaPJ = document.getElementById('areaExclusivaPJ');
    const linkSairSide = document.getElementById('linkSairSidebar');
    
    // Captura o botão novo
    const btnLojistaPedidos = document.getElementById('btnLojistaPedidos');

    if (user || nomeAvulso) {
        let nomeExibicao = "USUÁRIO";
        
        if (user && typeof user === 'object') {
            nomeExibicao = user.nome || user.name || "USUÁRIO";
        } else if (nomeAvulso) {
            nomeExibicao = nomeAvulso;
        } else if (typeof user === 'string' && user.trim() !== "") {
            nomeExibicao = user;
        }

        if (sidebarUser) sidebarUser.innerText = nomeExibicao.toUpperCase();
        if (linkSairSide) linkSairSide.style.display = 'block';

        // VERIFICA SE É LOJA
        if (tipoUser === 'loja' || tipoUser === 'admin') {
            if (areaPJ) areaPJ.style.display = 'block';
            if (authSection) {
                authSection.innerHTML = `
                    <a href="javascript:void(0)" onclick="window.location.href='sistema-empresa.html'" class="user-link-header">
                        ${nomeExibicao.toUpperCase()}
                    </a>
                    <button onclick="logout()" class="btn-logout-header">Sair</button>
                `;
            }
            
            // A MÁGICA ACONTECE AQUI: Mostra o botão de requisições!
            if (btnLojistaPedidos) {
                btnLojistaPedidos.style.display = 'block';
            }

        } else {
            // SE FOR CLIENTE
            if (authSection) {
                authSection.innerHTML = `
                    <span style="color: #ff4d00; font-family: 'Orbitron'; font-weight: bold; font-size: 12px; margin-right: 10px; cursor: pointer;" onclick="window.location.href='perfil-cliente.html'">
                        ${nomeExibicao.toUpperCase()}
                    </span>
                    <button onclick="logout()" class="btn-logout-header">Sair</button>
                `;
            }
        }
    }
};

};

// ========================================================
// 🔴 NOVO: FORÇA A ATUALIZAÇÃO AO VOLTAR PARA O FEED
// ========================================================
window.addEventListener('pageshow', function(event) {
    // Se a tela for puxada do cache (seta de voltar do navegador)
    if (event.persisted || (window.performance && window.performance.navigation.type === 2)) {
        window.location.reload(); // Força um reload limpo para atualizar o nome no cabeçalho
    }
});