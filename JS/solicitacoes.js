const API_URL = 'https://pe-abruta-3-0.onrender.com/api';
function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}
let categoriasDoBanco = [];
let tokenSolicitacoes = null;

// ========================================================
// FUNÇÃO MÁGICA: TRANSFORMA A FOTO PARA SALVAR NO SESSIONSTORAGE
// ========================================================
const lerArquivoComoBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve({ nome: file.name, tipo: file.type, base64: reader.result });
        reader.onerror = error => reject(error);
    });
};

// ========================================================
// BLOQUEIO DO BOTÃO "ENTER" (Impede o envio acidental)
// ========================================================
document.getElementById('formSolicitacao').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault(); // Impede o formulário de ser enviado ao dar enter
    }
});

// 1. VERIFICAÇÃO DE SEGURANÇA (Liberado para Loja e Cliente)
window.onload = async function() {
    tokenSolicitacoes = sessionStorage.getItem('token');
    let usuarioString = sessionStorage.getItem('usuario') || sessionStorage.getItem('usuarioLogado') || sessionStorage.getItem('clienteLogado');

    try {
        const usuarioSalvo = JSON.parse(sessionStorage.getItem('usuario') || '{}');
        tokenSolicitacoes = tokenSolicitacoes || usuarioSalvo.token || usuarioSalvo.user?.token || null;
    } catch (erro) {
        console.warn('Não foi possível ler os dados locais da sessão.');
    }

    if (!tokenSolicitacoes || !usuarioString) {
        document.getElementById('mainContainer').style.display = 'none';
        const alerta = document.getElementById('alertaErro');
        alerta.classList.add('mostrar');
        setTimeout(() => { window.location.href = 'login.html'; }, 3000);
        return;
    }

    await carregarCategoriasDoBanco();
};

// 2. BUSCA DE CATEGORIAS NO MONGODB
async function carregarCategoriasDoBanco() {
    const select = document.getElementById('categoriaVeiculo');
    
    try {
        const response = await apiFetch(`${API_URL}/categorias`);
        const data = await response.json();
        
        select.innerHTML = '<option value="">Selecione a categoria...</option>';
        
        if (response.ok && data.categorias) {
            categoriasDoBanco = data.categorias;

            data.categorias.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.nome; 
                option.innerText = cat.nome;
                select.appendChild(option);
            });
            
        } else {
            select.innerHTML = '<option value="">Erro ao carregar categorias</option>';
        }
    } catch (error) {
        console.error("Erro ao buscar categorias:", error);
        select.innerHTML = '<option value="">Falha na conexão com o banco</option>';
    }
}

// 3. ATUALIZA DICA (TOOLTIP)
function atualizarDicaCategoria() {
    const select = document.getElementById('categoriaVeiculo');
    const dica = document.getElementById('dicaCategoria');
    const categoriaSelecionada = select.value;

    if (!categoriaSelecionada || categoriaSelecionada.includes("Outros")) {
        dica.innerText = "";
        return;
    }

    const categoriaEncontrada = categoriasDoBanco.find(c => c.nome === categoriaSelecionada);

    if (categoriaEncontrada && categoriaEncontrada.descricao) {
        dica.innerText = "💡 Info: " + categoriaEncontrada.descricao;
    } else {
        dica.innerText = "";
    }
}

// 4. CEP INTELIGENTE E LOGRADOURO
function mascaraCEP(input) {
    let valor = input.value.replace(/\D/g, ''); 
    if (valor.length > 5) valor = valor.replace(/^(\d{5})(\d)/, '$1-$2'); 
    input.value = valor;
}

