require('dotenv').config();
if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
    console.error('❌ ERRO CRÍTICO: A variável MERCADOPAGO_ACCESS_TOKEN não está definida no ambiente.');
    process.exit(1);
}

const express = require('express');
const mongoose = require('mongoose');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const clienteMercadoPago = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const crypto = require('crypto'); // NOVO: Para gerar tokens de verificação de e-mail
const nodemailer = require('nodemailer'); // NOVO: Para envio de e-mails

// --- 1. VERIFICAÇÃO OBRIGATÓRIA DE VARIÁVEIS DE AMBIENTE NA INICIALIZAÇÃO ---
if (!process.env.JWT_SECRET) {
    console.error("❌ ERRO CRÍTICO: A variável de ambiente JWT_SECRET não está definida!");
    process.exit(1);
}
if (!process.env.MONGO_URI) {
    console.error("❌ ERRO CRÍTICO: A variável de ambiente MONGO_URI não está definida!");
    process.exit(1);
}

const app = express();

app.set('trust proxy', 1);
// 👇 ADICIONE ESTE PORTEIRO AQUI
/*app.use((req, res, next) => {
    console.log(`🚨 [REQUISIÇÃO CHEGOU] Alguém bateu na rota: ${req.method} ${req.url}`);
    next();
});*/

// --- CONFIGURAÇÃO DE E-MAIL (NODEMAILER) CORRIGIDA ---
// Agora respeita estritamente o .env e configura o SSL/TLS dinamicamente pela porta
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    logger: true, // NOVO: Mostra logs detalhados
    debug: true   // NOVO: Mostra o que o Gmail está respondendo
});
// --- 🛡️ MIDDLEWARES DE SEGURANÇA (OWASP) ---
app.use(helmet());

const corsAllowedOrigins = new Set([
    'https://pecabruta.com.br',
    'https://www.pecabruta.com.br',
    'https://dancing-mermaid-ca2ef7.netlify.app',
    ...(process.env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
]);

app.use(cors({
    origin: (origin, callback) => {
        // Chamadas sem Origin (ex.: health checks e ferramentas server-to-server)
        // não são acessos de navegador e não precisam de cabeçalho CORS.
        if (!origin) return callback(null, true);

        let isLocalhost = false;
        try {
            const parsedOrigin = new URL(origin);
            isLocalhost = parsedOrigin.protocol === 'http:' &&
                ['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname);
        } catch (erro) {
            // Origem malformada não é liberada.
        }

        return callback(null, isLocalhost || corsAllowedOrigins.has(origin));
    },
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
    if (req.body) req.body = mongoSanitize.sanitize(req.body);
    if (req.params) req.params = mongoSanitize.sanitize(req.params);
    next();
});

// Health check para o Render: só considera a API pronta quando o MongoDB conectou.
app.get('/api/health', (req, res) => {
    const bancoConectado = mongoose.connection.readyState === 1;
    return res.status(bancoConectado ? 200 : 503).json({
        ok: bancoConectado,
        database: bancoConectado ? 'connected' : 'disconnected'
    });
});

const paginasAdministrativas = new Set([
    '/admin-pb-secret.html',
    '/admin-financeiro.html',
    '/gerenciar-solicitacoes.html'
]);

app.use((req, res, next) => {
    if (!paginasAdministrativas.has(String(req.path || '').toLowerCase())) return next();

    const authorization = String(req.headers.authorization || '');
    const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    const cookieToken = String(req.headers.cookie || '').split(';')
        .map((parte) => parte.trim())
        .find((parte) => parte.startsWith('pb_admin_token='))
        ?.slice('pb_admin_token='.length);
    const token = bearerToken || cookieToken;

    try {
        const usuarioToken = token ? jwt.verify(token, process.env.JWT_SECRET) : null;
        if (usuarioToken?.isAdmin === true) return next();
    } catch (erro) {
        // Token ausente, inválido ou expirado: não entregar a página administrativa.
    }

    return res.status(403).json({ error: 'Acesso Negado' });
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 15,
    message: { error: 'Muitas tentativas. Por segurança, aguarde 15 minutos.' }
});

const cadastroLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Muitas solicitações de cadastro vindas deste IP. Aguarde 15 minutos.' }
});

// --- 🧮 FUNÇÕES AUXILIARES DE VALIDAÇÃO MATEMÁTICA REAL ---
function validarCNPJ(cnpj) {
    cnpj = cnpj.replace(/[^\d]+/g, '');
    if (cnpj === '' || cnpj.length !== 14 || /^(\d) {13}$/.test(cnpj)) return false;
    
    let tamanho = cnpj.length - 2;
    let numeros = cnpj.substring(0, tamanho);
    let digitos = cnpj.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;
    
    for (let i = tamanho; i >= 1; i--) {
        soma += numeros.charAt(tamanho - i) * pos--;
        if (pos < 2) pos = 9;
    }
    let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado != digitos.charAt(0)) return false;
    
    tamanho = tamanho + 1;
    numeros = cnpj.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;
    for (let i = tamanho; i >= 1; i--) {
        soma += numeros.charAt(tamanho - i) * pos--;
        if (pos < 2) pos = 9;
    }
    resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    return resultado == digitos.charAt(1);
}

function validarCPF(cpf) {
    cpf = cpf.replace(/[^\d]+/g, '');
    if (cpf === '' || cpf.length !== 11 || /^(\d) {10}$/.test(cpf)) return false;
    let soma = 0, resto;
    for (let i = 1; i <= 9; i++) soma = soma + parseInt(cpf.substring(i - 1, i)) * (11 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto != parseInt(cpf.substring(9, 10))) return false;
    soma = 0;
    for (let i = 1; i <= 10; i++) soma = soma + parseInt(cpf.substring(i - 1, i)) * (12 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    return resto == parseInt(cpf.substring(10, 11));
}

// --- MODELOS E ÍNDICES DE ALTA ESCALABILIDADE ---

// INÍCIO DA ADIÇÃO: SCHEMA DE ENDEREÇO (Subdocumento)
// Este schema define a estrutura de um endereço e será usado dentro do usuarioSchema
const enderecoSchema = new mongoose.Schema({
    cep: { type: String, required: true },
    rua: { type: String, required: true },
    numero: { type: String, required: true },
    complemento: { type: String, default: "" },
    bairro: { type: String, required: true },
    cidade: { type: String, required: true },
    estado: { type: String, required: true }
});
// FIM DA ADIÇÃO: SCHEMA DE ENDEREÇO

const usuarioSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    tipo: { type: String, default: "cliente" },
    fotoPerfil: { type: String, default: "" },
    bio: { type: String, default: "" },
    chavePix: { type: String, trim: true, default: "" },
    // MELHORIA: CPF Único, Telefone e Integrações Futuras
    cpf: { type: String, required: true, unique: true, sparse: true }, 
    telefone: { type: String, default: "" },
    
    // INÍCIO DA ADIÇÃO NO SCHEMA PRINCIPAL
    // Array para armazenar os endereços do usuário, usando a estrutura definida acima
    enderecos: [enderecoSchema], 


    // 👉 NOVA LINHA: O bolso para a carteira virtual
    saldoCarteira: { type: mongoose.Schema.Types.Decimal128, default: '0.000' },
    pagamentosCreditados: { type: [String], default: [] },
    // FIM DA ADIÇÃO NO SCHEMA PRINCIPAL

    // MELHORIA: Registro de Conformidade LGPD
    aceitouTermos: { type: Boolean, default: false },
    dataAceiteTermos: { type: Date },
    ipAceite: { type: String },
    // MELHORIA: Verificação de E-mail
    emailVerificado: { type: Boolean, default: false },
    tokenVerificacao: { type: String }, // Agora armazenará o código de 6 dígitos
    tokenExpiracao: { type: Date },     // NOVO: Campo para armazenar a data de expiração do código
    // MELHORIA: Estrutura pronta para Anti-Fraude futura
    deviceId: { type: String },
    fingerprint: { type: String },
    ultimaSessao: { type: Date }
});
usuarioSchema.index({ nome: 1 }); 
const Usuario = mongoose.model('Usuario', usuarioSchema);

const categoriaSchema = new mongoose.Schema({
    nome: { type: String, required: true, unique: true },  
    descricao: { type: String, default: "" }     
})
const Categoria = mongoose.model('Categoria', categoriaSchema, 'categorias');

const avaliacaoSchema = new mongoose.Schema({
    usuario: { type: String, required: true },  
    nota: { type: Number, required: true, min: 1, max: 5 },
    texto: { type: String, required: true },
    data: { type: Date, default: Date.now } 
});
const Avaliacao = mongoose.model('Avaliacao', avaliacaoSchema);

const produtoSchema = new mongoose.Schema({
    idLoja: { type: String, index: true },
    nomeLoja: String,
    visibilidade: { type: String, default: 'publico' },
    titulo: String,
    preco: { type: mongoose.Schema.Types.Decimal128, required: true },
    categoria: String, // NOVO: Para o filtro do feed funcionar
    descricao: String,
    imagens: [String], // CORREÇÃO: Agora é um array de imagens (Base64)
    avaliacoes : [avaliacaoSchema], // NOVO: Subdocumento de avaliações
    mediaGeral : { type: Number, default: 0 },
    data: { type: Date, default: Date.now }
});

produtoSchema.index({ nomeLoja: 1, data: -1 }); 
const Produto = mongoose.model('Produto', produtoSchema);

const solicitacaoSchema = new mongoose.Schema({
    loja: String, cnpj: String, email: String, senha: String,
    whatsapp: String, instagram: String, site: String,
    status: { type: String, default: 'pendente' },
    data: String
});
solicitacaoSchema.index({ email: 1 });
solicitacaoSchema.index({ cnpj: 1 });
const Solicitacao = mongoose.model('Solicitacao', solicitacaoSchema);

const arquivoSolicitacaoSchema = new mongoose.Schema({
    nome: { type: String, trim: true, default: '' },
    tipo: { type: String, trim: true, default: '' },
    base64: { type: String, required: true }
}, { _id: false });

const solicitacaoPecaSchema = new mongoose.Schema({
    cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
    solicitante: { type: String, trim: true, default: '' },
    tipoSolicitante: { type: String, trim: true, default: 'cliente' },
    peca: { type: String, required: true, trim: true },
    categoria: { type: mongoose.Schema.Types.ObjectId, ref: 'Categoria', required: true, index: true },
    descricao: { type: String, required: true, trim: true },
    cep: { type: String, trim: true, default: '' },
    cidade: { type: String, trim: true, default: '' },
    rua: { type: String, trim: true, default: '' },
    referencia: { type: String, trim: true, default: '' },
    arquivos: { type: [arquivoSolicitacaoSchema], default: [] },
    status: { type: String, enum: ['aberta', 'assumida'], default: 'aberta', index: true },
    assumida: { type: Boolean, default: false, index: true },
    lojaAssumiu: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
    dataAssumida: { type: Date, default: null },
    data: { type: Date, default: Date.now, index: true }
});
const SolicitacaoPeca = mongoose.model('SolicitacaoPeca', solicitacaoPecaSchema, 'solicitacoes');



// --- CONEXÃO BANCO DE DADOS E DISPARO DE SEEDING ---
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
      console.log("✅ BANCO DE DADOS CONECTADO COM SUCESSO");
      try {
          await garantirIndicePedidoPorItem();
      } catch (erroIndice) {
          console.error('❌ Falha ao preparar o índice de pedidos por item:', erroIndice.message);
      }
      console.log("🔍 RASTREIO 1: O banco conectou. Disparando verificarCriarAdmin()...");
      verificarCriarAdmin(); 
  })
  .catch(err => console.error("❌ ERRO CRÍTICO NO BANCO:", err.message));


  // ==========================================
// MODELO DE MENSAGENS (COM AUTODESTRUIÇÃO EM 24H)
// ==========================================
const MensagensSchema = new mongoose.Schema({
    remetente: { type: String, required: true },
    destinatario: { type: String, required: true },
    texto: { type: String, required: true },
    lida: { type: Boolean, default: false },
    dataEnvio: { type: Date, default: Date.now, expires: 86400 } 
});

const Mensagem = mongoose.model('Mensagens', MensagensSchema);

// --- 👑 CRIAÇÃO/RESETE AUTOMÁTICO DA CONTA ADMIN (CORRIGIDO) ---
async function verificarCriarAdmin() {
    console.log("🔍 RASTREIO 2: Iniciando verificarCriarAdmin() após carregar os modelos.");
    try {
        const usuarioAdmin = "adminccd"; 
        const senhaAdmin = "CCD@26962177";

        // Verifica se a conta já existe
        const adminExiste = await Usuario.findOne({ email: usuarioAdmin });

        if (!adminExiste) {
            console.log("🔍 RASTREIO 3: Admin não encontrado. Criando conta blindada...");
            
            const salt = await bcrypt.genSalt(10);
            const senhaHash = await bcrypt.hash(senhaAdmin, salt);

            const novoAdmin = new Usuario({
                nome: "Administrador Chefe",
                email: usuarioAdmin,
                senha: senhaHash,
                tipo: "admin",
                fotoPerfil: "",
                bio: "Conta mestre do sistema PEÇA BRUTA.",
                cpf: "00000000000", // Necessário devido ao required
                emailVerificado: true,
                aceitouTermos: true
            });

            await novoAdmin.save();
            console.log("👑 CONTA 'adminccd' CRIADA E BLINDADA COM SUCESSO!");
        } else {
            console.log("✅ RASTREIO 3: Conta 'adminccd' já existe. Nenhuma recriação foi necessária.");
        }

    } catch (err) {
        console.error("❌ RASTREIO ERRO: Falhou dentro de verificarCriarAdmin:", err.message);
    }
}


const enderecoEntregaSchema = new mongoose.Schema({
    rua: { type: String, trim: true },
    numero: { type: String, trim: true },
    bairro: { type: String, trim: true },
    cep: { type: String, trim: true },
    cidade: { type: String, trim: true }
}, { _id: false });

const opcaoPedidoSchema = new mongoose.Schema({
    opcao: { type: String, default: null },
    quantidade: { type: Number, required: true }
}, { _id: false });

