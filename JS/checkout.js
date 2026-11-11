// Substitua pela sua PUBLIC KEY verdadeira
const mp = new MercadoPago('APP_USR-f573e41d-3bda-49c3-9a0b-b1d77d7e4114', { locale: 'pt-BR' });
const API_URL = 'https://pe-abruta-3-0.onrender.com/api';

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

let avisoEnderecoTimeout = null;
let itensCheckout = [];
let sequenciaBuscaCEP = 0;
let sequenciaCotacaoFrete = 0;
let sequenciaRenderPagamento = 0;
let checkoutBricksBuilder = null;
let paymentBrickController = null;
let cotacaoFreteAtual = null;
let cepCotado = '';
let cotacaoFreteEmAndamento = false;

function lerPrecoEmCentavos(valor) {
    const bruto = valor && typeof valor === 'object' && valor.$numberDecimal != null
        ? valor.$numberDecimal
        : valor;
    const texto = String(bruto ?? '').trim().replace(/^R\$\s*/i, '').replace(',', '.');
    const partes = texto.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!partes) return null;
    return (Number(partes[1]) * 100) + Number((partes[2] || '').padEnd(2, '0'));
}

function formatarCentavos(centavos) {
    const numero = Number(centavos);
    return (Number.isSafeInteger(numero) ? numero / 100 : 0).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL'
    });
}

function obterTokenCheckout() {
    try {
        const sessao = JSON.parse(sessionStorage.getItem('usuario') || '{}');
        return sessionStorage.getItem('token') || sessao.token || sessao.user?.token || '';
    } catch (erro) {
        return sessionStorage.getItem('token') || '';
    }
}

function atualizarResumoFrete({ subtotalCentavos, freteCentavos, totalCentavos, fretes } = {}) {
    const subtotal = document.getElementById('subtotalProdutosTela');
    const frete = document.getElementById('freteTotalTela');
    const total = document.getElementById('precoProdutoTela');
    const detalhes = document.getElementById('freteLojasDetalhe');
    if (subtotal && subtotalCentavos !== undefined && subtotalCentavos !== null) subtotal.textContent = formatarCentavos(subtotalCentavos);
    if (frete && freteCentavos !== undefined) {
        frete.textContent = freteCentavos === null ? 'Calculando…' : (freteCentavos === '' ? 'Informe o CEP' : formatarCentavos(freteCentavos));
    }
    if (total && totalCentavos !== undefined) total.textContent = totalCentavos === null ? 'Aguardando frete' : formatarCentavos(totalCentavos);
    if (detalhes) {
        detalhes.innerHTML = Array.isArray(fretes) ? fretes.map((item) =>
            `<div class="frete-loja-linha"><span>${escaparHTML(item.nomeLoja || 'Loja')}</span><strong>${formatarCentavos(item.valorCentavos)}</strong></div>`
        ).join('') : '';
    }
}

function escaparHTML(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (caractere) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[caractere]);
}

function mostrarStatusFrete(mensagem, erro = false) {
    const status = document.getElementById('statusFreteCheckout');
    if (!status) return;
    status.textContent = mensagem;
    status.style.color = erro ? '#ff8d7a' : '#b9a27d';
}

async function desmontarPaymentBrick() {
    const controller = paymentBrickController;
    paymentBrickController = null;
    if (!controller) return;
    try { await controller.unmount(); }
    catch (erro) { console.warn('Não foi possível desmontar a interface de pagamento anterior.', erro); }
}

function invalidarCotacaoFrete() {
    sequenciaCotacaoFrete += 1;
    sequenciaRenderPagamento += 1;
    const sequenciaInvalidacao = sequenciaRenderPagamento;
    cotacaoFreteAtual = null;
    cepCotado = '';
    cotacaoFreteEmAndamento = false;
    atualizarResumoFrete({ subtotalCentavos: null, freteCentavos: '', totalCentavos: null });
    mostrarStatusFrete('O CEP foi alterado. Consulte novamente o frete antes de pagar.');
    desmontarPaymentBrick().finally(() => {
        if (sequenciaInvalidacao !== sequenciaRenderPagamento || cotacaoFreteAtual) return;
        const container = document.getElementById('paymentBrick_container');
        if (container) {
            container.innerHTML = '<p class="status-frete-checkout">O formulário de pagamento aparecerá depois do cálculo do frete.</p>';
        }
    });
}

