const API_URL = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? 'http://localhost:3000/api' : 'https://api.pecabruta.com.br/api';
function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}
        
let logado = JSON.parse(sessionStorage.getItem('usuario')) || { nome: "Visitante" };
const userStr = sessionStorage.getItem('usuario');
if (userStr) {
    const parsed = JSON.parse(userStr);
    if (parsed.user) logado = parsed.user;
}

const params = new URLSearchParams(window.location.search);
const lojaNomeUrl = params.get('nome') || "Peça Bruta";

async function carregarDadosLojaAPI() {
    try {
        const response = await apiFetch(`${API_URL}/loja/${encodeURIComponent(lojaNomeUrl)}`);
        
        if (!response.ok) {
            throw new Error('Loja não encontrada no servidor.');
        }

        const data = await response.json();
        const lojaInfo = data.loja;
        const pecasDaLoja = data.produtos || [];

        document.getElementById('shopName').innerText = lojaInfo.nome.toUpperCase();
        document.getElementById('numPosts').innerText = pecasDaLoja.length;

        let fotoParaExibir = lojaInfo.fotoPerfil || "";
        let bioParaExibir = lojaInfo.bio || "Parceiro Oficial Peça Bruta.";

        // === 🔴 DETETIVE VIP: Verifica se quem tá olhando a página é o DONO DA LOJA ===
        const isOwner = logado.nome && logado.nome.trim().toLowerCase() === lojaInfo.nome.trim().toLowerCase();

        if (isOwner) {
            document.getElementById('btnArea').innerHTML = `<button class="btn btn-follow" onclick="location.href='sistema-empresa.html'">EDITAR PERFIL</button>`;
        } else {
            renderUserButtons();
        }

        const imgEl = document.getElementById('shopImg');
        const initEl = document.getElementById('shopInitial');

        if (fotoParaExibir && fotoParaExibir.length > 50) { 
            imgEl.src = fotoParaExibir;
            imgEl.style.display = 'block';
            initEl.style.display = 'none';
        } else {
            initEl.innerText = lojaInfo.nome.charAt(0).toUpperCase();
            initEl.style.display = 'block';
            imgEl.style.display = 'none';
        }

        document.getElementById('shopBio').innerText = bioParaExibir;
        updateFollowerCount();
        
        // Passa o resultado do "detetive" para a função desenhar (ou não) a lixeira
        renderProducts(pecasDaLoja, isOwner);

    } catch (error) {
        console.error(error);
        document.getElementById('shopName').innerText = lojaNomeUrl.toUpperCase();
        document.getElementById('shopBio').innerText = "Não foi possível carregar os dados desta loja no momento.";
    }
}

function renderUserButtons() {
    const db = JSON.parse(sessionStorage.getItem('db_seguidores')) || {};
    const lista = db[lojaNomeUrl] || [];
    const jaSegue = logado.nome && lista.includes(logado.nome);
    const btnArea = document.getElementById('btnArea');

    btnArea.innerHTML = `
        <button class="btn ${jaSegue ? 'btn-active-follow' : 'btn-follow'}" onclick="toggleFollow()">
            ${jaSegue ? 'SEGUINDO' : 'SEGUIR'}
        </button>
        <button class="btn btn-following" onclick="alert('Funcionalidade de chat em breve!')">MENSAGEM</button>
    `;
}

function toggleFollow() {
    if(!logado.nome || logado.nome === "Visitante") return alert("Faça login para seguir!");
    let db = JSON.parse(sessionStorage.getItem('db_seguidores')) || {};
    let lista = db[lojaNomeUrl] || [];

    if(lista.includes(logado.nome)) {
        lista = lista.filter(u => u !== logado.nome);
    } else {
        lista.push(logado.nome);
    }

    db[lojaNomeUrl] = lista;
    sessionStorage.setItem('db_seguidores', JSON.stringify(db));
    updateFollowerCount();
    renderUserButtons();
}

function updateFollowerCount() {
    const db = JSON.parse(sessionStorage.getItem('db_seguidores')) || {};
    const count = (db[lojaNomeUrl] || []).length;
    document.getElementById('numFollowers').innerText = count;
}