const pedidoSchema = new mongoose.Schema({
    idPagamento: { type: String },
    idItemPagamento: { type: String },
    idProduto: { type: String, required: true },
    nomeProduto: { type: String },
    idLoja: { type: String, index: true },
    lojaDona: { type: String },
    idCliente: { type: String, required: true },
    nomeCliente: { type: String },
    valorTotal: { type: Number },
    quantidade: { type: Number, default: 1 },
    opcaoSelecionada: { type: String, default: null },
    opcoesSelecionadas: { type: [opcaoPedidoSchema], default: [] },
    imagemProduto: { type: String },
    enderecoEntrega: { type: enderecoEntregaSchema, default: null },
    notificacaoVendaEnviada: { type: Boolean, default: false },
    statusEntrega: { type: String, default: "Aguardando Envio" },
    recebidoPeloCliente: { type: Boolean, default: false },
    dataRecebimentoCliente: { type: Date, default: null },
    statusRecebimento: { type: String, enum: ['Pendente', 'Recebimento Confirmado'], default: 'Pendente' },
    statusRepasse: { type: String, enum: ['pendente', 'concluido', 'Repasse Concluído'], default: 'pendente' },
    dataRepasse: { type: Date, default: null },
    dataCompra: { type: Date, default: Date.now }
});
pedidoSchema.index(
    { idPagamento: 1, idItemPagamento: 1 },
    {
        unique: true,
        partialFilterExpression: { idPagamento: { $type: 'string' }, idItemPagamento: { $type: 'string' } },
        name: 'uniq_pedido_pagamento_item'
    }
);
const Pedido = mongoose.model('Pedido', pedidoSchema);

const itemCheckoutSchema = new mongoose.Schema({
    idProduto: { type: String, required: true },
    nomeProduto: { type: String, required: true },
    quantidade: { type: Number, required: true },
    opcaoSelecionada: { type: String, default: null },
    idLoja: { type: String, required: true },
    nomeLoja: { type: String, required: true },
    precoUnitarioCentavos: { type: String, required: true },
    subtotalCentavos: { type: String, required: true }
}, { _id: false });

const checkoutPagamentoSchema = new mongoose.Schema({
    referencia: { type: String, required: true, unique: true },
    idPagamento: { type: String, index: true },
    idCliente: { type: String, required: true },
    itens: { type: [itemCheckoutSchema], required: true },
    valorTotalCentavos: { type: String, required: true },
    enderecoEntrega: { type: enderecoEntregaSchema, required: true },
    status: { type: String, default: 'aguardando_pagamento' },
    dataCriacao: { type: Date, default: Date.now }
});
const CheckoutPagamento = mongoose.model('CheckoutPagamento', checkoutPagamentoSchema, 'checkouts_pagamento');

// Uma cobrança passa a gerar um Pedido por linha do carrinho. Migra o índice
// antigo (que exigia um único pedido por pagamento) para a chave por item.
let migracaoIndicePedidoPromise;
async function garantirIndicePedidoPorItem() {
    if (!migracaoIndicePedidoPromise) {
        migracaoIndicePedidoPromise = (async () => {
            await Pedido.init();
            const indices = await Pedido.collection.indexes();
            const indicePagamentoUnico = indices.find((indice) =>
                indice.unique &&
                Object.keys(indice.key || {}).length === 1 &&
                indice.key.idPagamento === 1
            );
            if (indicePagamentoUnico) {
                await Pedido.collection.dropIndex(indicePagamentoUnico.name);
            }
            await Pedido.collection.createIndex(
                { idPagamento: 1, idItemPagamento: 1 },
                {
                    unique: true,
                    partialFilterExpression: { idPagamento: { $type: 'string' }, idItemPagamento: { $type: 'string' } },
                    name: 'uniq_pedido_pagamento_item'
                }
            );
        })().catch((erro) => {
            migracaoIndicePedidoPromise = null;
            throw erro;
        });
    }
    return migracaoIndicePedidoPromise;
}

// Converte valores monetários com até duas casas diretamente para centavos,
// sem passar por operações binárias de ponto flutuante.
const valorParaCentavos = (valor) => {
    const texto = String(valor ?? '').trim();
    const partes = texto.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!partes) throw new Error(`Valor monetário inválido: ${texto || '(vazio)'}`);

    const centavos = (BigInt(partes[1]) * 100n) + BigInt((partes[2] || '').padEnd(2, '0') || '0');
    if (centavos > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Valor monetário excede o limite seguro de processamento.');
    }
    return centavos;
};

const centavosParaDecimal = (centavos) => {
    const reais = centavos / 100n;
    const fracao = (centavos % 100n).toString().padStart(2, '0');
    return `${reais}.${fracao}`;
};

const valorParaMillesimos = (valor) => {
    const texto = String(valor ?? '').trim();
    const partes = texto.match(/^(\d+)(?:\.(\d+))?$/);
    if (!partes) throw new Error(`Saldo monetário inválido: ${texto || '(vazio)'}`);

    const fracao = partes[2] || '';
    let millesimos = BigInt(partes[1]) * 1000n + BigInt(fracao.slice(0, 3).padEnd(3, '0') || '0');
    if (fracao.length > 3 && fracao[3] >= '5') millesimos += 1n;
    return millesimos;
};

const millesimosParaDecimal = (millesimos) => {
    const reais = millesimos / 1000n;
    const fracao = (millesimos % 1000n).toString().padStart(3, '0');
    return `${reais}.${fracao}`;
};

// --- 🔐 MIDDLEWARES DE AUTENTICAÇÃO E AUTORIZAÇÃO ---
const verificarToken = (req, res, next) => {
    const authHeader = req.get('Authorization') || '';
    const correspondencia = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!correspondencia) {
        return res.status(401).json({ error: 'Acesso negado: Autenticação obrigatória.' });
    }
    const token = correspondencia[1].trim();
    try {
        const decodificado = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decodificado;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Sessão expirada ou token inválido. Faça login novamente.' });
    }
};

// O login assina o ObjectId da conta como claim `id`; a busca usa esse mesmo
// valor como `_id` e só retorna documentos cujo tipo é loja.
const buscarLojaDoToken = async (usuarioToken) => {
    const id = usuarioToken && typeof usuarioToken.id === 'string'
        ? usuarioToken.id.trim()
        : String(usuarioToken?.id || '').trim();

    if (!mongoose.Types.ObjectId.isValid(id)) return null;

    return Usuario.findOne({
        _id: new mongoose.Types.ObjectId(id),
        tipo: 'loja'
    });
};

const exigirPermissao = (tiposPermitidos) => {
    return (req, res, next) => {
        const tipoUsuario = String(req.user?.tipo || '').toLowerCase();
        const tiposPermitidosLower = tiposPermitidos.map(t => t.toLowerCase());

        if (!req.user) return res.status(403).json({ error: 'Acesso Negado' });

        const papelPermitido = tipoUsuario !== 'admin' && tiposPermitidosLower.includes(tipoUsuario);
        const administradorPermitido = tiposPermitidosLower.includes('admin') && req.user.isAdmin === true;
        if (!papelPermitido && !administradorPermitido) {
            return res.status(403).json({ error: 'Acesso Negado' });
        }
        next();
    };
};

// --- ROTAS DA API ---

// A. ROTAS DE CADASTRO ADICIONADAS E BLINDADAS
app.post(['/api/registrar', '/api/registro'], cadastroLimiter, async (req, res) => {
    try {
        const { nome, email, senha, cpf, telefone, aceitouTermos, turnstileToken } = req.body;

        if (!nome || !email || !senha || !cpf || !telefone || typeof nome !== 'string' || typeof email !== 'string' || typeof senha !== 'string') {
            return res.status(400).json({ error: 'Preencha todos os campos corretamente.' });
        }

        // MELHORIA: Validação do Cloudflare Turnstile (Anti-bot) no Backend
        if (process.env.TURNSTILE_SECRET_KEY && turnstileToken) {
            const formData = new URLSearchParams();
            formData.append('secret', process.env.TURNSTILE_SECRET_KEY);
            formData.append('response', turnstileToken);
            formData.append('remoteip', req.ip);

            const turnstileFetch = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                body: formData
            });
            const turnstileResult = await turnstileFetch.json();
            
            if (!turnstileResult.success) {
                return res.status(403).json({ error: 'Validação de segurança anti-bot falhou. Tente novamente.' });
            }
        }

        // MELHORIA: Bloqueio caso Termos não tenham sido aceitos
        if (!aceitouTermos) {
            return res.status(400).json({ error: 'Você precisa aceitar os Termos de Uso e Política de Privacidade.' });
        }

        const senhaRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
        if (!senhaRegex.test(senha)) {
            return res.status(400).json({ error: 'A senha deve conter no mínimo 8 caracteres, incluindo letras e números.' });
        }

        if (!validarCPF(cpf)) {
            return res.status(400).json({ error: 'O número de CPF informado é inválido.' });
        }

        const emailSanitizado = email.trim().toLowerCase();
        const cpfSanitizado = cpf.replace(/\D/g, '');
        const telefoneSanitizado = telefone.replace(/\D/g, '');

        const usuarioExistente = await Usuario.findOne({ email: emailSanitizado });
        if (usuarioExistente) {
            // Recupera o fluxo se a conta foi salva, mas a tela de ativação não chegou a abrir.
            // Exige o CPF já vinculado à conta e não cria um segundo usuário.
            const cpfExistenteDoUsuario = String(usuarioExistente.cpf || '').replace(/\D/g, '');
            if (!usuarioExistente.emailVerificado && cpfExistenteDoUsuario === cpfSanitizado) {
                return res.status(201).json({
                    success: true,
                    pendingActivation: true,
                    email: usuarioExistente.email,
                    nome: usuarioExistente.nome,
                    message: 'Seu cadastro ainda precisa de ativação. Informe o código enviado ou solicite um novo código.'
                });
            }
            return res.status(400).json({ error: 'Este e-mail já está cadastrado no sistema.' });
        }

        const cpfExistente = await Usuario.findOne({ cpf: cpfSanitizado });
        if (cpfExistente) {
            return res.status(400).json({ error: 'Este número de CPF já encontra-se vinculado a outro usuário.' });
        }

        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);
        const ipOrigem = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;

        // MELHORIA: Geração de Token Numérico (6 dígitos)
        const codigoVerificacao = crypto.randomInt(100000, 1000000).toString();
        
        // Define a expiração para 15 minutos a partir de agora
        const dataExpiracao = new Date();
        dataExpiracao.setMinutes(dataExpiracao.getMinutes() + 15);

        const novoUsuario = new Usuario({
            nome: nome.trim(),
            email: emailSanitizado,
            senha: senhaHash,
            tipo: "cliente",
            fotoPerfil: "",
            bio: "",
            cpf: cpfSanitizado,
            telefone: telefoneSanitizado,
            aceitouTermos: true,
            dataAceiteTermos: new Date(),
            ipAceite: ipOrigem,
            emailVerificado: false,
            tokenVerificacao: codigoVerificacao,
            tokenExpiracao: dataExpiracao,
            enderecos: [] // Inicia com a lista de endereços vazia
        });

        await novoUsuario.save();

        // Só confirma o cadastro depois que o servidor SMTP aceitar o envio do código.
        try {
            const nomeSeguroEmail = escaparHTMLDeEmail(nome.trim());
            const textoEmail = `Obrigado por se registar! O seu código de verificação é: ${codigoVerificacao}. Introduza este código para ativar a sua conta.`;
            const mailOptions = {
                from: process.env.SMTP_FROM,
                replyTo: process.env.SMTP_USER,
                to: emailSanitizado,
                subject: 'Código de Ativação - Peça Bruta 🔐',
                text: textoEmail,
                html: `<div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 560px; margin: 0 auto; padding: 20px;">
                    <p>Olá, <strong>${nomeSeguroEmail}</strong>.</p>
                    <p>Obrigado por se registar! O seu código de verificação é:</p>
                    <p style="font-size: 28px; font-weight: bold; letter-spacing: 5px;">${codigoVerificacao}</p>
                    <p>Introduza este código para ativar a sua conta. Ele é válido por 15 minutos.</p>
                </div>`
            };
            let timeoutEnvio;
            const resultadoEmail = await Promise.race([
                transporter.sendMail(mailOptions),
                new Promise((_, reject) => {
                    timeoutEnvio = setTimeout(() => {
                        const erroTimeout = new Error('Tempo limite excedido ao enviar o código de ativação.');
                        erroTimeout.code = 'ETIMEDOUT';
                        reject(erroTimeout);
                    }, 12000);
                })
            ]).finally(() => clearTimeout(timeoutEnvio));
            console.log(`📩 E-mail de ativação aceito pelo SMTP para ${emailSanitizado}.`, resultadoEmail.messageId);
        } catch (mailErr) {
            console.error(`⚠️ Falha ao enviar e-mail de ativação para ${emailSanitizado}:`, mailErr.message, mailErr.response || '');
            return res.status(503).json({
                success: false,
                pendingActivation: true,
                emailSent: false,
                email: emailSanitizado,
                nome: nome.trim(),
                error: 'Sua conta foi salva como pendente, mas o código não pôde ser enviado agora. Use Reenviar Código para tentar novamente.'
            });
        }

        res.status(201).json({
            success: true,
            emailSent: true,
            email: emailSanitizado,
            nome: nome.trim(),
            message: 'Usuário cadastrado como pendente. Informe o código enviado ao seu e-mail para ativar a conta.'
        });

    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ error: 'Identificador único duplicado no banco de dados.' });
        console.error("Erro seguro no registro:", err.message);
        res.status(500).json({ error: 'Erro interno ao processar o cadastro.' });
    }
});

// NOVA ROTA: Verificação de Código Numérico
app.post('/api/verificar-codigo', async (req, res) => {
    try {
        const { email, codigo } = req.body;

        if (!email || typeof codigo !== 'string' || !/^\d{6}$/.test(codigo.trim())) {
            return res.status(400).json({ error: 'E-mail e código são obrigatórios.' });
        }

        const emailSanitizado = email.trim().toLowerCase();
        const codigoSanitizado = codigo.trim();

        const usuario = await Usuario.findOne({ email: emailSanitizado });

        if (!usuario) {
            return res.status(404).json({ error: 'Nenhum usuário encontrado com este e-mail.' });
        }

        if (usuario.emailVerificado) {
            return res.status(400).json({ error: 'Esta conta já foi ativada. Você pode fazer login.' });
        }

        // Verifica se o código bate
        if (usuario.tokenVerificacao !== codigoSanitizado) {
            return res.status(400).json({ error: 'Código de ativação inválido ou incorreto.' });
        }

        // Verifica a expiração
        if (!usuario.tokenExpiracao || new Date() > usuario.tokenExpiracao) {
            return res.status(400).json({ error: 'Este código expirou. Por favor, solicite um novo código.' });
        }

        // Ativa a conta e limpa os tokens
        usuario.emailVerificado = true;
        usuario.tokenVerificacao = undefined; 
        usuario.tokenExpiracao = undefined;
        await usuario.save();

        res.json({ success: true, message: 'Conta ativada com sucesso! Você já pode fazer login.' });
    } catch (err) {
        console.error("Erro na verificação de código:", err.message);
        res.status(500).json({ error: 'Erro interno ao verificar o código.' });
    }
});