function lerItensDaSessao() {
    try {
        const itensSalvos = JSON.parse(sessionStorage.getItem('carrinho') || '[]');
        if (!Array.isArray(itensSalvos) || itensSalvos.length === 0) return [];
        return itensSalvos.map((item) => ({
            idProduto: String(item._id || item.id || item.idProduto || ''),
            titulo: String(item.titulo || 'Produto'),
            precoCentavos: lerPrecoEmCentavos(item.preco),
            quantidade: Number(item.quantidade || 1),
            opcaoSelecionada: item.opcaoSelecionada || null
        }));
    } catch (erro) {
        console.warn('Não foi possível ler os itens do carrinho.', erro);
        return [];
    }
}

function mostrarAvisoEndereco(mensagem) {
    const avisoAnterior = document.getElementById('aviso-endereco-checkout');
    if (avisoAnterior) avisoAnterior.remove();
    if (avisoEnderecoTimeout) clearTimeout(avisoEnderecoTimeout);

    const aviso = document.createElement('div');
    aviso.id = 'aviso-endereco-checkout';
    aviso.setAttribute('role', 'alert');
    aviso.textContent = `⚠ ${mensagem}`;
    Object.assign(aviso.style, {
        position: 'fixed',
        top: '22px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '9999',
        width: 'max-content',
        maxWidth: 'calc(100vw - 32px)',
        boxSizing: 'border-box',
        padding: '14px 20px',
        border: '1px solid #a83232',
        borderLeft: '4px solid #ff5555',
        borderRadius: '10px',
        background: 'linear-gradient(135deg, #351717, #211212)',
        color: '#ffe7e7',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
        fontFamily: 'Inter, sans-serif',
        fontSize: '14px',
        fontWeight: '600',
        lineHeight: '1.45',
        opacity: '0',
        transition: 'opacity 300ms ease'
    });
    document.body.appendChild(aviso);
    requestAnimationFrame(() => { aviso.style.opacity = '1'; });

    avisoEnderecoTimeout = setTimeout(() => {
        aviso.style.opacity = '0';
        setTimeout(() => aviso.remove(), 300);
        avisoEnderecoTimeout = null;
    }, 3700);
}

function configurarBuscaPorCEP() {
    const campoCEP = document.getElementById('enderecoCep');
    const campoRua = document.getElementById('enderecoRua');
    const campoBairro = document.getElementById('enderecoBairro');
    const campoCidade = document.getElementById('enderecoCidade');
    if (!campoCEP || !campoRua || !campoBairro || !campoCidade) return;

    campoCidade.readOnly = true;
    campoCEP.addEventListener('input', () => {
        const cepAtual = campoCEP.value.replace(/\D/g, '');
        if (cepCotado && cepAtual !== cepCotado) {
            invalidarCotacaoFrete();
            campoCidade.value = '';
            campoRua.value = '';
            campoBairro.value = '';
        }
    });

    campoCEP.addEventListener('blur', async () => {
        const cepDigitado = campoCEP.value.trim();
        if (!cepDigitado) return;

        const cep = cepDigitado.replace(/\D/g, '');
        const buscaAtual = ++sequenciaBuscaCEP;
        if (cep.length !== 8) {
            campoRua.value = '';
            campoBairro.value = '';
            campoCidade.value = '';
            invalidarCotacaoFrete();
            mostrarAvisoEndereco('CEP inválido. Informe os 8 dígitos para preencher o endereço.');
            return;
        }

        try {
            const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            if (!resposta.ok) throw new Error(`ViaCEP respondeu HTTP ${resposta.status}.`);
            const dados = await resposta.json();
            if (buscaAtual !== sequenciaBuscaCEP || campoCEP.value.trim().replace(/\D/g, '') !== cep) return;

            if (dados.erro) {
                campoRua.value = '';
                campoBairro.value = '';
                campoCidade.value = '';
                invalidarCotacaoFrete();
                mostrarAvisoEndereco('CEP não encontrado. Confira os números e tente novamente.');
                return;
            }

            campoRua.value = dados.logradouro || '';
            campoBairro.value = dados.bairro || '';
            campoCidade.value = [dados.localidade, dados.uf].filter(Boolean).join(' - ');
            campoCidade.readOnly = true;
            await carregarCotacaoFrete(cep);
        } catch (erro) {
            if (buscaAtual !== sequenciaBuscaCEP) return;
            console.error('Erro ao consultar o ViaCEP:', erro);
            invalidarCotacaoFrete();
            mostrarAvisoEndereco('Não foi possível consultar o CEP agora. Tente novamente para calcular o frete.');
        }
    });
}

