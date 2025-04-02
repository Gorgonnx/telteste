document.addEventListener('DOMContentLoaded', () => {
  const PARAMS = new URLSearchParams(window.location.search);
  const MENSAGEM = PARAMS.get('mensagem') ? decodeURIComponent(PARAMS.get('mensagem')) : "Tempo de pausa excedido!";
  const TIPO_PAUSA = PARAMS.get('tipoPausa') ? decodeURIComponent(PARAMS.get('tipoPausa')) : "";
  const MENSAGEM_ELEMENT_ID = 'mensagem';
  const BOTAO_FECHAR_ID = 'fecharBtn';

  console.log("[DEBUG] Mensagem recebida:", MENSAGEM, "Tipo de pausa:", TIPO_PAUSA);

  exibirMensagem(MENSAGEM, MENSAGEM_ELEMENT_ID);
  registrarEventoClique(BOTAO_FECHAR_ID);

  function exibirMensagem(mensagem, elementoId) {
    const mensagemElement = document.getElementById(elementoId);
    if (mensagemElement) {
      mensagemElement.textContent = mensagem;
      console.log("[SUCCESS] Mensagem exibida:", mensagem);
    } else {
      console.error("[ERROR] Elemento 'mensagem' não encontrado");
    }
  }

  function registrarEventoClique(botaoId) {
    const botao = document.getElementById(botaoId);
    if (botao) {
      botao.addEventListener('click', () => {
        console.log("[DEBUG] Botão OK clicado, fechando popup e notificando background");
        enviarMensagemFechamento();
        window.close();
      });
      console.log("[SUCCESS] Evento de clique registrado no botão OK");
    } else {
      console.error("[ERROR] Botão 'fecharBtn' não encontrado");
    }
  }

  function enviarMensagemFechamento(retries = 3) {
    if (retries <= 0) {
      console.error("[ERROR] Não foi possível enviar mensagem após múltiplas tentativas.");
      return;
    }

    try {
      chrome.runtime.sendMessage({ action: "popupClosed" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[WARN] Falha ao enviar mensagem de fechamento:", chrome.runtime.lastError.message);
          setTimeout(() => enviarMensagemFechamento(retries - 1), 1000);
        } else {
          console.log("[SUCCESS] Mensagem de fechamento enviada ao background");
        }
      });
    } catch (error) {
      console.error("[ERROR] Erro inesperado ao enviar mensagem:", error);
      setTimeout(() => enviarMensagemFechamento(retries - 1), 1000);
    }
  }
});

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

  const statusAtual = window.getComputedStyle(statusAgente).color;
  const agora = Date.now();

  if (isCorInativa(statusAtual)) {
    if (agora - ultimoAlertaMicroSIP >= COOLDOWN_ALERTA_MICROSIP) {
      console.log("[ALERT] MicroSIP inativo detectado! Cor:", statusAtual);
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
    console.log("[INFO] MicroSIP ativo (cor:", statusAtual, ")");
  }
}

function isCorInativa(cor) {
  const rgb = cor.match(/\d+/g).map(Number);
  return Math.abs(rgb[0] - COR_INATIVA_MICROSIP.r) <= TOLERANCIA_COR &&
         Math.abs(rgb[1] - COR_INATIVA_MICROSIP.g) <= TOLERANCIA_COR &&
         Math.abs(rgb[2] - COR_INATIVA_MICROSIP.b) <= TOLERANCIA_COR;
}

// Adiciona o evento DOMContentLoaded para iniciar o monitoramento
document.addEventListener('DOMContentLoaded', () => {
  console.log("[INFO] DOM carregado - content.js executado");
  setInterval(verificarMicroSIP, INTERVALO_VERIFICACAO_MICROSIP);
});