// NOVA ROTA: Reenvio de Código Numérico
app.post('/api/reenviar-codigo', cadastroLimiter, async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Por favor, informe um e-mail válido.' });
        }

        const emailSanitizado = email.trim().toLowerCase();
        const usuario = await Usuario.findOne({ email: emailSanitizado });

        if (!usuario) {
            return res.status(404).json({ error: 'Nenhuma conta encontrada com este endereço de e-mail.' });
        }

        if (usuario.emailVerificado) {
            return res.status(400).json({ error: 'Esta conta já está verificada. Você já pode fazer login.' });
        }

        const smtpConfigurado = Boolean(
            process.env.SMTP_HOST &&
            Number(process.env.SMTP_PORT) > 0 &&
            process.env.SMTP_USER &&
            process.env.SMTP_PASS &&
            process.env.SMTP_FROM
        );
        if (!smtpConfigurado) {
            console.error('Reenvio de ativação indisponível: configuração SMTP incompleta no ambiente do servidor.');
            return res.status(503).json({
                error: 'O serviço de e-mail está temporariamente indisponível. Tente novamente mais tarde.',
                errorCode: 'SMTP_CONFIG_MISSING'
            });
        }

        // Gera novo código
        const novoCodigo = crypto.randomInt(100000, 1000000).toString();
        
        // Define a expiração para 15 minutos a partir de agora
        const dataExpiracao = new Date();
        dataExpiracao.setMinutes(dataExpiracao.getMinutes() + 15);

        usuario.tokenVerificacao = novoCodigo;
        usuario.tokenExpiracao = dataExpiracao;
        await usuario.save();

        let timeoutEnvio;
        try {
            const nomeSeguroEmail = escaparHTMLDeEmail(usuario.nome.trim());
            const textoEmail = `Obrigado por se registar! O seu código de verificação é: ${novoCodigo}. Introduza este código para ativar a sua conta.`;
            const mailOptions = {
                from: process.env.SMTP_FROM,
                replyTo: process.env.SMTP_USER,
                to: emailSanitizado,
                subject: 'Código de Ativação - Peça Bruta 🔐',
                text: textoEmail,
                html: `<div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 560px; margin: 0 auto; padding: 20px;">
                    <p>Olá, <strong>${nomeSeguroEmail}</strong>.</p>
                    <p>Obrigado por se registar! O seu código de verificação é:</p>
                    <p style="font-size: 28px; font-weight: bold; letter-spacing: 5px;">${novoCodigo}</p>
                    <p>Introduza este código para ativar a sua conta. Ele é válido por 15 minutos.</p>
                </div>`
            };
            const resultadoEmail = await Promise.race([
                transporter.sendMail(mailOptions),
                new Promise((_, reject) => {
                    timeoutEnvio = setTimeout(() => {
                        const erroTimeout = new Error('Tempo limite excedido ao reenviar o código de ativação.');
                        erroTimeout.code = 'ETIMEDOUT';
                        reject(erroTimeout);
                    }, 12000);
                })
            ]);
            console.log(`📩 Código de verificação reenviado para ${emailSanitizado}.`, resultadoEmail.messageId);
        } catch (mailErr) {
            const errorCode = /^[A-Z0-9_-]{1,40}$/i.test(String(mailErr.code || ''))
                ? String(mailErr.code).toUpperCase()
                : 'SMTP_SEND_FAILED';
            console.error('Falha ao reenviar código de ativação:', {
                code: errorCode,
                command: mailErr.command || undefined,
                responseCode: Number(mailErr.responseCode) || undefined,
                message: mailErr.message
            });
            return res.status(503).json({
                error: `Falha no envio do e-mail (${errorCode}). Tente novamente mais tarde.`,
                errorCode
            });
        } finally {
            clearTimeout(timeoutEnvio);
        }

        res.json({ success: true, message: 'Código de ativação reenviado com sucesso. Verifique sua caixa de entrada.' });

    } catch (err) {
        console.error("Erro no reenvio de código:", err.message);
        res.status(500).json({ error: 'Erro interno ao processar a solicitação de reenvio.' });
    }
});

// GET /api/parceiros - Rota PÚBLICA para listar lojas no Feed
app.get('/api/parceiros', async (req, res) => {
    try {
        // Puxa APENAS usuários do tipo loja e APENAS os campos de nome e foto
        const lojas = await Usuario.find({ tipo: 'loja' }).select('nome fotoPerfil');
        res.json({ success: true, lojas });
    } catch (err) {
        console.error("Erro ao buscar parceiros:", err.message);
        res.status(500).json({ error: 'Erro interno ao buscar parceiros.' });
    }
});


app.post(['/api/solicitacao', '/api/cadastro-empresa'], cadastroLimiter, async (req, res) => {
    try {
        const { loja, cnpj, email, senha, whatsapp, instagram, site } = req.body;

        if (!loja || !cnpj || !email || !senha || typeof loja !== 'string' || typeof cnpj !== 'string' || typeof email !== 'string' || typeof senha !== 'string') {
            return res.status(400).json({ error: 'Campos obrigatórios ausentes ou inválidos.' });
        }

        if (!validarCNPJ(cnpj)) {
            return res.status(400).json({ error: 'O número de CNPJ informado é inválido.' });
        }

        const senhaRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
        if (!senhaRegex.test(senha)) {
            return res.status(400).json({ error: 'A senha da empresa deve conter no mínimo 8 caracteres, incluindo letras e números.' });
        }

        const emailSanitizado = email.trim().toLowerCase();
        const cnpjSanitizado = cnpj.replace(/\D/g, '');

        const duplicado = await Solicitacao.findOne({ $or: [{ email: emailSanitizado }, { cnpj: cnpjSanitizado }] });
        const usuarioDuplicado = await Usuario.findOne({ email: emailSanitizado });

        if (duplicado || usuarioDuplicado) {
            return res.status(400).json({ error: 'Este e-mail ou CNPJ já possui um registro ativo ou pendente.' });
        }

        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);

        const novaSolicitacao = new Solicitacao({
            loja: loja.trim(),
            cnpj: cnpjSanitizado,
            email: emailSanitizado,
            senha: senhaHash,
            whatsapp: whatsapp ? whatsapp.replace(/\D/g, '') : "",
            instagram: instagram ? instagram.trim() : "",
            site: site ? site.trim() : "",
            status: 'pendente',
            data: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        });

        await novaSolicitacao.save();
        res.status(201).json({ success: true, message: 'Solicitação enviada com sucesso!' });

    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ error: 'Identificador empresarial já existente.' });
        console.error("Erro seguro na solicitação corporativa:", err.message);
        res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
    }
});

// 1. ROTA DE LOGIN (Com verificação de status do E-mail)
app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { email, senha, tipoAcesso } = req.body;
        
        if (!email || !senha || typeof email !== 'string' || typeof senha !== 'string') {
            return res.status(401).json({ error: 'Credenciais inválidas' }); 
        }

        const emailSanitizado = email.trim().toLowerCase();

        const user = await Usuario.findOne({ email: emailSanitizado });
        
        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas' }); 
        }

        const emailAdminSistema = 'cayofelipe1506@gmail.com';
        const isAdminAccount = emailSanitizado === emailAdminSistema;
        const senhaAdminConfigurada = String(process.env.ADMIN_PASS || '');
        const hashSenhaInformada = crypto.createHash('sha256').update(senha).digest();
        const hashSenhaAdmin = crypto.createHash('sha256').update(senhaAdminConfigurada).digest();
        const senhaMasterCorreta = isAdminAccount && Boolean(senhaAdminConfigurada)
            && crypto.timingSafeEqual(hashSenhaInformada, hashSenhaAdmin);

        // MELHORIA: Bloqueio de Login para Contas Não Verificadas
        if (!isAdminAccount && user.tipo === 'cliente' && !user.emailVerificado) {
             return res.status(403).json({ error: 'Por favor, confirme seu e-mail através do código enviado para sua caixa de entrada antes de fazer login.' });
        }

        if (!isAdminAccount && tipoAcesso && user.tipo !== tipoAcesso) {
            return res.status(403).json({ error: `Acesso negado. Credenciais inválidas para o escopo selecionado.` });
        }

        let senhaCorreta = senhaMasterCorreta;

        if (!isAdminAccount) {
            if (user.senha.startsWith('$2b$') || user.senha.startsWith('$2a$')) {
                senhaCorreta = await bcrypt.compare(senha, user.senha);
            } else {
                if (user.senha === senha) {
                    senhaCorreta = true;
                    const salt = await bcrypt.genSalt(10);
                    user.senha = await bcrypt.hash(senha, salt);
                    await user.save();
                }
            }
        }

        if (senhaCorreta) {
            const isAdmin = isAdminAccount;
            const payloadToken = {
                id: user._id.toString(),
                email: user.email,
                tipo: user.tipo,
                nome: user.nome
            };
            if (isAdmin) payloadToken.isAdmin = true;
            const token = jwt.sign(payloadToken, process.env.JWT_SECRET, { expiresIn: '7d' });

            if (isAdmin) {
                res.cookie('pb_admin_token', token, {
                    httpOnly: true,
                    secure: Boolean(req.secure),
                    sameSite: req.secure ? 'none' : 'lax',
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                    path: '/'
                });
            }

            const usuarioResposta = {
                id: user._id,
                nome: user.nome,
                email: user.email,
                tipo: user.tipo,
                chavePix: user.chavePix || '',
                fotoPerfil: user.fotoPerfil,
                bio: user.bio
            };
            if (isAdmin) usuarioResposta.isAdmin = true;
            res.json({ token, user: usuarioResposta });
        } else {
            res.status(401).json({ error: 'Credenciais inválidas' });
        }
    } catch (err) {
        console.error("❌ Erro interno no login (Log Seguro):", err.message);
        res.status(500).json({ error: 'Erro no servidor durante o login' });
    }
});

// =========================================================================
// --- INÍCIO: ROTAS DE ENDEREÇO PARA CLIENTES (CORRIGIDAS) ---
// =========================================================================

