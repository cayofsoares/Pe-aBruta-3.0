const API_URL = 'https://pe-abruta-3-0.onrender.com/api';
function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}
let imagensBase64 = [];

function obterUsuarioDaSessao() {
    try {
        const sessao = JSON.parse(sessionStorage.getItem('usuario') || '{}');
        return sessao.user || sessao;
    } catch (erro) {
        return {};
    }
}

function chavePixCadastrada() {
    const usuario = obterUsuarioDaSessao();
    return usuario.tipo === 'admin' || Boolean(String(usuario.chavePix || '').trim());
}

function bloquearPublicacaoSemChavePix() {
    alert('⚠️ Obrigatório: Cadastre sua Chave PIX no Perfil da Loja antes de anunciar uma peça.');
    window.location.replace('sistema-empresa.html#perfil');
}

        // Garante que a função vai rodar automaticamente assim que a página abrir
        document.addEventListener('DOMContentLoaded', () => {
            if (!chavePixCadastrada()) {
                bloquearPublicacaoSemChavePix();
                return;
            }
            carregarCategoriasNoSelect();
        });

        // Função para buscar e preencher as categorias
        async function carregarCategoriasNoSelect() {

            const selectCategoria = document.getElementById('categoria');
            
            try {
                const response = await apiFetch(`${API_URL}/categorias`);
                const data = await response.json();

                if (response.ok && data.success) {
                    // Limpa a mensagem de "Carregando" e coloca a opção padrão
                    selectCategoria.innerHTML = '<option value="" disabled selected>Selecione uma categoria</option>';
                    
                    // Faz um loop em todas as categorias que vieram do banco e cria as opções
                    data.categorias.forEach(cat => {
                        const option = document.createElement('option');
                        option.value = cat.nome;
                        option.textContent = cat.nome;
                        // O SEGREDO: Esconde a descrição dentro da tag option como um atributo "data-desc"
                        option.setAttribute('data-desc', cat.descricao || 'Nenhuma descrição detalhada para esta categoria.');
                        selectCategoria.appendChild(option);

                        // GATILHO: Fica "escutando" as mudanças no Select
                        selectCategoria.addEventListener('change', function() {
                            // Pega a opção que o usuário acabou de clicar
                            const opcaoSelecionada = this.options[this.selectedIndex];
                            
                            // Puxa o texto secreto que guardamos nela
                            const texto = opcaoSelecionada.getAttribute('data-desc');
                            
                            // Joga o texto na tela e deixa visível
                            document.getElementById('descricao-categoria').textContent = texto;
                            document.getElementById('descricao-categoria').style.display = 'block!important';
                        });

                    });
                } else {
                    selectCategoria.innerHTML = '<option value="" disabled>Erro ao carregar categorias</option>';
                }
            } catch (erro) {
                console.error('Falha ao buscar categorias:', erro);
                selectCategoria.innerHTML = '<option value="" disabled>Servidor indisponível</option>';
            }
        }

        function calcularPrecoFinal() {
            const valorLojista = parseFloat(document.getElementById('precoPeca').value) || 0;
            const comissao = valorLojista * 0.10;
            const valorFinal = valorLojista + comissao;
            document.getElementById('infoPreco').innerHTML = `Preço no site: <b>R$ ${valorFinal.toFixed(2)}</b> (Taxa: R$ ${comissao.toFixed(2)})`;
            return valorFinal.toFixed(2);
        }

        document.getElementById('multipleFileInput').addEventListener('change', function(e) {
            const files = e.target.files;
            const previewContainer = document.getElementById('galleryPreview');
            
            for(let file of files) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    const base64String = event.target.result;
                    const index = imagensBase64.length;
                    imagensBase64.push(base64String);

                    const div = document.createElement('div');
                    div.className = 'preview-item';
                    div.id = `img-${index}`;
                    div.innerHTML = `
                        <button type="button" class="btn-remove-photo" onclick="removerFoto(${index})">×</button>
                        <img src="${base64String}" alt="Preview">
                    `;
                    previewContainer.appendChild(div);
                };
                reader.readAsDataURL(file);
            }
        });

        function removerFoto(index) {
            imagensBase64[index] = null; 
            const el = document.getElementById(`img-${index}`);
            if(el) el.remove();
        }

        // LÓGICA DE POSTAGEM ÚNICA (INTEGRADA COM A API REAL E TOKEN CORRIGIDO)
        document.getElementById('formPublicarPeca').addEventListener('submit', async function(e) {

            e.preventDefault();

            if (!chavePixCadastrada()) {
                bloquearPublicacaoSemChavePix();
                return;
            }

            const fotosFinais = imagensBase64.filter(img => img !== null);

            if (fotosFinais.length === 0) {
                alert("Adicione pelo menos uma foto da peça!");
                return;
            }

            // Recuperação segura do Token e do Usuário Logado
            let token = sessionStorage.getItem('token');
            let usuarioLoja = obterUsuarioDaSessao();
            
            const userStr = sessionStorage.getItem('usuario');
            if (userStr) {
                let parsed = {};
                try { parsed = JSON.parse(userStr); } catch (erro) {}
                if (parsed.token) token = parsed.token;
                if (parsed.user) usuarioLoja = parsed.user;
            }

            if (!token) {
                alert("Erro: Sessão expirada ou não logada. Faça login novamente.");
                window.location.href = 'login-empresa.html';
                return;
            }

            // Desabilita o botão para evitar cliques duplos
            const btn = document.getElementById('btnPublish');
            btn.innerText = "PUBLICANDO NO SERVIDOR...";
            btn.disabled = true;

            // === 🔴 PASSO 2: CAPTURA E TRANSFORMAÇÃO DAS OPÇÕES (Com proteção contra erro) ===
            const campoOpcoes = document.getElementById('opcoesPeca');
            const textoOpcoes = campoOpcoes ? campoOpcoes.value : "";
            
            // Corta pela vírgula, limpa espaços vazios e ignora se não tiver nada
            const arrayOpcoes = textoOpcoes
                .split(',')
                .map(opcao => opcao.trim())
                .filter(opcao => opcao !== "");
            // ========================================================

            const novaPecaPayload = {
                titulo: document.getElementById('tituloPeca').value,
                preco: calcularPrecoFinal(),
                categoria: document.getElementById('categoria').value,
                descricao: document.getElementById('descricaoPeca').value,
                imagens: fotosFinais,
                visibilidade: document.getElementById('visibilidadeProduto').value,
                nomeLoja: usuarioLoja.nome, // Envia o nome da loja para vincular
                
                // === 🔴 PASSO 2: ENVIA O ARRAY PARA O BANCO ===
                opcoes: arrayOpcoes 
            };
            
            // 🚨 ESPIÃO: Mostra no console do navegador (F12) o que está sendo enviado
            console.log("🚀 DADOS QUE ESTÃO INDO PARA O BANCO:", novaPecaPayload);

            try {
                // Envia para o seu servidor Node.js
                const response = await apiFetch(`${API_URL}/produtos/postar`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(novaPecaPayload)
                });

                const data = await response.json();

                if (response.ok) {
                // 🔴 EXIBE O ALERTA CUSTOMIZADO
                const alertaSucesso = document.getElementById('alertaSucesso');
                if (alertaSucesso) {
                    alertaSucesso.classList.add('mostrar');
                    
                    // Aguarda 2.5 segundos para a animação acontecer antes de sair da página
                    setTimeout(() => {
                        window.location.href = 'sistema-empresa.html'; // Retorna ao hub
                    }, 2500);
                } else {
                    // Fallback de segurança caso o HTML não seja encontrado
                    alert("ANÚNCIO PUBLICADO COM SUCESSO NO FEED!");
                    window.location.href = 'sistema-empresa.html';
                }
                
            } else {
                alert("Erro ao publicar: " + (data.error || "Tente novamente."));
                btn.innerText = "PUBLICAR ANÚNCIO NO FEED";
                btn.disabled = false;
            }
        } catch (error) {
            console.error("Erro de requisição:", error);
            alert("Falha de comunicação com o servidor.");
            btn.innerText = "PUBLICAR ANÚNCIO NO FEED";
            btn.disabled = false;
        }
    });