// === 🗑️ NOVA FUNÇÃO: O TRITURADOR DE PEÇAS (COM AVISO BONITÃO) ===
function excluirPeca(idProduto, event) {
    // Impede que o clique na lixeira acabe abrindo a página da peça sem querer
    event.stopPropagation(); 

    // 1. Cria o fundo escuro desfocado (overlay)
    const overlay = document.createElement('div');
    overlay.id = 'modalExclusaoPezaBruta';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)'; // Fundo preto transparente
    overlay.style.backdropFilter = 'blur(8px)'; // Deixa o fundo embaçado (estilo Apple)
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';

    // 2. Cria a caixinha do popup estilizada
    const modalBox = document.createElement('div');
    modalBox.style.background = '#0a0a0a';
    modalBox.style.border = '1px solid #ff3333'; // Borda vermelha de alerta
    modalBox.style.borderRadius = '8px';
    modalBox.style.padding = '30px';
    modalBox.style.textAlign = 'center';
    modalBox.style.maxWidth = '350px';
    modalBox.style.boxShadow = '0 15px 35px rgba(255, 0, 0, 0.2)';
    modalBox.style.fontFamily = "'Inter', sans-serif";

    // 3. Coloca o texto e os botões dentro da caixinha
    modalBox.innerHTML = `
        <h3 style="color: #ff3333; font-family: 'Orbitron'; font-size: 18px; margin-top: 0; margin-bottom: 15px;">⚠️ EXCLUIR PEÇA?</h3>
        <p style="color: #aaa; font-size: 14px; margin-bottom: 25px; line-height: 1.5;">
            Tem certeza que deseja mandar esta peça para o triturador?<br>Essa ação não poderá ser desfeita.
        </p>
        <div style="display: flex; gap: 15px; justify-content: center;">
            <button id="btnCancelarLixeira" style="background: transparent; border: 1px solid #555; color: #ccc; padding: 10px 15px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: 0.3s;">
                CANCELAR
            </button>
            <button id="btnConfirmarLixeira" style="background: #ff3333; border: none; color: #fff; padding: 10px 15px; border-radius: 4px; font-family: 'Orbitron'; font-weight: bold; cursor: pointer; box-shadow: 0 4px 10px rgba(255,51,51,0.3); transition: 0.3s;">
                SIM, EXCLUIR
            </button>
        </div>
    `;

    // 4. Junta tudo e joga na tela do cliente
    overlay.appendChild(modalBox);
    document.body.appendChild(overlay);

    // 5. O que acontece se o lojista se arrepender e clicar em CANCELAR
    document.getElementById('btnCancelarLixeira').onclick = function() {
        document.body.removeChild(overlay); // Só fecha a caixa e não faz nada
    };

    // 6. O que acontece se o lojista clicar em SIM, EXCLUIR
    document.getElementById('btnConfirmarLixeira').onclick = async function() {
        document.body.removeChild(overlay); // Fecha a caixa primeiro
        
        // Executa a exclusão lá no MongoDB
        await executarExclusaoDeVerdadeAPI(idProduto);
    };
}

// === FUNÇÃO QUE VAI NO SERVIDOR EXCLUIR DE VERDADE ===
async function executarExclusaoDeVerdadeAPI(idProduto) {
    let token = sessionStorage.getItem('token');
    const userStr = sessionStorage.getItem('usuario');
    if (userStr) {
        const parsed = JSON.parse(userStr);
        if (parsed.token) token = parsed.token;
    }

    try {
        const response = await apiFetch(`${API_URL}/produtos/${idProduto}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            carregarDadosLojaAPI(); // Recarrega a vitrine atualizada (sem a peça)
        } else {
            const data = await response.json();
            alert("Erro ao excluir: " + (data.error || "Tente novamente."));
        }
    } catch (error) {
        console.error("Erro:", error);
        alert("Falha de comunicação com o servidor.");
    }
}

// === 🔴 ATENÇÃO: FUNÇÃO ALTERADA PARA RECEBER A LIXEIRA (isOwner) ===
function renderProducts(pecas, isOwner) {
    const grid = document.getElementById('productGrid');

    if(pecas.length === 0) {
        grid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: #444; font-family: 'Orbitron'; margin-top: 50px;">NENHUM PRODUTO PUBLICADO AINDA.</p>`;
        return;
    }

    grid.innerHTML = pecas.map((p) => {
        const imagemSrc = (p.imagens && p.imagens.length > 0) ? p.imagens[0] : (p.midia || 'https://via.placeholder.com/300?text=Sem+Foto');
        const lojaNome = p.loja || p.nomeLoja || lojaNomeUrl || 'Peça Bruta';
        const produtoReservado = String(p.visibilidade || '').trim().toLowerCase() === 'reservado';
        const badgeReservado = produtoReservado
            ? '<span class="badge-reservado">🔒 RESERVADO</span>'
            : '';

        let valorBruto = p.preco && p.preco.$numberDecimal ? p.preco.$numberDecimal : p.preco;
        let precoNumerico = parseFloat(valorBruto);
        let precoFormatado = isNaN(precoNumerico) ? "0,00" : precoNumerico.toFixed(2).replace('.', ',');

        // 🔴 MÁGICA: A lixeirinha só é injetada no HTML se o cara for o Dono da loja!
        let botaoLixeira = '';
        if (isOwner) {
            botaoLixeira = `
            <button onclick="excluirPeca('${p._id}', event)" 
                    style="position: absolute; top: 10px; left: 10px; background: rgba(255,0,0,0.85); color: white; border: 1px solid #330000; border-radius: 6px; padding: 6px 12px; font-size: 11px; font-weight: bold; cursor: pointer; z-index: 10; font-family: 'Inter'; box-shadow: 0 4px 10px rgba(0,0,0,0.5); transition: 0.2s;">
                🗑️ EXCLUIR
            </button>`;
        }

        // Repare no style="position: relative;" no article para a lixeira ficar presa no canto do cartão
        return `
        <article class="post" style="position: relative;" onclick="location.href='produto.html?id=${p._id}'">
            ${botaoLixeira}
            <div class="post-media">${badgeReservado}<img src="${imagemSrc}" alt="${p.titulo}"></div>
            <div class="post-body">
                <h2 style="font-size: 13px; font-weight:600; color:#eee;">${p.titulo.toUpperCase()}</h2>
                <div class="price-text">R$ ${precoFormatado}</div>
                <div class="store-name store-link">
                    ${lojaNome}
                </div>
            </div>
        </article>`;
    }).join('');
}

window.onload = carregarDadosLojaAPI;