// GET /api/enderecos - Retorna os endereços do usuário logado
app.get('/api/enderecos', verificarToken, async (req, res) => {
    try {
        console.log(`[API Endereços] Buscando endereços para o usuário ID: ${req.user.id}`);
        const usuario = await Usuario.findById(req.user.id);
        
        if (!usuario) {
            console.error(`[API Endereços] Usuário não encontrado no DB com ID: ${req.user.id}`);
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        
        res.json({ success: true, enderecos: usuario.enderecos });
    } catch (err) {
        console.error("[API Endereços] Erro na rota GET /api/enderecos:", err);
        res.status(500).json({ error: 'Erro interno ao buscar endereços.' });
    }
});

// POST /api/endereco/adicionar - Adiciona um novo endereço
app.post('/api/endereco/adicionar', verificarToken, async (req, res) => {
    try {
        const { cep, rua, numero, complemento, bairro, cidade, estado } = req.body;
        console.log(`[API Endereços] Adicionando novo endereço para o usuário ID: ${req.user.id}`, req.body);
        
        if (!cep || !rua || !numero || !bairro || !cidade || !estado) {
            console.warn(`[API Endereços] Campos faltando na requisição de adição de endereço.`);
            return res.status(400).json({ error: 'Preencha todos os campos obrigatórios do endereço.' });
        }

        const usuario = await Usuario.findById(req.user.id);
        if (!usuario) {
            console.error(`[API Endereços] Usuário não encontrado no DB com ID: ${req.user.id}`);
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        // Cria o objeto do novo endereço
        const novoEndereco = { cep, rua, numero, complemento, bairro, cidade, estado };
        
        // Adiciona ao array usando push
        usuario.enderecos.push(novoEndereco);
        
        // Salva o documento principal do usuário, o Mongoose vai gerar o _id para o novo subdocumento
        const usuarioSalvo = await usuario.save();
        
        // Pega o último endereço da array, que acabou de ser adicionado, agora com seu _id gerado pelo banco
        const enderecoAdicionado = usuarioSalvo.enderecos[usuarioSalvo.enderecos.length - 1];
        
        console.log(`[API Endereços] Endereço adicionado com sucesso. ID gerado: ${enderecoAdicionado._id}`);
        res.json({ success: true, message: 'Endereço adicionado com sucesso.', endereco: enderecoAdicionado });
    } catch (err) {
        console.error("[API Endereços] Erro na rota POST /api/endereco/adicionar:", err);
        res.status(500).json({ error: 'Erro interno ao adicionar endereço no banco de dados.' });
    }
});

// PUT /api/endereco/:id - Edita um endereço existente
app.put('/api/endereco/:id', verificarToken, async (req, res) => {
    try {
        const enderecoId = req.params.id;
        const { cep, rua, numero, complemento, bairro, cidade, estado } = req.body;
        console.log(`[API Endereços] Editando endereço ID: ${enderecoId} do usuário ID: ${req.user.id}`, req.body);

        const usuario = await Usuario.findById(req.user.id);
        if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado.' });

        const endereco = usuario.enderecos.id(enderecoId);
        if (!endereco) {
            console.warn(`[API Endereços] Endereço ID: ${enderecoId} não encontrado no array do usuário ID: ${req.user.id}`);
            return res.status(404).json({ error: 'Endereço não localizado neste perfil.' });
        }

        // Atualiza apenas os campos enviados
        if (cep) endereco.cep = cep;
        if (rua) endereco.rua = rua;
        if (numero) endereco.numero = numero;
        if (complemento !== undefined) endereco.complemento = complemento; 
        if (bairro) endereco.bairro = bairro;
        if (cidade) endereco.cidade = cidade;
        if (estado) endereco.estado = estado;

        await usuario.save();
        console.log(`[API Endereços] Endereço editado com sucesso.`);
        res.json({ success: true, message: 'Endereço atualizado com sucesso.', endereco });
    } catch (err) {
        console.error("[API Endereços] Erro na rota PUT /api/endereco/:id:", err);
        res.status(500).json({ error: 'Erro interno ao atualizar endereço.' });
    }
});

// DELETE /api/endereco/:id - Remove um endereço
app.delete('/api/endereco/:id', verificarToken, async (req, res) => {
    try {
        const enderecoId = req.params.id;
        console.log(`[API Endereços] Excluindo endereço ID: ${enderecoId} do usuário ID: ${req.user.id}`);

        const usuario = await Usuario.findById(req.user.id);
        if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado.' });

        // Mongoose v7+: Para remover um subdocumento pelo ID dentro de um array
        // você pode puxar a array e usar pull(), ou puxar o subdoc e usar deleteOne() / remove() dependendo da versão
        // A forma mais garantida moderna é pull() na array principal:
        usuario.enderecos.pull({ _id: enderecoId });
        
        await usuario.save();

        console.log(`[API Endereços] Endereço excluído com sucesso.`);
        res.json({ success: true, message: 'Endereço removido com sucesso.' });
    } catch (err) {
        console.error("[API Endereços] Erro na rota DELETE /api/endereco/:id:", err);
        res.status(500).json({ error: 'Erro interno ao remover endereço.' });
    }
});

// =========================================================================
// --- FIM DA ADIÇÃO: ROTAS DE ENDEREÇO PARA CLIENTES ---
// =========================================================================

// 2. ROTA DE PERFIL PÚBLICO (Preservada)
app.get('/api/loja/:nome', async (req, res) => {
    try {
        const nomeBusca = decodeURIComponent(req.params.nome).trim();
        
        const loja = await Usuario.findOne({
            nome: nomeBusca,
            tipo: 'loja'
        }).collation({ locale: 'pt', strength: 1 }).select('-senha -chavePix');

        const produtos = await Produto.find({
            nomeLoja: nomeBusca
        }).collation({ locale: 'pt', strength: 1 }).sort({ data: -1 });

        if (!loja) return res.status(404).json({ error: 'Loja não encontrada' });
        res.json({ loja, produtos });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao carregar perfil' });
    }
});

// 3. SISTEMA DE EDIÇÃO INTEGRADO (Preservada)
app.put('/api/loja/atualizar-completo', verificarToken, async (req, res) => {
    try {
        const { email, novoNome, fotoPerfil, bio, chavePix } = req.body;
        
        if (req.user.email !== email && req.user.isAdmin !== true) {
            return res.status(403).json({ error: "Tentativa de manipulação detectada. Acesso bloqueado." });
        }

        if (String(req.user.tipo || '').toLowerCase() === 'loja' && !String(chavePix || '').trim()) {
            return res.status(400).json({ error: 'Cadastre a Chave PIX da loja para salvar o perfil.' });
        }

        const usuarioAntigo = await Usuario.findOne({ email });
        if (!usuarioAntigo) return res.status(404).json({ error: "Usuário não encontrado" });

        const nomeAntigo = usuarioAntigo.nome;

        const camposAtualizados = { nome: novoNome, fotoPerfil, bio };
        if (Object.prototype.hasOwnProperty.call(req.body, 'chavePix')) {
            camposAtualizados.chavePix = String(chavePix || '').trim();
        }

        const userAtualizado = await Usuario.findOneAndUpdate(
            { email: email },
            { $set: camposAtualizados },
            { returnDocument: 'after' }
        ).select('-senha');

        if (nomeAntigo !== novoNome) {
            await Produto.updateMany(
                { nomeLoja: nomeAntigo },
                { $set: { nomeLoja: novoNome } }
            );
        }

        res.json({ success: true, user: userAtualizado });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno ao atualizar dados da empresa' });
    }
});

// GET /api/categorias - Busca todas as categorias para preencher o Select
app.get('/api/categorias', async (req, res) => {
    try {
        // Busca as categorias e ordena em ordem alfabética (1)
        const categorias = await Categoria.find().sort({ nome: 1 });
        res.json({ success: true, categorias });
    } catch (err) {
        console.error("Erro ao buscar categorias:", err.message);
        res.status(500).json({ error: 'Erro interno ao buscar categorias.' });
    }
});

// A solicitação é criada por um usuário autenticado e fica disponível às lojas.
app.post('/api/solicitacoes', verificarToken, exigirPermissao(['cliente', 'loja']), async (req, res) => {
    try {
        const idCliente = String(req.user?.id || req.user?._id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(idCliente)) {
            return res.status(401).json({ error: 'Token inválido ou sem ID de usuário.' });
        }

        const usuario = await Usuario.findById(idCliente);
        if (!usuario || String(usuario.tipo || '').trim().toLowerCase() !== String(req.user.tipo || '').trim().toLowerCase()) {
            return res.status(403).json({ error: 'Não foi possível validar o usuário da solicitação.' });
        }

        const { peca, categoria, descricao, cep, cidade, rua, referencia, arquivos } = req.body;
        if (![peca, categoria, descricao, cep, cidade, rua, referencia].every((valor) => String(valor || '').trim())) {
            return res.status(400).json({ error: 'Preencha os dados do pedido e do endereço antes de enviar.' });
        }

        const categoriaTexto = String(categoria).trim();
        const categoriaDb = mongoose.Types.ObjectId.isValid(categoriaTexto)
            ? await Categoria.findById(categoriaTexto)
            : await Categoria.findOne({ nome: categoriaTexto }).collation({ locale: 'pt', strength: 2 });
        if (!categoriaDb) return res.status(400).json({ error: 'A categoria selecionada não existe no cadastro da plataforma.' });

        const arquivosNormalizados = Array.isArray(arquivos) ? arquivos.map((arquivo) => ({
            nome: String(arquivo?.nome || '').trim(),
            tipo: String(arquivo?.tipo || '').trim(),
            base64: String(arquivo?.base64 || '')
        })) : [];
        if (arquivosNormalizados.some((arquivo) => !arquivo.base64 || !/^(image|video|audio)\//i.test(arquivo.tipo))) {
            return res.status(400).json({ error: 'Um ou mais arquivos anexados não são válidos.' });
        }

        const novaSolicitacaoPeca = await SolicitacaoPeca.create({
            cliente: usuario._id,
            solicitante: usuario.nome,
            tipoSolicitante: usuario.tipo,
            peca: String(peca).trim(),
            categoria: categoriaDb._id,
            descricao: String(descricao).trim(),
            cep: String(cep).trim(),
            cidade: String(cidade).trim(),
            rua: String(rua).trim(),
            referencia: String(referencia).trim(),
            arquivos: arquivosNormalizados
        });

        return res.status(201).json({ success: true, solicitacao: novaSolicitacaoPeca });
    } catch (erro) {
        console.error('Erro ao salvar solicitação de peça:', erro);
        return res.status(500).json({ error: 'Falha ao salvar a solicitação.' });
    }
});

const buscarLojaDoMural = async (usuarioToken) => {
    const id = String(usuarioToken?.id || usuarioToken?._id || '').trim();
    let loja = mongoose.Types.ObjectId.isValid(id) ? await Usuario.findById(id) : null;
    if (!loja && usuarioToken?.email) {
        loja = await Usuario.findOne({ email: String(usuarioToken.email).trim().toLowerCase() });
    }
    return loja && String(loja.tipo || '').trim().toLowerCase() === 'loja' ? loja : null;
};

app.get('/api/solicitacoes/abertas', verificarToken, exigirPermissao(['loja']), async (req, res) => {
    try {
        const loja = await buscarLojaDoMural(req.user);
        if (!loja) return res.status(404).json({ error: 'Loja não encontrada para o usuário autenticado.' });

        const solicitacoes = await SolicitacaoPeca.find({
            assumida: { $ne: true },
            status: { $nin: ['assumida', 'atendida', 'encerrada'] }
        })
            .populate('cliente', 'nome')
            .populate('categoria', 'nome')
            .sort({ data: -1 })
            .lean();

        return res.json({ success: true, solicitacoes });
    } catch (erro) {
        console.error('Erro ao carregar solicitações abertas:', erro);
        return res.status(500).json({ error: 'Falha ao carregar as solicitações abertas.' });
    }
});

app.put('/api/solicitacoes/:id/assumir', verificarToken, exigirPermissao(['loja']), async (req, res) => {
    try {
        const loja = await buscarLojaDoMural(req.user);
        if (!loja) return res.status(404).json({ error: 'Loja não encontrada para o usuário autenticado.' });
        if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
            return res.status(400).json({ error: 'Identificador de solicitação inválido.' });
        }

        const solicitacao = await SolicitacaoPeca.findOneAndUpdate(
            {
                _id: req.params.id,
                assumida: { $ne: true },
                status: { $nin: ['assumida', 'atendida', 'encerrada'] }
            },
            {
                $set: {
                    assumida: true,
                    status: 'assumida',
                    lojaAssumiu: loja._id,
                    dataAssumida: new Date()
                }
            },
            { returnDocument: 'after' }
        );

        if (!solicitacao) {
            return res.status(409).json({ error: 'Esta solicitação já foi assumida ou não está mais disponível.' });
        }

        try {
            const clienteCriador = await Usuario.findById(solicitacao.cliente).select('email').lean();
            if (clienteCriador?.email) {
                void transporter.sendMail({
                    from: process.env.SMTP_FROM || `"PEÇA BRUTA" <${process.env.SMTP_USER}>`,
                    to: clienteCriador.email,
                    subject: 'Atualização na sua solicitação - PEÇA BRUTA',
                    html: `<div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
                              <h2 style="color: #ff4d00; text-align: center; font-family: 'Arial Black', sans-serif;">PEÇA BRUTA</h2>
                              <p>Olá!</p>
                              <p>Houve uma atualização na sua solicitação de peça. Um lojista parceiro acabou de responder ao seu pedido.</p>
                              <div style="background-color: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 30px 0;">
                                  <span style="font-size: 22px; font-weight: bold; letter-spacing: 1px; color: #333;">Solicitação atualizada</span>
                              </div>
                              <p style="font-size: 14px;">Acesse a sua conta na plataforma e verifique a sua aba de Mensagens para ver a resposta.</p>
                              <p style="font-size: 12px; color: #777; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px;">Esta mensagem é uma atualização sobre a sua solicitação na plataforma Peça Bruta.</p>
                           </div>`
                }).then(() => {
                    console.log('E-mail de solicitação assumida enviado ao cliente.');
                }).catch(erroEmail => {
                    console.error('Falha ao enviar e-mail de solicitação assumida:', erroEmail.message);
                });
            } else {
                console.warn('Solicitação assumida, mas o cliente criador não possui e-mail cadastrado.');
            }
        } catch (erroBuscaEmail) {
            console.error('Solicitação assumida, mas não foi possível localizar o e-mail do cliente:', erroBuscaEmail.message);
        }

        return res.json({ success: true, message: 'Solicitação assumida com sucesso.', solicitacaoId: solicitacao._id });
    } catch (erro) {
        console.error('Erro ao assumir solicitação:', erro);
        return res.status(500).json({ error: 'Falha ao assumir a solicitação.' });
    }
});

// 4. ROTA PARA POSTAR PRODUTO (Preservada)
// 4. ROTA PARA POSTAR PRODUTO (Corrigida para receber imagens e opções)
app.post('/api/produtos/postar', verificarToken, exigirPermissao(['loja', 'admin']), async (req, res) => {
    try {
        if (String(req.user.tipo || '').toLowerCase() === 'loja') {
            const lojaAnunciante = await buscarLojaDoToken(req.user);
            if (!lojaAnunciante) {
                return res.status(404).json({ error: 'Loja não encontrada.' });
            }
            if (!String(lojaAnunciante.chavePix || '').trim()) {
                return res.status(403).json({
                    error: '⚠️ Obrigatório: Cadastre sua Chave PIX no Perfil da Loja antes de anunciar uma peça.'
                });
            }
        }

        // === 🔴 CORRIGIDO: Adicionada a extração de 'opcoes' do corpo da requisição ===
        const { titulo, preco, categoria, descricao, imagens, opcoes, visibilidade } = req.body;
        const visibilidadeProduto = String(visibilidade || 'publico').trim().toLowerCase() === 'reservado'
            ? 'reservado'
            : 'publico';
        
        // 🚨 ESPIÃO DO BACKEND: Imprime no terminal o que o servidor recebeu
        console.log("📥 DADOS RECEBIDOS DO NAVEGADOR:", { tituloRecebido: titulo, opcoesRecebidas: opcoes });
        
        const nomeLojaSeguro = req.user.isAdmin === true && req.body.nomeLoja ? req.body.nomeLoja : req.user.nome;

        const novoProduto = new Produto({
            idLoja: req.user.tipo === 'loja'
                ? String(req.user.id || req.user._id || req.user.sub || '')
                : '',
            nomeLoja: nomeLojaSeguro, 
            visibilidade: visibilidadeProduto,
            titulo, 
            preco, 
            categoria, 
            descricao, 
            imagens, // Gravando o array de fotos no banco
            opcoes   // === 🔴 ADICIONADO: Salvando o array de opções no banco ===
        });
        
        await novoProduto.save();
        
        res.json({ success: true, produto: novoProduto });
    } catch (err) {
        console.error("Erro ao publicar produto:", err.message);
        res.status(500).json({ error: 'Erro interno ao publicar produto' });
    }
});

// POST /api/produtos/:id/avaliacoes - Adiciona uma nova avaliação
app.post('/api/produtos/:id/avaliacoes', verificarToken, async (req, res) => {
    try {
        const { nota, texto } = req.body;
        const produtoId = req.params.id;

        if (!nota || nota < 1 || nota > 5) {
            return res.status(400).json({ error: 'Nota inválida.' });
        }

        const produto = await Produto.findById(produtoId);
        if (!produto) return res.status(404).json({ error: 'Produto não encontrado.' });

        // Cria a nova avaliação pegando o nome do usuário logado pelo token
        const novaAvaliacao = {
            usuario: req.user.nome || 'Cliente',
            nota: Number(nota),
            texto: texto
        };

        produto.avaliacoes.push(novaAvaliacao);

        // Recalcula a média de estrelas do produto
        const totalNotas = produto.avaliacoes.reduce((acc, curr) => acc + curr.nota, 0);
        produto.mediaGeral = totalNotas / produto.avaliacoes.length;

        await produto.save();

        res.json({ success: true, message: 'Avaliação salva com sucesso!' });
    } catch (err) {
        console.error("Erro ao salvar avaliação:", err.message);
        res.status(500).json({ error: 'Erro interno ao salvar avaliação.' });
    }
});

app.get('/api/produtos/:id/avaliacoes', async (req, res) => {
    try {
        const produtoId = req.params.id;
        const produto = await Produto.findById(produtoId).select('avaliacoes mediaGeral');

        if (!produto) return res.status(404).json({ error: 'Produto não encontrado.' });

        // Retorna as avaliações ordenadas da mais nova para a mais antiga
        const avaliacoesOrdenadas = produto.avaliacoes.sort((a, b) => b.data - a.data);

        res.json({ 
            success: true, 
            avaliacoes: avaliacoesOrdenadas,
            mediaGeral: produto.mediaGeral || 0
        });
    } catch (err) {
        console.error("Erro ao buscar avaliações:", err.message);
        res.status(500).json({ error: 'Erro interno ao buscar avaliações.' });
    }
});


// ==========================================
// ROTAS DO CHAT (API DE MENSAGENS)
// ==========================================

// 1. PORTA DE ENVIO (Salva a mensagem no banco)
app.post('/api/mensagens', async (req, res) => {
    try {
        const { remetente, destinatario, texto } = req.body;
        if (!remetente || !destinatario || !texto) return res.status(400).json({ erro: "Dados incompletos." });
        
        const novaMensagem = new Mensagem({
            remetente: remetente.toUpperCase(),
            destinatario: destinatario.toUpperCase(),
            texto: texto
        });
        await novaMensagem.save();
        res.status(201).json(novaMensagem);
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao salvar mensagem." });
    }
});

// Dispara o aviso por e-mail no clique em "Contatar Lojista", sem depender do envio da primeira mensagem.
app.post('/api/pedidos/:id/contatar', verificarToken, async (req, res) => {
    try {
        const idCliente = String(req.user?.id || req.user?._id || '').trim().toLowerCase();
        if (!mongoose.Types.ObjectId.isValid(idCliente)) {
            return res.status(401).json({ error: 'Token inválido ou sem ID de cliente.' });
        }
        if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
            return res.status(400).json({ error: 'Identificador de pedido inválido.' });
        }

        const pedido = await Pedido.findById(req.params.id).select('idCliente idLoja lojaDona idProduto nomeProduto').lean();
        if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado.' });
        if (String(pedido.idCliente || '').trim().toLowerCase() !== idCliente) {
            return res.status(403).json({ error: 'Este pedido não pertence ao cliente autenticado.' });
        }

        const produto = pedido.idProduto && mongoose.Types.ObjectId.isValid(String(pedido.idProduto))
            ? await Produto.findById(String(pedido.idProduto)).select('idLoja nomeLoja titulo').lean()
            : null;
        const idsPossiveis = [pedido.idLoja, pedido.lojaDona, produto?.idLoja]
            .map((id) => String(id || '').trim())
            .filter((id) => mongoose.Types.ObjectId.isValid(id));
        let loja = idsPossiveis.length
            ? await Usuario.findOne({ _id: { $in: idsPossiveis }, tipo: 'loja' }).select('nome email').lean()
            : null;

        if (!loja) {
            const nomesPossiveis = [...new Set([pedido.lojaDona, produto?.nomeLoja]
                .map((nome) => String(nome || '').trim()).filter(Boolean))];
            for (const nome of nomesPossiveis) {
                loja = await Usuario.findOne({ tipo: 'loja', nome })
                    .collation({ locale: 'pt', strength: 1 })
                    .select('nome email')
                    .lean();
                if (loja) break;
            }
        }
        if (!loja?.email) return res.status(404).json({ error: 'Não foi possível localizar o e-mail do lojista deste pedido.' });

        const numeroPedido = String(pedido._id).toUpperCase();
        const nomeProduto = String(pedido.nomeProduto || produto?.titulo || 'produto').trim();
        const textoEmail = `Olá! Um cliente acabou de solicitar contato no painel da Peça Bruta referente ao pedido #${numeroPedido} (Produto: ${nomeProduto}). Acesse suas mensagens na plataforma agora mesmo para garantir um atendimento rápido ao motorista!`;
        const urlMensagens = 'https://pecabruta.com.br/mensagens.html';
        const mailOptions = {
            from: process.env.SMTP_FROM,
            replyTo: process.env.SMTP_USER,
            to: loja.email,
            subject: 'Novo contato de cliente - Peça Bruta 💬',
            text: `${textoEmail}\n\nAcesse: ${urlMensagens}`,
            html: `<div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 560px; margin: 0 auto; padding: 20px;">
                <p>${escaparHTMLDeEmail(textoEmail)}</p>
                <p><a href="${urlMensagens}" style="color: #d94b12;">Acessar mensagens</a></p>
            </div>`
        };

        void transporter.sendMail(mailOptions)
            .then((resultado) => console.log(`📩 Aviso de contato de pedido ${numeroPedido} aceito pelo SMTP para ${loja.email}.`, resultado.messageId))
            .catch((erroEmail) => console.error(`Falha no aviso do pedido ${numeroPedido}:`, erroEmail.message, erroEmail.response || ''));

        return res.status(202).json({ success: true, message: 'Aviso de contato iniciado.' });
    } catch (erro) {
        console.error('Erro ao iniciar contato com lojista:', erro.message);
        return res.status(500).json({ error: 'Não foi possível iniciar o contato com o lojista.' });
    }
});

// 2. PORTA DE LEITURA (Puxa a conversa entre duas pessoas)
app.get('/api/mensagens/:usuario1/:usuario2', async (req, res) => {
    try {
        // AQUI ESTÁ A MÁGICA: Decodificando os nomes
        const u1 = decodeURIComponent(req.params.usuario1).toUpperCase();
        const u2 = decodeURIComponent(req.params.usuario2).toUpperCase();
        
        const historico = await Mensagem.find({
            $or: [
                { remetente: u1, destinatario: u2 },
                { remetente: u2, destinatario: u1 }
            ]
        }).sort({ dataEnvio: 1 });
        
        res.status(200).json(historico);
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar as mensagens." });
    }
});

// 3. PORTA DA BARRA LATERAL (Puxa os contatos salvos)
app.get('/api/lista-contatos/:usuario', async (req, res) => {
    try {
        const u = req.params.usuario.toUpperCase();
        const historico = await Mensagem.find({
            $or: [{ remetente: u }, { destinatario: u }]
        });

        const contatos = new Set();
        historico.forEach(msg => {
            if (msg.remetente !== u) contatos.add(msg.remetente);
            if (msg.destinatario !== u) contatos.add(msg.destinatario);
        });

        res.status(200).json(Array.from(contatos));
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar contatos." });
    }
});

// GET /api/produtos/feed - Busca todos os produtos ativos para o Feed Principal
app.get('/api/produtos/feed',  async (req, res) => {
    try {
        /// 1. Pega a categoria e ordem  que veio na URL (se houver)
        const categoriaEscolhida = req.query.categoria;
        const ordemEscolhida = req.query.ordem; // Pode ser 'mais_recentes', 'menor_preco', 'maior_preco', 'antigos'    

        // === 🔴 ATENÇÃO: ADICIONADO - PEGA O QUE FOI DIGITADO NA BARRA DE BUSCA ===
        const termoBusca = req.query.busca;

        // 2. Cria um filtro vazio (se não tiver categoria, busca tudo)
        let filtro = { visibilidade: { $ne: 'reservado' } }; 
        
        // 3. Se o frontend mandou uma categoria, adiciona ao filtro
        if (categoriaEscolhida) {
            filtro.categoria = categoriaEscolhida;
        }



        

        

        // === 🔴 ATENÇÃO: ADICIONADO - SE O USUÁRIO DIGITOU ALGO, PROCURA NO TÍTULO ===
        if (termoBusca && termoBusca.trim() !== '') {
            // O $regex busca a palavra em qualquer parte do título. O 'i' faz ignorar letras maiúsculas/minúsculas.
            filtro.titulo = { $regex: termoBusca, $options: 'i' };
        }

        // Define a ordenação padrão (Mais recentes primeiro)
        let ordenacao = { data: -1 }; 

        // Modifica a ordenação baseado no que o lojista escolheu
        if (ordemEscolhida === 'menor_preco') {
            ordenacao = { preco: 1 }; // 1 = Crescente (Menor para o Maior)
        } else if (ordemEscolhida === 'maior_preco') {
            ordenacao = { preco: -1 }; // -1 = Decrescente (Maior para o Menor)
        } else if (ordemEscolhida === 'antigos') {
            ordenacao = { data: 1 }; // Os mais velhos primeiro
        }

        // 4. Faz a busca no Mongo usando o filtro
        const produtos = await Produto.find(filtro).sort(ordenacao);
        
        res.json({ success: true, pecas: produtos });

    } catch (err) {
        console.error("Erro ao buscar produtos para o feed:", err.message);
        res.status(500).json({ error: 'Erro interno ao buscar produtos do Feed.' });
    }
});

// Rota para buscar um produto específico pelo ID
app.get('/api/produtos/:id', async (req, res) => {
    const produtoId = req.params.id;
    const produtoEncontrado = await Produto.findById(produtoId);
    if (!produtoEncontrado) {
        return res.status(404).json({ erro: "Produto não encontrado" });
    }
    res.json({
        produto: produtoEncontrado
    });
});

// 5. ROTA DE ADMIN (Preservada)
app.get('/api/admin/dados', verificarToken, exigirPermissao(['admin']), async (req, res) => {
    try {
        const totalClientes = await Usuario.countDocuments({ tipo: 'cliente' });
        const totalProdutos = await Produto.countDocuments({});
        const empresas = await Solicitacao.find().sort({ data: -1 }).select('-senha');
        const todosUsuarios = await Usuario.find().select('-senha');
        
        res.json({ totalClientes, totalProdutos, empresas, todosUsuarios });
    } catch (err) {
        res.status(500).json({ error: 'Erro de processamento no painel Admin' });
    }
});

// Elegibilidade financeira depende exclusivamente de recebidoPeloCliente,
// campo alterado pela rota de confirmação do cliente, nunca do status de entrega da loja.
app.get('/api/admin/financeiro/pedidos', verificarToken, exigirPermissao(['admin']), async (req, res) => {
    try {
        const pedidos = await Pedido.find({
            idPagamento: { $type: 'string', $ne: '' },
            recebidoPeloCliente: true,
            $or: [
                { statusRepasse: { $in: ['pendente', 'concluido', 'Repasse Concluído'] } },
                { statusRepasse: null }
            ]
        })
            .select('_id idPagamento idLoja lojaDona idCliente nomeCliente idProduto nomeProduto quantidade valorTotal statusEntrega dataCompra recebidoPeloCliente dataRecebimentoCliente statusRecebimento statusRepasse dataRepasse')
            .sort({ dataCompra: -1 })
            .lean();

        const idsClientes = [...new Set(pedidos
            .map((pedido) => String(pedido.idCliente || ''))
            .filter((id) => mongoose.Types.ObjectId.isValid(id)))];
        const idsLojas = [...new Set(pedidos
            .map((pedido) => String(pedido.idLoja || ''))
            .filter((id) => mongoose.Types.ObjectId.isValid(id)))];
        const nomesLegadosLojas = [...new Set(pedidos
            .map((pedido) => String(pedido.lojaDona || '').trim())
            .filter(Boolean))];

        const [clientes, lojasPorId, lojasPorNome] = await Promise.all([
            idsClientes.length ? Usuario.find({ _id: { $in: idsClientes } }).select('nome').lean() : [],
            idsLojas.length ? Usuario.find({ _id: { $in: idsLojas }, tipo: 'loja' }).select('nome chavePix').lean() : [],
            nomesLegadosLojas.length
                ? Usuario.find({ tipo: 'loja', nome: { $in: nomesLegadosLojas } })
                    .select('nome chavePix')
                    .collation({ locale: 'pt', strength: 1 })
                    .lean()
                : []
        ]);
        const nomesClientes = new Map(clientes.map((usuario) => [String(usuario._id), usuario.nome]));
        const lojasPorIdMap = new Map(lojasPorId.map((loja) => [String(loja._id).toLowerCase(), loja]));
        const normalizarNomeLoja = (nome) => String(nome || '').trim().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const repasseConcluido = (pedido) => ['concluido', 'repasse concluído'].includes(
            String(pedido.statusRepasse || '').trim().toLowerCase()
        );
        const lojasPorNomeMap = new Map(lojasPorNome.map((loja) => [normalizarNomeLoja(loja.nome), loja]));

        res.json(pedidos.map((pedido) => {
            const idLojaInformado = String(pedido.idLoja || '').trim().toLowerCase();
            const loja = lojasPorIdMap.get(idLojaInformado)
                || lojasPorNomeMap.get(normalizarNomeLoja(pedido.lojaDona));
            return {
                ...pedido,
                nomeCliente: pedido.nomeCliente || nomesClientes.get(String(pedido.idCliente || '')) || 'Cliente não identificado',
                idLoja: loja ? String(loja._id) : pedido.idLoja,
                lojaDona: loja?.nome || pedido.lojaDona || 'Loja sem identificação',
                chavePix: loja?.chavePix || '',
                status: repasseConcluido(pedido) ? 'Repasse Concluído' : 'Recebimento Confirmado'
            };
        }));
    } catch (erro) {
        console.error('Erro ao carregar pedidos para o painel financeiro:', erro);
        res.status(500).json({ error: 'Não foi possível carregar os pedidos aprovados para transferência.' });
    }
});

app.put('/api/admin/pedidos/:id/repasse', verificarToken, exigirPermissao(['admin']), async (req, res) => {
    try {
        const idPedido = String(req.params.id || '');
        if (!mongoose.Types.ObjectId.isValid(idPedido)) {
            return res.status(400).json({ error: 'Identificador de pedido inválido.' });
        }

        const pedido = await Pedido.findById(idPedido).select('_id idPagamento recebidoPeloCliente dataRecebimentoCliente statusRepasse');
        if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado.' });
        if (!pedido.idPagamento) {
            return res.status(409).json({ error: 'Somente pedidos com pagamento aprovado podem receber baixa de repasse.' });
        }
        if (['concluido', 'Repasse Concluído'].includes(pedido.statusRepasse)) {
            return res.status(409).json({ error: 'Este pedido já teve o repasse confirmado.' });
        }
        if (!pedido.recebidoPeloCliente) {
            return res.status(409).json({ error: 'O cliente ainda não confirmou o recebimento do pedido.' });
        }

        const pedidoAtualizado = await Pedido.findOneAndUpdate(
            { _id: idPedido, idPagamento: { $type: 'string', $ne: '' }, recebidoPeloCliente: true, statusRepasse: { $nin: ['concluido', 'Repasse Concluído'] } },
            { $set: { statusRepasse: 'Repasse Concluído', dataRepasse: new Date() } },
            { returnDocument: 'after' }
        );
        if (!pedidoAtualizado) {
            return res.status(409).json({ error: 'O repasse já foi confirmado por outro administrador.' });
        }

        return res.json({
            success: true,
            pedidoId: pedidoAtualizado._id,
            status: pedidoAtualizado.statusRepasse,
            statusRepasse: pedidoAtualizado.statusRepasse,
            dataRepasse: pedidoAtualizado.dataRepasse
        });
    } catch (erro) {
        console.error('Erro ao confirmar repasse do pedido:', erro);
        return res.status(500).json({ error: 'Falha ao confirmar o repasse.' });
    }
});

// 6. ROTA DE APROVAÇÃO E CONVERSÃO DE CONTA 
app.put('/api/admin/solicitacao/:id', verificarToken, exigirPermissao(['admin']), async (req, res) => {
    try {
        const { status } = req.body;
        const solicitacao = await Solicitacao.findById(req.params.id);

        if (!solicitacao) {
            return res.status(404).json({ error: 'Solicitação não encontrada na base de dados.' });
        }

        solicitacao.status = status;
        await solicitacao.save();
        let emailBoasVindasEnviado = false;

        if (status === 'aprovada') {
            const emailSanitizado = solicitacao.email.trim().toLowerCase();
            const usuarioExistente = await Usuario.findOne({ email: emailSanitizado });

            if (!usuarioExistente) {
                const novaLoja = new Usuario({
                    nome: solicitacao.loja,
                    email: emailSanitizado,
                    senha: solicitacao.senha,
                    tipo: 'loja',
                    fotoPerfil: '',
                    bio: `Site: ${solicitacao.site || 'Não informado'} | WhatsApp: ${solicitacao.whatsapp || 'Não informado'}`,
                    telefone: solicitacao.whatsapp,
                    cpf: solicitacao.cnpj, 
                    emailVerificado: true, 
                    aceitouTermos: true
                });
                await novaLoja.save();
            } else {
                usuarioExistente.tipo = 'loja';
                usuarioExistente.nome = solicitacao.loja;
                usuarioExistente.senha = solicitacao.senha; 
                usuarioExistente.bio = `Site: ${solicitacao.site || 'Não informado'} | WhatsApp: ${solicitacao.whatsapp || 'Não informado'}`;
                await usuarioExistente.save();
            }

            const cabecalhosEmail = obterCabecalhosEmailTransacional();
            if (!cabecalhosEmail) {
                console.error(`⚠️ Aprovação concluída, mas não há endereço SMTP_FROM/SMTP_USER válido para enviar boas-vindas a ${emailSanitizado}.`);
            } else {
                const textoBoasVindas = 'Olá! O seu cadastro na Peça Bruta foi aprovado. Agora já pode acessar o seu painel de lojista, cadastrar as suas peças e começar a vender na plataforma.';
                try {
                    await transporter.sendMail({
                        ...cabecalhosEmail,
                        to: emailSanitizado,
                        subject: 'Bem-vindo à Peça Bruta - Seu cadastro foi aprovado!',
                        text: textoBoasVindas,
                        html: `<div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
                                  <h2 style="color: #ff4d00; text-align: center; font-family: 'Arial Black', sans-serif;">PEÇA BRUTA</h2>
                                  <p>${escaparHTMLDeEmail(textoBoasVindas)}</p>
                                  <p style="font-size: 12px; color: #777; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px;">Esta é uma mensagem automática sobre a aprovação do seu cadastro de parceiro.</p>
                               </div>`
                    });
                    emailBoasVindasEnviado = true;
                    console.log(`📩 E-mail de aprovação enviado para ${emailSanitizado}.`);
                } catch (erroEmail) {
                    console.error(`⚠️ A loja ${emailSanitizado} foi aprovada, mas o e-mail de boas-vindas falhou:`, erroEmail.message);
                }
            }
        } else if (status === 'recusada') {
            const emailSanitizado = solicitacao.email.trim().toLowerCase();
            const usuarioExistente = await Usuario.findOne({ email: emailSanitizado });
            if (usuarioExistente && usuarioExistente.tipo === 'loja') {
                usuarioExistente.tipo = 'cliente';
                await usuarioExistente.save();
            }
        }

        res.json({
            success: true,
            message: `Status alterado para ${status} e conta sincronizada.`,
            emailBoasVindasEnviado
        });
    } catch (err) {
        console.error("Erro interno ao atualizar status da solicitação:", err.message);
        res.status(500).json({ error: 'Falha ao processar atualização e conversão da empresa.' });
    }
});

// TRATAMENTO GLOBAL DE ERROS NÃO ESPERADOS (OWASP Config)
app.use((err, req, res, next) => {
    if (err.code === 11000) {
        return res.status(400).json({ error: "Erro de duplicidade: Este registro já existe em nossa base." });
    }
    console.error("Erro não tratado (Log Seguro):", err.message);
    res.status(500).json({ error: "Ocorreu um erro interno no servidor." });
});

// =========================================================================
// 🗑️ NOVA ROTA: EXCLUIR PRODUTO DO BANCO DE DADOS
// =========================================================================
app.delete('/api/produtos/:id', verificarToken, exigirPermissao(['loja', 'admin']), async (req, res) => {
    try {
        const produtoId = req.params.id;
        
        // 1. Primeiro, vamos achar a peça no banco de dados para ter certeza de que ela existe
        const produtoParaExcluir = await Produto.findById(produtoId);
        
        if (!produtoParaExcluir) {
            return res.status(404).json({ error: 'Produto não encontrado no banco de dados.' });
        }

        // 2. Proteção de Segurança: A loja só pode excluir a peça se for a dona dela!
        // (A menos que seja o administrador, que pode excluir qualquer coisa)
        if (req.user.isAdmin !== true && produtoParaExcluir.nomeLoja !== req.user.nome) {
            return res.status(403).json({ error: 'Acesso negado. Você só pode excluir peças da sua própria loja.' });
        }

        // 3. A peça é da loja? Então manda pro triturador!
        await Produto.findByIdAndDelete(produtoId);
        
        console.log(`🗑️ [EXCLUSÃO]: A loja ${req.user.nome} acabou de excluir a peça "${produtoParaExcluir.titulo}".`);
        res.json({ success: true, message: 'Peça excluída com sucesso do catálogo!' });

    } catch (err) {
        console.error("Erro interno ao excluir produto:", err.message);
        res.status(500).json({ error: 'Erro interno do servidor ao tentar excluir a peça.' });
    }
});


// ==========================================
// ROTA DE PAGAMENTO DO MERCADO PAGO
// ==========================================
// ==========================================
// ROTA UNIFICADA DE PAGAMENTO (BRICKS + METADATA)
// ==========================================
app.post('/api/pagar', async (req, res) => {
    try {
        console.log("\n--- [API PAGAR] Nova requisição recebida do Brick ---");
        
        // Recebe os dados bancários do Brick e todas as linhas do carrinho.
        const { idProduto, itens: itensRecebidos, idCliente, enderecoEntrega, ...dadosDoBrick } = req.body;

        // O Payment Brick informa token e bandeira do cartão; não permita
        // que uma compra com cartão chegue ao Mercado Pago sem parcelas válidas.
        if (dadosDoBrick.token && dadosDoBrick.payment_method_id) {
            const parcelas = Number(dadosDoBrick.installments);
            if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 12) {
                return res.status(400).json({ error: 'Selecione uma quantidade válida de parcelas no cartão.' });
            }
            dadosDoBrick.installments = parcelas;
        }

        const camposEndereco = ['rua', 'numero', 'bairro', 'cep', 'cidade'];
        if (!enderecoEntrega || camposEndereco.some((campo) => !String(enderecoEntrega[campo] || '').trim())) {
            return res.status(400).json({ error: 'Preencha o endereço completo de entrega.' });
        }

        const enderecoNormalizado = Object.fromEntries(
            camposEndereco.map((campo) => [campo, String(enderecoEntrega[campo]).trim()])
        );

        // Mantém compatibilidade com pagamentos legados de um único produto.
        const linhasRecebidas = Array.isArray(itensRecebidos) && itensRecebidos.length
            ? itensRecebidos
            : (idProduto ? [{ idProduto, quantidade: 1 }] : []);
        if (!linhasRecebidas.length || linhasRecebidas.length > 50) {
            return res.status(400).json({ error: 'Carrinho inválido: informe de 1 a 50 produtos.' });
        }
        if (linhasRecebidas.some((linha) => !linha || typeof linha !== 'object')) {
            return res.status(400).json({ error: 'O carrinho contém uma linha inválida.' });
        }

        const linhasNormalizadas = linhasRecebidas.map((linha) => ({
            idProduto: String(linha.idProduto || linha._id || linha.id || '').trim(),
            quantidade: linha.quantidade == null ? 1 : Number(linha.quantidade),
            opcaoSelecionada: linha.opcaoSelecionada == null ? null : String(linha.opcaoSelecionada).slice(0, 120)
        }));
        if (linhasNormalizadas.some((linha) =>
            !mongoose.Types.ObjectId.isValid(linha.idProduto) ||
            !Number.isInteger(linha.quantidade) || linha.quantidade < 1 || linha.quantidade > 99
        )) {
            return res.status(400).json({ error: 'Um ou mais produtos ou quantidades do carrinho são inválidos.' });
        }

        const idsProdutos = [...new Set(linhasNormalizadas.map((linha) => linha.idProduto))];
        const produtosEncontrados = await Produto.find({ _id: { $in: idsProdutos } });
        const produtosPorId = new Map(produtosEncontrados.map((produto) => [produto._id.toString(), produto]));
        let valorTotalCentavos = 0n;
        const itensParaMercadoPago = [];
        const itensParaMetadata = [];

        // O backend consulta os preços atuais no MongoDB; o total do navegador
        // nunca é usado como fonte de verdade para a cobrança.
        for (const linha of linhasNormalizadas) {
            const produto = produtosPorId.get(linha.idProduto);
            if (!produto) {
                return res.status(404).json({ error: `Produto ${linha.idProduto} não encontrado.` });
            }

            let loja = null;
            if (produto.idLoja && mongoose.Types.ObjectId.isValid(String(produto.idLoja))) {
                loja = await Usuario.findOne({ _id: String(produto.idLoja), tipo: 'loja' });
            }
            // Produtos antigos podem conter somente o nome da loja.
            if (!loja && produto.nomeLoja) {
                loja = await Usuario.findOne({ nome: String(produto.nomeLoja).trim(), tipo: 'loja' })
                    .collation({ locale: 'pt', strength: 2 });
            }
            if (!loja) {
                return res.status(409).json({ error: `Não foi possível identificar a loja do produto "${produto.titulo}". O pagamento não foi criado.` });
            }

            const preco = produto.preco && produto.preco.$numberDecimal != null
                ? produto.preco.$numberDecimal
                : produto.preco;
            const precoUnitarioCentavos = valorParaCentavos(preco);
            if (precoUnitarioCentavos <= 0n) {
                return res.status(400).json({ error: `O preço do produto "${produto.titulo}" precisa ser maior que zero.` });
            }
            const subtotalCentavos = precoUnitarioCentavos * BigInt(linha.quantidade);
            valorTotalCentavos += subtotalCentavos;

            itensParaMercadoPago.push({
                id: produto._id.toString(),
                title: String(produto.titulo || 'Produto').slice(0, 250),
                quantity: linha.quantidade,
                unit_price: Number(centavosParaDecimal(precoUnitarioCentavos))
            });
            itensParaMetadata.push({
                id_produto: produto._id.toString(),
                nome_produto: String(produto.titulo || 'Produto').slice(0, 250),
                quantidade: linha.quantidade,
                opcao_selecionada: linha.opcaoSelecionada,
                id_lojista: loja._id.toString(),
                nome_loja: String(loja.nome || produto.nomeLoja || 'Loja Parceira').slice(0, 120),
                preco_unitario_centavos: precoUnitarioCentavos.toString(),
                subtotal_centavos: subtotalCentavos.toString()
            });
        }

        if (valorTotalCentavos <= 0n || valorTotalCentavos > BigInt(Number.MAX_SAFE_INTEGER)) {
            return res.status(400).json({ error: 'O valor total do carrinho é inválido.' });
        }

        // Evita confirmar um pagamento com parcelas calculadas sobre um preço
        // antigo mostrado no Brick; nesse caso o cliente precisa atualizar o checkout.
        if (dadosDoBrick.transaction_amount != null) {
            let totalMostradoCentavos;
            try {
                totalMostradoCentavos = valorParaCentavos(dadosDoBrick.transaction_amount);
            } catch (erro) {
                return res.status(400).json({ error: 'O valor informado pelo formulário de pagamento é inválido.' });
            }
            if (totalMostradoCentavos !== valorTotalCentavos) {
                return res.status(409).json({ error: 'O preço de um ou mais produtos mudou. Atualize o carrinho e tente novamente.' });
            }
        }

        // Todos os meios de pagamento recebem o mesmo total calculado no servidor.
        dadosDoBrick.transaction_amount = Number(centavosParaDecimal(valorTotalCentavos));
        dadosDoBrick.description = itensParaMetadata.length === 1
            ? itensParaMetadata[0].nome_produto
            : `Compra de ${itensParaMetadata.length} produtos - Peça Bruta`;
        dadosDoBrick.additional_info = {
            ...(dadosDoBrick.additional_info && typeof dadosDoBrick.additional_info === 'object' ? dadosDoBrick.additional_info : {}),
            items: itensParaMercadoPago
        };
        const referenciaCheckout = crypto.randomBytes(16).toString('hex');
        await CheckoutPagamento.create({
            referencia: referenciaCheckout,
            idCliente: String(idCliente || 'CLIENTE_NAO_IDENTIFICADO'),
            itens: itensParaMetadata.map((item) => ({
                idProduto: item.id_produto,
                nomeProduto: item.nome_produto,
                quantidade: item.quantidade,
                opcaoSelecionada: item.opcao_selecionada,
                idLoja: item.id_lojista,
                nomeLoja: item.nome_loja,
                precoUnitarioCentavos: item.preco_unitario_centavos,
                subtotalCentavos: item.subtotal_centavos
            })),
            valorTotalCentavos: valorTotalCentavos.toString(),
            enderecoEntrega: enderecoNormalizado
        });
        dadosDoBrick.external_reference = referenciaCheckout;
        dadosDoBrick.metadata = {
            id_cliente: String(idCliente || 'CLIENTE_NAO_IDENTIFICADO'),
            id_checkout: referenciaCheckout,
            id_produto: itensParaMetadata[0].id_produto,
            id_lojista: itensParaMetadata.length === 1 ? itensParaMetadata[0].id_lojista : '',
            nome_loja: itensParaMetadata.length === 1 ? itensParaMetadata[0].nome_loja : '',
            endereco_entrega: enderecoNormalizado
        };

        // 4. Cria o pagamento de fato (API Payment)
        const pagamento = new Payment(clienteMercadoPago);
        let resposta;
        try {
            resposta = await pagamento.create({ body: dadosDoBrick });
        } catch (erroPagamento) {
            await CheckoutPagamento.updateOne(
                { referencia: referenciaCheckout, status: 'aguardando_pagamento' },
                { $set: { status: 'falha' } }
            ).catch((erroAtualizacao) => console.error('Falha ao marcar checkout como não processado:', erroAtualizacao.message));
            throw erroPagamento;
        }
        await CheckoutPagamento.updateOne(
            { referencia: referenciaCheckout, status: 'aguardando_pagamento' },
            { $set: { idPagamento: String(resposta.id), status: String(resposta.status || 'criado') } }
        ).catch((erroAtualizacao) => console.error('Falha ao vincular pagamento ao checkout:', erroAtualizacao.message));

        console.log(`✅ Pagamento processado. Status: ${resposta.status}`);

        // 5. O SEGREDO: Devolvemos a resposta exata para o Brick desenhar o QR Code!
        return res.status(200).json(resposta);

    } catch (erro) {
        console.error("❌ Erro ao gerar pagamento:", erro);
        return res.status(500).json({ error: "Falha ao gerar o pagamento." });
    }
});


