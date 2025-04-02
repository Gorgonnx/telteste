console.log("[INFO] content.js injetado - INÍCIO");

// Adiciona um log para verificar se o DOM já está carregado
console.log("[DEBUG] Estado inicial do DOM:", document.readyState);

// Constantes
const URL_DESEJADA_BASE = "/lisagente/index.php";
const INTERVALO_VERIFICACAO_MICROSIP = 10000; // 10 segundos
const COOLDOWN_ALERTA_MICROSIP = 15000; // 15 segundos
const COR_INATIVA_MICROSIP = { r: 150, g: 148, b: 148 }; // #969494
const TOLERANCIA_COR = 5; // Permite uma variação de ±5

// Função para esperar o elemento #status_agente
function esperarElementoStatusAgente(callback) {
  const statusAgente = document.getElementById('status_agente');
  if (statusAgente) {
    console.log("[DEBUG] Elemento #status_agente encontrado imediatamente");
    callback(statusAgente);
    return;
  }

  console.log("[DEBUG] Elemento #status_agente não encontrado, iniciando observação...");
  const observer = new MutationObserver((mutations, obs) => {
    const statusAgente = document.getElementById('status_agente');
    if (statusAgente) {
      console.log("[DEBUG] Elemento #status_agente encontrado dinamicamente");
      obs.disconnect();
      callback(statusAgente);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Função para comparar cores com tolerância
function isCorInativa(cor) {
  const rgb = cor.match(/\d+/g).map(Number);
  return Math.abs(rgb[0] - COR_INATIVA_MICROSIP.r) <= TOLERANCIA_COR &&
         Math.abs(rgb[1] - COR_INATIVA_MICROSIP.g) <= TOLERANCIA_COR &&
         Math.abs(rgb[2] - COR_INATIVA_MICROSIP.b) <= TOLERANCIA_COR;
}

// Função principal que contém a lógica
function iniciarLogica() {
  console.log("[INFO] Iniciando lógica do content.js");

  // Verifica se a URL é a desejada (baseada em caminho e parâmetros)
  const urlAtualBase = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  const go = params.get('go');

  console.log("[DEBUG] Verificando URL. Caminho atual:", urlAtualBase, "Parâmetros: action=", action, "go=", go);

  if (urlAtualBase !== URL_DESEJADA_BASE || action !== "index" || go !== "home") {
    console.log("[INFO] URL atual não corresponde à URL desejada. URL atual:", window.location.href, "Parâmetros esperados: action=index, go=home");
    return;
  }

  console.log("[SUCCESS] URL correspondida:", window.location.href);

  // Espera o elemento #status_agente
  esperarElementoStatusAgente((statusAgente) => {
    console.log("[DEBUG] Elemento #status_agente encontrado, prosseguindo...");

    // Função auxiliar para verificar e enviar mensagens
    function sendMessageWithContext(action, data, callback) {
      try {
        chrome.runtime.sendMessage({ ...data, action }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("[WARN] Contexto da extensão inválido:", chrome.runtime.lastError.message);
            if (callback) callback({ success: false, error: chrome.runtime.lastError.message });
          } else if (response) {
            if (callback) callback(response);
          } else {
            console.error("[ERROR] Sem resposta do background para:", action);
            if (callback) callback({ success: false, error: "Sem resposta" });
          }
        });
      } catch (error) {
        console.error("[ERROR] Erro ao enviar mensagem:", error.message);
        if (callback) callback({ success: false, error: error.message });
      }
    }

    // Função para enviar mensagem ao background.js
    function iniciarTemporizador(tipoPausa) {
      sendMessageWithContext("iniciarTemporizador", { tipoPausa }, (response) => {
        if (response?.success) {
          console.log("Temporizador iniciado para:", tipoPausa);
          atualizarTempoNoDOM(tipoPausa);
        } else {
          console.error("Falha ao iniciar temporizador para:", tipoPausa, response?.error);
        }
      });
    }

    // Função para parar o temporizador
    function pararTemporizador() {
      sendMessageWithContext("pararTemporizador", {}, (response) => {
        if (response?.success) {
          console.log("Temporizador parado com sucesso.");
          const spanTempo = document.getElementById('duration_pausa');
          if (spanTempo) spanTempo.textContent = "00:00:00";
        } else {
          console.error("Falha ao parar temporizador.", response?.error);
        }
      });
    }

    // Ativa o service worker ao carregar a página
    sendMessageWithContext("ativarServiceWorker", {}, (response) => {
      if (response?.success) {
        console.log("[INIT] Service worker ativado ao carregar página");
      } else {
        console.error("[ERROR] Falha ao ativar service worker ao carregar", response?.error);
      }
    });

    // Mantém o service worker ativo com intervalo mais curto
    setInterval(() => {
      sendMessageWithContext("keepAlive", {}, (response) => {
        if (response?.success) {
          console.log("[KEEP-ALIVE] Background mantido ativo:", Date.now());
        } else {
          console.error("[ERROR] Falha ao manter background ativo", response?.error);
        }
      });
    }, 2000);

    // Função para atualizar o tempo no DOM (mostrando tempo decorrido)
    function atualizarTempoNoDOM(tipoPausa) {
      const spanTempo = document.getElementById('duration_pausa');
      if (!spanTempo) return;

      function formatarTempo(segundos) {
        const horas = Math.floor(segundos / 3600);
        const minutos = Math.floor((segundos % 3600) / 60);
        const segs = segundos % 60;
        return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}:${segs.toString().padStart(2, '0')}`;
      }

      function atualizar() {
        sendMessageWithContext("atualizarTempo", { tipoPausa }, (response) => {
          if (response?.tempoRestante !== undefined) {
            const tempoDecorrido = TIPOS_PAUSA[tipoPausa.toUpperCase()] - response.tempoRestante || 0;
            spanTempo.textContent = formatarTempo(tempoDecorrido);
            if (response.tempoRestante <= 0) {
              console.log(`[ALERT] Tempo excedido para ${tipoPausa}, disparando popup manualmente`);
              pararTemporizador();
            } else {
              setTimeout(atualizar, 1000);
            }
          } else {
            console.error("[ERROR] Falha ao atualizar tempo", response?.error);
          }
        });
      }

      atualizar();
    }

    // Monitora cliques para iniciar ou trocar pausa
    function adicionarListeners() {
      document.querySelectorAll('.click_pausar, .click_trocar_pausa').forEach(botao => {
        botao.removeEventListener('click', handleIniciarClick);
        botao.addEventListener('click', handleIniciarClick);
      });
      document.querySelectorAll('.retirar_pausa').forEach(botao => {
        botao.removeEventListener('click', handlePararClick);
        botao.addEventListener('click', handlePararClick);
      });
    }

    function handleIniciarClick(event) {
      const botao = event.target.closest('.click_pausar, .click_trocar_pausa');
      if (botao) {
        let tipoPausa;
        if (botao.classList.contains('click_pausar')) {
          tipoPausa = botao.getAttribute('name');
        } else if (botao.classList.contains('click_trocar_pausa')) {
          tipoPausa = botao.textContent.trim().toUpperCase();
        }
        if (tipoPausa) iniciarTemporizador(tipoPausa);
      }
    }

    function handlePararClick(event) {
      const botao = event.target.closest('.retirar_pausa');
      if (botao) {
        pararTemporizador();
      }
    }

    // Adiciona listeners iniciais e observa mudanças no DOM
    adicionarListeners();
    const observer = new MutationObserver(() => {
      adicionarListeners();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // --- Monitoramento do MicroSIP ---
    let ultimoAlertaMicroSIP = 0;

    function verificarMicroSIP() {
      const statusAgente = document.getElementById('status_agente');
      const listaPausas = document.getElementById('lista_pausas');

      if (!statusAgente) {
        console.log("[WARN] Elemento #status_agente não encontrado");
        return;
      }

      // Verifica se há uma pausa ativa (ignorar MicroSIP durante pausas)
      const pausaAtiva = listaPausas && listaPausas.style.display !== 'none';
      if (pausaAtiva) {
        console.log("[INFO] Pausa ativa, ignorando verificação do MicroSIP");
        return;
      }

      const cor = statusAgente.style.color;
      const agora = Date.now();

      if (isCorInativa(cor)) { // Usa a função isCorInativa
        if (agora - ultimoAlertaMicroSIP >= COOLDOWN_ALERTA_MICROSIP) {
          console.log("[ALERT] MicroSIP inativo detectado!");
          sendMessageWithContext("microsipInactiveAlert", {}, (response) => {
            if (response?.success) {
              console.log("[SUCCESS] Alerta de MicroSIP inativo disparado");
              ultimoAlertaMicroSIP = agora;
            } else {
              console.error("[ERROR] Falha ao disparar alerta de MicroSIP inativo", response?.error);
            }
          });
        } else {
          console.log("[INFO] MicroSIP inativo, mas em cooldown de alerta");
        }
      } else {
        console.log("[INFO] MicroSIP ativo (cor:", cor, ")");
      }
    }

    // Inicia o monitoramento do MicroSIP
    setInterval(verificarMicroSIP, INTERVALO_VERIFICACAO_MICROSIP);

    // Observa mudanças no #status_agente
    const statusObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          console.log("[DEBUG] Mudança detectada no estilo de #status_agente");
          verificarMicroSIP();
        }
      });
    });

    statusObserver.observe(statusAgente, { attributes: true, attributeFilter: ['style'] });
  });
}

// Executa a lógica imediatamente se o DOM já estiver carregado
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  console.log("[DEBUG] DOM já está carregado, executando lógica imediatamente");
  iniciarLogica();
} else {
  // Caso contrário, espera o evento DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    console.log("[INFO] DOM carregado - content.js executado");
    iniciarLogica();
  });
}