async function buscarCEP(cep) {
    const cepLimpo = cep.replace(/\D/g, ''); 
    const campoRua = document.getElementById('ruaCliente');
    const campoCidade = document.getElementById('cidadeCliente');
    
    if (cepLimpo.length === 8) {
        campoRua.value = "Buscando logradouro...";
        campoCidade.value = "Buscando cidade...";
        
        try {
            const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
            const data = await response.json();
            
            if (!data.erro) {
                campoRua.value = data.logradouro ? `${data.logradouro}, ${data.bairro}` : "";
                campoCidade.value = `${data.localidade} - ${data.uf}`;
                
                campoCidade.style.color = "#fff";
                campoCidade.style.borderColor = "#222";
            } else {
                campoRua.value = "";
                campoCidade.value = "";
                alert("CEP não encontrado. Verifique se os números estão corretos.");
            }
        } catch (error) {
            console.error("Erro de API:", error);
            campoRua.value = "";
            campoCidade.value = "";
        }
    }
}

// 5. MOSTRAR ARQUIVOS
function mostrarNomesArquivos(input) {
    const span = document.getElementById('file-names');
    if (input.files && input.files.length > 0) {
        let nomes = Array.from(input.files).map(f => f.name);
        span.innerText = "📁 " + nomes.join(', ');
        span.style.color = "#ff4d00";
    } else {
        span.innerText = "Nenhum arquivo anexado ainda.";
        span.style.color = "#555";
    }
}

// ========================================================
// 6. ENVIO: SALVANDO O PEDIDO COM O NOME E TIPO REAIS
// ========================================================
document.getElementById('formSolicitacao').addEventListener('submit', async function(e) {
    e.preventDefault(); 

    const inputCategoria = document.getElementById('categoriaVeiculo').value;
    if(!inputCategoria) {
        alert("Por favor, selecione uma categoria na lista antes de enviar a requisição.");
        return;
    }

    const btn = document.querySelector('.btn-neon');
    const textoOriginal = btn.innerText;
    
    btn.innerText = "PROCESSANDO ARQUIVOS...";
    btn.style.background = "#222";
    btn.style.color = "#888";
    btn.disabled = true;

    // Lendo as fotos anexadas
    const inputArquivos = document.getElementById('midiaSolicitacao');
    let listaArquivosBase64 = [];
    
    if (inputArquivos.files.length > 0) {
        for (let file of inputArquivos.files) {
            try {
                let arquivoConvertido = await lerArquivoComoBase64(file);
                listaArquivosBase64.push(arquivoConvertido);
            } catch (err) {
                console.error("Erro ao ler arquivo", err);
            }
        }
    }

    const payload = {
        peca: document.getElementById('tituloSolicitacao').value.trim(),
        categoria: inputCategoria,
        descricao: document.getElementById('descricaoSolicitacao').value.trim(),
        cep: document.getElementById('cepCliente').value.trim(),
        cidade: document.getElementById('cidadeCliente').value.trim(),
        rua: document.getElementById('ruaCliente').value.trim(),
        referencia: document.getElementById('referenciaCliente').value.trim(),
        arquivos: listaArquivosBase64
    };

    try {
        const response = await apiFetch(`${API_URL}/solicitacoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokenSolicitacoes}`
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Não foi possível registrar sua solicitação.');

        const alertaSucesso = document.getElementById('alertaSucesso');
        if (alertaSucesso) {
            alertaSucesso.classList.add('mostrar');
            setTimeout(() => alertaSucesso.classList.remove('mostrar'), 4000);
        } else {
            alert('Requisição registrada com sucesso!');
        }

        document.getElementById('formSolicitacao').reset();
        document.getElementById('cidadeCliente').value = '';
        document.getElementById('file-names').innerText = 'Nenhum arquivo anexado ainda.';
        const trigger = document.querySelector('#customSelectTrigger span');
        if (trigger) trigger.innerText = 'Selecione a categoria...';
        const dica = document.getElementById('dicaCategoria');
        if (dica) dica.innerText = '';
    } catch (erro) {
        console.error('Erro ao enviar solicitação para o MongoDB:', erro);
        showToast(erro.message || 'Falha ao enviar a solicitação.');
    } finally {
        btn.innerText = textoOriginal;
        btn.style.background = 'linear-gradient(90deg, #ff4d00, #ff7300)';
        btn.style.color = '#fff';
        btn.disabled = false;
    }
});