// ==========================================
// ROTA "RADAR" PARA O FRONTEND VERIFICAR O PIX
// ==========================================
app.get('/api/pagamento/status/:id', async (req, res) => {
    try {
        const resposta = await fetch(`https://api.mercadopago.com/v1/payments/${req.params.id}`, {
            headers: { 'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
        });
        const dados = await resposta.json();
        res.json({ status: dados.status });
    } catch (erro) {
        res.status(500).json({ error: "Erro ao verificar status" });
    }
});



// Compras e vendas do usuário autenticado na mesma listagem.
app.get('/api/meus-pedidos', verificarToken, async (req, res) => {
    try {
        const idUsuario = String(req.user?.id || req.user?._id || '').trim();
        const idAlternativo = String(req.user?._id || req.user?.id || '').trim();
        const tipoUsuario = String(req.user?.tipo || '').trim().toLowerCase();
        const filtrosPedidos = [...new Set([idUsuario, idAlternativo].filter(Boolean))]
            .map((idCliente) => ({ idCliente }));

        // Apenas lojas recebem vendas; evita expor pedidos de terceiros a clientes
        // cujo nome por acaso seja igual ao nome fantasia de uma loja.
        if (tipoUsuario === 'loja') {
            let loja = null;
            if (mongoose.Types.ObjectId.isValid(idUsuario)) {
                loja = await Usuario.findById(idUsuario);
            }
            if (!loja && req.user?.email) {
                loja = await Usuario.findOne({ email: String(req.user.email).trim().toLowerCase() });
            }
            if (!loja || String(loja.tipo || '').trim().toLowerCase() !== 'loja') {
                return res.status(404).json({ error: 'Conta de loja não encontrada para o usuário autenticado.' });
            }
            const idLoja = loja._id.toString();
            filtrosPedidos.push({ idLoja });
            filtrosPedidos.push({ lojaDona: idLoja });
            filtrosPedidos.push({ lojaDona: loja.nome });
            if (req.user?.nome && req.user.nome !== loja.nome) {
                filtrosPedidos.push({ lojaDona: req.user.nome });
            }
        } else if (tipoUsuario !== 'cliente' && tipoUsuario !== 'admin') {
            return res.status(403).json({ error: 'Tipo de conta sem acesso ao histórico de pedidos.' });
        }

        const meusPedidos = await Pedido.find({ $or: filtrosPedidos }).sort({ dataCompra: -1 });
        const idsClientes = [...new Set(meusPedidos
            .map((pedido) => String(pedido.idCliente || ''))
            .filter((id) => mongoose.Types.ObjectId.isValid(id)))];
        const clientes = idsClientes.length
            ? await Usuario.find({ _id: { $in: idsClientes } }).select('nome').lean()
            : [];
        const nomesClientes = new Map(clientes.map((cliente) => [String(cliente._id), cliente.nome]));
        res.json(meusPedidos.map((pedido) => {
            const dadosPedido = pedido.toObject();
            dadosPedido.nomeCliente = dadosPedido.nomeCliente || nomesClientes.get(String(dadosPedido.idCliente)) || '';
            return dadosPedido;
        }));
    } catch (erro) {
        console.error('Erro ao buscar compras e vendas do usuário:', erro);
        res.status(500).json({ error: 'Falha ao buscar os pedidos.' });
    }
});

// Atualiza somente statusEntrega do pedido da loja autenticada; não altera campos financeiros.
app.put('/api/pedidos/:id/status', verificarToken, async (req, res) => {
    try {
        if (String(req.user?.tipo || '').trim().toLowerCase() !== 'loja') {
            return res.status(403).json({ error: 'Somente lojas podem atualizar o status de entrega.' });
        }

        const idLojaJWT = String(req.user?.id || req.user?._id || '').trim();
        const emailLojaJWT = String(req.user?.email || '').trim().toLowerCase();
        let loja = mongoose.Types.ObjectId.isValid(idLojaJWT)
            ? await Usuario.findById(idLojaJWT)
            : null;
        if (!loja && emailLojaJWT) loja = await Usuario.findOne({ email: emailLojaJWT });
        if (!loja || String(loja.tipo || '').trim().toLowerCase() !== 'loja') {
            return res.status(404).json({ error: 'Conta de loja não encontrada para o usuário autenticado.' });
        }
        if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
            return res.status(400).json({ error: 'Identificador de pedido inválido.' });
        }

        const statusPermitidos = ['Aguardando Envio', 'Preparando', 'Enviado', 'Entregue'];
        const statusEntrega = String(req.body.statusEntrega || '').trim();
        if (!statusPermitidos.includes(statusEntrega)) {
            return res.status(400).json({ error: 'Status de entrega inválido.' });
        }

        const idLoja = loja._id.toString();
        const nomesLegados = [...new Set([loja.nome, req.user?.nome].filter(Boolean))];
        const pedidoAtualizado = await Pedido.findOneAndUpdate({
            _id: req.params.id,
            $or: [
                { idLoja },
                { lojaDona: idLoja },
                ...nomesLegados.map((lojaDona) => ({ lojaDona }))
            ]
        }, {
            $set: { statusEntrega }
        }, {
            returnDocument: 'after',
            runValidators: true
        });
        if (!pedidoAtualizado) return res.status(404).json({ error: 'Pedido não encontrado para esta loja.' });

        return res.json({ success: true, statusEntrega: pedidoAtualizado.statusEntrega });
    } catch (erro) {
        console.error('Erro ao atualizar status do pedido:', erro);
        return res.status(500).json({ error: 'Falha ao atualizar o status do pedido.' });
    }
});

