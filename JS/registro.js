const API_URL = 'https://pe-abruta-3-0.onrender.com/api';
function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}
 // Registro do tempo de início para bloqueio de bots preenchedores instantâneos
        const formStartTime = Date.now();
        let emailCadastradoGlobal = ""; // Variável global para armazenar o email para reenvio e ativação

        // Função para mostrar/esconder senha
        function toggleSenha(id) {
            const input = document.getElementById(id);
            input.type = input.type === "password" ? "text" : "password";
        }

        // MELHORIA: Validação visual de senha forte em tempo real
        document.getElementById('senhaCliente').addEventListener('input', function(e) {
            const val = e.target.value;
            const feedback = document.getElementById('senhaFeedback');
            feedback.style.display = 'block';
            
            if (val.length === 0) {
                feedback.style.display = 'none';
            } else if (val.length < 8 || !/[A-Za-z]/.test(val) || !/\d/.test(val)) {
                feedback.className = 'password-strength strength-weak';
                feedback.innerText = '⚠️ Fraca: Use mínimo de 8 caracteres contendo letras e números.';
            } else {
                feedback.className = 'password-strength strength-strong';
                feedback.innerText = '✔️ Forte: Padrão de segurança atingido.';
            }
        });

        // Validação Algorítmica Real de CPF (Front-end)
        function validarCPF(cpf) {
            cpf = cpf.replace(/[^\d]+/g, '');
            if (cpf === '' || cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
            let soma = 0, resto;
            for (let i = 1; i <= 9; i++) soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
            resto = (soma * 10) % 11;
            if ((resto === 10) || (resto === 11)) resto = 0;
            if (resto != parseInt(cpf.substring(9, 10))) return false;
            soma = 0;
            for (let i = 1; i <= 10; i++) soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
            resto = (soma * 10) % 11;
            if ((resto === 10) || (resto === 11)) resto = 0;
            return resto == parseInt(cpf.substring(10, 11));
        }

        function validarEmail(email) {
            const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return re.test(String(email).toLowerCase());
        }

        document.getElementById('formRegistroCliente').onsubmit = async function(e) {
            e.preventDefault();

            // Defesa Anti-Bot Comportamental (Preenchimento rápido demais < 3 segundos)
            if (Date.now() - formStartTime < 3000) {
                console.warn("Automação detectada (Tempo de preenchimento irreal).");
                return;
            }

            // Defesa Anti-Bot (Honeypot)
            if (document.getElementById('website_url').value) {
                console.warn("Automação maliciosa detectada (Honeypot acionado).");
                return;
            }

            // Captura e Higienização de Dados
            const nomeInput = document.getElementById('nomeCliente').value.trim().replace(/\s+/g, ' ');
            const emailInput = document.getElementById('emailCliente').value.trim().toLowerCase();
            const cpfInput = document.getElementById('cpf').value;
            const telefoneInput = document.getElementById('telefoneCliente').value;
            const senha = document.getElementById('senhaCliente').value;
            const confirma = document.getElementById('confirmaSenha').value;
            const aceiteTermos = document.getElementById('aceiteTermos').checked;
            
            // Validações de Consistência
            if (nomeInput.split(' ').length < 2) {
                alert('Por favor, informe seu nome e sobrenome reais.');
                return;
            }

            if (!validarEmail(emailInput)) {
                alert('O e-mail informado não possui um formato válido.');
                return;
            }

            if (!validarCPF(cpfInput)) {
                alert('O número de CPF informado é inválido.');
                return;
            }

            const telefoneLimpo = telefoneInput.replace(/\D/g, '');
            if (telefoneLimpo.length < 10 || telefoneLimpo.length > 13) {
                alert('Insira um número de telefone válido, incluindo o código de área (DDD).');
                return;
            }

            const senhaRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
            if (!senhaRegex.test(senha)) {
                alert('A senha deve conter no mínimo 8 caracteres, incluindo letras e números.');
                return;
            }

            if (senha !== confirma) {
                alert('As senhas digitadas não coincidem!');
                return;
            }

            if (!aceiteTermos) {
                alert('Você deve ler e aceitar os Termos de Uso e Política de Privacidade.');
                return;
            }

            const turnstileToken = document.querySelector('[name="cf-turnstile-response"]')?.value?.trim();
            if (!turnstileToken) {
                alert('Conclua a validação de segurança para continuar.');
                return;
            }

            // Proteção contra múltiplos envios (Race Condition UI)
            const btnSubmit = document.getElementById('btnSubmitRegistro');
            const textoOriginalBtn = btnSubmit.innerText;
            btnSubmit.disabled = true;
            btnSubmit.innerText = 'PROCESSANDO...';

            const cpfLimpo = cpfInput.replace(/\D/g, '');

            // Payload com aderência jurídica e segurança extra
            const dados = {
                nome: nomeInput,
                email: emailInput,
                senha: senha,
                cpf: cpfLimpo, 
                telefone: telefoneLimpo, 
                tipo: "cliente",
                aceitouTermos: aceiteTermos,
                turnstileToken
            };

            const controllerRegistro = new AbortController();
            const timeoutRegistro = setTimeout(() => controllerRegistro.abort(), 25000);

            try {
                const response = await apiFetch(`${API_URL}/registrar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    mode: 'cors',
                    signal: controllerRegistro.signal,
                    body: JSON.stringify(dados)
                });

                const dadosResposta = await response.json().catch(() => ({}));

                const ativacaoPendente = dadosResposta.pendingActivation === true;
                if ((response.status === 201 && dadosResposta.success) || (ativacaoPendente && dadosResposta.email)) {
                    const emailParaAtivacao = dadosResposta.email || emailInput;
                    const nomeParaAtivacao = dadosResposta.nome || nomeInput;
                    emailCadastradoGlobal = emailParaAtivacao;
                    sessionStorage.setItem('emailVerificacao', emailParaAtivacao);
                    sessionStorage.setItem('usuarioNome', nomeParaAtivacao);
                    sessionStorage.setItem('usuarioEmail', emailParaAtivacao);
                    document.getElementById('emailCadastradoDisplay').innerText = emailParaAtivacao;
                    const textoAtivacao = document.getElementById('textoAtivacao');
                    if (textoAtivacao) {
                        textoAtivacao.innerText = ativacaoPendente && dadosResposta.emailSent === false
                            ? 'Sua conta foi salva como pendente, mas não conseguimos enviar o código agora. Clique em “Reenviar Código” para tentar novamente.'
                            : ativacaoPendente
                                ? 'Seu cadastro já está salvo e aguarda ativação. Digite o código recebido ou clique em “Reenviar Código”.'
                            : 'Enviamos um código de segurança de 6 dígitos para o e-mail:';
                    }
                    btnSubmit.disabled = false;
                    btnSubmit.innerText = textoOriginalBtn;
                    document.getElementById('modalSucesso').style.display = 'flex'; // Mostra o modal de código
                } else {
                    alert('Erro: ' + (dadosResposta.error || 'Não foi possível concluir o cadastro.'));
                    window.turnstile?.reset();
                    btnSubmit.disabled = false;
                    btnSubmit.innerText = textoOriginalBtn;
                }
            } catch (err) {
                console.error(err);
                if (err.name === 'AbortError') {
                    // O navegador desistiu de aguardar, mas o servidor pode já ter salvo a conta
                    // e enviado (ou ainda estar enviando) o código. Leva o usuário à etapa de ativação.
                    emailCadastradoGlobal = emailInput;
                    sessionStorage.setItem('emailVerificacao', emailInput);
                    sessionStorage.setItem('usuarioNome', nomeInput);
                    sessionStorage.setItem('usuarioEmail', emailInput);
                    document.getElementById('emailCadastradoDisplay').innerText = emailInput;
                    const textoAtivacao = document.getElementById('textoAtivacao');
                    if (textoAtivacao) {
                        textoAtivacao.innerText = 'O servidor demorou para confirmar. Sua conta pode estar pendente; informe o código se ele chegar ou clique em “Reenviar Código”.';
                    }
                    document.getElementById('modalSucesso').style.display = 'flex';
                } else {
                    alert('ERRO DE CONEXÃO: Verifique sua internet ou contate o suporte.');
                    window.turnstile?.reset();
                }
                btnSubmit.disabled = false;
                btnSubmit.innerText = textoOriginalBtn;
            } finally {
                clearTimeout(timeoutRegistro);
                btnSubmit.disabled = false;
                btnSubmit.innerText = textoOriginalBtn;
            }
        };

        // NOVA FUNÇÃO: Reenviar código
        async function reenviarEmailModal() {
            if (!emailCadastradoGlobal) return;

            const btnReenviar = document.getElementById('btnReenviarEmailModal');
            const textoOriginalBtnReenviar = btnReenviar.innerText;
            
            btnReenviar.disabled = true;
            btnReenviar.innerText = 'REENVIANDO...';

            try {
                const response = await apiFetch(`${API_URL}/reenviar-codigo`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: emailCadastradoGlobal })
                });

                const data = await response.json();

                if (response.ok) {
                    alert('E-mail de verificação reenviado com sucesso. Verifique sua caixa de entrada e também a pasta de spam.');
                } else {
                    alert('Erro ao reenviar e-mail: ' + (data.error || 'Falha desconhecida.'));
                }
            } catch (err) {
                console.error(err);
                alert('Erro de conexão ao tentar reenviar o código de verificação.');
            } finally {
                btnReenviar.disabled = false;
                btnReenviar.innerText = textoOriginalBtnReenviar;
            }
        }

        // NOVA FUNÇÃO: Validar código via POST
        async function verificarCodigo() {
            const emailVerificacao = sessionStorage.getItem('emailVerificacao');
            const codigoInput = document.getElementById('codigoAtivacao').value.trim();
            
            if(!codigoInput || codigoInput.length < 6) {
                alert("Por favor, digite o código completo de 6 dígitos.");
                return;
            }

            if(!emailVerificacao) {
                alert("Erro interno: E-mail não encontrado na sessão. Tente atualizar a página.");
                return;
            }

            const btnAtivar = document.getElementById('btnAtivarConta');
            const textoOriginalBtn = btnAtivar.innerText;
            
            btnAtivar.disabled = true;
            btnAtivar.innerText = 'VERIFICANDO...';

            try {
                const response = await apiFetch(`${API_URL}/verificar-codigo`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: emailVerificacao, codigo: codigoInput })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    alert(data.message || "Conta ativada com sucesso! Você será redirecionado para o Login.");
                    sessionStorage.removeItem('emailVerificacao');
                    window.location.href = "login.html";
                } else {
                    alert(data.error || 'Código inválido ou expirado. Verifique o código e tente novamente.');
                    document.getElementById('codigoAtivacao').value = '';
                }
            } catch (err) {
                console.error(err);
                alert('Erro de conexão ao tentar verificar o código.');
            } finally {
                btnAtivar.disabled = false;
                btnAtivar.innerText = textoOriginalBtn;
            }
        }

        // Permitir apenas números no campo de código
        document.getElementById('codigoAtivacao').addEventListener('input', function(e) {
            this.value = this.value.replace(/[^0-9]/g, '');
        });

        // Máscara inteligente para Telefone
        document.getElementById('telefoneCliente').addEventListener('input', function (e) {
            let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,2})(\d{0,5})(\d{0,4})/);
            e.target.value = !x[2] ? x[1] : "+55 (" + x[2] + ") " + x[3] + (x[4] ? "-" + x[4] : "");
        });

        // Máscara visual de CPF
        document.getElementById('cpf').addEventListener('input', function (e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0,11);
            if (value.length > 9) value = value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
            else if (value.length > 6) value = value.replace(/(\d{3})(\d{3})(\d{1,3})/, "$1.$2.$3");
            else if (value.length > 3) value = value.replace(/(\d{3})(\d{1,3})/, "$1.$2");
            e.target.value = value;
        });

        // Restaura a etapa de ativação se o cliente recarregar a página durante o cadastro.
        const emailPendenteAtivacao = sessionStorage.getItem('emailVerificacao');
        if (emailPendenteAtivacao && emailPendenteAtivacao !== 'undefined') {
            emailCadastradoGlobal = emailPendenteAtivacao;
            document.getElementById('emailCadastradoDisplay').innerText = emailPendenteAtivacao;
            document.getElementById('modalSucesso').style.display = 'flex';
        }
