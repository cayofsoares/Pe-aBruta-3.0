const API_URL = 'https://pe-abruta-3-0.onrender.com/api';
function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}

(function restaurarSessaoDaAbaDeMensagens() {
    const url = new URL(window.location.href);
    const bridgeId = url.searchParams.get('pbAuthBridge');
    if (!bridgeId) return;

    url.searchParams.delete('pbAuthBridge');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    if (!/^\d+-[a-z0-9]+$/i.test(bridgeId)) return;

    const bridgeKey = `pb_auth_bridge:${bridgeId}`;
    try {
        const bridgeRaw = localStorage.getItem(bridgeKey);
        localStorage.removeItem(bridgeKey);
        const bridge = bridgeRaw ? JSON.parse(bridgeRaw) : null;
        if (!bridge || bridge.expiresAt <= Date.now() || typeof bridge.token !== 'string') return;

        if (!sessionStorage.getItem('token')) sessionStorage.setItem('token', bridge.token);
        if (!sessionStorage.getItem('usuario') && typeof bridge.usuario === 'string') {
            sessionStorage.setItem('usuario', bridge.usuario);
        }
    } catch (erro) {
        console.warn('Não foi possível restaurar a sessão transferida do chat.');
    }
})();

// Variável de estado mantida segura e carregada via API sempre que possível
        let pecaAtual = null;
        let selectedRating = 0; // Armazena a nota selecionada pelo usuário
        let isUserLoggedIn = false;

        window.onload = async function() {
            verificarLogin();
            await carregarProdutoSeguro();
        };

        function verificarLogin() {
            const token = getTokenSeguro();
            isUserLoggedIn = !!token;
            if (isUserLoggedIn) {
                document.getElementById('addReviewBox').style.display = 'block';
            }
        }

        function getTokenSeguro() {
            let token = sessionStorage.getItem('token'); 
            if (!token) {
                try {
                    const u = JSON.parse(sessionStorage.getItem('usuario'));
                    if (u && u.token) token = u.token;
                } catch(e) {}
            }
            return token || sessionStorage.getItem('usuario'); 
        }

        function getTokenAutenticacao() {
            const tokenDireto = sessionStorage.getItem('token');
            if (tokenDireto) return tokenDireto;

            try {
                const usuario = JSON.parse(sessionStorage.getItem('usuario'));
                return usuario?.token || usuario?.user?.token || null;
            } catch (erro) {
                return null;
            }
        }

        // --- SISTEMA DE CARREGAMENTO SEGURO VIA API ---
        async function carregarProdutoSeguro() {
            try {
                // 1. Pega ID da URL (Ex: produto.html?id=12345)
                const urlParams = new URLSearchParams(window.location.search);
                const produtoId = urlParams.get('id');
                
                if (!produtoId) {
                    throw new Error("Produto não referenciado na URL.");
                }

                // 2. Busca na API de forma autoritativa
                const res = await apiFetch(`${API_URL}/produtos/${produtoId}`);
                if (res.ok) {
                    const data = await res.json();
                    pecaAtual = data.produto || data; // Adaptação para o formato de resposta do backend
                } else {
                    throw new Error("Produto não encontrado no servidor.");
                }

                // Validação final de segurança: O produto existe?
                if (!pecaAtual || !pecaAtual.titulo) {
                    mostrarErroFatal("PRODUTO NÃO ENCONTRADO", "Este anúncio foi removido ou está indisponível no momento.");
                    return;
                }

                // 3. Renderizar a Interface após aprovação de segurança
                renderizarDetalhesIniciais();
                renderizarGaleriaSegura();
                carregarDadosLojaAPI(pecaAtual.loja || pecaAtual.nomeLoja);
                carregarAvaliacoesAPI(produtoId);
                verificarEstadoCarrinho();

            } catch (err) {
                console.error(err);
                mostrarErroFatal("ERRO DE CONEXÃO", "Falha ao carregar as informações críticas do produto.");
            }
        }

        function mostrarErroFatal(titulo, msg) {
            document.querySelector('.vitrine-container').innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 60px; background: #0a0a0a; border: 1px dashed #333; border-radius: 8px;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 40px; color: #ff3333; margin-bottom: 20px;"></i>
                    <h2 style="color: #ff4d00; font-family: 'Orbitron'; margin-bottom: 10px;">${titulo}</h2>
                    <p style="color: #888; margin-bottom: 25px;">${msg}</p>
                    <button class="btn-checkout-brutal" style="max-width: 250px; margin: 0 auto;" onclick="window.location.href='feed.html'">VOLTAR AO CATÁLOGO</button>
                </div>
            `;
        }

       // ========================================================
        // 🔴 ATENÇÃO: FUNÇÃO MODIFICADA PARA CORRIGIR O PREÇO E ADICIONAR OPÇÕES
        // ========================================================
        function renderizarDetalhesIniciais() {
            document.getElementById('display-tit').textContent = pecaAtual.titulo || "Produto Peça Bruta";
            
            // 1. Extrai o número do objeto Decimal128 do MongoDB
            let valorBruto = pecaAtual.preco && pecaAtual.preco.$numberDecimal ? pecaAtual.preco.$numberDecimal : pecaAtual.preco;
            
            // 2. Transforma em número decimal
            let precoNumerico = parseFloat(valorBruto);
            
            // 3. Formata para o padrão visual (ex: 12,10)
            let precoFormatado = isNaN(precoNumerico) ? "0,00" : precoNumerico.toFixed(2).replace('.', ',');

            // 4. Aplica o preço formatado na tela
            document.getElementById('display-prc').textContent = "R$ " + precoFormatado;
            
            document.getElementById('display-dsc').textContent = pecaAtual.descricao || "Nenhuma descrição técnica fornecida.";
            document.getElementById('display-cat').textContent = (pecaAtual.categoria || "Geral").toUpperCase();

            // ========================================================
            // === NOVO PASSO 3: LÓGICA DE OPÇÕES / VARIAÇÕES DA PEÇA ===
            // ========================================================
            const containerOpcoes = document.getElementById('opcoes-container');
            const divOpcoes = document.getElementById('display-opcoes');
            
            if (divOpcoes && containerOpcoes) {
                divOpcoes.innerHTML = ''; // Limpa opções antigas por segurança
                
                // Verifica se a peça tem opções e se o array não está vazio
                if (pecaAtual.opcoes && Array.isArray(pecaAtual.opcoes) && pecaAtual.opcoes.length > 0) {
                    // A peça TEM opções! Mostra o container
                    containerOpcoes.style.display = 'block';
                    
                    // Cria um botão para cada opção cadastrada
                    pecaAtual.opcoes.forEach(opcao => {
                        if (opcao.trim() !== "") {
                            const btn = document.createElement('button');
                            btn.textContent = opcao.trim();
                            btn.className = 'btn-opcao-variacao'; 
                            
                            // Evento de clique para o usuário selecionar a opção
                            btn.onclick = function() {
                                // Remove a cor de todos e pinta só o clicado
                                document.querySelectorAll('.btn-opcao-variacao').forEach(b => b.classList.remove('ativa'));
                                this.classList.add('ativa');
                                
                                // Salva a escolha para ser enviada ao carrinho depois
                                window.opcaoSelecionadaParaCompra = opcao.trim();
                            };
                            divOpcoes.appendChild(btn);
                        }
                    });
                } else {
                    // A peça NÃO TEM opções (peça única). Mantém escondido.
                    containerOpcoes.style.display = 'none';
                    window.opcaoSelecionadaParaCompra = null;
                }
            }
            // ========================================================
        }
        // ========================================================
        // ========================================================

        function renderizarGaleriaSegura() {

            const displayImg = document.getElementById('display-img');
            const thumbArea = document.getElementById('thumb-area');
            debugger;
            // Verifica se array de imagens existe e tem conteúdo válido
            if (!pecaAtual.imagens || !Array.isArray(pecaAtual.imagens) || pecaAtual.imagens.length === 0) {
                displayImg.src = "https://via.placeholder.com/600x400/111111/ff4d00?text=Sem+Imagem";
                thumbArea.innerHTML = "";
                return;
            }

            displayImg.src = pecaAtual.imagens[0];
            thumbArea.innerHTML = "";

            pecaAtual.imagens.forEach((imgSrc, idx) => {
                // Valida a URL ou Base64 básico
                if(!imgSrc || imgSrc.trim() === "") return;

                const el = document.createElement('img');
                el.src = imgSrc;
                if(idx === 0) el.classList.add('active');
                
                el.onclick = () => {
                    displayImg.src = imgSrc;
                    document.querySelectorAll('.thumb-bar img').forEach(t => t.classList.remove('active'));
                    el.classList.add('active');
                };
                thumbArea.appendChild(el);
            });
        }

        // --- SISTEMA DE INFORMAÇÕES DA LOJA (API FETCH) ---
        async function carregarDadosLojaAPI(nomeLoja) {
            
            const fallbackNome = nomeLoja || "Vendedor Não Informado";
            document.getElementById('storeNameInfo').textContent = fallbackNome.toUpperCase();
            document.getElementById('storeInitial').textContent = fallbackNome.charAt(0).toUpperCase();
            document.getElementById('storeInfoBox').onclick = () => irParaPerfil(fallbackNome);

            if (!nomeLoja) return;

            try {
                // Fetch de dados da loja na API real
                const response = await apiFetch(`${API_URL}/loja/${encodeURIComponent(nomeLoja)}`);
                if(response.ok) {
                    const data = await response.json();
                    
                    // Quantidade de produtos reais da loja
                    if(data.produtos) {
                        document.getElementById('storeProductCount').innerHTML = `<i class="fas fa-box"></i> ${data.produtos.length} Produtos`;
                    }

                    const infoLoja = data.loja || {};
                    // Exibir selo verificado se a conta for autenticada como 'loja' oficial
                    if (infoLoja.tipo === 'loja') {
                        document.getElementById('storeVerifiedBadge').style.display = 'inline-block';
                    }

                    // Para dados não retornados ainda pelo banco, injetamos mock visual compatível
                    document.getElementById('storeSalesCount').innerHTML = `<i class="fas fa-shopping-bag"></i> ${infoLoja.vendasTotais || Math.floor(Math.random() * 300 + 50)} Vendas`;
                    document.getElementById('storeRatingInfo').textContent = infoLoja.notaMedia || "4.9";
                }
            } catch(e) {
                console.warn("Dados estendidos da loja não puderam ser carregados.");
            }
        }

        function irParaPerfil(nomeLoja) {
            sessionStorage.setItem('loja_ativa_perfil', nomeLoja);
            window.location.href = 'perfil-loja.html?nome=' + encodeURIComponent(nomeLoja);
        }
        // --- NOVO SISTEMA VISUAL DE AVALIAÇÕES REAIS (INTEGRADO COM API) ---
        
        function setRating(rating) {
            selectedRating = rating;
            const stars = document.querySelectorAll('#starSelectArea i');
            stars.forEach((star, index) => {
                if (index < rating) {
                    star.classList.remove('far');
                    star.classList.add('fas');
                } else {
                    star.classList.remove('fas');
                    star.classList.add('far');
                }
            });
        }

        async function enviarAvaliacao() {

            if (selectedRating === 0) {
                return alert('Por favor, selecione uma nota de 1 a 5 estrelas.');
            }
            const texto = document.getElementById('reviewTextInput').value.trim();
            if (!texto) {
                return alert('Por favor, escreva um comentário sobre o produto.');
            }

            const btn = document.getElementById('btnSubmitReview');
            btn.disabled = true;
            btn.textContent = 'ENVIANDO...';

            try {
                // Recupera ID real do produto ou fallback
                const urlParams = new URLSearchParams(window.location.search);
                let produtoId = urlParams.get('id');
                if(!produtoId && pecaAtual && pecaAtual._id) produtoId = pecaAtual._id;

                if(!produtoId) throw new Error("ID do produto indisponível para avaliar.");

                const response = await apiFetch(`${API_URL}/produtos/${produtoId}/avaliacoes`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getTokenSeguro()}` 
                    },
                    body: JSON.stringify({ nota: selectedRating, texto: texto })
                });

                const data = await response.json();

                if (response.ok) {

                    alert('Avaliação publicada com sucesso!');
                    document.getElementById('reviewTextInput').value = '';

                    setRating(0); // Reseta as estrelas

                    // Recarrega as avaliações atualizadas
                    carregarAvaliacoesAPI(produtoId);
                } 
                else {
                    alert('Erro: ' + (data.error || 'Falha ao enviar avaliação.'));
                }

            } catch (err) {
                console.error(err);
                alert('Erro de conexão ao tentar enviar a avaliação.');
            } finally {
                btn.disabled = false;
                btn.textContent = 'ENVIAR AVALIAÇÃO';
            }
        }

        async function carregarAvaliacoesAPI(produtoId) {
            const listContainer = document.getElementById('reviewsList');
            let avaliacoes = [];
            let media = 0;

            if(!produtoId) {
                renderizarReviewsUI([], 0, listContainer);
                return;
            }

            try {
                // Rota real da API de reviews do Backend
                const response = await apiFetch(`${API_URL}/produtos/${produtoId}/avaliacoes`);
                if (!response.ok) throw new Error("Rota de avaliações falhou");
                debugger;
                const data = await response.json();
                avaliacoes = data.avaliacoes || [];
                media = data.mediaGeral || 0;
            } 
            catch (err) {
                console.warn("Falha ao buscar avaliações reais. Verifique se o server.js está rodando.");
                avaliacoes = [];
                media = 0;
            }

            renderizarReviewsUI(avaliacoes, media, listContainer);
        }

        function renderizarReviewsUI(avaliacoes, mediaGeral, container) {
            // Nenhuma avaliação encontrada
            if (!avaliacoes || avaliacoes.length === 0) {
                document.getElementById('averageRatingText').textContent = "S/N";
                document.getElementById('totalReviewsText').textContent = "(0 avaliações)";
                document.getElementById('averageStars').innerHTML = '<i class="far fa-star"></i><i class="far fa-star"></i><i class="far fa-star"></i><i class="far fa-star"></i><i class="far fa-star"></i>';
                
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; background: #0a0a0a; border-radius: 8px; border: 1px dashed #222;">
                        <i class="fas fa-comment-slash" style="font-size: 28px; color: #444; margin-bottom: 12px;"></i>
                        <p style="color: #888; font-size: 13px; margin: 0; font-family:'Orbitron';">Nenhuma avaliação encontrada.</p>
                        <p style="color: #555; font-size: 11px; margin-top: 5px;">Seja o primeiro a avaliar este produto após a compra!</p>
                    </div>
                `;
                document.getElementById('btnVerTodas').style.display = 'none';
                return;
            }

            // Exibir resumo dinâmico
            document.getElementById('averageRatingText').textContent = mediaGeral.toFixed(1);
            document.getElementById('totalReviewsText').textContent = `(${avaliacoes.length} avaliações)`;
            
            // Calculo seguro de estrelas gerais
            let starHtml = '';
            for(let i=1; i<=5; i++) {
                if (i <= Math.floor(mediaGeral)) starHtml += '<i class="fas fa-star"></i>';
                else if (i === Math.ceil(mediaGeral) && !Number.isInteger(mediaGeral)) starHtml += '<i class="fas fa-star-half-alt"></i>';
                else starHtml += '<i class="far fa-star"></i>';
            }
            document.getElementById('averageStars').innerHTML = starHtml;

            // Injetar os HTMLs dinâmicos prevenindo XSS com uso cuidadoso
            container.innerHTML = avaliacoes.map(av => {
                let uStarHtml = '';
                for(let i=1; i<=5; i++) {
                    uStarHtml += i <= av.nota ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>';
                }
                
                // Sanitização simples
                const safeUser = escapeHTML(av.usuario || 'Anônimo');
                const safeText = escapeHTML(av.texto || '');
                // Formata a data se for válida
                let safeDate = '';
                try {
                    safeDate = new Date(av.data).toLocaleDateString('pt-BR');
                } catch(e) { safeDate = 'Data desconhecida'; }

                return `
                    <div class="review-card">
                        <div class="review-user">
                            <strong>${safeUser} <i class="fas fa-check-circle" style="color:#00cc66; font-size:10px; margin-left:5px;" title="Compra Confirmada"></i></strong>
                            <span class="stars">${uStarHtml}</span>
                        </div>
                        <p class="review-text">${safeText}</p>
                        <span class="review-date">${safeDate}</span>
                    </div>
                `;
            }).join('');

            if (avaliacoes.length >= 2) {
                document.getElementById('btnVerTodas').style.display = 'block';
            }
        }

        function escapeHTML(str) {
            return str.replace(/[&<>'"]/g, 
                tag => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    "'": '&#39;',
                    '"': '&quot;'
                }[tag] || tag)
            );
        }

        // --- SISTEMA DE CARRINHO (Ações preservadas) ---
       function verificarEstadoCarrinho() {
            let carrinho = JSON.parse(sessionStorage.getItem('carrinho')) || [];
            const btnRemove = document.getElementById('btnRemoveCart');
            const btnAdd = document.getElementById('btnCartAction');
            
            // Verifica se a peça atual está no carrinho e em qual posição
            let indexExistente = carrinho.findIndex(item => item.titulo === pecaAtual.titulo);

            // =================================================================
            // MÁGICA: Cria um botão "Ir para o Carrinho" dinamicamente (se não existir)
            // =================================================================
            let btnIrCarrinho = document.getElementById('btnIrCarrinho');
            if (!btnIrCarrinho) {
                btnIrCarrinho = document.createElement('button');
                btnIrCarrinho.id = 'btnIrCarrinho';
                btnIrCarrinho.className = 'btn-add-cart'; // Reusa o seu estilo bonitão
                btnIrCarrinho.style.backgroundColor = '#111'; // Fundo mais escuro para diferenciar
                btnIrCarrinho.style.borderColor = '#333';
                btnIrCarrinho.style.color = '#fff';
                btnIrCarrinho.style.marginTop = '10px';
                btnIrCarrinho.innerHTML = '🛒 IR PARA O CARRINHO';
                // Quando clicar, viaja para a página do carrinho
                btnIrCarrinho.onclick = () => window.location.href = 'carrinho.html'; 
                
                // Injerta esse botão logo abaixo do botão de remover
                if (btnRemove) {
                    btnRemove.parentNode.insertBefore(btnIrCarrinho, btnRemove.nextSibling);
                }
            }
            // =================================================================

            if (indexExistente !== -1) {
                // 🟢 SE A PEÇA ESTÁ NO CARRINHO
                let qtdAtual = carrinho[indexExistente].quantidade;
                
                // 1. Mostra no botão principal quantos itens tem
                btnAdd.innerHTML = `➕ ADICIONAR MAIS (No Carrinho: ${qtdAtual})`;
                
                // 2. Mostra o botão de remover e deixa a ação clara
                if(btnRemove) {
                    btnRemove.style.display = 'block';
                    btnRemove.innerHTML = `➖ REMOVER 1 UNIDADE`;
                }

                // 3. Mostra o botão de ir pro carrinho
                btnIrCarrinho.style.display = 'block';

            } else {
                // 🔴 SE A PEÇA NÃO ESTÁ NO CARRINHO (Zeradinho)
                btnAdd.innerHTML = `🛒 ADICIONAR AO CARRINHO`;
                
                if(btnRemove) btnRemove.style.display = 'none';
                btnIrCarrinho.style.display = 'none';
            }
        }

      // ========================================================
        // 🛡️ SISTEMA DE PROTEÇÃO DE ACESSO (LOGIN OBRIGATÓRIO)
        // ========================================================
        function clienteEstaLogado() {
            // Usamos a sua própria função que já valida o token de forma segura!
            return !!getTokenSeguro();
        }

        function mostrarAlertaLogin() {
            // Evita duplicar o modal se o utilizador clicar várias vezes
            if (document.getElementById('modalBloqueioLogin')) return;

            const modalHtml = `
                <div id="modalBloqueioLogin" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); display: flex; justify-content: center; align-items: center; z-index: 9999;">
                    <div style="background: #111; border: 1px solid #ff4d00; padding: 40px; border-radius: 8px; text-align: center; max-width: 420px; width: 90%; box-shadow: 0 10px 40px rgba(255, 77, 0, 0.15);">
                        <i class="fas fa-user-lock" style="font-size: 50px; color: #ff4d00; margin-bottom: 20px;"></i>
                        <h2 style="font-family: 'Orbitron', sans-serif; color: #fff; margin-bottom: 10px; font-size: 22px;">ACESSO RESTRITO</h2>
                        <p style="color: #aaa; font-family: 'Inter', sans-serif; margin-bottom: 30px; line-height: 1.5; font-size: 14px;">
                            Para garantir a segurança da transação, você precisa estar logado na sua conta Peça Bruta antes de comprar ou adicionar itens ao carrinho.
                        </p>
                        <div style="display: flex; flex-direction: column; gap: 15px;">
                            <button onclick="window.location.href='login.html'" style="background: #ff4d00; color: #fff; border: none; padding: 14px; font-family: 'Inter', sans-serif; font-weight: 900; font-size: 14px; border-radius: 4px; cursor: pointer; transition: 0.3s;">
                                FAZER LOGIN OU CADASTRAR
                            </button>
                            <button onclick="document.getElementById('modalBloqueioLogin').remove()" style="background: transparent; color: #666; border: none; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: bold;">
                                FECHAR E VOLTAR
                            </button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }

        // ========================================================
        // FUNÇÕES BLINDADAS COM A NOVA BARREIRA
        // ========================================================
        function adicionarAoCarrinho() {
            // 1. BARREIRA DE AUTENTICAÇÃO: Se não estiver logado, bloqueia!
            if (!clienteEstaLogado()) {
                mostrarAlertaLogin();
                return; 
            }

            let carrinho = JSON.parse(sessionStorage.getItem('carrinho')) || [];
            
            // Verifica se a peça JÁ ESTÁ no carrinho
            let indexExistente = carrinho.findIndex(item => item.titulo === pecaAtual.titulo);

            if (indexExistente !== -1) {
                carrinho[indexExistente].quantidade = (carrinho[indexExistente].quantidade || 1) + 1;
            } else {
                let novoItem = { ...pecaAtual }; 
                novoItem.quantidade = 1;
                carrinho.push(novoItem);
            }

            sessionStorage.setItem('carrinho', JSON.stringify(carrinho));
            
            const btn = document.getElementById('btnCartAction');
            const textoOriginal = btn.innerHTML; 
            
            btn.innerHTML = "✅ ADICIONADO +1";
            btn.style.backgroundColor = "#00cc66";
            btn.style.color = "#fff";
            btn.style.borderColor = "#00cc66";
            
            setTimeout(() => {
                btn.innerHTML = textoOriginal;
                btn.style.backgroundColor = "transparent";
                btn.style.color = "#ff4d00";
                btn.style.borderColor = "#ff4d00";
            }, 1500);

            verificarEstadoCarrinho();
        }

        function removerDoCarrinho() {
            let carrinho = JSON.parse(sessionStorage.getItem('carrinho')) || [];
            
            let indexExistente = carrinho.findIndex(item => item.titulo === pecaAtual.titulo);

            if (indexExistente !== -1) {
                if (carrinho[indexExistente].quantidade > 1) {
                    carrinho[indexExistente].quantidade -= 1;
                } else {
                    carrinho.splice(indexExistente, 1);
                }
                sessionStorage.setItem('carrinho', JSON.stringify(carrinho));
            }
            
            verificarEstadoCarrinho(); 
        }

        function irParaCheckout() {
            // 1. BARREIRA DE AUTENTICAÇÃO: Se não estiver logado, bloqueia o "Comprar Agora"!
            if (!clienteEstaLogado()) {
                mostrarAlertaLogin();
                return; 
            }

            // Proteção da variação também no botão "Comprar Agora"
            if (pecaAtual.opcoes && pecaAtual.opcoes.length > 0 && !window.opcaoSelecionadaParaCompra) {
                alert("Por favor, selecione uma variação antes de finalizar a compra!");
                return;
            }

            let carrinho = JSON.parse(sessionStorage.getItem('carrinho')) || [];
            
            let indexExistente = carrinho.findIndex(item => 
                item.titulo === pecaAtual.titulo && 
                item.opcaoSelecionada === window.opcaoSelecionadaParaCompra
            );

            if (indexExistente === -1) {
                let novoItem = { ...pecaAtual };
                novoItem.quantidade = 1;
                novoItem.opcaoSelecionada = window.opcaoSelecionadaParaCompra || null;
                carrinho.push(novoItem);
                sessionStorage.setItem('carrinho', JSON.stringify(carrinho));
            }

            let totalParaPagar = 0;
            carrinho.forEach(item => {
                let valorBruto = item.preco && item.preco.$numberDecimal ? item.preco.$numberDecimal : item.preco;
                let precoNumerico = parseFloat(valorBruto) || 0;
                let qtd = item.quantidade || 1;
                totalParaPagar += (precoNumerico * qtd);
            });

            sessionStorage.setItem('valor_final_pagamento', totalParaPagar.toFixed(2)); 
            sessionStorage.setItem('checkoutId', pecaAtual._id); 
            sessionStorage.setItem('checkoutNome', pecaAtual.titulo); 
            sessionStorage.setItem('checkoutPreco', totalParaPagar.toFixed(2)); 
            
            window.location.href = 'checkout.html';
        }

        // Redireciona a conversa para o chat real da plataforma.
        function abrirChatVendedor() {
            const tokenLogado = getTokenAutenticacao();
            
            // Segurança: Se não estiver logado, proíbe a abertura do chat.
            if(!tokenLogado) {
                alert("Acesso Restrito: Você precisa estar logado na sua conta para conversar com o vendedor ou negociar preços.");
                window.location.href = "login.html";
                return;
            }

            if (!pecaAtual) return;

            const parametros = new URLSearchParams();
            const idLojista = pecaAtual.lojistaId || pecaAtual.idLoja || pecaAtual.lojaId;
            const nomeLoja = pecaAtual.loja || pecaAtual.nomeLoja || '';
            const nomeProduto = pecaAtual.nome || pecaAtual.titulo || 'produto';
            if (idLojista) parametros.set('lojista', String(idLojista));
            if (nomeLoja) parametros.set('loja', nomeLoja);
            parametros.set('ref', nomeProduto);

            const idProduto = String(pecaAtual._id || pecaAtual.id || '').trim();
            if (idProduto) {
                apiFetch(`${API_URL}/produtos/${encodeURIComponent(idProduto)}/interesse-chat`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${tokenLogado}` },
                    keepalive: true
                }).then(async resposta => {
                    if (!resposta.ok) {
                        const erroApi = await resposta.json().catch(() => ({}));
                        console.warn('Não foi possível iniciar o aviso de interesse ao lojista:', erroApi.error || resposta.status);
                    }
                }).catch(erro => {
                    console.warn('Falha de conexão ao iniciar o aviso de interesse ao lojista:', erro.message);
                });
            }

            window.location.href = `mensagens.html?${parametros.toString()}`;
        }

        // ========================================================
// CONTROLE DAS SETAS DA GALERIA
// ========================================================
function rolarGaleria(distancia) {
    const galeria = document.getElementById('thumb-area');
    if (galeria) {
        galeria.scrollBy({ left: distancia, behavior: 'smooth' });
    }
}

// ========================================================
// NAVEGAR PELAS IMAGENS (FRENTE E TRÁS)
// ========================================================
function navegarImagemPrincipal(direcao) {
    const thumbArea = document.getElementById('thumb-area');
    if (!thumbArea) return;

    const thumbs = Array.from(thumbArea.querySelectorAll('img'));
    if (thumbs.length <= 1) return; 

    const indexAtivo = thumbs.findIndex(img => img.classList.contains('active'));
    
    // Calcula a próxima foto com base na direção (-1 ou 1)
    let novoIndex = indexAtivo + direcao;
    
    // Faz dar a volta quando chegar no fim ou no começo
    if (novoIndex >= thumbs.length) {
        novoIndex = 0; 
    } else if (novoIndex < 0) {
        novoIndex = thumbs.length - 1;
    }

    thumbs[novoIndex].click();
    thumbs[novoIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

// ========================================================
// EXPANDIR/RECOLHER DESCRIÇÃO DO PRODUTO
// ========================================================
function alternarDescricao() {
    const desc = document.getElementById('display-dsc');
    const btn = document.getElementById('btnLerMaisDesc');
    
    if (desc.classList.contains('descricao-curta')) {
        desc.classList.remove('descricao-curta');
        desc.classList.add('descricao-expandida');
        btn.innerText = "Ler menos";
    } else {
        desc.classList.remove('descricao-expandida');
        desc.classList.add('descricao-curta');
        btn.innerText = "Ler mais";
    }
}

// Verifica automaticamente se o botão é necessário quando a página carrega os dados
const observadorDescricao = new MutationObserver(function() {
    const desc = document.getElementById('display-dsc');
    const btn = document.getElementById('btnLerMaisDesc');
    
    if (desc.scrollHeight <= desc.clientHeight || desc.innerText.trim() === "") {
        btn.style.display = 'none'; // Esconde se for curto demais
    } else {
        btn.style.display = 'inline-block'; // Mostra se passar de 5 linhas
    }
});

window.addEventListener('DOMContentLoaded', () => {
    const descElement = document.getElementById('display-dsc');
    if (descElement) {
        observadorDescricao.observe(descElement, { childList: true, characterData: true, subtree: true });
    }

    const botaoCopiarLink = document.getElementById('btnCopiarLink');
    if (botaoCopiarLink) {
        const textoOriginal = botaoCopiarLink.innerHTML;
        botaoCopiarLink.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(window.location.href);
                botaoCopiarLink.textContent = '✅ Link Copiado!';
                botaoCopiarLink.classList.add('copiado');
            } catch (erro) {
                console.error('Não foi possível copiar o link do anúncio:', erro);
                botaoCopiarLink.textContent = 'Não foi possível copiar o link';
                botaoCopiarLink.classList.add('erro');
            }

            botaoCopiarLink.disabled = true;
            window.setTimeout(() => {
                botaoCopiarLink.innerHTML = textoOriginal;
                botaoCopiarLink.classList.remove('copiado', 'erro');
                botaoCopiarLink.disabled = false;
            }, 2000);
        });
    }
});