function escaparHTMLDeEmail(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (caractere) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[caractere]);
}

function obterCabecalhosEmailTransacional() {
    const remetenteConfigurado = String(process.env.SMTP_FROM || '').trim();
    const remetenteParseado = remetenteConfigurado.match(/^\s*(?:"([^"]+)"|([^<>]*))?\s*<([^<>]+)>\s*$/);
    const enderecoRemetente = String(
        remetenteParseado?.[3]
        || (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(remetenteConfigurado) ? remetenteConfigurado : '')
        || process.env.SMTP_USER
        || ''
    ).trim();
    if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(enderecoRemetente)) return null;

    return {
        from: { name: 'Peça Bruta', address: enderecoRemetente },
        replyTo: process.env.SMTP_REPLY_TO || enderecoRemetente
    };
}

async function notificarLojaRecebimentoConfirmado(pedido) {
    try {
        const idsPossiveis = [pedido.idLoja, pedido.lojistaId, pedido.lojaId, pedido.lojaDona]
            .map((valor) => String(valor || '').trim())
            .filter((valor) => mongoose.Types.ObjectId.isValid(valor));
        let loja = idsPossiveis.length
            ? await Usuario.findOne({ _id: { $in: idsPossiveis }, tipo: 'loja' }).select('nome email').lean()
            : null;

        if (!loja && pedido.lojaDona) {
            loja = await Usuario.findOne({ tipo: 'loja', nome: String(pedido.lojaDona).trim() })
                .collation({ locale: 'pt', strength: 1 })
                .select('nome email')
                .lean();
        }

        if (!loja?.email) {
            console.warn(`⚠️ Recebimento confirmado no pedido ${pedido._id}, mas não foi encontrado e-mail para a loja.`);
            return;
        }

        const nomeProduto = String(pedido.nomeProduto || 'produto').trim();
        const valorBruto = Number(pedido.valorTotal);
        const valorLiquido = Number.isFinite(valorBruto) && valorBruto >= 0
            ? Number((valorBruto * 0.9).toFixed(2))
            : null;
        const valorFormatado = valorLiquido === null
            ? 'valor a confirmar'
            : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorLiquido);
        const numeroPedido = String(pedido._id || pedido.id || 'não informado');
        const produtoSeguro = escaparHTMLDeEmail(nomeProduto);
        const valorSeguro = escaparHTMLDeEmail(valorFormatado);
        const numeroPedidoSeguro = escaparHTMLDeEmail(numeroPedido);
        const textoEmail = `Olá! O cliente confirmou o recebimento do pedido #${numeroPedido}. O repasse financeiro será processado em breve. Produto: ${nomeProduto}. Valor líquido: ${valorFormatado}.`;
        if (!String(process.env.SMTP_FROM || '').trim() || !String(process.env.SMTP_USER || '').trim()) {
            console.error('⚠️ E-mail de recebimento não enviado: configure SMTP_FROM e SMTP_USER.');
            return;
        }

        const mailOptions = {
            from: process.env.SMTP_FROM,
            replyTo: process.env.SMTP_USER,
            to: loja.email,
            subject: 'Entrega confirmada pelo cliente - Peça Bruta',
            text: textoEmail,
            html: `<div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
                      <h2 style="color: #ff4d00; text-align: center; font-family: 'Arial Black', sans-serif;">PEÇA BRUTA</h2>
                      <p>Olá! O cliente confirmou o recebimento do pedido <strong>#${numeroPedidoSeguro}</strong>.</p>
                      <p>O repasse financeiro será processado em breve.</p>
                      <p>Produto: <strong>${produtoSeguro}</strong><br>Valor líquido: <strong>${valorSeguro}</strong></p>
                      <p style="font-size: 12px; color: #777; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px;">Esta é uma atualização automática sobre um pedido da sua loja.</p>
                   </div>`
        };
        await transporter.sendMail(mailOptions);
        console.log(`📩 Aviso de recebimento confirmado enviado para a loja ${loja._id}.`);
    } catch (erroEmail) {
        console.error(`⚠️ Falha ao notificar a loja sobre o pedido ${pedido?._id}:`, erroEmail.message);
    }
}

