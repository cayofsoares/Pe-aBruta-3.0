const API_URL = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? 'http://localhost:3000/api' : 'https://api.pecabruta.com.br/api';
function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}
        // Funções do Modal de Termos
        function abrirTermos() {
            document.getElementById('termsModal').style.display = 'flex';
        }
        function fecharTermos() {
            document.getElementById('termsModal').style.display = 'none';
        }

        // Função do Toast (Notificação Moderna)
        function showToast(message, isError = true) {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = `toast ${isError ? 'error' : ''}`;
            toast.innerText = message;
            
            container.appendChild(toast);

            // Animação de entrada
            setTimeout(() => toast.classList.add('show'), 10);

            // Tempo na tela (5 segundos) e animação de saída
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300); // Remove do DOM após sumir
            }, 5000);
        }

        // Função para exibir/ocultar senha
        function togglePass(id) {
            const input = document.getElementById(id);
            input.type = input.type === 'password' ? 'text' : 'password';
        }

        // Máscara Automática para CNPJ
        document.getElementById('cnpjInput').addEventListener('input', function (e) {
            let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,3})(\d{0,3})(\d{0,4})(\d{0,2})/);
            if (!x) { e.target.value = ''; return; }
            e.target.value = !x[2] ? x[1] : x[1] + '.' + x[2] + (x[3] ? '.' + x[3] : '') + (x[4] ? '/' + x[4] : '') + (x[5] ? '-' + x[5] : '');
        });

        // Máscara Automática para WhatsApp
        document.getElementById('whatsappEmpresa').addEventListener('input', function (e) {
            let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,5})(\d{0,4})/);
            if (!x) { e.target.value = ''; return; }
            e.target.value = !x[2] ? x[1] : '(' + x[1] + ') ' + x[2] + (x[3] ? '-' + x[3] : '');
        });

        document.getElementById('formEmpresa').onsubmit = async function(e) {
            e.preventDefault();
            const btnSubmit = document.getElementById('btnSubmit');
            const textoOriginal = btnSubmit.innerText;

            const razaoSocial = document.getElementById('razaoSocial').value.trim();
            const cnpj = document.getElementById('cnpjInput').value.trim();
            const email = document.getElementById('emailEmpresa').value.trim();
            const senha = document.getElementById('senhaEmpresa').value;
            const confirma = document.getElementById('confirmarSenha').value;
            const whatsapp = document.getElementById('whatsappEmpresa').value.trim();
            const instagram = document.getElementById('instagramEmpresa').value.trim();
            const site = document.getElementById('siteEmpresa').value.trim();
            const aceiteTermos = document.getElementById('aceiteTermos').checked;

            // Validação dos Termos de Uso
            if (!aceiteTermos) {
                showToast("Para enviar a solicitação, você precisa aceitar os Termos de Uso e Política de Privacidade.");
                return;
            }

            // Validação de campos vazios
            if (!razaoSocial || !cnpj || !email || !whatsapp) {
                showToast("Por favor, preencha todos os campos obrigatórios.");
                return;
            }

            // Validação de senhas iguais
            if(senha !== confirma) {
                showToast("Atenção: As senhas digitadas não coincidem. Verifique e tente novamente.");
                return;
            }

            // Validação de Senha Forte
            const senhaRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
            if (!senhaRegex.test(senha)) {
                showToast("Por segurança, sua senha deve conter no mínimo 8 caracteres, incluindo letras e números.");
                return;
            }

            // Validação de URL (Site da Empresa)
            if (site && !site.match(/^https?:\/\/.+\..+/)) {
                showToast("O link do site inserido é inválido. Certifique-se de incluir 'http://' ou 'https://'.");
                return;
            }

            // Objeto limpo apenas com o que o backend precisa
            // NENHUMA data ou status é gerado aqui. O backend é 100% responsável.
            const dadosSolicitacao = {
                loja: razaoSocial,
                cnpj: cnpj,
                email: email,
                senha: senha,
                whatsapp: whatsapp,
                instagram: instagram,
                site: site
            };

            // Trava de segurança no botão para evitar duplo clique
            btnSubmit.disabled = true;
            btnSubmit.innerText = "PROCESSANDO...";

            try {
                const response = await apiFetch(`${API_URL}/cadastro-empresa`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dadosSolicitacao)
                });
                
                const result = await response.json();

                if(response.ok) {
                    document.getElementById('successModal').style.display = 'flex';
                } else {
                    showToast(result.error || 'Ocorreu um erro ao processar sua solicitação. Tente novamente.');
                }
            } catch (err) {
                console.error("Erro de requisição:", err);
                showToast('Erro de conexão: Não foi possível se comunicar com o servidor. Verifique sua internet.');
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.innerText = textoOriginal;
            }
        };