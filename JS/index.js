let promptInstalacaoPendente = null;

(() => {
    const botaoInstalar = document.getElementById('btnInstalarAplicativo');
    const dialogoInstrucoes = document.getElementById('installGuide');
    const textoInstrucoes = document.getElementById('installGuideText');
    const botaoFecharInstrucoes = document.getElementById('btnFecharInstrucoes');
    function irParaSistema() {
        window.location.href = 'feed.html';
    }

    window.irParaSistema = irParaSistema;

    function estaInstalado() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    function esconderBotao() {
        botaoInstalar.style.display = 'none';
        botaoInstalar.setAttribute('aria-hidden', 'true');
    }

    function mostrarBotao() {
        botaoInstalar.style.display = 'inline-flex';
        botaoInstalar.removeAttribute('aria-hidden');
    }

    function mostrarInstrucoes(texto) {
        textoInstrucoes.textContent = texto;
        if (typeof dialogoInstrucoes.showModal === 'function') {
            dialogoInstrucoes.showModal();
        } else {
            window.alert(texto);
        }
    }

    if (botaoInstalar) {
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        if (estaInstalado()) {
            esconderBotao();
        } else if (ios) {
            // iOS não dispara beforeinstallprompt: instalação é iniciada pelo menu Compartilhar.
            mostrarBotao();
        }

        window.addEventListener('beforeinstallprompt', (evento) => {
            evento.preventDefault();
            promptInstalacaoPendente = evento;
            mostrarBotao();
        });

        botaoInstalar.addEventListener('click', async () => {
            if (promptInstalacaoPendente) {
                const eventoInstalacao = promptInstalacaoPendente;
                promptInstalacaoPendente = null;
                botaoInstalar.disabled = true;

                try {
                    await eventoInstalacao.prompt();
                    await eventoInstalacao.userChoice;
                    esconderBotao();
                } catch (erro) {
                    console.error('Não foi possível abrir o prompt de instalação:', erro);
                    mostrarBotao();
                } finally {
                    botaoInstalar.disabled = false;
                }
                return;
            }

            if (ios) {
                mostrarInstrucoes('No iPhone ou iPad, toque em Compartilhar no navegador e escolha “Adicionar à Tela de Início”. Depois confirme em “Adicionar”.');
                return;
            }

            mostrarInstrucoes('Para instalar, abra o menu do navegador e escolha “Instalar Peça Bruta” ou “Adicionar à tela inicial”, se essa opção estiver disponível.');
        });

        window.addEventListener('appinstalled', () => {
            promptInstalacaoPendente = null;
            esconderBotao();
        });
    }

    if (botaoFecharInstrucoes && dialogoInstrucoes) {
        botaoFecharInstrucoes.addEventListener('click', () => dialogoInstrucoes.close());
        dialogoInstrucoes.addEventListener('click', (evento) => {
            if (evento.target === dialogoInstrucoes) dialogoInstrucoes.close();
        });
    }

    if ('serviceWorker' in navigator && window.isSecureContext) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .catch((erro) => console.error('Falha ao registrar o service worker:', erro));
        });
    }
})();