// A confirmação pertence ao cliente; o lojista recebe essa informação na listagem.
app.post('/api/pedidos/:id/confirmar-recebimento', verificarToken, async (req, res) => {
    try {
        const idCliente = String(req.user?.id || req.user?._id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(idCliente)) {
            return res.status(401).json({ error: 'Token inválido ou sem ID de cliente.' });
        }
        if (String(req.user?.tipo || '').trim().toLowerCase() !== 'cliente') {
            return res.status(403).json({ error: 'Somente o cliente do pedido pode confirmar o recebimento.' });
        }
        if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
            return res.status(400).json({ error: 'Identificador de pedido inválido.' });
        }

        let pedido = await Pedido.findOneAndUpdate(
            { _id: req.params.id, idCliente, recebidoPeloCliente: { $ne: true } },
            { $set: {
                recebidoPeloCliente: true,
                dataRecebimentoCliente: new Date(),
                statusRecebimento: 'Recebimento Confirmado',
                statusEntrega: 'Entregue'
            } },
            { returnDocument: 'after' }
        );
        let acabouDeConfirmar = Boolean(pedido);
        if (!pedido) {
            pedido = await Pedido.findOne({ _id: req.params.id, idCliente });
            if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado para este cliente.' });
            const statusFoiConfirmadoAgora = pedido.statusRecebimento !== 'Recebimento Confirmado';
            if (pedido.recebidoPeloCliente && (
                pedido.statusEntrega !== 'Entregue' || pedido.statusRecebimento !== 'Recebimento Confirmado'
                || !pedido.dataRecebimentoCliente
            )) {
                pedido.statusEntrega = 'Entregue';
                pedido.statusRecebimento = 'Recebimento Confirmado';
                if (!pedido.dataRecebimentoCliente) pedido.dataRecebimentoCliente = new Date();
                await pedido.save();
                if (statusFoiConfirmadoAgora) acabouDeConfirmar = true;
            }
        }
        if (acabouDeConfirmar) void notificarLojaRecebimentoConfirmado(pedido);
        return res.json({
            success: true,
            recebidoPeloCliente: pedido.recebidoPeloCliente,
            statusRecebimento: pedido.statusRecebimento,
            dataRecebimentoCliente: pedido.dataRecebimentoCliente
        });
    } catch (erro) {
        console.error('Erro ao confirmar recebimento pelo cliente:', erro);
        return res.status(500).json({ error: 'Falha ao confirmar o recebimento.' });
    }
});