async function carregarCotacaoFrete(cep) {
    if (cotacaoFreteAtual && cep === cepCotado) return;
    if (cotacaoFreteEmAndamento && cep === cepCotado) return;
    const sequenciaAtual = ++sequenciaCotacaoFrete;
    cotacaoFreteEmAndamento = true;
    cepCotado = cep;
    cotacaoFreteAtual = null;
    sequenciaRenderPagamento += 1;
    await desmontarPaymentBrick();
    const container = document.getElementById('paymentBrick_container');
    if (container) container.innerHTML = '<p class="status-frete-checkout">Calculando o frete das lojas…</p>';
    mostrarStatusFrete('Consultando as tarifas regionais das lojas.');
    atualizarResumoFrete({ freteCentavos: null, totalCentavos: null, fretes: [] });

    try {
        const token = obterTokenCheckout();
        if (!token) throw new Error('Sua sessão expirou. Entre novamente para continuar a compra.');
        const resposta = await apiFetch(`${API_URL}/frete/cotacao`, {
            method: 'POST',
            headers: apiHeaders({
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }),
            body: JSON.stringify({
                itens: itensCheckout.map((item) => ({ idProduto: item.idProduto, quantidade: item.quantidade })),
                enderecoEntrega: { cep }
            })
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.error || 'Não foi possível calcular o frete.');
        if (sequenciaAtual !== sequenciaCotacaoFrete || document.getElementById('enderecoCep').value.replace(/\D/g, '') !== cep) return;

        cotacaoFreteAtual = dados;
        cepCotado = cep;
        const itensCotadosPorId = new Map((dados.itens || []).map((item) => [String(item.idProduto), item]));
        itensCheckout = itensCheckout.map((item) => {
            const cotado = itensCotadosPorId.get(item.idProduto);
            return cotado ? {
                ...item,
                titulo: cotado.nomeProduto || item.titulo,
                precoCentavos: Math.round(Number(cotado.subtotalCentavos) / item.quantidade)
            } : item;
        });
        document.getElementById('nomeProdutoTela').textContent = itensCheckout
            .map((item) => `${item.titulo}${item.quantidade > 1 ? ` (x${item.quantidade})` : ''}`).join(' + ');
        atualizarResumoFrete({
            subtotalCentavos: dados.valorProdutosCentavos,
            freteCentavos: dados.valorFreteCentavos,
            totalCentavos: dados.valorTotalCentavos,
            fretes: dados.fretes || []
        });
        mostrarStatusFrete('Frete estimado pelas tarifas regionais informadas pelas lojas.');
        await renderizarFormularioDePagamento(Number(dados.valorTotalCentavos) / 100);
    } catch (erro) {
        if (sequenciaAtual !== sequenciaCotacaoFrete) return;
        cotacaoFreteAtual = null;
        cepCotado = '';
        document.getElementById('freteTotalTela').textContent = 'Indisponível';
        document.getElementById('precoProdutoTela').textContent = 'Aguardando frete';
        if (container) container.innerHTML = '<p class="status-frete-checkout">O pagamento ficará disponível depois que o frete puder ser calculado.</p>';
        mostrarStatusFrete(erro.message || 'Não foi possível calcular o frete.', true);
        mostrarAvisoEndereco(erro.message || 'Não foi possível calcular o frete.');
    } finally {
        if (sequenciaAtual === sequenciaCotacaoFrete) cotacaoFreteEmAndamento = false;
    }
}

async function carregarCheckout() {
    const idProduto = sessionStorage.getItem('checkoutId');
    const nomeProduto = sessionStorage.getItem('checkoutNome');
    const precoProduto = sessionStorage.getItem('checkoutPreco');
    itensCheckout = lerItensDaSessao();

    // Compatibilidade com checkouts antigos ou compra iniciada fora do carrinho.
    if (itensCheckout.length === 0 && idProduto) {
        const precoCentavos = lerPrecoEmCentavos(precoProduto);
        itensCheckout = [{
            idProduto,
            titulo: nomeProduto || 'Produto',
            precoCentavos,
            quantidade: 1,
            opcaoSelecionada: null
        }];
    }

    if (!itensCheckout.length || itensCheckout.some((item) => !item.idProduto || !Number.isInteger(item.quantidade) || item.quantidade < 1 || item.precoCentavos == null)) {
        alert("Sessão expirada ou pedido não identificado.");
        window.location.href = "feed.html";
        return;
    }

    const totalCentavos = itensCheckout.reduce((total, item) => total + (item.precoCentavos * item.quantidade), 0);
    if (!Number.isSafeInteger(totalCentavos) || totalCentavos <= 0) {
        alert('O valor do carrinho é inválido. Revise os itens antes de pagar.');
        window.location.href = 'carrinho.html';
        return;
    }
    checkoutBricksBuilder = mp.bricks();
    const valorTotal = totalCentavos / 100;
    const nomesItens = itensCheckout.map((item) => `${item.titulo}${item.quantidade > 1 ? ` (x${item.quantidade})` : ''}`).join(' + ');

    document.getElementById('nomeProdutoTela').textContent = nomesItens || nomeProduto;
    atualizarResumoFrete({ subtotalCentavos: totalCentavos, totalCentavos: null });
    mostrarStatusFrete('Informe o CEP de entrega para calcular o frete regional.');
}

async function renderizarFormularioDePagamento(valorTotal) {
    const container = document.getElementById('paymentBrick_container');
    const sequenciaAtual = ++sequenciaRenderPagamento;
    await desmontarPaymentBrick();
    if (sequenciaAtual !== sequenciaRenderPagamento || !cotacaoFreteAtual) return;
    container.innerHTML = '';

    try {
        const controller = await checkoutBricksBuilder.create("payment", "paymentBrick_container", {
        initialization: {
            amount: valorTotal,
        },
        customization: {
            paymentMethods: {
                ticket: "all",
                bankTransfer: "all",
                creditCard: "all",
                debitCard: "all",
                mercadoPago: "all",
                minInstallments: 1,
                maxInstallments: 12,
            },
        },
        callbacks: {
            onReady: () => {
                console.log("Campos de pagamento renderizados.");
            },
            onSubmit: ({ selectedPaymentMethod, formData }) => {
                return new Promise((resolve, reject) => {
                    const tipoPagamento = String(formData.payment_type_id || selectedPaymentMethod || '').toLowerCase();
                    const dadosDeCartaoPresentes = Boolean(formData.token && formData.payment_method_id);
                    const ehCartaoCredito = tipoPagamento === 'credit_card'
                        || (dadosDeCartaoPresentes && tipoPagamento !== 'debit_card');
                    let parcelasSelecionadas = null;

                    const cepAtual = document.getElementById('enderecoCep').value.replace(/\D/g, '');
                    if (!cotacaoFreteAtual || !cepAtual || cepAtual !== cepCotado) {
                        mostrarAvisoEndereco('Calcule novamente o frete pelo CEP antes de pagar.');
                        reject(new Error('A cotação do frete está desatualizada.'));
                        return;
                    }

                    const enderecoEntrega = {
                        rua: document.getElementById('enderecoRua').value.trim(),
                        numero: document.getElementById('enderecoNumero').value.trim(),
                        bairro: document.getElementById('enderecoBairro').value.trim(),
                        cep: document.getElementById('enderecoCep').value.trim(),
                        cidade: document.getElementById('enderecoCidade').value.trim()
                    };

                    if (Object.values(enderecoEntrega).some((valor) => !valor)) {
                        mostrarAvisoEndereco('Preencha todos os campos do endereço de entrega antes de pagar.');
                        reject(new Error('Endereço de entrega incompleto.'));
                        return;
                    }

                    if (ehCartaoCredito) {
                        parcelasSelecionadas = Number(formData.installments);
                        if (!Number.isInteger(parcelasSelecionadas) || parcelasSelecionadas < 1 || parcelasSelecionadas > 12) {
                            mostrarAvisoEndereco('Selecione uma quantidade válida de parcelas no formulário do cartão.');
                            reject(new Error('Quantidade de parcelas inválida ou não selecionada.'));
                            return;
                        }

                        const escolhaParcelas = parcelasSelecionadas === 1
                            ? '1x (à vista)'
                            : `${parcelasSelecionadas}x no cartão de crédito`;
                        const confirmouParcelas = window.confirm(
                            `Você selecionou pagar em ${escolhaParcelas}. Confirma essa opção? O valor final de cada parcela seguirá as condições exibidas pelo Mercado Pago.`
                        );
                        if (!confirmouParcelas) {
                            mostrarAvisoEndereco('Pagamento não enviado. Revise as parcelas selecionadas e tente novamente.');
                            reject(new Error('Pagamento cancelado antes do envio.'));
                            return;
                        }
                    }
                    
                    let idDoComprador = "CLIENTE_NAO_LOGADO";
                    const usuarioStr = sessionStorage.getItem('usuario');
                    if (usuarioStr) {
                        const objUsuario = JSON.parse(usuarioStr);
                        // 🔴 A CORREÇÃO: Agora ele encontra a ID do cliente de forma infalível
                        if (objUsuario.user) {
                            idDoComprador = objUsuario.user.id || objUsuario.user._id || "CLIENTE_NAO_LOGADO";
                        } else {
                            idDoComprador = objUsuario.id || objUsuario._id || "CLIENTE_NAO_LOGADO";
                        }
                    }

                    const payloadCompleto = {
                        ...formData,
                        ...(ehCartaoCredito ? { installments: parcelasSelecionadas } : {}),
                        idProduto: itensCheckout[0]?.idProduto,
                        itens: itensCheckout.map((item) => ({
                            idProduto: item.idProduto,
                            quantidade: item.quantidade,
                            opcaoSelecionada: item.opcaoSelecionada
                        })),
                        idCliente: idDoComprador,
                        enderecoEntrega
                    };

                    apiFetch(`${API_URL}/pagar`, {
                        method: 'POST',
                        headers: apiHeaders({ 'Content-Type': 'application/json' }),
                        body: JSON.stringify(payloadCompleto)
                    })
                    .then(async (response) => {
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) throw new Error(data.error || 'Não foi possível processar o pagamento.');
                        return data;
                    })
                    .then((data) => {
                        resolve(data); // Libera o botão do Brick
                        
                        // SE FOR PIX, DESENHA O QR CODE NA TELA E ATIVA O RADAR
                        if (data.payment_method_id === 'pix' && data.status === 'pending') {
                            const qrCodeImg = data.point_of_interaction.transaction_data.qr_code_base64;
                            const qrCodeCopiaCola = data.point_of_interaction.transaction_data.qr_code;
                            
                            // Esconde o formulário original e mostra a interface do PIX
                            container.innerHTML = `
                                <div style="text-align: center; margin-top: 10px; padding: 25px; background: #111; border-radius: 8px; border: 1px solid #333;">
                                    <h3 style="color: #00cc66; font-family: 'Orbitron'; margin-bottom: 10px;">PIX GERADO COM SUCESSO!</h3>
                                    <p style="color: #888; font-size: 13px; margin-bottom: 20px;">Escaneie o código abaixo no aplicativo do seu banco:</p>
                                    
                                    <img src="data:image/jpeg;base64,${qrCodeImg}" alt="QR Code PIX" style="width: 220px; height: 220px; border-radius: 8px; border: 3px solid #fff; margin-bottom: 20px;">
                                    
                                    <p style="font-size: 12px; color: #888; margin-bottom: 5px;">Ou copie o código (Copia e Cola):</p>
                                    <input type="text" readonly value="${qrCodeCopiaCola}" style="width: 100%; padding: 12px; background: #222; color: #00cc66; font-weight: bold; border: 1px solid #444; border-radius: 4px; text-align: center; cursor: pointer;" onclick="this.select(); document.execCommand('copy'); alert('Código PIX copiado!');">
                                    
                                    <p style="font-size: 11px; color: #555; margin-top: 20px;">A sua compra será aprovada automaticamente após o pagamento. Não é necessário atualizar a página.</p>
                                </div>
                            `;

                            // --- INÍCIO DO CRONÓMETRO (RADAR) ---
                            // Pergunta ao servidor a cada 4 segundos se o PIX foi pago
                            const radarPix = setInterval(async () => {
                                try {
                                    // Chama a nossa nova rota segura no backend
                                    const resStatus = await apiFetch(`${API_URL}/pagamento/status/${data.id}`, {
                                        headers: apiHeaders()
                                    });
                                    const jsonStatus = await resStatus.json();
                                    
                                    // Se o status mudar para aprovado, para o radar e vai para o sucesso!
                                    if (jsonStatus.status === 'approved') {
                                        clearInterval(radarPix);
                                        window.location.href = "sucesso.html";
                                    }
                                } catch (e) {
                                    console.log("A aguardar pagamento...");
                                }
                            }, 4000); 
                            // --- FIM DO CRONÓMETRO ---
                        } 
                        
                        // SE FOR CARTÃO DE CRÉDITO APROVADO
                        else if (data.status === 'approved') {
                            window.location.href = "sucesso.html";
                        }
                    })
                    .catch((error) => {
                        console.error("Erro na API de cobrança:", error);
                        mostrarAvisoEndereco(error.message || "Ocorreu um erro ao processar o pagamento.");
                        reject();
                    });
                });
            },
            onError: (error) => {
                console.error("Erro interno no Brick:", error);
            }
        }
        });
        if (sequenciaAtual !== sequenciaRenderPagamento || !cotacaoFreteAtual) {
            await controller.unmount();
            return;
        }
        paymentBrickController = controller;
    } catch (erro) {
        console.error('Não foi possível renderizar o formulário de pagamento:', erro);
        mostrarStatusFrete('O frete foi calculado, mas não foi possível abrir o pagamento. Atualize a página e tente novamente.', true);
    }
}

// Inicia a aplicação na tela
configurarBuscaPorCEP();
carregarCheckout();