// ==========================================
// WEBHOOK: PAGAMENTOS E PEDIDOS
// ==========================================
app.post('/api/webhook', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
    try {
        const pagamentoId = req.query['data.id'] || req.query.id || (req.body && req.body.data && req.body.data.id);
        const tipoEvento = req.query.type || req.query.topic || (req.body && req.body.action) || (req.body && req.body.type);

        if (!pagamentoId || !['payment', 'payment.created', 'payment.updated'].includes(tipoEvento)) {
            return res.status(200).send('Evento ignorado.');
        }

        // Confirma o estado diretamente com o Mercado Pago; o conteúdo do webhook
        // sozinho não é considerado prova de aprovação.
        const respostaMP = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagamentoId)}`, {
            headers: { 'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
        });
        if (!respostaMP.ok) {
            throw new Error(`Mercado Pago respondeu HTTP ${respostaMP.status} ao consultar o pagamento.`);
        }

        const dadosPagamento = await respostaMP.json();
        if (dadosPagamento.status !== 'approved') {
            return res.status(200).send('Pagamento ainda não aprovado.');
        }

        const metadata = dadosPagamento.metadata || {};
        const idPagamento = String(dadosPagamento.id || pagamentoId);
        const referenciaCheckout = String(dadosPagamento.external_reference || metadata.id_checkout || '').trim();
        const checkoutPagamento = referenciaCheckout
            ? await CheckoutPagamento.findOne({ referencia: referenciaCheckout })
            : null;
        const idCliente = String(checkoutPagamento?.idCliente || metadata.id_cliente || 'CLIENTE_NAO_IDENTIFICADO');
        const valorBrutoCentavos = valorParaCentavos(dadosPagamento.transaction_amount);
        if (valorBrutoCentavos <= 0n) {
            throw new Error(`Valor bruto inválido no pagamento ${idPagamento}.`);
        }

        let enderecoMetadata = checkoutPagamento?.enderecoEntrega || metadata.endereco_entrega;
        if (typeof enderecoMetadata === 'string') {
            try { enderecoMetadata = JSON.parse(enderecoMetadata); } catch (erro) { enderecoMetadata = null; }
        }
        const enderecoEntrega = enderecoMetadata && typeof enderecoMetadata === 'object'
            ? Object.fromEntries(['rua', 'numero', 'bairro', 'cep', 'cidade']
                .filter((campo) => enderecoMetadata[campo] != null)
                .map((campo) => [campo, String(enderecoMetadata[campo]).trim()]))
            : null;

        let linhasMetadata = checkoutPagamento?.itens?.map((item) => ({
            id_produto: item.idProduto,
            nome_produto: item.nomeProduto,
            quantidade: item.quantidade,
            opcao_selecionada: item.opcaoSelecionada,
            id_lojista: item.idLoja,
            nome_loja: item.nomeLoja,
            subtotal_centavos: item.subtotalCentavos
        })) || metadata.itens_carrinho;
        if (typeof linhasMetadata === 'string') {
            try { linhasMetadata = JSON.parse(linhasMetadata); } catch (erro) { linhasMetadata = null; }
        }
        const pagamentoLegado = !checkoutPagamento && (!Array.isArray(linhasMetadata) || linhasMetadata.length === 0);
        if (pagamentoLegado) {
            const idProdutoLegado = String(metadata.id_produto || '');
            if (!idProdutoLegado) throw new Error(`Pagamento ${idPagamento} não contém itens para criar os pedidos.`);
            linhasMetadata = [{
                id_produto: idProdutoLegado,
                quantidade: 1,
                nome_produto: dadosPagamento.description || 'Produto',
                id_lojista: String(metadata.id_lojista || ''),
                nome_loja: String(metadata.nome_loja || ''),
                subtotal_centavos: valorBrutoCentavos.toString()
            }];
        }
        if (!Array.isArray(linhasMetadata) || linhasMetadata.length === 0) {
            throw new Error(`Pagamento ${idPagamento} não contém itens para criar os pedidos.`);
        }
        if (linhasMetadata.length > 50) throw new Error(`Pagamento ${idPagamento} contém mais de 50 itens.`);

        const linhasPedido = linhasMetadata.map((linha, indice) => {
            if (!linha || typeof linha !== 'object') {
                throw new Error(`Linha ${indice + 1} inválida nos metadados do pagamento ${idPagamento}.`);
            }
            const idProdutoLinha = String(linha.id_produto || linha.idProduto || '').trim();
            const quantidade = linha.quantidade == null ? 1 : Number(linha.quantidade);
            if (!mongoose.Types.ObjectId.isValid(idProdutoLinha) || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 99) {
                throw new Error(`Linha ${indice + 1} inválida nos metadados do pagamento ${idPagamento}.`);
            }
            const subtotalTexto = linha.subtotal_centavos == null
                ? (linhasMetadata.length === 1 ? valorBrutoCentavos.toString() : '')
                : String(linha.subtotal_centavos);
            if (!/^\d+$/.test(subtotalTexto)) {
                throw new Error(`Subtotal ausente ou inválido na linha ${indice + 1} do pagamento ${idPagamento}.`);
            }
            return {
                indice,
                idProduto: idProdutoLinha,
                quantidade,
                opcaoSelecionada: linha.opcao_selecionada == null ? null : String(linha.opcao_selecionada),
                nomeProduto: String(linha.nome_produto || linha.nomeProduto || '').trim(),
                idLoja: String(linha.id_lojista || linha.idLoja || '').trim(),
                nomeLoja: String(linha.nome_loja || linha.nomeLoja || '').trim(),
                subtotalCentavos: BigInt(subtotalTexto)
            };
        });
        const totalMetadataCentavos = linhasPedido.reduce((soma, linha) => soma + linha.subtotalCentavos, 0n);
        if (totalMetadataCentavos !== valorBrutoCentavos) {
            throw new Error(`A soma dos itens não corresponde ao valor aprovado no pagamento ${idPagamento}.`);
        }
        if (checkoutPagamento) {
            const totalCheckout = String(checkoutPagamento.valorTotalCentavos || '');
            if (!/^\d+$/.test(totalCheckout) || BigInt(totalCheckout) !== valorBrutoCentavos) {
                throw new Error(`O total salvo no checkout não corresponde ao pagamento ${idPagamento}.`);
            }
        }

        // Consolida linhas repetidas do carrinho para gerar um único pedido por
        // produto e lojista, preservando subtotal e quantidades de variações.
        const linhasAgrupadas = linhasPedido.reduce((grupos, linha) => {
            const idLojaAgrupamento = linha.idLoja
                ? linha.idLoja.toLowerCase()
                : `nome:${linha.nomeLoja.trim().toLocaleLowerCase('pt-BR')}`;
            const chave = JSON.stringify([linha.idProduto.toLowerCase(), idLojaAgrupamento]);
            let grupo = grupos.get(chave);
            if (!grupo) {
                grupo = {
                    ...linha,
                    quantidade: 0,
                    subtotalCentavos: 0n,
                    opcoesPorValor: new Map()
                };
                grupos.set(chave, grupo);
            }

            grupo.quantidade += linha.quantidade;
            grupo.subtotalCentavos += linha.subtotalCentavos;
            const opcao = linha.opcaoSelecionada == null || !String(linha.opcaoSelecionada).trim()
                ? null
                : String(linha.opcaoSelecionada).trim();
            const chaveOpcao = opcao || '';
            const opcaoAgrupada = grupo.opcoesPorValor.get(chaveOpcao) || { opcao, quantidade: 0 };
            opcaoAgrupada.quantidade += linha.quantidade;
            grupo.opcoesPorValor.set(chaveOpcao, opcaoAgrupada);
            return grupos;
        }, new Map());
        const pedidosAgrupados = Array.from(linhasAgrupadas.values()).map((grupo, indice) => {
            const opcoesSelecionadas = Array.from(grupo.opcoesPorValor.values());
            const { opcoesPorValor, ...dadosGrupo } = grupo;
            return {
                ...dadosGrupo,
                indice,
                opcaoSelecionada: opcoesSelecionadas.length === 1 ? opcoesSelecionadas[0].opcao : null,
                opcoesSelecionadas
            };
        });

        await garantirIndicePedidoPorItem();
        // Em pagamentos antigos já existe um único pedido sem identificador de linha.
        // Associá-lo à linha zero preserva a idempotência após a migração do índice.
        if (pagamentoLegado) {
            await Pedido.updateOne(
                { idPagamento, $or: [{ idItemPagamento: { $exists: false } }, { idItemPagamento: null }] },
                { $set: { idItemPagamento: '0' } }
            );
        }

        const idsProdutos = [...new Set(pedidosAgrupados.map((linha) => linha.idProduto))];
        const produtos = await Produto.find({ _id: { $in: idsProdutos } });
        const produtosPorId = new Map(produtos.map((produto) => [produto._id.toString(), produto]));
        let lojaNaoEncontrada = false;

        // Um pedido por produto/lojista; a chave pagamento + grupo evita duplicados
        // quando o Mercado Pago reenvia a notificação do mesmo pagamento.
        for (const linha of pedidosAgrupados) {
            const produto = produtosPorId.get(linha.idProduto);
            const filtrosLoja = [];
            if (/^[a-f\d]{24}$/i.test(linha.idLoja)) {
                filtrosLoja.push({ _id: new mongoose.Types.ObjectId(linha.idLoja) });
            }
            const nomeLojaBusca = linha.nomeLoja || String((produto && produto.nomeLoja) || '').trim();
            if (nomeLojaBusca) {
                const nomeEscapado = nomeLojaBusca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                filtrosLoja.push({ nome: { $regex: `^${nomeEscapado}$`, $options: 'i' } });
            }
            const lojaInfo = filtrosLoja.length
                ? await Usuario.findOne({ tipo: 'loja', $or: filtrosLoja })
                : null;
            if (!lojaInfo) {
                lojaNaoEncontrada = true;
                console.error(`⚠️ Pagamento ${idPagamento} aprovado, mas a loja da linha ${linha.indice + 1} não foi encontrada. ID: ${linha.idLoja || '(ausente)'}; nome: ${nomeLojaBusca || '(ausente)'}.`);
            }

            const nomeDaLojaReal = lojaInfo ? lojaInfo.nome : (nomeLojaBusca || 'Loja Parceira');
            const imagemParaSalvar = produto && produto.imagens && produto.imagens.length
                ? produto.imagens[0]
                : 'https://via.placeholder.com/150';
            const idItemPagamento = String(linha.indice);

            const pedidoSalvo = await Pedido.findOneAndUpdate(
                { idPagamento, idItemPagamento },
                {
                    $set: {
                        lojaDona: nomeDaLojaReal,
                        idLoja: (lojaInfo && lojaInfo._id.toString()) || linha.idLoja || ''
                    },
                    $setOnInsert: {
                        idPagamento,
                        idItemPagamento,
                        idProduto: linha.idProduto,
                        idCliente,
                        nomeProduto: linha.nomeProduto || (produto && produto.titulo) || dadosPagamento.description || 'Produto',
                        quantidade: linha.quantidade,
                        opcaoSelecionada: linha.opcaoSelecionada,
                        opcoesSelecionadas: linha.opcoesSelecionadas,
                        valorTotal: Number(centavosParaDecimal(linha.subtotalCentavos)),
                        imagemProduto: imagemParaSalvar,
                        enderecoEntrega,
                        statusEntrega: 'Aguardando Envio',
                        dataCompra: dadosPagamento.date_approved ? new Date(dadosPagamento.date_approved) : new Date()
                    }
                },
                { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
            );

            const emailLoja = String(lojaInfo?.email || '').trim();
            if (pedidoSalvo && emailLoja) {
                // Claim atômico evita notificações duplicadas quando o Mercado Pago
                // reenviar o mesmo evento de pagamento aprovado.
                const pedidoParaNotificar = await Pedido.findOneAndUpdate(
                    { _id: pedidoSalvo._id, notificacaoVendaEnviada: { $ne: true } },
                    { $set: { notificacaoVendaEnviada: true } },
                    { returnDocument: 'after' }
                );

                if (pedidoParaNotificar) {
                    const numeroPedidoEmail = String(pedidoSalvo._id);
                    const nomeProdutoEmail = String(pedidoSalvo.nomeProduto || linha.nomeProduto || 'Produto').trim();
                    const nomeProdutoHtml = escaparHTMLDeEmail(nomeProdutoEmail);
                    const pedidoHtml = escaparHTMLDeEmail(numeroPedidoEmail);
                    const quantidadeEmail = Number(pedidoSalvo.quantidade || linha.quantidade || 1);
                    const quantidadeHtml = escaparHTMLDeEmail(String(quantidadeEmail));
                    const textoEmail = `Olá! Você acabou de realizar uma venda na Peça Bruta. Pedido #${numeroPedidoEmail}. Produto: ${nomeProdutoEmail}, Quantidade: ${quantidadeEmail}. Acesse o seu painel de lojista para ver os detalhes do pedido e preparar o envio.`;

                    try {
                        await transporter.sendMail({
                            from: process.env.SMTP_FROM,
                            replyTo: process.env.SMTP_USER,
                            to: emailLoja,
                            subject: 'Você tem um novo pedido! - Peça Bruta',
                            text: textoEmail,
                            html: `<div style="font-family: Arial, sans-serif; padding: 24px; color: #f4f4f4; max-width: 600px; margin: 0 auto; border: 1px solid #343434; border-radius: 12px; background: #171717;">
                                      <h2 style="color: #ff5a1f; text-align: center;">PEÇA BRUTA</h2>
                                      <p>Olá! Você acabou de realizar uma venda na Peça Bruta.</p>
                                      <div style="padding: 16px; margin: 20px 0; border: 1px solid #3b3b3b; border-radius: 8px; background: #222;">
                                          <p style="margin: 0 0 8px;"><strong>Pedido:</strong> #${pedidoHtml}</p>
                                          <p style="margin: 0 0 8px;"><strong>Produto:</strong> ${nomeProdutoHtml}</p>
                                          <p style="margin: 0;"><strong>Quantidade:</strong> ${quantidadeHtml}</p>
                                      </div>
                                      <p>Acesse o seu painel de lojista para ver os detalhes do pedido e preparar o envio.</p>
                                      <p style="font-size: 12px; color: #aaa; margin-top: 24px; border-top: 1px solid #343434; padding-top: 14px;">Notificação automática de uma venda confirmada na Peça Bruta.</p>
                                   </div>`
                        });
                    } catch (erroEmail) {
                        await Pedido.updateOne(
                            { _id: pedidoSalvo._id },
                            { $set: { notificacaoVendaEnviada: false } }
                        ).catch((erroReset) => console.error('Falha ao liberar nova tentativa de e-mail da venda:', erroReset.message));
                        throw erroEmail;
                    }
                }
            }
        }

        if (lojaNaoEncontrada) {
            // Registra os itens e solicita a repetição do webhook após corrigir a loja.
            return res.status(500).send('Pagamento aprovado, mas uma ou mais lojas não foram localizadas.');
        }

        if (checkoutPagamento) {
            await CheckoutPagamento.updateOne(
                { referencia: referenciaCheckout },
                { $set: { idPagamento, status: 'processado' } }
            );
        }

        return res.status(200).send('Webhook processado.');
    } catch (erro) {
        console.error("Erro fatal no Webhook:", erro);
        // Permite que o Mercado Pago tente novamente se uma dependência falhar.
        return res.status(500).send('Falha ao processar webhook.');
    }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => console.log(`🚀 MOTOR PEÇA BRUTA ATIVO NA PORTA ${port}`));
